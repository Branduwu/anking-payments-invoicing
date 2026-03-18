function Get-NpmCommand {
  $candidates = if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    @('npm.cmd', 'npm')
  } else {
    @('npm')
  }

  foreach ($candidate in $candidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw 'npm no esta disponible en esta maquina.'
}

function Test-TcpPort {
  param(
    [string]$HostName = 'localhost',
    [int]$Port,
    [int]$TimeoutMilliseconds = 1500
  )

  $client = [System.Net.Sockets.TcpClient]::new()

  try {
    $connectTask = $client.ConnectAsync($HostName, $Port)
    if (-not $connectTask.Wait($TimeoutMilliseconds)) {
      return $false
    }

    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Stop-ProcessTreePortable {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }

  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    try {
      & taskkill.exe /PID $Process.Id /T /F | Out-Null
      return
    } catch {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
      return
    }
  }

  try {
    & bash -lc "pkill -TERM -P $($Process.Id) || true; kill -TERM $($Process.Id) || true" | Out-Null
  } catch {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}
