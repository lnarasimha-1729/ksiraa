# restart.ps1 — kill anything on the port, then start the server fresh.
# Usage:  ./restart.ps1            (foreground, logs in this window)
#         ./restart.ps1 -Background (detached, logs to server.out.log / server.err.log)

param([switch]$Background)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# Read PORT from .env (fallback 4173)
$port = 4173
if (Test-Path ".env") {
  $line = Get-Content ".env" | Where-Object { $_ -match "^\s*PORT\s*=" } | Select-Object -First 1
  if ($line) { $port = ($line -split "=", 2)[1].Trim() }
}

Write-Host "Freeing port $port ..."
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Write-Host "  Stopping PID $_"
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 700
} else {
  Write-Host "  Nothing was using port $port."
}

if ($Background) {
  $p = Start-Process -FilePath "node" -ArgumentList "server.mjs" `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput "server.out.log" `
    -RedirectStandardError  "server.err.log" `
    -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "Started in background as PID $($p.Id). Logs: server.out.log / server.err.log"
} else {
  Write-Host "Starting server (Ctrl+C to stop)...`n"
  node server.mjs
}
