# DEADNET — Presentation Startup Script
# Run: .\testing-sys.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  DEADNET PRESENTATION STARTUP" -ForegroundColor Red
Write-Host "  =============================" -ForegroundColor DarkRed
Write-Host ""

# 1. Get ngrok URL
$ngrokUrl = Read-Host "Enter ngrok URL (start ngrok first, then paste URL here)"
$ngrokUrl = $ngrokUrl.TrimEnd("/")

if (-not $ngrokUrl.StartsWith("http")) {
    Write-Host "ERROR: URL must start with http/https" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Using: $ngrokUrl" -ForegroundColor Yellow
Write-Host ""

# 2. Update .env
Write-Host "  [1/3] Updating .env..." -ForegroundColor Cyan

$envPath = Join-Path $PSScriptRoot ".env"
$envContent = Get-Content $envPath -Raw

$envContent = $envContent -replace "(?m)^FRONTEND_URL=.*$", "FRONTEND_URL=$ngrokUrl"
$envContent = $envContent -replace "(?m)^VITE_API_URL=.*$", "VITE_API_URL=$ngrokUrl"

Set-Content $envPath $envContent -NoNewline
Write-Host "  .env updated." -ForegroundColor Green

# 3. Build frontend
Write-Host ""
Write-Host "  [2/3] Building frontend (this takes a minute)..." -ForegroundColor Cyan

docker compose -f docker-compose.prod.yml run --rm frontend-build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Frontend build failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Build complete." -ForegroundColor Green

# 4. Start services
Write-Host ""
Write-Host "  [3/3] Starting backend, postgres, redis..." -ForegroundColor Cyan

docker compose -f docker-compose.prod.yml up -d backend postgres redis
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start services." -ForegroundColor Red
    exit 1
}

# 5. Done
Write-Host ""
Write-Host "  =============================" -ForegroundColor DarkRed
Write-Host "  DEADNET is live at: $ngrokUrl" -ForegroundColor Red
Write-Host "  =============================" -ForegroundColor DarkRed
Write-Host ""
