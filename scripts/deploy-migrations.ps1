param(
  [switch]$SkipPrismaGenerate,
  [switch]$SkipStatusCheck
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-NpmCommand {
  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    return 'npm.cmd'
  }

  return 'npm'
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

Push-Location $repoRoot
try {
  if (-not $env:DATABASE_URL) {
    throw 'DATABASE_URL no esta configurada. No es seguro ejecutar migraciones sin un destino explicito.'
  }

  $npmCommand = Get-NpmCommand

  if (-not $SkipPrismaGenerate) {
    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'prisma:generate') -ErrorMessage 'Prisma generate fallo antes de migrar.'
  }

  if (-not $SkipStatusCheck) {
    Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'prisma:migrate:status') -ErrorMessage 'No se pudo obtener el estado de migraciones.'
  }

  Invoke-CheckedCommand -FilePath $npmCommand -Arguments @('run', 'prisma:migrate:deploy') -ErrorMessage 'La aplicacion controlada de migraciones fallo.'
}
finally {
  Pop-Location
}

Write-Host 'Migraciones aplicadas correctamente.'
