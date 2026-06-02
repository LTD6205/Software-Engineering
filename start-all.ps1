# start-all.ps1 — one-shot launcher for the Event Ops stack.
#
# Order:  Docker Desktop + Postgres  ->  backend (:3000)  ->  frontend (:3001)  ->  share link (ngrok via :8080)
# Each server opens in its OWN PowerShell window; THIS window orchestrates and
# waits for each step to be ready before starting the next.
#
# Run it by double-clicking start-all.bat, or:  powershell -ExecutionPolicy Bypass -File start-all.ps1

$root     = $PSScriptRoot
$backend  = Join-Path $root 'event-ops-backend'
$frontend = Join-Path $root 'event-ops-frontend'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# Is something already listening on this TCP port?
function Test-Listening($port) {
  return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# Open a new PowerShell window with a title, cd into a dir, and run a command.
# -NoExit keeps the window (and its logs) open.
function Open-Window($title, $dir, $cmd) {
  $inner = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $cmd"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $inner | Out-Null
}

# Poll a URL until it answers. ANY HTTP response (even 401/404) means "up".
function Wait-Http($url, $timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url | Out-Null; return $true }
    catch { if ($_.Exception.Response) { return $true } }
    Start-Sleep -Seconds 2
  }
  return $false
}

# --- 0. First-run guard ------------------------------------------------------
# This launcher only STARTS the stack; it assumes a one-time setup was done.
if (-not (Test-Path (Join-Path $backend 'node_modules')) -or
    -not (Test-Path (Join-Path $frontend 'node_modules')) -or
    -not (Test-Path (Join-Path $backend '.env')) -or
    -not (Test-Path (Join-Path $frontend '.env.local'))) {
  Write-Host 'It looks like this is a fresh clone (missing dependencies or env files).' -ForegroundColor Yellow
  Write-Host 'Run setup-once.bat first, then start-all.bat.' -ForegroundColor Yellow
  Read-Host 'Press Enter to exit'
  exit 1
}

# --- 1. Docker Desktop + Postgres -------------------------------------------
Write-Step 'Checking Docker engine...'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker not responding - launching Docker Desktop...'
  $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd } else { Write-Host 'Docker Desktop.exe not found - start Docker manually.' -ForegroundColor Yellow }
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 3
  }
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker still not ready - aborting.' -ForegroundColor Red; Read-Host 'Press Enter to exit'; exit 1 }
Write-Host 'Docker is up.' -ForegroundColor Green

Write-Step 'Starting Postgres (docker compose up -d)...'
Push-Location $backend
docker compose up -d
Pop-Location

Write-Step 'Waiting for Postgres to accept connections...'
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  docker exec event_ops_db pg_isready -U postgres -d event_ops *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
Write-Host 'Postgres ready.' -ForegroundColor Green

# --- 2. Backend (:3000) ------------------------------------------------------
Write-Step 'Starting backend (:3000)...'
if (Test-Listening 3000) {
  Write-Host 'Port 3000 already in use - assuming the backend is already running.' -ForegroundColor Yellow
} else {
  Open-Window 'Event Ops - Backend' $backend 'npm run start:dev'
}
Write-Host 'Waiting for http://localhost:3000/api ...'
if (Wait-Http 'http://localhost:3000/api' 150) { Write-Host 'Backend ready.' -ForegroundColor Green }
else { Write-Host 'Backend did not respond in time - check its window.' -ForegroundColor Yellow }

# --- 3. Frontend (:3001) -----------------------------------------------------
Write-Step 'Starting frontend (:3001)...'
if (Test-Listening 3001) {
  Write-Host 'Port 3001 already in use - assuming the frontend is already running.' -ForegroundColor Yellow
} else {
  Open-Window 'Event Ops - Frontend' $frontend 'npm run dev -- --port 3001'
}
Write-Host 'Waiting for http://localhost:3001 ...'
if (Wait-Http 'http://localhost:3001' 150) { Write-Host 'Frontend ready.' -ForegroundColor Green }
else { Write-Host 'Frontend did not respond in time - check its window.' -ForegroundColor Yellow }

# --- 4. Public share link (ngrok via the proxy on :8080) --------------------
Write-Step 'Starting public share link (npm run share:web)...'
if (Test-Listening 8080) {
  Write-Host 'Port 8080 already in use - assuming the share proxy is already running.' -ForegroundColor Yellow
} else {
  Open-Window 'Event Ops - Share' $frontend 'npm run share:web'
}

Write-Host "`n------------------------------------------------------------" -ForegroundColor Green
Write-Host 'All set.' -ForegroundColor Green
Write-Host '  Local URL :  http://localhost:3001'
Write-Host '  Share URL :  see the "Event Ops - Share" window for "SHARE THIS LINK", or open http://localhost:4040'
Write-Host '  (When sharing, log in again on the ngrok URL - it is a separate origin.)'
Write-Host 'Stop a server with Ctrl+C in its window. Postgres keeps running (docker compose stop to halt it).'
Write-Host "------------------------------------------------------------`n" -ForegroundColor Green
Read-Host 'Press Enter to close this launcher window'
