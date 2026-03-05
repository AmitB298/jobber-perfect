# ============================================================
# JOBBER PRO — Dev Launcher
# Usage: .\scripts\start-dev.ps1
# Starts backend + frontend, opens browser automatically
# ============================================================

$ROOT         = "D:\jobber-perfect"
$BACKEND      = "$ROOT\backend"
$FRONTEND     = "$ROOT\frontend"
$BACKEND_URL  = "http://localhost:3001/api/system/stats"
$FRONTEND_URL = "http://localhost:5175"

function Show-Header {
    Clear-Host
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║        ⚡ JOBBER PRO — Dev Launcher                      ║" -ForegroundColor Cyan
    Write-Host "║        $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  |  Starting...             ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Wait-ForBackend {
    Write-Host "  ⏳ Waiting for backend to be ready..." -ForegroundColor Yellow
    $attempts    = 0
    $maxAttempts = 30  # 30 x 2s = 60s timeout
    while ($attempts -lt $maxAttempts) {
        try {
            $res = Invoke-RestMethod -Uri $BACKEND_URL -TimeoutSec 2 -ErrorAction Stop
            Write-Host "  ✅ Backend is UP — uptime: $($res.uptime)s" -ForegroundColor Green
            return $true
        } catch {
            $attempts++
            Write-Host "  ⏳ Attempt $attempts/$maxAttempts ..." -ForegroundColor DarkGray
            Start-Sleep -Seconds 2
        }
    }
    Write-Host "  ❌ Backend failed to start after 60s — check logs" -ForegroundColor Red
    return $false
}

function Wait-ForFrontend {
    Write-Host "  ⏳ Waiting for frontend to be ready..." -ForegroundColor Yellow
    $attempts    = 0
    $maxAttempts = 20
    while ($attempts -lt $maxAttempts) {
        try {
            $null = Invoke-WebRequest -Uri $FRONTEND_URL -TimeoutSec 2 -ErrorAction Stop
            Write-Host "  ✅ Frontend is UP — $FRONTEND_URL" -ForegroundColor Green
            return $true
        } catch {
            $attempts++
            Start-Sleep -Seconds 2
        }
    }
    Write-Host "  ⚠️  Frontend taking longer than expected — opening anyway" -ForegroundColor Yellow
    return $false
}

# ── MAIN ──────────────────────────────────────────────────
Show-Header

# Check folders exist
if (-not (Test-Path $BACKEND)) {
    Write-Host "  ❌ Backend folder not found: $BACKEND" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $FRONTEND)) {
    Write-Host "  ❌ Frontend folder not found: $FRONTEND" -ForegroundColor Red
    exit 1
}

# ── Step 1: Start Backend
Write-Host "[ STEP 1 — BACKEND ]" -ForegroundColor Magenta
Write-Host "  📂 $BACKEND" -ForegroundColor DarkGray
$backendProcess = Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$BACKEND'; Write-Host '⚡ JOBBER PRO Backend' -ForegroundColor Cyan; npm run dev"
) -PassThru
Write-Host "  🚀 Backend process started (PID: $($backendProcess.Id))" -ForegroundColor Green
Write-Host ""

# ── Step 2: Wait for backend
Write-Host "[ STEP 2 — HEALTH CHECK ]" -ForegroundColor Magenta
$backendReady = Wait-ForBackend
Write-Host ""

if (-not $backendReady) {
    Write-Host "  ⚠️  Starting frontend anyway..." -ForegroundColor Yellow
}

# ── Step 3: Start Frontend
Write-Host "[ STEP 3 — FRONTEND ]" -ForegroundColor Magenta
Write-Host "  📂 $FRONTEND" -ForegroundColor DarkGray
$frontendProcess = Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$FRONTEND'; Write-Host '⚡ JOBBER PRO Frontend' -ForegroundColor Cyan; npm run dev"
) -PassThru
Write-Host "  🚀 Frontend process started (PID: $($frontendProcess.Id))" -ForegroundColor Green
Write-Host ""

# ── Step 4: Wait for frontend then open browser
Write-Host "[ STEP 4 — BROWSER ]" -ForegroundColor Magenta
$null = Wait-ForFrontend
Start-Sleep -Seconds 1
Start-Process $FRONTEND_URL
Write-Host "  🌐 Browser opened: $FRONTEND_URL" -ForegroundColor Green
Write-Host ""

# ── Step 5: Summary
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✅ JOBBER PRO is running!                               ║" -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Green
Write-Host "║  Frontend  → http://localhost:5175                       ║" -ForegroundColor Green
Write-Host "║  Backend   → http://localhost:3001                       ║" -ForegroundColor Green
Write-Host "║  WebSocket → ws://localhost:3001/ws                      ║" -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Green
Write-Host "║  Monitor   → .\scripts\heartbeat.ps1                     ║" -ForegroundColor Green
Write-Host "║  Seed Close→ .\scripts\seed-close.ps1                    ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  PIDs — Backend: $($backendProcess.Id)  |  Frontend: $($frontendProcess.Id)" -ForegroundColor DarkGray
Write-Host "  Close the backend/frontend windows to stop." -ForegroundColor DarkGray
