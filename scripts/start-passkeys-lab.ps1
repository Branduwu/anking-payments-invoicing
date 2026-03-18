param(
  [ValidateSet('localhost', '127.0.0.1')]
  [string]$HostName = 'localhost',
  [switch]$OpenBrowser,
  [switch]$SkipDemoSeed
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps/api'
$rootEnvPath = Join-Path $repoRoot '.env'
$apiEnvPath = Join-Path $apiRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'

$apiPidPath = Join-Path $repoRoot '.passkeys-lab-api.pid'
$webPidPath = Join-Path $repoRoot '.passkeys-lab-web.pid'
$apiStdOutLogPath = Join-Path $repoRoot '.passkeys-lab-api.stdout.log'
$apiStdErrLogPath = Join-Path $repoRoot '.passkeys-lab-api.stderr.log'
$webStdOutLogPath = Join-Path $repoRoot '.passkeys-lab-web.stdout.log'
$webStdErrLogPath = Join-Path $repoRoot '.passkeys-lab-web.stderr.log'

$apiUrl = "http://${HostName}:4000"
$apiBaseUrl = "$apiUrl/api"
$webUrl = "http://${HostName}:3000"

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
  param(
    [string]$TargetHost,
    [int]$Port
  )

  $result = Test-NetConnection $TargetHost -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [string[]]$ExpectedStatuses = @(),
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Method GET -Uri $Url -TimeoutSec 5
      if ($ExpectedStatuses.Count -eq 0) {
        return
      }

      if ($ExpectedStatuses -contains $response.status) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "No se pudo validar $Url dentro de $TimeoutSeconds segundos."
}

function Wait-WebReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Method GET -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "No se pudo validar el frontend en $Url dentro de $TimeoutSeconds segundos."
}

function Remove-StalePidFile {
  param([string]$PidPath)

  if (-not (Test-Path $PidPath)) {
    return
  }

  $pidValue = (Get-Content -Path $PidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $pidValue) {
    Remove-Item $PidPath -ErrorAction SilentlyContinue
    return
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item $PidPath -ErrorAction SilentlyContinue
  }
}

function Start-BackgroundProcess {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string]$PidPath,
    [string]$StdOutLogPath,
    [string]$StdErrLogPath
  )

  Remove-StalePidFile -PidPath $PidPath
  Remove-Item $StdOutLogPath -ErrorAction SilentlyContinue
  Remove-Item $StdErrLogPath -ErrorAction SilentlyContinue

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -PassThru `
    -RedirectStandardOutput $StdOutLogPath `
    -RedirectStandardError $StdErrLogPath

  Set-Content -Path $PidPath -Value $process.Id
  return $process
}

Ensure-EnvFile -TargetPath $rootEnvPath -SourcePath $envTemplatePath
Sync-EnvFile -TargetPath $apiEnvPath -SourcePath $rootEnvPath

Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'start-infra.ps1')

  if (-not $SkipDemoSeed) {
    Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'seed:webauthn-demo') -ErrorMessage 'No se pudo preparar el usuario demo de WebAuthn.'
  }

  $apiWasRunning = Test-PortReady -TargetHost $HostName -Port 4000
  if (-not $apiWasRunning) {
    Start-BackgroundProcess `
      -FilePath 'npm.cmd' `
      -Arguments @('--workspace', 'apps/api', 'run', 'start:dev') `
      -WorkingDirectory $repoRoot `
      -PidPath $apiPidPath `
      -StdOutLogPath $apiStdOutLogPath `
      -StdErrLogPath $apiStdErrLogPath | Out-Null
  }

  Wait-HttpReady -Url "$apiBaseUrl/health/live" -ExpectedStatuses @('ok')
  Wait-HttpReady -Url "$apiBaseUrl/health/ready" -ExpectedStatuses @('ready')

  $webWasRunning = Test-PortReady -TargetHost $HostName -Port 3000
  if (-not $webWasRunning) {
    Start-BackgroundProcess `
      -FilePath 'npm.cmd' `
      -Arguments @('--workspace', 'apps/web', 'run', 'dev', '--', '--host', $HostName, '--port', '3000', '--strictPort') `
      -WorkingDirectory $repoRoot `
      -PidPath $webPidPath `
      -StdOutLogPath $webStdOutLogPath `
      -StdErrLogPath $webStdErrLogPath | Out-Null
  }

  Wait-WebReady -Url $webUrl

  Write-Host ''
  Write-Host 'Passkeys lab listo.'
  Write-Host "Frontend: $webUrl"
  Write-Host "API: $apiBaseUrl"
  Write-Host "Demo email: webauthn.demo@example.com"
  Write-Host "Demo password: ChangeMeNow_123456789!"
  Write-Host ''
  Write-Host 'Logs:'
  Write-Host "  API stdout: $apiStdOutLogPath"
  Write-Host "  API stderr: $apiStdErrLogPath"
  Write-Host "  Web stdout: $webStdOutLogPath"
  Write-Host "  Web stderr: $webStdErrLogPath"
  Write-Host ''
  Write-Host 'Para apagar procesos iniciados por este script:'
  Write-Host '  npm.cmd run webauthn:demo:stop'

  if ($OpenBrowser) {
    Start-Process $webUrl | Out-Null
  }
}
finally {
  Pop-Location
}
