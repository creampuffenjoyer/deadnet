Set-ExecutionPolicy Bypass -Scope Process -Force
$ErrorActionPreference = "Continue"

# ---------- Paths ------------------------------------------------------------
$Root           = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile        = Join-Path $Root ".env"
$ToolsDir       = Join-Path $Root ".tools"
$CloudflaredExe = Join-Path $ToolsDir "cloudflared.exe"
$LogDir         = Join-Path $Root ".tunnel-logs"

# ---------- Helpers ----------------------------------------------------------
function info { param($m) Write-Host "  [*] $m" -ForegroundColor Cyan }
function ok   { param($m) Write-Host "  [+] $m" -ForegroundColor Green }
function warn { param($m) Write-Host "  [!] $m" -ForegroundColor Yellow }
function fail {
    param($m)
    Write-Host ""
    Write-Host "  [X] $m" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Press Enter to close..." -ForegroundColor DarkGray
    $null = Read-Host
    exit 1
}

function Get-EnvVal {
    param([string]$K)
    if (-not (Test-Path $EnvFile)) { return $null }
    foreach ($line in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        if ($line -match "^\s*$K\s*=\s*(.+)$") { return $Matches[1].Trim() }
    }
    return $null
}

function Set-EnvVal {
    param([string]$K, [string]$V)
    if (-not (Test-Path $EnvFile)) { "" | Set-Content $EnvFile -Encoding UTF8 }
    $lines = Get-Content $EnvFile -ErrorAction SilentlyContinue
    $found = $false
    $out = $lines | ForEach-Object {
        if ($_ -match "^\s*$K\s*=") { "$K=$V"; $found = $true }
        else { $_ }
    }
    if (-not $found) { $out = @($out) + "$K=$V" }
    $out | Set-Content $EnvFile -Encoding UTF8
}

function Remove-EnvVal {
    param([string]$K)
    if (-not (Test-Path $EnvFile)) { return }
    (Get-Content $EnvFile -ErrorAction SilentlyContinue) |
        Where-Object { $_ -notmatch "^\s*$K\s*=" } |
        Set-Content $EnvFile -Encoding UTF8
}

# Read log file without blocking the writer
function Read-LogFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return "" }
    try {
        $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
        $reader = [System.IO.StreamReader]::new($stream)
        $txt    = $reader.ReadToEnd()
        $reader.Close(); $stream.Close()
        return $txt
    } catch { return "" }
}

# Poll log file until trycloudflare URL appears (takes ~4s after cloudflared starts)
function Get-TunnelUrl {
    param([string]$LogFile, [string]$Label, [int]$TimeoutSec = 70)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    Write-Host "  [*] Waiting for $Label URL" -NoNewline -ForegroundColor Cyan
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        Write-Host "." -NoNewline -ForegroundColor DarkGray
        $txt = Read-LogFile $LogFile
        if ($txt -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            Write-Host " got it!" -ForegroundColor Green
            return $Matches[0]
        }
    }
    Write-Host " TIMED OUT" -ForegroundColor Red
    return $null
}

# Launch cloudflared via a temp batch file -- this is the only approach that
# reliably merges stdout+stderr into one file on all Windows versions.
function Start-Tunnel {
    param([int]$Port, [string]$LogFile)
    "" | Set-Content $LogFile -Encoding ASCII
    $bat = "$LogFile.bat"
    "@echo off" | Set-Content $bat -Encoding ASCII
    "`"$CloudflaredExe`" tunnel --url http://localhost:$Port --no-autoupdate > `"$LogFile`" 2>&1" |
        Add-Content $bat -Encoding ASCII
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c `"$bat`"" `
        -WindowStyle Hidden `
        -PassThru
    return $proc
}

function Stop-Tunnels {
    param($BackendProc, $FrontendProc)
    try { if (-not $BackendProc.HasExited)  { $BackendProc.Kill()  } } catch {}
    try { if (-not $FrontendProc.HasExited) { $FrontendProc.Kill() } } catch {}
    # Also kill any cloudflared child processes
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

# ---------- Banner -----------------------------------------------------------
Clear-Host
Write-Host ""
Write-Host "  ================================" -ForegroundColor Red
Write-Host "   DEADNET  --  Tunnel Launcher  " -ForegroundColor Red
Write-Host "  ================================" -ForegroundColor Red
Write-Host ""

# ---------- Prereq checks ----------------------------------------------------
info "Repo: $Root"
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
    fail "docker-compose.yml not found. Run this from E:\Code\deadnet"
}

info "Checking cloudflared..."
$null = New-Item -ItemType Directory -Force -Path $ToolsDir
$null = New-Item -ItemType Directory -Force -Path $LogDir
if (-not (Test-Path $CloudflaredExe)) {
    warn "Not found -- downloading..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        Invoke-WebRequest -Uri $cfUrl -OutFile $CloudflaredExe -UseBasicParsing
        ok "Downloaded cloudflared.exe"
    } catch {
        fail "Download failed: $_"
    }
} else {
    ok "cloudflared.exe found"
}

info "Checking Docker..."
$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) { fail "Docker not running. Start Docker Desktop first." }
ok "Docker running"

# ---------- Start Docker Compose ---------------------------------------------
info "Starting Docker Compose..."
Push-Location $Root
$null = docker compose up -d --remove-orphans 2>&1
ok "Services up"

info "Waiting for backend..."
$healthy = $false
for ($i = 0; $i -lt 35; $i++) {
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline -ForegroundColor DarkGray
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
}
Write-Host ""
if ($healthy) { ok "Backend healthy" } else { warn "Backend slow -- continuing anyway" }
Pop-Location

# ---------- Launch tunnels ---------------------------------------------------
$backendLog  = Join-Path $LogDir "backend.log"
$frontendLog = Join-Path $LogDir "frontend.log"

info "Launching backend tunnel  (port 8000)..."
$backendProc = Start-Tunnel -Port 8000 -LogFile $backendLog

info "Launching frontend tunnel (port 5173)..."
$frontendProc = Start-Tunnel -Port 5173 -LogFile $frontendLog

# ---------- Capture URLs -----------------------------------------------------
$backendUrl  = Get-TunnelUrl -LogFile $backendLog  -Label "backend"
$frontendUrl = Get-TunnelUrl -LogFile $frontendLog -Label "frontend"

if (-not $backendUrl)  { Stop-Tunnels $backendProc $frontendProc; fail "No backend URL. Is port 8000 up?" }
if (-not $frontendUrl) { Stop-Tunnels $backendProc $frontendProc; fail "No frontend URL. Is port 5173 up?" }

# ---------- Patch .env and restart -------------------------------------------
info "Patching .env..."
$savedApiUrl      = Get-EnvVal "VITE_API_URL"
$savedFrontendUrl = Get-EnvVal "FRONTEND_URL"

Set-EnvVal "VITE_API_URL" $backendUrl
Set-EnvVal "FRONTEND_URL" $frontendUrl
ok "VITE_API_URL  = $backendUrl"
ok "FRONTEND_URL  = $frontendUrl"

info "Restarting frontend + backend..."
Push-Location $Root
$null = docker compose up -d --force-recreate frontend backend 2>&1
ok "Containers restarted"

info "Waiting for backend to return..."
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline -ForegroundColor DarkGray
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { break }
    } catch {}
}
Write-Host ""
ok "Backend ready"
Pop-Location

# ---------- Print live URLs --------------------------------------------------
Write-Host ""
Write-Host "  ================================================" -ForegroundColor Yellow
Write-Host "   DEADNET IS LIVE" -ForegroundColor Yellow
Write-Host "  ================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "   SHARE THIS URL:" -ForegroundColor White
Write-Host "   $frontendUrl" -ForegroundColor Green
Write-Host ""
Write-Host "   Backend API:" -ForegroundColor DarkGray
Write-Host "   $backendUrl" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ================================================" -ForegroundColor Yellow
Write-Host "   Press Ctrl+C to stop and restore settings." -ForegroundColor DarkGray
Write-Host "  ================================================" -ForegroundColor Yellow
Write-Host ""

try { $frontendUrl | Set-Clipboard; Write-Host "  (Frontend URL copied to clipboard)" -ForegroundColor DarkGray } catch {}

# ---------- Keep-alive -------------------------------------------------------
try {
    while ($true) {
        Start-Sleep -Seconds 20

        $bDead = $false; try { $bDead = $backendProc.HasExited  } catch { $bDead = $true }
        $fDead = $false; try { $fDead = $frontendProc.HasExited } catch { $fDead = $true }

        if ($bDead) {
            warn "Backend tunnel died -- restarting..."
            $backendProc = Start-Tunnel -Port 8000 -LogFile $backendLog
            $newUrl = Get-TunnelUrl -LogFile $backendLog -Label "backend" -TimeoutSec 45
            if ($newUrl) {
                $backendUrl = $newUrl
                Set-EnvVal "VITE_API_URL" $backendUrl
                if ($newUrl -ne $backendUrl) {
                    warn "Backend URL changed: $backendUrl"
                    warn "Run: docker compose up -d --force-recreate frontend"
                } else {
                    ok "Backend tunnel restored"
                }
            }
        }

        if ($fDead) {
            warn "Frontend tunnel died -- restarting..."
            $frontendProc = Start-Tunnel -Port 5173 -LogFile $frontendLog
            $newUrl = Get-TunnelUrl -LogFile $frontendLog -Label "frontend" -TimeoutSec 45
            if ($newUrl) {
                $frontendUrl = $newUrl
                Set-EnvVal "FRONTEND_URL" $frontendUrl
                Write-Host ""
                Write-Host "  NEW FRONTEND URL: $frontendUrl" -ForegroundColor Green
                Write-Host ""
            }
        }
    }
} finally {
    Write-Host ""
    info "Stopping tunnels..."
    Stop-Tunnels $backendProc $frontendProc
    ok "Tunnels stopped"

    info "Restoring .env..."
    if ($savedApiUrl)      { Set-EnvVal    "VITE_API_URL"  $savedApiUrl }
    else                   { Remove-EnvVal "VITE_API_URL" }
    if ($savedFrontendUrl) { Set-EnvVal    "FRONTEND_URL"  $savedFrontendUrl }
    else                   { Set-EnvVal    "FRONTEND_URL"  "http://localhost:5173" }
    ok ".env restored"

    info "Restarting containers with local config..."
    Push-Location $Root
    $null = docker compose up -d --force-recreate frontend backend 2>&1
    Pop-Location
    ok "Stack back to local-only mode"

    Write-Host ""
    Write-Host "  Press Enter to close..." -ForegroundColor DarkGray
    $null = Read-Host
}
