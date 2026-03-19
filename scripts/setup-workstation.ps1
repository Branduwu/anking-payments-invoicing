param(
  [switch]$InstallPrerequisites,
  [switch]$InstallPlaywright,
  [switch]$RunVerify,
  [switch]$RunValidateLocal
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps/api'
$rootEnvPath = Join-Path $repoRoot '.env'
$apiEnvPath = Join-Path $apiRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'

. (Join-Path $PSScriptRoot 'common.ps1')

function Get-OptionalCommand {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Install-WithWinget {
  param(
    [string]$PackageId,
    [string]$DisplayName
  )

  $winget = Get-OptionalCommand -Name 'winget'
  if (-not $winget) {
    throw "No se encontro winget para instalar $DisplayName automaticamente."
  }

  Write-Host "Instalando $DisplayName con winget..."
  & $winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo instalar $DisplayName con winget."
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

function Ensure-Prerequisite {
  param(
    [string]$DisplayName,
    [string[]]$Commands,
    [string]$PackageId,
    [switch]$Optional
  )

  foreach ($commandName in $Commands) {
    if (Get-OptionalCommand -Name $commandName) {
      return $true
    }
  }

  if ($InstallPrerequisites) {
    Install-WithWinget -PackageId $PackageId -DisplayName $DisplayName
    $script:InstalledAnyPrerequisite = $true
    return $false
  }

  if ($Optional) {
    $script:MissingOptionalPrerequisites += $DisplayName
    return $false
  }

  $script:MissingRequiredPrerequisites += $DisplayName
  return $false
}

$InstalledAnyPrerequisite = $false
$MissingRequiredPrerequisites = @()
$MissingOptionalPrerequisites = @()

$null = Ensure-Prerequisite -DisplayName 'Git' -Commands @('git') -PackageId 'Git.Git'
$nodeAvailable = Ensure-Prerequisite -DisplayName 'Node.js LTS' -Commands @('node', 'npm', 'npm.cmd') -PackageId 'OpenJS.NodeJS.LTS'
$dockerAvailable = Ensure-Prerequisite -DisplayName 'Docker Desktop' -Commands @('docker') -PackageId 'Docker.DockerDesktop' -Optional
$null = Ensure-Prerequisite -DisplayName 'GitHub CLI' -Commands @('gh') -PackageId 'GitHub.cli' -Optional

if ($MissingRequiredPrerequisites.Count -gt 0) {
  throw "Faltan prerequisitos requeridos: $($MissingRequiredPrerequisites -join ', '). Ejecuta este script con -InstallPrerequisites o instalalos manualmente."
}

if ($InstalledAnyPrerequisite) {
  Write-Host ''
  Write-Host 'Se instalaron prerequisitos en esta maquina.'
  Write-Host 'Cierra y abre una terminal nueva, luego vuelve a correr este mismo script para continuar con el bootstrap del repo.'
  return
}

Ensure-EnvFile -TargetPath $rootEnvPath -SourcePath $envTemplatePath
Sync-EnvFile -TargetPath $apiEnvPath -SourcePath $rootEnvPath

$npmCommand = Get-NpmCommand

Push-Location $repoRoot
try {
  Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('ci') -ErrorMessage 'No se pudieron instalar las dependencias del repo.'
  Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'prisma:generate') -ErrorMessage 'No se pudo generar Prisma Client.'

  if ($InstallPlaywright) {
    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'e2e:install') -ErrorMessage 'No se pudo instalar Chromium para Playwright.'
  }

  if ($RunVerify) {
    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'verify') -ErrorMessage 'Fallo el verify inicial del repo.'
  }

  if ($RunValidateLocal) {
    if (-not $dockerAvailable) {
      throw 'Docker Desktop es necesario para ejecutar validate:local en una maquina limpia.'
    }

    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'validate:local') -ErrorMessage 'Fallo la validacion local de punta a punta.'
  }
}
finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Bootstrap de workstation completado.'
Write-Host ''
Write-Host 'Siguiente paso recomendado:'
Write-Host '  1. revisa y ajusta .env si necesitas Neon, Redis remoto o secretos propios'
Write-Host '  2. npm run start'
Write-Host '  3. npm run validate:local'
Write-Host '  4. npm run webauthn:demo:open'
Write-Host ''

if ($MissingOptionalPrerequisites.Count -gt 0) {
  Write-Host "Opcionales faltantes: $($MissingOptionalPrerequisites -join ', ')"
}
