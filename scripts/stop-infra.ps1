param(
  [switch]$RemoveVolumes
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
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
  throw 'Docker no esta instalado en esta maquina.'
}

Push-Location $repoRoot
try {
  if ($RemoveVolumes) {
    Invoke-CheckedCommand -FilePath $dockerCommand.Source -Arguments @('compose', 'down', '-v', '--remove-orphans') -ErrorMessage 'Docker Compose no pudo detener y limpiar la infraestructura.'
  } else {
    Invoke-CheckedCommand -FilePath $dockerCommand.Source -Arguments @('compose', 'stop', 'postgres', 'redis', 'api', 'migration-runner') -ErrorMessage 'Docker Compose no pudo detener la infraestructura.'
  }
}
finally {
  Pop-Location
}

Write-Host 'Infraestructura detenida.'
