# ============================================================================
# NIFTY OPTIONS TRACKER - FIXED DEPLOYMENT SCRIPT
# Handles missing files gracefully and provides better diagnostics
# ============================================================================

$ErrorActionPreference = "Continue"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║    NIFTY OPTIONS TRACKER - FIXED DEPLOYMENT SCRIPT            ║" -ForegroundColor Cyan
Write-Host "║              Automatic File Transfer & Setup                  ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# ============================================================================
# CONFIGURATION
# ============================================================================

$frontendPath = "D:\jobber-perfect\frontend"
$downloadsPath = "$env:USERPROFILE\Downloads"

Write-Host "📂 Frontend Path: $frontendPath" -ForegroundColor Cyan
Write-Host "📥 Downloads Path: $downloadsPath`n" -ForegroundColor Cyan

if (!(Test-Path $frontendPath)) {
    Write-Host "❌ ERROR: Frontend directory not found at $frontendPath" -ForegroundColor Red
    Write-Host "Please check the path and try again.`n" -ForegroundColor Yellow
    exit 1
}

Set-Location $frontendPath

# ============================================================================
# FILE MAPPING - Source (Downloads) → Destination (Frontend)
# ============================================================================

$fileMapping = @{
    # React Pages
    "Dashboard.tsx" = "src\pages\Dashboard.tsx"
    "Charts.tsx" = "src\pages\Charts.tsx"
    "Settings.tsx" = "src\pages\Settings.tsx"
    "Alerts.tsx" = "src\pages\Alerts.tsx"
    "App.tsx" = "src\App.tsx"
    
    # Electron Files
    "electron-main-index.ts" = "electron\main\index.ts"
    "electron-preload-index.ts" = "electron\preload\index.ts"
}

# ============================================================================
# STEP 1: CHECK WHAT FILES EXIST IN DOWNLOADS
# ============================================================================

Write-Host "🔍 STEP 1: Scanning Downloads folder...`n" -ForegroundColor Yellow

$foundFiles = @()
$notFoundFiles = @()

foreach ($sourceName in $fileMapping.Keys) {
    $sourcePath = Join-Path $downloadsPath $sourceName
    if (Test-Path $sourcePath) {
        $fileSize = (Get-Item $sourcePath).Length
        Write-Host "  ✅ Found: $sourceName ($fileSize bytes)" -ForegroundColor Green
        $foundFiles += $sourceName
    } else {
        Write-Host "  ❌ Missing: $sourceName" -ForegroundColor Red
        $notFoundFiles += $sourceName
    }
}

Write-Host "`n  📊 Found: $($foundFiles.Count)/$($fileMapping.Count) files`n" -ForegroundColor Cyan

# If no files found, provide guidance
if ($foundFiles.Count -eq 0) {
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║                    ⚠️  NO FILES FOUND! ⚠️                      ║" -ForegroundColor Red
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Red
    
    Write-Host "It looks like the required files are not in your Downloads folder." -ForegroundColor Yellow
    Write-Host "`nYou have 3 options:`n" -ForegroundColor Cyan
    
    Write-Host "1️⃣  CREATE FILES MANUALLY" -ForegroundColor White
    Write-Host "   Ask Claude to generate each component file separately" -ForegroundColor Gray
    Write-Host "   Save them in the correct locations in your frontend folder`n" -ForegroundColor Gray
    
    Write-Host "2️⃣  USE FILE GENERATOR SCRIPT" -ForegroundColor White
    Write-Host "   Ask Claude to create a script that generates all files directly" -ForegroundColor Gray
    Write-Host "   in the correct locations (no Downloads folder needed)`n" -ForegroundColor Gray
    
    Write-Host "3️⃣  MANUAL SETUP" -ForegroundColor White
    Write-Host "   Get the code for each component from Claude" -ForegroundColor Gray
    Write-Host "   Create files manually in VS Code`n" -ForegroundColor Gray
    
    Write-Host "❓ Would you like to continue anyway to set up the project structure? (Y/N): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -ne 'Y' -and $response -ne 'y') {
        Write-Host "`n👋 Setup cancelled. Please prepare the files and run this script again.`n" -ForegroundColor Cyan
        exit 0
    }
}

# ============================================================================
# STEP 2: CREATE BACKUP
# ============================================================================

Write-Host "💾 STEP 2: Creating backup of existing files...`n" -ForegroundColor Yellow

$backupDir = Join-Path $frontendPath "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$filesToBackup = @(
    "src\App.tsx",
    "src\pages\Dashboard.tsx",
    "src\pages\Charts.tsx",
    "src\pages\Settings.tsx",
    "src\pages\Alerts.tsx",
    "electron\main\index.ts",
    "electron\preload\index.ts"
)

$backedUpCount = 0
foreach ($file in $filesToBackup) {
    $sourcePath = Join-Path $frontendPath $file
    if (Test-Path $sourcePath) {
        $destPath = Join-Path $backupDir $file
        $destDir = Split-Path $destPath -Parent
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        Copy-Item $sourcePath $destPath -Force
        Write-Host "  ✅ Backed up: $file" -ForegroundColor Green
        $backedUpCount++
    }
}

if ($backedUpCount -gt 0) {
    Write-Host "`n  📦 Backup saved to: $backupDir`n" -ForegroundColor Cyan
} else {
    Write-Host "`n  ℹ️  No existing files to backup`n" -ForegroundColor Gray
}

# ============================================================================
# STEP 3: CREATE REQUIRED DIRECTORIES
# ============================================================================

Write-Host "📁 STEP 3: Creating directory structure...`n" -ForegroundColor Yellow

$directories = @(
    "src\pages",
    "src\services",
    "src\types",
    "public",
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
# STEP 4: COPY FILES FROM DOWNLOADS (if found)
# ============================================================================

Write-Host "`n📥 STEP 4: Copying files from Downloads folder...`n" -ForegroundColor Yellow

$filesCopied = 0

if ($foundFiles.Count -gt 0) {
    foreach ($sourceName in $foundFiles) {
        $sourcePath = Join-Path $downloadsPath $sourceName
        $destRelative = $fileMapping[$sourceName]
        $destPath = Join-Path $frontendPath $destRelative
        
        try {
            # Ensure destination directory exists
            $destDir = Split-Path $destPath -Parent
            if (!(Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            
            # Copy the file
            Copy-Item $sourcePath $destPath -Force
            
            # Verify the copy
            if (Test-Path $destPath) {
                $fileSize = (Get-Item $destPath).Length
                Write-Host "  ✅ Copied: $sourceName → $destRelative" -ForegroundColor Green
                Write-Host "     Size: $fileSize bytes" -ForegroundColor Gray
                $filesCopied++
            } else {
                Write-Host "  ❌ Failed to verify: $sourceName" -ForegroundColor Red
            }
        } catch {
            Write-Host "  ❌ Error copying $sourceName : $_" -ForegroundColor Red
        }
    }
    
    Write-Host "`n  📊 Files copied: $filesCopied/$($foundFiles.Count)`n" -ForegroundColor Cyan
} else {
    Write-Host "  ⚠️  No files to copy from Downloads folder" -ForegroundColor Yellow
    Write-Host "  You'll need to create the component files manually`n" -ForegroundColor Yellow
}

# ============================================================================
# STEP 5: UPDATE CONFIGURATION FILES
# ============================================================================

Write-Host "⚙️  STEP 5: Creating/updating configuration files...`n" -ForegroundColor Yellow

# Update Vite Config
$viteConfig = @'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
'@

$viteConfig | Out-File -FilePath (Join-Path $frontendPath "vite.config.ts") -Encoding utf8 -Force
Write-Host "  ✅ Created vite.config.ts" -ForegroundColor Green

# Create Electron Directory Structure
$electronDir = Join-Path $frontendPath "electron"
if (!(Test-Path $electronDir)) {
    New-Item -ItemType Directory -Path $electronDir -Force | Out-Null
}

# Update Electron TypeScript Config
$electronTsConfig = @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist-electron",
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["**/*"]
}
'@

$electronTsConfigPath = Join-Path $electronDir "tsconfig.json"
$electronTsConfig | Out-File -FilePath $electronTsConfigPath -Encoding utf8 -Force
Write-Host "  ✅ Created electron/tsconfig.json" -ForegroundColor Green

# Create TypeScript Definitions
$typesDir = Join-Path $frontendPath "src\types"
if (!(Test-Path $typesDir)) {
    New-Item -ItemType Directory -Path $typesDir -Force | Out-Null
}

$typesDef = @'
// src/types/electron.d.ts
export interface ElectronAPI {
  openCharts: () => Promise<void>;
  openSettings: () => Promise<void>;
  openAlerts: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  updateTray: (stats: any) => Promise<void>;
  showNotification: (options: { title: string; body: string; urgent?: boolean }) => Promise<void>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<boolean>;
  getAllSettings: () => Promise<any>;
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  onRefreshData: (callback: () => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  platform: string;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
'@

$typesDef | Out-File -FilePath (Join-Path $typesDir "electron.d.ts") -Encoding utf8 -Force
Write-Host "  ✅ Created src/types/electron.d.ts" -ForegroundColor Green

# ============================================================================
# STEP 6: CREATE PLACEHOLDER ICONS
# ============================================================================

Write-Host "`n🎨 STEP 6: Creating placeholder files...`n" -ForegroundColor Yellow

$publicDir = Join-Path $frontendPath "public"
if (!(Test-Path $publicDir)) {
    New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
}

"PLACEHOLDER_ICON" | Out-File -FilePath (Join-Path $publicDir "icon.png") -Encoding utf8 -Force
"PLACEHOLDER_ICON" | Out-File -FilePath (Join-Path $publicDir "tray-icon.png") -Encoding utf8 -Force

Write-Host "  ✅ Created placeholder icons in public/" -ForegroundColor Green

# ============================================================================
# STEP 7: CREATE START SCRIPTS
# ============================================================================

Write-Host "`n📝 STEP 7: Creating launch scripts...`n" -ForegroundColor Yellow

# Create start-api-server.ps1
$startApiScript = @'
# Start API Server
Write-Host "`n🚀 Starting NIFTY Options API Server...`n" -ForegroundColor Cyan

cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"

Write-Host "✅ API Server running on http://localhost:3001" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow

npx ts-node api-server.ts
'@

$startApiScript | Out-File -FilePath (Join-Path $frontendPath "start-api-server.ps1") -Encoding utf8 -Force
Write-Host "  ✅ Created start-api-server.ps1" -ForegroundColor Green

# Create start-dev-app.ps1
$startDevScript = @'
# Start Development App
Write-Host "`n🚀 Starting NIFTY Options Desktop App (Dev Mode)...`n" -ForegroundColor Cyan

cd D:\jobber-perfect\frontend

Write-Host "✅ Dev server will start on http://localhost:5173" -ForegroundColor Green
Write-Host "Browser will open automatically`n" -ForegroundColor Yellow

npm run dev
'@

$startDevScript | Out-File -FilePath (Join-Path $frontendPath "start-dev-app.ps1") -Encoding utf8 -Force
Write-Host "  ✅ Created start-dev-app.ps1" -ForegroundColor Green

# Create start-both.ps1
$startBothScript = @'
# Start Both API Server and Dev App
Write-Host "`n🚀 Starting NIFTY Options Tracker - Complete System`n" -ForegroundColor Cyan

# Start API Server in new window
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api-server.ps1"

# Wait for API to start
Write-Host "⏳ Waiting for API server to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Start Dev App in new window
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-dev-app.ps1"

Write-Host "`n✅ Both servers starting in separate windows!" -ForegroundColor Green
Write-Host "`n📊 Access your dashboard at: http://localhost:5173`n" -ForegroundColor Cyan
'@

$startBothScript | Out-File -FilePath (Join-Path $frontendPath "start-both.ps1") -Encoding utf8 -Force
Write-Host "  ✅ Created start-both.ps1 (Master launcher)" -ForegroundColor Green

# ============================================================================
# STEP 8: VERIFY INSTALLATION
# ============================================================================

Write-Host "`n✔️  STEP 8: Verifying installation...`n" -ForegroundColor Yellow

$requiredFiles = @{
    "src\pages\Dashboard.tsx" = "Dashboard component"
    "src\pages\Charts.tsx" = "Charts component"
    "src\pages\Settings.tsx" = "Settings component"
    "src\pages\Alerts.tsx" = "Alerts component"
    "src\App.tsx" = "Main App component"
    "electron\main\index.ts" = "Electron main process"
    "electron\preload\index.ts" = "Electron preload script"
    "src\types\electron.d.ts" = "TypeScript definitions"
    "vite.config.ts" = "Vite configuration"
    "package.json" = "Package configuration"
}

$presentCount = 0
$missingComponentFiles = @()

foreach ($file in $requiredFiles.Keys) {
    $filePath = Join-Path $frontendPath $file
    $description = $requiredFiles[$file]
    
    if (Test-Path $filePath) {
        $fileSize = (Get-Item $filePath).Length
        if ($fileSize -gt 100) {
            Write-Host "  ✅ $description" -ForegroundColor Green
            Write-Host "     $file ($fileSize bytes)" -ForegroundColor Gray
            $presentCount++
        } else {
            Write-Host "  ⚠️  $description (file too small - likely placeholder)" -ForegroundColor Yellow
            Write-Host "     $file ($fileSize bytes)" -ForegroundColor Gray
            if ($file -notmatch "package.json|vite.config.ts|electron.d.ts") {
                $missingComponentFiles += $file
            }
        }
    } else {
        Write-Host "  ❌ $description (missing)" -ForegroundColor Red
        Write-Host "     $file" -ForegroundColor Gray
        if ($file -notmatch "package.json") {
            $missingComponentFiles += $file
        }
    }
}

Write-Host "`n  📊 Status: $presentCount/$($requiredFiles.Count) files ready`n" -ForegroundColor Cyan

# ============================================================================
# FINAL REPORT
# ============================================================================

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    SETUP COMPLETE                             ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

if ($missingComponentFiles.Count -eq 0) {
    Write-Host "✅ ALL FILES PRESENT - YOUR APP IS READY!`n" -ForegroundColor Green
    
    Write-Host "🚀 TO START YOUR APP:`n" -ForegroundColor Cyan
    Write-Host "   .\start-both.ps1" -ForegroundColor White
    Write-Host "   (Starts both API server and frontend)`n" -ForegroundColor Gray
    
    Write-Host "❓ Launch now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host "`n🚀 Launching...`n" -ForegroundColor Green
        & ".\start-both.ps1"
    }
} else {
    Write-Host "⚠️  SETUP INCOMPLETE - Missing Component Files`n" -ForegroundColor Yellow
    
    Write-Host "📋 Missing Files:" -ForegroundColor Red
    foreach ($file in $missingComponentFiles) {
        Write-Host "   • $file" -ForegroundColor Red
    }
    
    Write-Host "`n💡 NEXT STEPS:`n" -ForegroundColor Cyan
    Write-Host "1️⃣  Ask Claude: 'Generate all missing React component files for my NIFTY Options Tracker'" -ForegroundColor White
    Write-Host "2️⃣  Or run: .\create-all-components.ps1 (if you have that script)" -ForegroundColor White
    Write-Host "3️⃣  Then run: .\deploy-desktop-app-FIXED.ps1 again`n" -ForegroundColor White
}

Write-Host "✨ Setup script finished! ✨`n" -ForegroundColor Green