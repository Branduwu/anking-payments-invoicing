param(
  [switch]$ForcePrismaGenerate
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $repoRoot 'apps/api/prisma/schema.prisma'
$generatedClientPath = Join-Path $repoRoot 'apps/api/node_modules/.prisma/client/index.d.ts'
$npmCommand = $null

. (Join-Path $PSScriptRoot 'common.ps1')

function Invoke-NpmCommandCapture {
  param(
    [string]$Executable,
    [string[]]$Arguments
  )

  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    $escapedSegments = @('"' + ($Executable -replace '"', '\"') + '"')
    $escapedSegments += $Arguments | ForEach-Object {
      if ($_ -match '\s') {
        '"' + ($_ -replace '"', '\"') + '"'
      } else {
        $_
      }
    }

    $commandText = "$($escapedSegments -join ' ') 2>&1"
    $output = & cmd.exe /d /c $commandText
    $exitCode = $LASTEXITCODE
  } else {
    $output = & $Executable @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  }

  foreach ($line in $output) {
    Write-Host $line
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = ($output | Out-String)
  }
}

function Test-PortReady {
  param([int]$Port)

  return Test-TcpPort -HostName 'localhost' -Port $Port
}

function Test-PrismaClientFresh {
  param(
    [string]$SchemaPath,
    [string]$GeneratedClientPath
  )

  if (-not (Test-Path $GeneratedClientPath) -or -not (Test-Path $SchemaPath)) {
    return $false
  }

  $schemaItem = Get-Item $SchemaPath
  $clientItem = Get-Item $GeneratedClientPath
  return $clientItem.LastWriteTimeUtc -ge $schemaItem.LastWriteTimeUtc
}

function Invoke-PrismaGenerateWithRetry {
  param([int]$MaxAttempts = 3)

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    $result = Invoke-NpmCommandCapture -Executable $npmCommand -Arguments @('run', 'prisma:generate')
    if ($result.ExitCode -eq 0) {
      return $result
    }

    $isWindowsEngineLock =
      $result.Output -match 'EPERM: operation not permitted, rename' -and
      $result.Output -match 'query_engine-windows\.dll\.node'

    if (-not $isWindowsEngineLock -or $attempt -eq $MaxAttempts) {
      return $result
    }

    Write-Warning "Prisma generate pego con un bloqueo transitorio del engine en Windows. Reintentando ($attempt/$MaxAttempts)..."
    Start-Sleep -Seconds 2
  }
}

function Test-WebBuildSpawnIssue {
  param([string]$Output)

  $isWindowsHost = $IsWindows -or $env:OS -eq 'Windows_NT'
  return $isWindowsHost -and
    $Output -match 'spawn EPERM' -and
    $Output -match 'vite|esbuild'
}

Push-Location $repoRoot
try {
  $npmCommand = Get-NpmCommand
  $apiRunning = Test-PortReady -Port 4000

  if ($apiRunning) {
    Write-Warning 'Se detecto un proceso escuchando en localhost:4000. Prisma generate puede fallar si el engine esta bloqueado por una API en ejecucion.'
  }

  $shouldContinueWithoutGenerate = $false

  $prismaGenerateResult = Invoke-PrismaGenerateWithRetry
  if ($prismaGenerateResult.ExitCode -ne 0) {
    $clientFresh = Test-PrismaClientFresh -SchemaPath $schemaPath -GeneratedClientPath $generatedClientPath
    $prismaEngineLocked =
      $prismaGenerateResult.Output -match 'EPERM: operation not permitted, rename' -and
      $prismaGenerateResult.Output -match 'query_engine-windows\.dll\.node'

    if (-not $ForcePrismaGenerate -and $clientFresh -and ($apiRunning -or $prismaEngineLocked)) {
      Write-Warning 'Prisma generate fallo, pero el cliente generado ya esta al dia respecto a schema.prisma. Continuando con build y test.'
      Write-Warning 'Si cambiaste schema.prisma o migraciones y tienes la API en watch mode, detenla y ejecuta npm run verify:full.'
      $shouldContinueWithoutGenerate = $true
    } else {
      throw 'Prisma generate fallo. Si tienes una API en watch mode abierta, detenla y vuelve a ejecutar la verificacion. Si acabas de cambiar schema.prisma, usa npm run verify:full.'
    }
  }

  if (-not $shouldContinueWithoutGenerate) {
    Write-Host 'Prisma client generado correctamente.'
  }

  $apiBuildResult = Invoke-NpmCommandCapture -Executable $npmCommand -Arguments @('run', 'build:api')
  if ($apiBuildResult.ExitCode -ne 0) {
    throw 'La compilacion de la API fallo durante verify.'
  }

  $webBuildResult = Invoke-NpmCommandCapture -Executable $npmCommand -Arguments @('run', 'build:web')
  if ($webBuildResult.ExitCode -ne 0) {
    if (Test-WebBuildSpawnIssue -Output $webBuildResult.Output) {
      Write-Warning 'La compilacion del frontend pego con un bloqueo local de Vite/esbuild en Windows (spawn EPERM). Se continua porque lint:web y el E2E browser-based siguen cubriendo el panel.'
      Write-Warning 'Si quieres forzar el build web en esta maquina, prueba en WSL/Linux o revisa politicas locales que bloqueen el spawn del servicio de esbuild.'
    } else {
      throw 'La compilacion del frontend fallo durante verify.'
    }
  }

  & $npmCommand 'run' 'test'
  if ($LASTEXITCODE -ne 0) {
    throw 'Los tests fallaron durante verify.'
  }
}
finally {
  Pop-Location
}

Write-Host 'Verify completado correctamente.'
