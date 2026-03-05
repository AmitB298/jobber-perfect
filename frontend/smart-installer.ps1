# ============================================================================
# NIFTY OPTIONS TRACKER - SMART ZIP INSTALLER
# Automatically finds and extracts the ZIP file
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         NIFTY OPTIONS TRACKER - SMART INSTALLER              ║" -ForegroundColor Cyan
Write-Host "║           Auto-detecting and Installing Files                ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$frontendPath = "D:\jobber-perfect\frontend"
$downloadsPath = "$env:USERPROFILE\Downloads"

Write-Host "📂 Frontend: $frontendPath" -ForegroundColor Cyan
Write-Host "📥 Downloads: $downloadsPath`n" -ForegroundColor Cyan

if (!(Test-Path $frontendPath)) {
    Write-Host "❌ ERROR: Frontend directory not found" -ForegroundColor Red
    exit 1
}

# ============================================================================
# STEP 1: FIND THE ZIP FILE OR EXTRACTED FOLDER
# ============================================================================

Write-Host "🔍 Searching for component files...`n" -ForegroundColor Yellow

# Try to find ZIP file with various names
$possibleZipNames = @(
    "files__4_.zip",
    "files (4).zip",
    "files.zip",
    "components.zip"
)

$zipFile = $null
foreach ($zipName in $possibleZipNames) {
    $testPath = Join-Path $downloadsPath $zipName
    if (Test-Path $testPath) {
        $zipFile = $testPath
        Write-Host "  ✅ Found ZIP: $zipName" -ForegroundColor Green
        break
    }
}

# Also check for extracted folder
$extractedFolder = $null
$possibleFolders = @(
    "files (4)",
    "files__4_",
    "files",
    "components"
)

foreach ($folderName in $possibleFolders) {
    $testPath = Join-Path $downloadsPath $folderName
    if (Test-Path $testPath) {
        # Check if it contains component files
        $dashboardFile = Join-Path $testPath "Dashboard.tsx"
        if (Test-Path $dashboardFile) {
            $extractedFolder = $testPath
            Write-Host "  ✅ Found extracted folder: $folderName" -ForegroundColor Green
            break
        }
    }
}

# Determine source
$sourcePath = $null
$needsExtraction = $false

if ($extractedFolder) {
    $sourcePath = $extractedFolder
    Write-Host "  📂 Using extracted folder: $extractedFolder`n" -ForegroundColor Cyan
} elseif ($zipFile) {
    $sourcePath = Join-Path $downloadsPath "temp_extract"
    $needsExtraction = $true
    Write-Host "  📦 Will extract ZIP file`n" -ForegroundColor Cyan
} else {
    Write-Host "  ❌ No ZIP file or extracted folder found" -ForegroundColor Red
    Write-Host "`n💡 Please ensure one of these exists in Downloads:" -ForegroundColor Yellow
    Write-Host "   • files__4_.zip" -ForegroundColor Gray
    Write-Host "   • files (4) folder" -ForegroundColor Gray
    Write-Host "   • Or run: Expand-Archive -Path 'path\to\zip' -DestinationPath '$downloadsPath\files'`n" -ForegroundColor Gray
    exit 1
}

# ============================================================================
# STEP 2: EXTRACT ZIP IF NEEDED
# ============================================================================

if ($needsExtraction) {
    Write-Host "📦 Extracting ZIP file...`n" -ForegroundColor Yellow
    
    # Remove old extraction folder if exists
    if (Test-Path $sourcePath) {
        Remove-Item $sourcePath -Recurse -Force
    }
    
    try {
        Expand-Archive -Path $zipFile -DestinationPath $sourcePath -Force
        Write-Host "  ✅ Extracted successfully`n" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ Failed to extract: $_" -ForegroundColor Red
        exit 1
    }
}

# List files found
Write-Host "📋 Component files found:" -ForegroundColor Cyan
$componentFiles = Get-ChildItem $sourcePath -Filter "*.tsx" -ErrorAction SilentlyContinue
$componentFiles += Get-ChildItem $sourcePath -Filter "*.ts" -ErrorAction SilentlyContinue
foreach ($file in $componentFiles) {
    Write-Host "  • $($file.Name) ($([Math]::Round($file.Length/1KB, 1)) KB)" -ForegroundColor Gray
}
Write-Host ""

# ============================================================================
# STEP 3: CREATE DIRECTORIES
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
# STEP 4: COPY FILES
# ============================================================================

Write-Host "`n📥 Installing component files...`n" -ForegroundColor Yellow

# File mapping
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

foreach ($sourceFile in $fileMap.Keys) {
    $sourceFilePath = Join-Path $sourcePath $sourceFile
    $destRelative = $fileMap[$sourceFile]
    $destPath = Join-Path $frontendPath $destRelative
    
    # Ensure destination directory exists
    $destDir = Split-Path $destPath -Parent
    if (!(Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    
    if (Test-Path $sourceFilePath) {
        try {
            Copy-Item $sourceFilePath $destPath -Force
            $size = (Get-Item $destPath).Length
            Write-Host "  ✅ $sourceFile → $destRelative" -ForegroundColor Green
            Write-Host "     $([Math]::Round($size/1KB, 1)) KB" -ForegroundColor Gray
            $copied++
        } catch {
            Write-Host "  ❌ Failed: $sourceFile - $_" -ForegroundColor Red
        }
    } else {
        Write-Host "  ⚠️  Not found: $sourceFile" -ForegroundColor Yellow
    }
}

Write-Host "`n  📊 Installed: $copied/$($fileMap.Count) files" -ForegroundColor Cyan

# ============================================================================
# STEP 5: CREATE LAUNCHER SCRIPTS
# ============================================================================

Write-Host "`n📝 Creating launcher scripts...`n" -ForegroundColor Yellow

Set-Location $frontendPath

# start-api.ps1
$startApiScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              🚀 NIFTY OPTIONS API SERVER 🚀                  ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"

Write-Host "✅ API Server: http://localhost:3001" -ForegroundColor Green
Write-Host "✅ Database: PostgreSQL (tradedb)" -ForegroundColor Green
Write-Host "⏸  Press Ctrl+C to stop`n" -ForegroundColor Yellow

npx ts-node api-server.ts
'@
$startApiScript | Out-File "start-api.ps1" -Encoding utf8 -Force
Write-Host "  ✅ start-api.ps1" -ForegroundColor Green

# start-app.ps1
$startAppScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              🌐 NIFTY OPTIONS FRONTEND 🌐                    ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

cd D:\jobber-perfect\frontend

Write-Host "✅ Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "✅ Framework: Vite + React + TypeScript" -ForegroundColor Green
Write-Host "⏸  Press Ctrl+C to stop`n" -ForegroundColor Yellow

npm run dev
'@
$startAppScript | Out-File "start-app.ps1" -Encoding utf8 -Force
Write-Host "  ✅ start-app.ps1" -ForegroundColor Green

# start-all.ps1
$startAllScript = @'
Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          🎯 NIFTY OPTIONS TRACKER - LAUNCHER 🎯              ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

Write-Host "⚡ Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api.ps1"

Write-Host "⏳ Waiting 5 seconds for API to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "⚡ Starting Frontend App..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-app.ps1"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                     ✅ SERVICES STARTED ✅                     ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "📊 Dashboard: http://localhost:5173" -ForegroundColor Cyan
Write-Host "🔌 API: http://localhost:3001" -ForegroundColor Cyan
Write-Host "`n💡 Two PowerShell windows opened - keep them running!" -ForegroundColor Yellow

Start-Sleep -Seconds 12
Write-Host "`n🌐 Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"
'@
$startAllScript | Out-File "start-all.ps1" -Encoding utf8 -Force
Write-Host "  ✅ start-all.ps1 (Master)" -ForegroundColor Green

# ============================================================================
# STEP 6: VERIFY INSTALLATION
# ============================================================================

Write-Host "`n✔️  Verifying installation...`n" -ForegroundColor Yellow

$requiredFiles = @{
    "src\pages\Dashboard.tsx" = "Dashboard"
    "src\pages\Charts.tsx" = "Charts"
    "src\pages\Settings.tsx" = "Settings"
    "src\pages\Alerts.tsx" = "Alerts"
    "src\App.tsx" = "App"
    "electron\main\index.ts" = "Electron Main"
    "electron\preload\index.ts" = "Electron Preload"
}

$ready = 0

foreach ($file in $requiredFiles.Keys) {
    $filePath = Join-Path $frontendPath $file
    $name = $requiredFiles[$file]
    
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length
        if ($size -gt 500) {
            Write-Host "  ✅ $name ($([Math]::Round($size/1KB, 1)) KB)" -ForegroundColor Green
            $ready++
        } else {
            Write-Host "  ⚠️  $name (too small)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ❌ $name (missing)" -ForegroundColor Red
    }
}

Write-Host "`n  📊 Status: $ready/$($requiredFiles.Count) ready`n" -ForegroundColor Cyan

# ============================================================================
# CLEANUP
# ============================================================================

if ($needsExtraction -and (Test-Path $sourcePath)) {
    Remove-Item $sourcePath -Recurse -Force -ErrorAction SilentlyContinue
}

# ============================================================================
# FINAL STATUS
# ============================================================================

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                 ✅ INSTALLATION COMPLETE ✅                    ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

if ($ready -eq $requiredFiles.Count) {
    Write-Host "🎉 ALL FILES INSTALLED SUCCESSFULLY!`n" -ForegroundColor Green
    
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                      🚀 QUICK START 🚀                        ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
    
    Write-Host "ONE COMMAND TO START EVERYTHING:`n" -ForegroundColor White
    Write-Host "   .\start-all.ps1`n" -ForegroundColor Green
    
    Write-Host "This will:" -ForegroundColor Gray
    Write-Host "  • Start API server (localhost:3001)" -ForegroundColor Gray
    Write-Host "  • Start frontend (localhost:5173)" -ForegroundColor Gray
    Write-Host "  • Open browser automatically`n" -ForegroundColor Gray
    
    Write-Host "❓ Launch now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host "`n🚀 LAUNCHING...`n" -ForegroundColor Green
        & ".\start-all.ps1"
    } else {
        Write-Host "`n👍 Ready! Run .\start-all.ps1 when ready`n" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  Some files missing - see above`n" -ForegroundColor Yellow
}

Write-Host "✨ Done! ✨`n" -ForegroundColor Green