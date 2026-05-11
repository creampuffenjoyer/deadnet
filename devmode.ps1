# DEADNET — Revert to Dev Mode
# Run: .\devmode.ps1

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "  DEADNET DEV MODE RESTORE" -ForegroundColor Cyan
Write-Host "  ========================" -ForegroundColor DarkCyan
Write-Host ""

# 1. Stop production services
Write-Host "  [1/3] Stopping production services..." -ForegroundColor Yellow

$prodContainers = docker compose -f docker-compose.prod.yml ps -q 2>&1 | Where-Object { $_ -match "^[a-f0-9]+" }
if ($prodContainers) {
    docker compose -f docker-compose.prod.yml down --remove-orphans 2>&1 | Out-Null
    Write-Host "  Production services stopped." -ForegroundColor DarkGray
} else {
    Write-Host "  No production services running, skipping." -ForegroundColor DarkGray
}

# 2. Restore .env to dev defaults
Write-Host ""
Write-Host "  [2/3] Restoring .env to dev defaults..." -ForegroundColor Yellow

$envPath = Join-Path $PSScriptRoot ".env"
$envContent = Get-Content $envPath -Raw

$envContent = $envContent -replace "(?m)^FRONTEND_URL=.*$", "FRONTEND_URL=http://localhost:5173"
$envContent = $envContent -replace "(?m)^VITE_API_URL=.*$", "VITE_API_URL=http://localhost:8000"

Set-Content $envPath $envContent -NoNewline
Write-Host "  .env restored." -ForegroundColor Green

# 3. Start dev environment
Write-Host ""
Write-Host "  [3/3] Starting dev environment..." -ForegroundColor Yellow

docker compose up -d --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start dev services." -ForegroundColor Red
    exit 1
}

# 4. Done
Write-Host ""
Write-Host "  ========================" -ForegroundColor DarkCyan
Write-Host "  Reverted to dev mode" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "  Backend:  http://localhost:8000" -ForegroundColor Green
Write-Host "  ========================" -ForegroundColor DarkCyan
Write-Host ""
