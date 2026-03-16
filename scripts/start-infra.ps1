param(
  [switch]$SkipBootstrap
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps/api'
$rootEnvPath = Join-Path $repoRoot '.env'
$apiEnvPath = Join-Path $apiRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'
$envValues = @{}

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

  $result = Test-NetConnection $HostName -Port $Port -WarningAction SilentlyContinue
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

function Wait-DockerHealth {
  param(
    [string]$DockerExecutable,
    [string]$ContainerName,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $status = & $DockerExecutable inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerName 2>$null
    if ($LASTEXITCODE -eq 0 -and ($status -eq 'healthy' -or $status -eq 'running')) {
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "El contenedor $ContainerName no alcanzo estado healthy dentro de $TimeoutSeconds segundos."
}

function Print-DockerServiceLogs {
  param(
    [string]$DockerExecutable,
    [string[]]$ServiceNames
  )

  foreach ($serviceName in $ServiceNames) {
    Write-Warning "Logs recientes de ${serviceName}:"
    & $DockerExecutable compose logs --tail 50 $serviceName
  }
}

Ensure-EnvFile -TargetPath $rootEnvPath -SourcePath $envTemplatePath
Sync-EnvFile -TargetPath $apiEnvPath -SourcePath $rootEnvPath

$envValues = Read-EnvValues -Path $rootEnvPath
$databaseTarget = Get-ServiceTarget -Url $envValues['DIRECT_DATABASE_URL'] -DefaultPort 5432
$redisTarget = Get-ServiceTarget -Url $envValues['REDIS_URL'] -DefaultPort 6379

$postgresReady = Test-ServiceReachable -HostName $databaseTarget.Host -Port $databaseTarget.Port
$redisReady = Test-ServiceReachable -HostName $redisTarget.Host -Port $redisTarget.Port
$usedDockerCompose = $false
$needsLocalPostgres = $databaseTarget.IsLocal -and -not $postgresReady
$needsLocalRedis = $redisTarget.IsLocal -and -not $redisReady

if ($needsLocalPostgres -or $needsLocalRedis) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

  if (-not $dockerCommand) {
    throw 'Docker no esta instalado y PostgreSQL/Redis no estan disponibles localmente.'
  }

  Push-Location $repoRoot
  try {
    $composeServices = @()
    if ($needsLocalPostgres) {
      $composeServices += 'postgres'
    }
    if ($needsLocalRedis) {
      $composeServices += 'redis'
    }

    Invoke-CheckedCommand -FilePath $dockerCommand.Source -Arguments @('compose', 'up', '-d') + $composeServices -ErrorMessage 'Docker Compose no pudo levantar PostgreSQL y Redis.'
    $usedDockerCompose = $true
  }
  finally {
    Pop-Location
  }

  if ($needsLocalPostgres) {
    Wait-PortReady -Port 5432
    Wait-DockerHealth -DockerExecutable $dockerCommand.Source -ContainerName 'platform-postgres'
  }

  if ($needsLocalRedis) {
    Wait-PortReady -Port 6379
    Wait-DockerHealth -DockerExecutable $dockerCommand.Source -ContainerName 'platform-redis'
  }
} elseif (-not $postgresReady -or -not $redisReady) {
  $missingServices = @()
  if (-not $postgresReady) {
    $missingServices += "PostgreSQL en $($databaseTarget.Host):$($databaseTarget.Port)"
  }
  if (-not $redisReady) {
    $missingServices += "Redis en $($redisTarget.Host):$($redisTarget.Port)"
  }

  throw "No se pudo alcanzar: $($missingServices -join ', ')."
}

if ($SkipBootstrap) {
  Write-Host 'Infraestructura lista. Se omitieron migraciones y seed por parametro.'
  return
}

Push-Location $repoRoot
try {
  try {
    Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'prisma:migrate:deploy') -ErrorMessage 'La aplicacion de migraciones Prisma fallo.'
    Invoke-CheckedCommand -FilePath 'npm.cmd' -Arguments @('run', 'seed:admin') -ErrorMessage 'El bootstrap del usuario administrador fallo.'
  } catch {
    if ($usedDockerCompose -and $dockerCommand) {
      $serviceNames = @()
      if ($needsLocalPostgres) {
        $serviceNames += 'postgres'
      }
      if ($needsLocalRedis) {
        $serviceNames += 'redis'
      }
      Print-DockerServiceLogs -DockerExecutable $dockerCommand.Source -ServiceNames $serviceNames
    }

    throw
  }
}
finally {
  Pop-Location
}

Write-Host 'Infraestructura local lista: PostgreSQL y Redis disponibles, migraciones aplicadas y admin preparado.'
