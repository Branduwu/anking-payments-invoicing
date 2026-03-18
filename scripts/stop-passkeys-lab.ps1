param(
  [switch]$StopInfra
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiPidPath = Join-Path $repoRoot '.passkeys-lab-api.pid'
$webPidPath = Join-Path $repoRoot '.passkeys-lab-web.pid'

function Stop-TrackedProcess {
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
    return
  }

  try {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  } catch {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  Remove-Item $PidPath -ErrorAction SilentlyContinue
}

Stop-TrackedProcess -PidPath $apiPidPath
Stop-TrackedProcess -PidPath $webPidPath

if ($StopInfra) {
  Push-Location $repoRoot
  try {
    & (Join-Path $PSScriptRoot 'stop-infra.ps1')
  }
  finally {
    Pop-Location
  }
}

Write-Host 'Passkeys lab detenido.'
