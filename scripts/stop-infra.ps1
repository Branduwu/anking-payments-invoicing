param(
  [switch]$RemoveVolumes,
  [switch]$BestEffort
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$rootEnvPath = Join-Path $repoRoot '.env'
$envTemplatePath = Join-Path $repoRoot '.env.example'
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

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

if (-not $dockerCommand) {
  if ($BestEffort) {
    Write-Warning 'Docker no esta instalado en esta maquina. Se omite el cleanup de infraestructura.'
    return
  }

  throw 'Docker no esta instalado en esta maquina.'
}

Push-Location $repoRoot
try {
  $createdTemporaryEnv = $false
  if (-not (Test-Path $rootEnvPath) -and (Test-Path $envTemplatePath)) {
    Copy-Item -Path $envTemplatePath -Destination $rootEnvPath
    $createdTemporaryEnv = $true
  }

  try {
    if ($RemoveVolumes) {
      Invoke-CheckedCommand -FilePath $dockerCommand.Source -Arguments @('compose', 'down', '-v', '--remove-orphans') -ErrorMessage 'Docker Compose no pudo detener y limpiar la infraestructura.'
    } else {
      Invoke-CheckedCommand -FilePath $dockerCommand.Source -Arguments @('compose', 'stop', 'postgres', 'redis', 'api', 'migration-runner') -ErrorMessage 'Docker Compose no pudo detener la infraestructura.'
    }
  } catch {
    if (-not $BestEffort) {
      throw
    }

    Write-Warning ($_ | Out-String).Trim()
    Write-Warning 'Se omite el error de cleanup de infraestructura por modo BestEffort.'
  } finally {
    if ($createdTemporaryEnv -and (Test-Path $rootEnvPath)) {
      Remove-Item -Path $rootEnvPath -Force
    }
  }
}
finally {
  Pop-Location
}

Write-Host 'Infraestructura detenida.'
