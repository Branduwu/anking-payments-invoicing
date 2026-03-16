param(
  [switch]$ForcePrismaGenerate
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $repoRoot 'apps/api/prisma/schema.prisma'
$generatedClientPath = Join-Path $repoRoot 'apps/api/node_modules/.prisma/client/index.d.ts'

function Test-PortReady {
  param([int]$Port)

  $result = Test-NetConnection localhost -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
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

Push-Location $repoRoot
try {
  $apiRunning = Test-PortReady -Port 4000

  if ($apiRunning) {
    Write-Warning 'Se detecto un proceso escuchando en localhost:4000. Prisma generate puede fallar si el engine esta bloqueado por una API en ejecucion.'
  }

  $shouldContinueWithoutGenerate = $false

  cmd /c npm run prisma:generate
  if ($LASTEXITCODE -ne 0) {
    $clientFresh = Test-PrismaClientFresh -SchemaPath $schemaPath -GeneratedClientPath $generatedClientPath

    if (-not $ForcePrismaGenerate -and $apiRunning -and $clientFresh) {
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

  cmd /c npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'La compilacion fallo durante verify.'
  }

  cmd /c npm run test
  if ($LASTEXITCODE -ne 0) {
    throw 'Los tests fallaron durante verify.'
  }
}
finally {
  Pop-Location
}

Write-Host 'Verify completado correctamente.'
