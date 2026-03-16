param(
  [string]$BaseUrl = 'http://localhost:4000',
  [switch]$LeaveApiRunning,
  [switch]$UseRunningApi
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

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

function Test-PortReady {
  param([int]$Port)

  $result = Test-NetConnection localhost -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

function Wait-ApiReady {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) {
      throw "La API termino antes de quedar lista. ExitCode=$($Process.ExitCode)."
    }

    try {
      $response = Invoke-RestMethod -Method 'GET' -Uri $Url -TimeoutSec 5
      if ($response.status -eq 'ok') {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "La API no estuvo disponible en $Url dentro de $TimeoutSeconds segundos."
}

Push-Location $repoRoot
try {
  Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'verify') -ErrorMessage 'La verificacion previa fallo.'
  & (Join-Path $PSScriptRoot 'start-infra.ps1')

  $apiWasAlreadyRunning = Test-PortReady -Port 4000
  $apiProcess = $null

  if ($apiWasAlreadyRunning -and -not $UseRunningApi) {
    throw 'Ya existe un proceso escuchando en localhost:4000. Detenlo antes de validate:local o usa -UseRunningApi si quieres validar explicitamente contra esa instancia.'
  }

  if (-not $apiWasAlreadyRunning) {
    $apiProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList '--workspace', 'apps/api', 'run', 'start' -WorkingDirectory $repoRoot -PassThru
    Wait-ApiReady -Url "$BaseUrl/api/health/live" -Process $apiProcess
  }

  try {
    & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $BaseUrl -Mode full
  }
  finally {
    if ($apiProcess -and -not $LeaveApiRunning) {
      Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
finally {
  Pop-Location
}

Write-Host 'Validacion local completa: verify + infraestructura + smoke tests.'
