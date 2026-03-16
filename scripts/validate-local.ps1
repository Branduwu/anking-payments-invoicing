param(
  [string]$BaseUrl = 'http://localhost:4000',
  [switch]$LeaveApiRunning,
  [switch]$UseRunningApi
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps/api'
$rootEnvPath = Join-Path $repoRoot '.env'
$apiEnvPath = Join-Path $apiRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$ErrorMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

function Ensure-EnvFile {
  param(
    [string]$TargetPath,
    [string]$SourcePath
  )

  if (Test-Path $TargetPath) {
    return
  }

  Copy-Item -Path $SourcePath -Destination $TargetPath
  Write-Host "Creado archivo de entorno: $TargetPath"
}

function Sync-EnvFile {
  param(
    [string]$TargetPath,
    [string]$SourcePath
  )

  if (-not (Test-Path $SourcePath)) {
    throw "No existe el archivo fuente de entorno: $SourcePath"
  }

  if (-not (Test-Path $TargetPath)) {
    Copy-Item -Path $SourcePath -Destination $TargetPath
    Write-Host "Sincronizado archivo de entorno: $TargetPath"
    return
  }

  $sourceContent = Get-Content -Path $SourcePath -Raw
  $targetContent = Get-Content -Path $TargetPath -Raw

  if ($sourceContent -ceq $targetContent) {
    return
  }

  Copy-Item -Path $SourcePath -Destination $TargetPath -Force
  Write-Host "Actualizado archivo de entorno sincronizado: $TargetPath"
}

function Test-PortReady {
  param([int]$Port)

  $result = Test-NetConnection localhost -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

function Wait-ApiReady {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [string[]]$ExpectedStatuses = @('ok'),
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) {
      throw "La API termino antes de quedar lista. ExitCode=$($Process.ExitCode)."
    }

    try {
      $response = Invoke-RestMethod -Method 'GET' -Uri $Url -TimeoutSec 5
      if ($ExpectedStatuses -contains $response.status) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "La API no estuvo disponible en $Url dentro de $TimeoutSeconds segundos."
}

function Print-ApiLogs {
  param(
    [string]$StdOutPath,
    [string]$StdErrPath
  )

  if (Test-Path $StdOutPath) {
    Write-Warning 'Salida estandar reciente de la API:'
    Get-Content -Path $StdOutPath -Tail 100
  }

  if (Test-Path $StdErrPath) {
    Write-Warning 'Salida de error reciente de la API:'
    Get-Content -Path $StdErrPath -Tail 100
  }
}

function Stop-ApiProcessTree {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }

  try {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
  } catch {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

Ensure-EnvFile -TargetPath $rootEnvPath -SourcePath $envTemplatePath
Sync-EnvFile -TargetPath $apiEnvPath -SourcePath $rootEnvPath

Push-Location $repoRoot
try {
  Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'verify') -ErrorMessage 'La verificacion previa fallo.'
  Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'lint') -ErrorMessage 'Lint fallo antes de la validacion local.'
  & (Join-Path $PSScriptRoot 'start-infra.ps1')

  $apiWasAlreadyRunning = Test-PortReady -Port 4000
  $apiProcess = $null
  $apiStdOutLogPath = Join-Path $repoRoot '.validate-local-api.stdout.log'
  $apiStdErrLogPath = Join-Path $repoRoot '.validate-local-api.stderr.log'

  if ($apiWasAlreadyRunning -and -not $UseRunningApi) {
    throw 'Ya existe un proceso escuchando en localhost:4000. Detenlo antes de validate:local o usa -UseRunningApi si quieres validar explicitamente contra esa instancia.'
  }

  if (-not $apiWasAlreadyRunning) {
    Remove-Item $apiStdOutLogPath -ErrorAction SilentlyContinue
    Remove-Item $apiStdErrLogPath -ErrorAction SilentlyContinue
    $apiProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList '--workspace', 'apps/api', 'run', 'start' -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiStdOutLogPath -RedirectStandardError $apiStdErrLogPath
  }

  try {
    if (-not $apiWasAlreadyRunning) {
      try {
        Wait-ApiReady -Url "$BaseUrl/api/health/live" -Process $apiProcess -ExpectedStatuses @('ok')
        Wait-ApiReady -Url "$BaseUrl/api/health/ready" -Process $apiProcess -ExpectedStatuses @('ready')
      } catch {
        Print-ApiLogs -StdOutPath $apiStdOutLogPath -StdErrPath $apiStdErrLogPath
        throw
      }
    } else {
      Wait-ApiReady -Url "$BaseUrl/api/health/live" -Process $null -ExpectedStatuses @('ok')
      Wait-ApiReady -Url "$BaseUrl/api/health/ready" -Process $null -ExpectedStatuses @('ready')
    }

    try {
      & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $BaseUrl -Mode full
    } catch {
      if ($apiProcess) {
        Print-ApiLogs -StdOutPath $apiStdOutLogPath -StdErrPath $apiStdErrLogPath
      }

      throw
    }
  }
  finally {
    if ($apiProcess -and -not $LeaveApiRunning) {
      Stop-ApiProcessTree -Process $apiProcess
    }
  }
}
finally {
  Pop-Location
}

Write-Host 'Validacion local completa: verify + lint + infraestructura + smoke tests.'
