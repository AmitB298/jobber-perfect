# ============================================================================
# NIFTY OPTIONS TRACKER - QUICK SETUP (CORRECTED PATH)
# Copies all files from Downloads\files (4) folder to frontend project
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         NIFTY OPTIONS TRACKER - QUICK DEPLOYMENT             ║" -ForegroundColor Cyan
Write-Host "║           Copying Files from Downloads Folder                ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$frontendPath = "D:\jobber-perfect\frontend"
$downloadsPath = "$env:USERPROFILE\Downloads\files (4)"

Write-Host "📂 Frontend: $frontendPath" -ForegroundColor Cyan
Write-Host "📥 Source: $downloadsPath`n" -ForegroundColor Cyan

# Check if source directory exists
if (!(Test-Path $downloadsPath)) {
    Write-Host "❌ ERROR: Source directory not found: $downloadsPath" -ForegroundColor Red
    Write-Host "`nLooking for files in other common locations...`n" -ForegroundColor Yellow
    
    # Try to find the files folder
    $possiblePaths = @(
        "$env:USERPROFILE\Downloads\files (4)",
        "$env:USERPROFILE\Downloads\files",
        "$env:USERPROFILE\Downloads"
    )
    
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $filesInPath = Get-ChildItem $path -Filter "Dashboard*" -ErrorAction SilentlyContinue
            if ($filesInPath) {
                Write-Host "  ✅ Found files in: $path" -ForegroundColor Green
                $downloadsPath = $path
                break
            }
        }
    }
    
    if (!(Test-Path "$downloadsPath\Dashboard")) {
        Write-Host "  ❌ Could not find the files. Please check the location.`n" -ForegroundColor Red
        exit 1
    }
}

if (!(Test-Path $frontendPath)) {
    Write-Host "❌ ERROR: Frontend directory not found" -ForegroundColor Red
    exit 1
}

Set-Location $frontendPath

# ============================================================================
# STEP 1: CREATE DIRECTORIES
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
# STEP 2: COPY FILES (FILES DON'T HAVE EXTENSIONS IN DOWNLOADS)
# ============================================================================

Write-Host "`n📥 Copying files from Downloads...`n" -ForegroundColor Yellow

# File mapping: Downloads filename (no extension) → Frontend destination (with extension)
$fileMap = @{
    "Dashboard" = "src\pages\Dashboard.tsx"
    "Charts" = "src\pages\Charts.tsx"
    "Settings" = "src\pages\Settings.tsx"
    "Alerts" = "src\pages\Alerts.tsx"
    "App" = "src\App.tsx"
    "electron-main-index" = "electron\main\index.ts"
    "electron-preload-index" = "electron\preload\index.ts"
}

$copied = 0
$failed = @()

foreach ($sourceFile in $fileMap.Keys) {
    $sourcePath = Join-Path $downloadsPath $sourceFile
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
            Write-Host "     Size: $size bytes" -ForegroundColor Gray
            $copied++
        } catch {
            Write-Host "  ❌ Failed: $sourceFile - $_" -ForegroundColor Red
            $failed += $sourceFile
        }
    } else {
        Write-Host "  ⚠️  Not found: $sourceFile" -ForegroundColor Yellow
        $failed += $sourceFile
    }
}

Write-Host "`n  📊 Successfully copied: $copied/$($fileMap.Count) files" -ForegroundColor Cyan

# ============================================================================
# STEP 3: CREATE LAUNCHER SCRIPTS
# ============================================================================

Write-Host "`n📝 Creating launcher scripts...`n" -ForegroundColor Yellow

# start-api.ps1
$startApiScript = @'
Write-Host "`n🚀 Starting API Server...`n" -ForegroundColor Cyan
cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"
Write-Host "✅ API Server: http://localhost:3001" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow
npx ts-node api-server.ts
'@
$startApiScript | Out-File "start-api.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-api.ps1" -ForegroundColor Green

# start-app.ps1
$startAppScript = @'
Write-Host "`n🚀 Starting Frontend App...`n" -ForegroundColor Cyan
cd D:\jobber-perfect\frontend
Write-Host "✅ Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Browser will open automatically`n" -ForegroundColor Yellow
npm run dev
'@
$startAppScript | Out-File "start-app.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-app.ps1" -ForegroundColor Green

# start-all.ps1 (Master launcher)
$startAllScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       NIFTY OPTIONS TRACKER - STARTING ALL SERVICES          ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

Write-Host "🚀 Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api.ps1"

Write-Host "⏳ Waiting for API to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "🚀 Starting Frontend App..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-app.ps1"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  ✅ ALL SERVICES STARTED! ✅                   ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "📊 Access your dashboard at: http://localhost:5173" -ForegroundColor Cyan
Write-Host "🔌 API Server running at: http://localhost:3001" -ForegroundColor Cyan
Write-Host "`n💡 TIP: Keep both PowerShell windows open while using the app`n" -ForegroundColor Yellow
'@
$startAllScript | Out-File "start-all.ps1" -Encoding utf8 -Force
Write-Host "  ✅ Created start-all.ps1 (Master launcher)" -ForegroundColor Green

# ============================================================================
# STEP 4: VERIFY INSTALLATION
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
            Write-Host "     $file ($size bytes)" -ForegroundColor Gray
            $ready++
        } else {
            Write-Host "  ⚠️  $description (file too small)" -ForegroundColor Yellow
            Write-Host "     $file ($size bytes)" -ForegroundColor Gray
            $missing += $file
        }
    } else {
        Write-Host "  ❌ $description (missing)" -ForegroundColor Red
        Write-Host "     $file" -ForegroundColor Gray
        $missing += $file
    }
}

Write-Host "`n  📊 Status: $ready/$($requiredFiles.Count) files ready`n" -ForegroundColor Cyan

# ============================================================================
# FINAL STATUS & LAUNCH
# ============================================================================

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  🎉 SETUP COMPLETE! 🎉                        ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

if ($ready -eq $requiredFiles.Count) {
    Write-Host "✅ ALL FILES SUCCESSFULLY INSTALLED!`n" -ForegroundColor Green
    
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                      HOW TO START                             ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
    
    Write-Host "🚀 OPTION 1 - ONE CLICK (RECOMMENDED):`n" -ForegroundColor White
    Write-Host "   .\start-all.ps1" -ForegroundColor Green
    Write-Host "   (Automatically starts both API and frontend)`n" -ForegroundColor Gray
    
    Write-Host "🚀 OPTION 2 - MANUAL (Two separate windows):`n" -ForegroundColor White
    Write-Host "   Terminal 1: .\start-api.ps1" -ForegroundColor Yellow
    Write-Host "   Terminal 2: .\start-app.ps1`n" -ForegroundColor Yellow
    
    Write-Host "📊 After starting, access at: http://localhost:5173`n" -ForegroundColor Cyan
    
    Write-Host "❓ Would you like to launch the app now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host "`n🚀 Launching NIFTY Options Tracker...`n" -ForegroundColor Green
        & ".\start-all.ps1"
        Start-Sleep -Seconds 2
        Write-Host "✅ Check the new PowerShell windows for server status`n" -ForegroundColor Green
    } else {
        Write-Host "`n👍 No problem! Run .\start-all.ps1 whenever you're ready`n" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  SETUP INCOMPLETE - Some Files Missing`n" -ForegroundColor Yellow
    
    Write-Host "Missing files:" -ForegroundColor Red
    foreach ($file in $missing) {
        Write-Host "  • $file" -ForegroundColor Red
    }
    
    Write-Host "`n💡 TROUBLESHOOTING:`n" -ForegroundColor Cyan
    Write-Host "1. Check if files exist in: $downloadsPath" -ForegroundColor White
    Write-Host "2. Make sure the 'files (4)' folder contains all component files" -ForegroundColor White
    Write-Host "3. Or manually copy files to the frontend folder`n" -ForegroundColor White
}

Write-Host "✨ Setup script finished! ✨`n" -ForegroundColor Green