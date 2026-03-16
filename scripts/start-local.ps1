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

function Wait-PortReady {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortReady -Port $Port) {
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "El puerto $Port no estuvo disponible dentro de $TimeoutSeconds segundos."
}

Ensure-EnvFile -TargetPath $rootEnvPath -SourcePath $envTemplatePath
Sync-EnvFile -TargetPath $apiEnvPath -SourcePath $rootEnvPath

$postgresReady = Test-PortReady -Port 5432
$redisReady = Test-PortReady -Port 6379

if (-not $postgresReady -or -not $redisReady) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

  if (-not $dockerCommand) {
    Write-Warning 'PostgreSQL o Redis no estan disponibles y Docker no esta instalado. La API arrancara en modo degradado.'
    $env:ALLOW_DEGRADED_STARTUP = 'true'

    Push-Location $repoRoot
    try {
      Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'dev') -ErrorMessage 'La API en modo degradado no pudo iniciar correctamente.'
    }
    finally {
      Pop-Location
    }

    return
  }
}

& (Join-Path $PSScriptRoot 'start-infra.ps1')

Push-Location $repoRoot
try {
  Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'dev') -ErrorMessage 'La API local no pudo iniciar correctamente.'
}
finally {
  Pop-Location
}
