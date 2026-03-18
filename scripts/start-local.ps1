$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps/api'
$rootEnvPath = Join-Path $repoRoot '.env'
$apiEnvPath = Join-Path $apiRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'
$envValues = @{}
$npmCommand = $null

. (Join-Path $PSScriptRoot 'common.ps1')

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

  return Test-TcpPort -HostName 'localhost' -Port $Port
}

function Read-EnvValues {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
      continue
    }

    $parts = $trimmed -split '=', 2
    $values[$parts[0]] = $parts[1]
  }

  return $values
}

function Get-ServiceTarget {
  param(
    [string]$Url,
    [int]$DefaultPort
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return [pscustomobject]@{
      Host = 'localhost'
      Port = $DefaultPort
      IsLocal = $true
    }
  }

  $uri = [System.Uri]$Url
  $port = if ($uri.IsDefaultPort) { $DefaultPort } else { $uri.Port }
  $isLocalHost = @('localhost', '127.0.0.1', '::1') -contains $uri.Host

  return [pscustomobject]@{
    Host = $uri.Host
    Port = $port
    IsLocal = $isLocalHost
  }
}

function Test-ServiceReachable {
  param(
    [string]$HostName,
    [int]$Port
  )

  return Test-TcpPort -HostName $HostName -Port $Port
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
$npmCommand = Get-NpmCommand

$envValues = Read-EnvValues -Path $rootEnvPath
$databaseTarget = Get-ServiceTarget -Url $envValues['DIRECT_DATABASE_URL'] -DefaultPort 5432
$redisTarget = Get-ServiceTarget -Url $envValues['REDIS_URL'] -DefaultPort 6379
$postgresReady = Test-ServiceReachable -HostName $databaseTarget.Host -Port $databaseTarget.Port
$redisReady = Test-ServiceReachable -HostName $redisTarget.Host -Port $redisTarget.Port

if (-not $postgresReady -or -not $redisReady) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

  if (-not $dockerCommand) {
    Write-Warning 'PostgreSQL o Redis no estan disponibles segun las URLs configuradas y Docker no esta instalado. La API arrancara en modo degradado.'
    $env:ALLOW_DEGRADED_STARTUP = 'true'

    Push-Location $repoRoot
    try {
      Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'dev') -ErrorMessage 'La API en modo degradado no pudo iniciar correctamente.'
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
  Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'dev') -ErrorMessage 'La API local no pudo iniciar correctamente.'
}
finally {
  Pop-Location
}
