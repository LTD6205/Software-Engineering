# setup-once.ps1 — one-time setup for a fresh clone (Windows).
#
# Run this ONCE after cloning (double-click setup-once.bat). It is safe to
# re-run: each step is skipped if it's already done.
#   1. Verify Docker + npm are installed.
#   2. npm install (--legacy-peer-deps) in backend and frontend if needed.
#   3. Create .env / .env.local from the example files if missing.
#   4. Start Postgres (docker compose up -d) and wait for it.
#   5. Apply the database schema if the tables don't exist yet.
#   6. Seed the login accounts if the database is empty.
#
# After this, use start-all.bat to launch the stack day to day.

$root     = $PSScriptRoot
$backend  = Join-Path $root 'event-ops-backend'
$frontend = Join-Path $root 'event-ops-frontend'
$schema   = Join-Path $root 'database_creating.txt'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; Read-Host 'Press Enter to exit'; exit 1 }

# --- 0. Prerequisites --------------------------------------------------------
Write-Step 'Checking prerequisites (Docker, Node/npm)...'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker is not installed or not on PATH. Install Docker Desktop, then re-run.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue))    { Fail 'Node/npm is not installed or not on PATH. Install Node.js 20+, then re-run.' }
Write-Host 'Docker and npm found.' -ForegroundColor Green

# --- 1. Install dependencies -------------------------------------------------
foreach ($proj in @($backend, $frontend)) {
  $name = Split-Path $proj -Leaf
  if (Test-Path (Join-Path $proj 'node_modules')) {
    Write-Host "[$name] node_modules present - skipping install."
  } else {
    Write-Step "[$name] npm install --legacy-peer-deps ..."
    Push-Location $proj
    npm install --legacy-peer-deps
    Pop-Location
    if ($LASTEXITCODE -ne 0) { Fail "[$name] npm install failed." }
  }
}

# --- 2. Env files ------------------------------------------------------------
Write-Step 'Creating env files from examples (if missing)...'
$beEnv = Join-Path $backend '.env'
if (-not (Test-Path $beEnv)) { Copy-Item (Join-Path $backend '.env.example') $beEnv; Write-Host 'Created event-ops-backend\.env' } else { Write-Host 'backend .env already exists.' }
$feEnv = Join-Path $frontend '.env.local'
if (-not (Test-Path $feEnv)) { Copy-Item (Join-Path $frontend '.env.local.example') $feEnv; Write-Host 'Created event-ops-frontend\.env.local' } else { Write-Host 'frontend .env.local already exists.' }

# --- 3. Docker engine + Postgres --------------------------------------------
Write-Step 'Checking Docker engine...'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker not responding - launching Docker Desktop...'
  $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd } else { Write-Host 'Docker Desktop.exe not found - start Docker manually.' -ForegroundColor Yellow }
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 3 }
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker engine still not ready.' }

Write-Step 'Starting Postgres (docker compose up -d)...'
Push-Location $backend
docker compose up -d
Pop-Location
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed.' }

Write-Step 'Waiting for Postgres...'
$deadline = (Get-Date).AddSeconds(90)
$pgReady = $false
while ((Get-Date) -lt $deadline) {
  docker exec event_ops_db pg_isready -U postgres -d event_ops *> $null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $pgReady) { Fail 'Postgres did not become ready.' }
Write-Host 'Postgres ready.' -ForegroundColor Green

# --- 4. Schema (only if not applied yet) ------------------------------------
Write-Step 'Checking database schema...'
$usersTable = (docker exec event_ops_db psql -U postgres -d event_ops -tAc "SELECT to_regclass('public.users')") 2>$null
if ([string]::IsNullOrWhiteSpace($usersTable) -or $usersTable.Trim() -eq '') {
  Write-Host 'Applying schema from database_creating.txt ...'
  docker cp $schema event_ops_db:/tmp/schema.sql | Out-Null
  docker exec event_ops_db psql -U postgres -d event_ops -f /tmp/schema.sql
  if ($LASTEXITCODE -ne 0) { Fail 'Schema apply failed.' }
} else {
  Write-Host 'Schema already present - skipping.'
}

# --- 5. Seed (only if no users yet) -----------------------------------------
Write-Step 'Checking seed data...'
$userCount = (docker exec event_ops_db psql -U postgres -d event_ops -tAc "SELECT count(*) FROM users") 2>$null
if ($userCount) { $userCount = $userCount.Trim() }
if ($userCount -eq '0' -or [string]::IsNullOrWhiteSpace($userCount)) {
  Write-Step 'Seeding login accounts (npm run seed)...'
  Push-Location $backend
  npm run seed
  Pop-Location
  if ($LASTEXITCODE -ne 0) { Fail 'Seeding failed.' }
} else {
  Write-Host "Database already has $userCount users - skipping seed."
}

Write-Host "`n------------------------------------------------------------" -ForegroundColor Green
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host 'Now run start-all.bat to launch Docker + backend + frontend + share link.'
Write-Host '(Optional) For the public share link, configure ngrok once:'
Write-Host '    ngrok config add-authtoken <your-token>'
Write-Host "------------------------------------------------------------`n" -ForegroundColor Green
Read-Host 'Press Enter to close'
