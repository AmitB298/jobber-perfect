# ============================================================================
# NIFTY OPTIONS TRACKER - FINAL SETUP FROM ZIP
# Extracts ZIP and copies all files to correct locations
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         NIFTY OPTIONS TRACKER - FINAL SETUP                  ║" -ForegroundColor Cyan
Write-Host "║           Extracting and Installing All Files                ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$frontendPath = "D:\jobber-perfect\frontend"
$downloadsPath = "$env:USERPROFILE\Downloads"
$zipFile = Join-Path $downloadsPath "files(4).zip"
$extractPath = Join-Path $downloadsPath "extracted_components"

Write-Host "📂 Frontend: $frontendPath" -ForegroundColor Cyan
Write-Host "📥 Downloads: $downloadsPath" -ForegroundColor Cyan
Write-Host "📦 ZIP File: $zipFile`n" -ForegroundColor Cyan

if (!(Test-Path $frontendPath)) {
    Write-Host "❌ ERROR: Frontend directory not found" -ForegroundColor Red
    exit 1
}

# ============================================================================
# STEP 1: EXTRACT ZIP FILE
# ============================================================================

Write-Host "📦 Extracting ZIP file...`n" -ForegroundColor Yellow

if (!(Test-Path $zipFile)) {
    Write-Host "❌ ERROR: ZIP file not found at $zipFile" -ForegroundColor Red
    Write-Host "`nPlease make sure files__4_.zip is in your Downloads folder`n" -ForegroundColor Yellow
    exit 1
}

# Remove old extraction folder if exists
if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
}

# Extract ZIP
try {
    Expand-Archive -Path $zipFile -DestinationPath $extractPath -Force
    Write-Host "  ✅ ZIP file extracted successfully" -ForegroundColor Green
    Write-Host "  📂 Extracted to: $extractPath`n" -ForegroundColor Gray
} catch {
    Write-Host "  ❌ Failed to extract ZIP: $_" -ForegroundColor Red
    exit 1
}

# List extracted files
Write-Host "📋 Found files in ZIP:" -ForegroundColor Cyan
Get-ChildItem $extractPath | ForEach-Object {
    Write-Host "  • $($_.Name) ($($_.Length) bytes)" -ForegroundColor Gray
}
Write-Host ""

# ============================================================================
# STEP 2: CREATE DIRECTORIES
# ============================================================================

Write-Host "📁 Creating directory structure...`n" -ForegroundColor Yellow

$directories = @(
    "src\pages",
    "electron\main",
    "electron\preload"
)

foreach ($dir in $directories) {
    $dirPath = Join-Path $frontendPath $dir
    if (!(Test-Path $dirPath)) {
        New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
        Write-Host "  ✅ Created: $dir" -ForegroundColor Green
    } else {
        Write-Host "  ✓ Exists: $dir" -ForegroundColor Gray
    }
}

# ============================================================================
# STEP 3: COPY FILES FROM EXTRACTED FOLDER
# ============================================================================

Write-Host "`n📥 Copying component files...`n" -ForegroundColor Yellow

# File mapping: Source filename → Destination path
$fileMap = @{
    "Dashboard.tsx" = "src\pages\Dashboard.tsx"
    "Charts.tsx" = "src\pages\Charts.tsx"
    "Settings.tsx" = "src\pages\Settings.tsx"
    "Alerts.tsx" = "src\pages\Alerts.tsx"
    "App.tsx" = "src\App.tsx"
    "electron-main-index.ts" = "electron\main\index.ts"
    "electron-preload-index.ts" = "electron\preload\index.ts"
}

$copied = 0
$failed = @()

foreach ($sourceFile in $fileMap.Keys) {
    $sourcePath = Join-Path $extractPath $sourceFile
    $destRelative = $fileMap[$sourceFile]
    $destPath = Join-Path $frontendPath $destRelative
    
    # Ensure destination directory exists
    $destDir = Split-Path $destPath -Parent
    if (!(Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    
    if (Test-Path $sourcePath) {
        try {
            Copy-Item $sourcePath $destPath -Force
            $size = (Get-Item $destPath).Length
            Write-Host "  ✅ $sourceFile → $destRelative" -ForegroundColor Green
            Write-Host "     Size: $([Math]::Round($size/1KB, 1)) KB" -ForegroundColor Gray
            $copied++
        } catch {
            Write-Host "  ❌ Failed: $sourceFile - $_" -ForegroundColor Red
            $failed += $sourceFile
        }
    } else {
        Write-Host "  ⚠️  Not found in ZIP: $sourceFile" -ForegroundColor Yellow
        $failed += $sourceFile
    }
}

Write-Host "`n  📊 Successfully copied: $copied/$($fileMap.Count) files" -ForegroundColor Cyan

# ============================================================================
# STEP 4: CREATE LAUNCHER SCRIPTS
# ============================================================================

Write-Host "`n📝 Creating launcher scripts...`n" -ForegroundColor Yellow

Set-Location $frontendPath

# start-api.ps1
$startApiScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              STARTING NIFTY OPTIONS API SERVER               ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"

Write-Host "🔌 API Server: http://localhost:3001" -ForegroundColor Green
Write-Host "📊 Database: PostgreSQL (tradedb)" -ForegroundColor Green
Write-Host "⏸  Press Ctrl+C to stop`n" -ForegroundColor Yellow

npx ts-node api-server.ts
'@
$startApiScript | Out-File "start-api.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-api.ps1" -ForegroundColor Green

# start-app.ps1
$startAppScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║            STARTING NIFTY OPTIONS FRONTEND APP                ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

cd D:\jobber-perfect\frontend

Write-Host "🌐 Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "🚀 Dev Server: Vite + React" -ForegroundColor Green
Write-Host "🔄 Auto-refresh: Enabled" -ForegroundColor Green
Write-Host "⏸  Press Ctrl+C to stop`n" -ForegroundColor Yellow

npm run dev
'@
$startAppScript | Out-File "start-app.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-app.ps1" -ForegroundColor Green

# start-all.ps1 (Master launcher)
$startAllScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     NIFTY OPTIONS TRACKER - LAUNCHING ALL SERVICES           ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

Write-Host "🚀 Step 1/2: Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api.ps1"

Write-Host "⏳ Waiting for API to initialize (5 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "🚀 Step 2/2: Starting Frontend App..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-app.ps1"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  ✅ ALL SERVICES STARTED! ✅                   ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "📊 Dashboard URL: http://localhost:5173" -ForegroundColor Cyan
Write-Host "🔌 API Endpoint: http://localhost:3001" -ForegroundColor Cyan
Write-Host "`n💡 TIP: Two new PowerShell windows will open" -ForegroundColor Yellow
Write-Host "         Keep them running while using the app" -ForegroundColor Yellow
Write-Host "         Close them or press Ctrl+C to stop`n" -ForegroundColor Yellow

# Wait a bit for Vite to start, then open browser
Start-Sleep -Seconds 10
Write-Host "🌐 Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"
'@
$startAllScript | Out-File "start-all.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-all.ps1 (Master launcher)" -ForegroundColor Green

# ============================================================================
# STEP 5: VERIFY INSTALLATION
# ============================================================================

Write-Host "`n✔️  Verifying installation...`n" -ForegroundColor Yellow

$requiredFiles = @{
    "src\pages\Dashboard.tsx" = "Dashboard Component"
    "src\pages\Charts.tsx" = "Charts Component"
    "src\pages\Settings.tsx" = "Settings Component"
    "src\pages\Alerts.tsx" = "Alerts Component"
    "src\App.tsx" = "Main App Component"
    "electron\main\index.ts" = "Electron Main Process"
    "electron\preload\index.ts" = "Electron Preload Script"
}

$ready = 0
$missing = @()

foreach ($file in $requiredFiles.Keys) {
    $filePath = Join-Path $frontendPath $file
    $description = $requiredFiles[$file]
    
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length
        if ($size -gt 500) {
            Write-Host "  ✅ $description" -ForegroundColor Green
            Write-Host "     $file ($([Math]::Round($size/1KB, 1)) KB)" -ForegroundColor Gray
            $ready++
        } else {
            Write-Host "  ⚠️  $description (file too small: $size bytes)" -ForegroundColor Yellow
            $missing += $file
        }
    } else {
        Write-Host "  ❌ $description (missing)" -ForegroundColor Red
        Write-Host "     Expected at: $file" -ForegroundColor Gray
        $missing += $file
    }
}

Write-Host "`n  📊 Final Status: $ready/$($requiredFiles.Count) files ready" -ForegroundColor Cyan

# ============================================================================
# STEP 6: CLEANUP
# ============================================================================

Write-Host "`n🧹 Cleaning up...`n" -ForegroundColor Yellow

if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
    Write-Host "  ✅ Removed temporary extraction folder" -ForegroundColor Green
}

# ============================================================================
# FINAL STATUS & LAUNCH
# ============================================================================

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  🎉 INSTALLATION COMPLETE! 🎉                 ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

if ($ready -eq $requiredFiles.Count) {
    Write-Host "✅ ALL $ready FILES SUCCESSFULLY INSTALLED!`n" -ForegroundColor Green
    
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                    🚀 HOW TO START 🚀                         ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
    
    Write-Host "RECOMMENDED - ONE COMMAND:`n" -ForegroundColor White
    Write-Host "   .\start-all.ps1" -ForegroundColor Green
    Write-Host "   (Starts API + Frontend, opens browser automatically)`n" -ForegroundColor Gray
    
    Write-Host "ALTERNATIVE - MANUAL START:`n" -ForegroundColor White
    Write-Host "   Terminal 1: .\start-api.ps1" -ForegroundColor Yellow
    Write-Host "   Terminal 2: .\start-app.ps1" -ForegroundColor Yellow
    Write-Host "   Browser: http://localhost:5173`n" -ForegroundColor Yellow
    
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                   WHAT YOU'LL SEE                             ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
    
    Write-Host "  📊 Real-time NIFTY Options Dashboard" -ForegroundColor White
    Write-Host "  📈 PCR (Put/Call Ratio) - OI & Volume" -ForegroundColor White
    Write-Host "  💰 Max Pain Strike calculation" -ForegroundColor White
    Write-Host "  📋 Full Options Chain (ATM ±500 strikes)" -ForegroundColor White
    Write-Host "  🔄 Auto-refresh every 2 seconds" -ForegroundColor White
    Write-Host "  📉 Interactive charts & analytics`n" -ForegroundColor White
    
    Write-Host "❓ Launch the app now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host "`n🚀 LAUNCHING NIFTY OPTIONS TRACKER...`n" -ForegroundColor Green
        & ".\start-all.ps1"
        Write-Host "`n✅ Check the new PowerShell windows and browser!`n" -ForegroundColor Green
    } else {
        Write-Host "`n👍 Ready to go! Run .\start-all.ps1 when you want to start`n" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  SETUP INCOMPLETE - Some Files Missing`n" -ForegroundColor Yellow
    
    Write-Host "Missing or invalid files:" -ForegroundColor Red
    foreach ($file in $missing) {
        Write-Host "  • $file" -ForegroundColor Red
    }
    
    Write-Host "`n💡 TROUBLESHOOTING:`n" -ForegroundColor Cyan
    Write-Host "1. Check if files__4_.zip is in Downloads folder" -ForegroundColor White
    Write-Host "2. Re-download the ZIP if it's corrupted" -ForegroundColor White
    Write-Host "3. Run this script again: .\install-from-zip.ps1`n" -ForegroundColor White
}

Write-Host "✨ Setup script finished! ✨`n" -ForegroundColor Green