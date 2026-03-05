# ============================================================================
# COMPLETE FIX AND DEPLOYMENT
# This script fixes all issues and gets you back to a working state
# ============================================================================

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        NIFTY OPTIONS TRACKER - COMPLETE FIX & DEPLOY         ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$frontendPath = "D:\jobber-perfect\frontend"
cd $frontendPath

# ============================================================================
# STEP 1: KILL ALL PROCESSES
# ============================================================================

Write-Host "🛑 STEP 1: Stopping all processes...`n" -ForegroundColor Yellow

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

Write-Host "  ✅ All processes stopped`n" -ForegroundColor Green

# ============================================================================
# STEP 2: BACKUP CURRENT DASHBOARD
# ============================================================================

Write-Host "💾 STEP 2: Backing up current files...`n" -ForegroundColor Yellow

$backupName = "backup-emergency-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupName -Force | Out-Null

if (Test-Path "src\pages\Dashboard.tsx") {
    New-Item -ItemType Directory -Path "$backupName\src\pages" -Force | Out-Null
    Copy-Item "src\pages\Dashboard.tsx" "$backupName\src\pages\Dashboard.tsx" -Force
    Write-Host "  ✅ Backed up Dashboard.tsx to $backupName`n" -ForegroundColor Green
}

if (Test-Path "src\App.tsx") {
    New-Item -ItemType Directory -Path "$backupName\src" -Force | Out-Null
    Copy-Item "src\App.tsx" "$backupName\src\App.tsx" -Force
    Write-Host "  ✅ Backed up App.tsx to $backupName`n" -ForegroundColor Green
}

# ============================================================================
# STEP 3: CHECK FOR DOWNLOADED FILES
# ============================================================================

Write-Host "📥 STEP 3: Checking for new files...`n" -ForegroundColor Yellow

$downloadsPath = "$env:USERPROFILE\Downloads"
$needsManualCopy = $false

if (Test-Path "$downloadsPath\Dashboard-Simple-Working.tsx") {
    Copy-Item "$downloadsPath\Dashboard-Simple-Working.tsx" "src\pages\Dashboard.tsx" -Force
    Write-Host "  ✅ Installed simple working Dashboard" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Dashboard-Simple-Working.tsx not found in Downloads" -ForegroundColor Yellow
    $needsManualCopy = $true
}

if (Test-Path "$downloadsPath\App-Fixed.tsx") {
    Copy-Item "$downloadsPath\App-Fixed.tsx" "src\App.tsx" -Force
    Write-Host "  ✅ Installed fixed App.tsx (BrowserRouter)" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  App-Fixed.tsx not found in Downloads" -ForegroundColor Yellow
    $needsManualCopy = $true
}

# ============================================================================
# STEP 4: MANUAL FILE INSTRUCTIONS (IF NEEDED)
# ============================================================================

if ($needsManualCopy) {
    Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "║          ⚠️  MANUAL FILE DOWNLOAD REQUIRED ⚠️                ║" -ForegroundColor Yellow
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Yellow
    
    Write-Host "Please download these files from the outputs folder:`n" -ForegroundColor Cyan
    Write-Host "  1. Dashboard-Simple-Working.tsx" -ForegroundColor White
    Write-Host "     → Save to: $frontendPath\src\pages\Dashboard.tsx`n" -ForegroundColor Gray
    
    Write-Host "  2. App-Fixed.tsx" -ForegroundColor White
    Write-Host "     → Save to: $frontendPath\src\App.tsx`n" -ForegroundColor Gray
    
    Write-Host "After downloading, run this script again!`n" -ForegroundColor Yellow
    
    Write-Host "Press any key to exit..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

# ============================================================================
# STEP 5: VERIFY FILES
# ============================================================================

Write-Host "`n✔️  STEP 4: Verifying installation...`n" -ForegroundColor Yellow

$dashboardSize = (Get-Item "src\pages\Dashboard.tsx").Length
$appSize = (Get-Item "src\App.tsx").Length

Write-Host "  ✅ Dashboard.tsx: $dashboardSize bytes" -ForegroundColor Green
Write-Host "  ✅ App.tsx: $appSize bytes" -ForegroundColor Green

# Check for BrowserRouter
$hasBrowserRouter = Select-String -Path "src\App.tsx" -Pattern "BrowserRouter" -Quiet
if ($hasBrowserRouter) {
    Write-Host "  ✅ App.tsx uses BrowserRouter (routing fixed!)`n" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  App.tsx might still use HashRouter`n" -ForegroundColor Yellow
}

# ============================================================================
# STEP 6: START EVERYTHING
# ============================================================================

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                ✅ FILES READY - STARTING APP ✅               ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "🚀 Starting services...`n" -ForegroundColor Cyan

# Start API Server in new window
Write-Host "📊 Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd D:\jobber-perfect\backend; `$env:DB_PASSWORD = 'Amit@1992'; Write-Host '🚀 API SERVER STARTING...' -ForegroundColor Cyan; npx ts-node api-server.ts"
)

# Wait for API
Write-Host "⏳ Waiting for API server (5 seconds)...`n" -ForegroundColor Gray
Start-Sleep -Seconds 5

# Test API
try {
    $response = Invoke-RestMethod http://localhost:3001/api/stats -ErrorAction Stop
    Write-Host "✅ API Server is READY!" -ForegroundColor Green
    Write-Host "   Total ticks: $($response.data.total_records)`n" -ForegroundColor Cyan
} catch {
    Write-Host "⚠️  API Server might still be starting..." -ForegroundColor Yellow
    Write-Host "   Check the API server window`n" -ForegroundColor Gray
}

# Start Frontend
Write-Host "🌐 Starting Frontend on port 5173...`n" -ForegroundColor Yellow
Start-Sleep -Seconds 2

npm run dev:vite

# Instructions shown after user stops Vite
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                     🎉 SETUP COMPLETE! 🎉                     ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

Write-Host "📊 Access your dashboard at:" -ForegroundColor White
Write-Host "   http://localhost:5173/`n" -ForegroundColor Cyan

Write-Host "💡 To restart in the future, just run:" -ForegroundColor White
Write-Host "   .\START-EVERYTHING.ps1`n" -ForegroundColor Gray