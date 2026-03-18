param(
  [ValidateSet('localhost', '127.0.0.1')]
  [string]$HostName = 'localhost',
  [switch]$OpenBrowser,
  [switch]$SkipDemoSeed,
  [switch]$UseCurrentEnvironment
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
$npmCommand = $null

. (Join-Path $PSScriptRoot 'common.ps1')

$apiUrl = "http://${HostName}:4000"
$apiBaseUrl = "$apiUrl/api"
$webUrl = "http://${HostName}:3000"
$webHealthUrl = "$webUrl/healthz.json"

$labDatabaseUrl = $env:WEBAUTHN_LAB_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($labDatabaseUrl)) {
  $labDatabaseUrl = 'postgresql://platform:platform@localhost:5432/platform'
}

$labRedisUrl = $env:WEBAUTHN_LAB_REDIS_URL
if ([string]::IsNullOrWhiteSpace($labRedisUrl)) {
  $labRedisUrl = 'redis://localhost:6379'
}

if ([string]::IsNullOrWhiteSpace($env:WEBAUTHN_DEMO_EMAIL)) {
  $env:WEBAUTHN_DEMO_EMAIL = 'webauthn.demo@example.com'
}

if ([string]::IsNullOrWhiteSpace($env:WEBAUTHN_DEMO_PASSWORD)) {
  $env:WEBAUTHN_DEMO_PASSWORD = 'ChangeMeNow_123456789!'
}

if (-not $UseCurrentEnvironment) {
  $env:NODE_ENV = 'test'
  $env:API_PREFIX = 'api'
  $env:COOKIE_NAME = 'session'
  $env:COOKIE_SECRET = 'lab-cookie-secret-lab-cookie-secret-1234'
  $env:COOKIE_SECURE = 'false'
  $env:DATABASE_URL = $labDatabaseUrl
  $env:DIRECT_DATABASE_URL = $labDatabaseUrl
  $env:REDIS_URL = $labRedisUrl
  $env:MFA_ENCRYPTION_KEY = 'lab-mfa-secret-lab-mfa-secret-lab-1234'
  $env:CORS_ORIGIN = $webUrl
  $env:CSRF_TRUSTED_ORIGINS = $webUrl
  $env:WEBAUTHN_RP_ID = $HostName
  $env:WEBAUTHN_ORIGINS = $webUrl
  $env:VITE_DEFAULT_API_BASE_URL = $apiBaseUrl
}

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

  return Test-TcpPort -HostName $TargetHost -Port $Port
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
      $response = Invoke-RestMethod -Method GET -Uri $Url -TimeoutSec 5
      if ($response.status -eq 'ok' -and $response.service -eq 'webauthn-control-panel') {
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
$npmCommand = Get-NpmCommand

Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'start-infra.ps1')

  if (-not $SkipDemoSeed) {
    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'seed:webauthn-demo') -ErrorMessage 'No se pudo preparar el usuario demo de WebAuthn.'
  }

  $apiWasRunning = Test-PortReady -TargetHost $HostName -Port 4000
  if (-not $apiWasRunning) {
    Start-BackgroundProcess `
      -FilePath $npmCommand `
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
      -FilePath $npmCommand `
      -Arguments @('--workspace', 'apps/web', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--strictPort') `
      -WorkingDirectory $repoRoot `
      -PidPath $webPidPath `
      -StdOutLogPath $webStdOutLogPath `
      -StdErrLogPath $webStdErrLogPath | Out-Null
  }

  Wait-WebReady -Url $webHealthUrl

  Write-Host ''
  Write-Host 'Passkeys lab listo.'
  Write-Host "Frontend: $webUrl"
  Write-Host "API: $apiBaseUrl"
  Write-Host 'Cuenta demo local resembrada. Usa WEBAUTHN_DEMO_EMAIL y WEBAUTHN_DEMO_PASSWORD si necesitas personalizarla.'
  if (-not $UseCurrentEnvironment) {
    Write-Host "Infra aislada: PostgreSQL=$labDatabaseUrl | Redis=$labRedisUrl"
  }
  Write-Host ''
  Write-Host 'Logs:'
  Write-Host "  API stdout: $apiStdOutLogPath"
  Write-Host "  API stderr: $apiStdErrLogPath"
  Write-Host "  Web stdout: $webStdOutLogPath"
  Write-Host "  Web stderr: $webStdErrLogPath"
  Write-Host ''
  Write-Host 'Para apagar procesos iniciados por este script:'
  Write-Host '  npm run webauthn:demo:stop'

  if ($OpenBrowser) {
    Start-Process $webUrl | Out-Null
  }
}
finally {
  Pop-Location
}
