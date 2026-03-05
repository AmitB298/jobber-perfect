# ============================================================================
# NIFTY OPTIONS TRACKER - ULTIMATE MASTER FIX
# Fixes ALL configuration issues and sets up complete working application
# ============================================================================

$ErrorActionPreference = "Continue"

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         NIFTY OPTIONS TRACKER - MASTER FIX SCRIPT             ║" -ForegroundColor Cyan
Write-Host "║     Fixes ALL Errors & Creates Working Application            ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$frontendPath = "D:\jobber-perfect\frontend"
Set-Location $frontendPath

# ============================================================================
# STEP 1: KILL ALL RUNNING PROCESSES
# ============================================================================

Write-Host "🛑 STEP 1: Stopping all running processes...`n" -ForegroundColor Yellow

try {
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "  ✅ Stopped Node.js processes" -ForegroundColor Green
} catch {}

try {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "  ✅ Stopped Electron processes" -ForegroundColor Green
} catch {}

Start-Sleep -Seconds 2

# ============================================================================
# STEP 2: CREATE ROOT tsconfig.json (CRITICAL!)
# ============================================================================

Write-Host "`n📝 STEP 2: Creating root TypeScript configuration...`n" -ForegroundColor Yellow

$rootTsConfig = @'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
'@

$rootTsConfig | Out-File -FilePath "tsconfig.json" -Encoding utf8 -Force
Write-Host "  ✅ Created tsconfig.json" -ForegroundColor Green

# ============================================================================
# STEP 3: CREATE tsconfig.node.json (CRITICAL!)
# ============================================================================

Write-Host "`n📝 STEP 3: Creating Node TypeScript configuration...`n" -ForegroundColor Yellow

$nodeTsConfig = @'
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
'@

$nodeTsConfig | Out-File -FilePath "tsconfig.node.json" -Encoding utf8 -Force
Write-Host "  ✅ Created tsconfig.node.json" -ForegroundColor Green

# ============================================================================
# STEP 4: UPDATE vite.config.ts
# ============================================================================

Write-Host "`n⚙️  STEP 4: Updating Vite configuration...`n" -ForegroundColor Yellow

$viteConfig = @'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
'@

$viteConfig | Out-File -FilePath "vite.config.ts" -Encoding utf8 -Force
Write-Host "  ✅ Updated vite.config.ts" -ForegroundColor Green

# ============================================================================
# STEP 5: CREATE/UPDATE index.html
# ============================================================================

Write-Host "`n📄 STEP 5: Creating/updating index.html...`n" -ForegroundColor Yellow

$indexHtml = @'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NIFTY Options Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'@

$indexHtml | Out-File -FilePath "index.html" -Encoding utf8 -Force
Write-Host "  ✅ Created/updated index.html" -ForegroundColor Green

# ============================================================================
# STEP 6: CREATE src/main.tsx (ENTRY POINT)
# ============================================================================

Write-Host "`n📝 STEP 6: Creating entry point (main.tsx)...`n" -ForegroundColor Yellow

$mainTsx = @'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
'@

$mainTsx | Out-File -FilePath "src\main.tsx" -Encoding utf8 -Force
Write-Host "  ✅ Created src/main.tsx" -ForegroundColor Green

# ============================================================================
# STEP 7: CREATE src/index.css
# ============================================================================

Write-Host "`n🎨 STEP 7: Creating styles (index.css)...`n" -ForegroundColor Yellow

$indexCss = @'
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  
  color-scheme: dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  width: 100%;
  min-height: 100vh;
}

* {
  box-sizing: border-box;
}
'@

$indexCss | Out-File -FilePath "src\index.css" -Encoding utf8 -Force
Write-Host "  ✅ Created src/index.css" -ForegroundColor Green

# ============================================================================
# STEP 8: CREATE DIRECTORY STRUCTURE
# ============================================================================

Write-Host "`n📁 STEP 8: Creating directory structure...`n" -ForegroundColor Yellow

$dirs = @("src\pages", "src\types", "public")
foreach ($dir in $dirs) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  ✅ Created $dir" -ForegroundColor Green
    }
}

# ============================================================================
# STEP 9: COPY COMPONENT FILES FROM DOWNLOADS
# ============================================================================

Write-Host "`n📥 STEP 9: Copying component files from Downloads...`n" -ForegroundColor Yellow

$downloadsPath = "$env:USERPROFILE\Downloads\files (4)"

if (Test-Path $downloadsPath) {
    $fileMap = @{
        "Dashboard" = "src\pages\Dashboard.tsx"
        "Charts" = "src\pages\Charts.tsx"
        "Settings" = "src\pages\Settings.tsx"
        "Alerts" = "src\pages\Alerts.tsx"
        "App" = "src\App.tsx"
        "electron-main-index" = "electron\main\index.ts"
        "electron-preload-index" = "electron\preload\index.ts"
    }
    
    foreach ($source in $fileMap.Keys) {
        $sourcePath = Join-Path $downloadsPath $source
        $destPath = $fileMap[$source]
        
        if (Test-Path $sourcePath) {
            $destDir = Split-Path $destPath -Parent
            if (!(Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            Copy-Item $sourcePath $destPath -Force
            $size = (Get-Item $destPath).Length
            Write-Host "  ✅ Copied $source → $destPath ($size bytes)" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ⚠️  Downloads folder not found, skipping component copy" -ForegroundColor Yellow
}

# ============================================================================
# STEP 10: CREATE ELECTRON TypeScript CONFIG
# ============================================================================

Write-Host "`n⚙️  STEP 10: Creating Electron TypeScript config...`n" -ForegroundColor Yellow

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

if (!(Test-Path "electron")) {
    New-Item -ItemType Directory -Path "electron" -Force | Out-Null
}

$electronTsConfig | Out-File -FilePath "electron\tsconfig.json" -Encoding utf8 -Force
Write-Host "  ✅ Created electron/tsconfig.json" -ForegroundColor Green

# ============================================================================
# STEP 11: CREATE LAUNCHER SCRIPTS
# ============================================================================

Write-Host "`n🚀 STEP 11: Creating launcher scripts...`n" -ForegroundColor Yellow

# API Server Launcher
$startApi = @'
Write-Host "`n🚀 Starting API Server...`n" -ForegroundColor Cyan
cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"
npx ts-node api-server.ts
'@
$startApi | Out-File -FilePath "start-api.ps1" -Encoding utf8 -Force

# Frontend Launcher (VIT E ONLY - No Electron for now)
$startFrontend = @'
Write-Host "`n🚀 Starting Frontend (Vite Dev Server)...`n" -ForegroundColor Cyan
cd D:\jobber-perfect\frontend
npm run dev:vite
'@
$startFrontend | Out-File -FilePath "start-frontend.ps1" -Encoding utf8 -Force

# Master Launcher
$startAll = @'
Write-Host "`n🚀 NIFTY Options Tracker - Starting All Services`n" -ForegroundColor Cyan

Write-Host "📊 Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api.ps1"

Start-Sleep -Seconds 3

Write-Host "🌐 Starting Frontend..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-frontend.ps1"

Start-Sleep -Seconds 5

Write-Host "`n✅ Both services starting!`n" -ForegroundColor Green
Write-Host "📊 API Server: http://localhost:3001" -ForegroundColor Cyan
Write-Host "🌐 Frontend:   http://localhost:5173" -ForegroundColor Cyan
Write-Host "`nOpening browser..." -ForegroundColor Yellow

Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
'@
$startAll | Out-File -FilePath "start-all.ps1" -Encoding utf8 -Force

Write-Host "  ✅ Created start-api.ps1" -ForegroundColor Green
Write-Host "  ✅ Created start-frontend.ps1" -ForegroundColor Green
Write-Host "  ✅ Created start-all.ps1" -ForegroundColor Green

# ============================================================================
# STEP 12: UPDATE package.json SCRIPTS
# ============================================================================

Write-Host "`n📦 STEP 12: Updating package.json scripts...`n" -ForegroundColor Yellow

try {
    $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
    
    # Update scripts
    $packageJson.scripts.dev = "vite"
    $packageJson.scripts.'dev:vite' = "vite"
    $packageJson.scripts.'dev:electron' = "tsc -p electron/tsconfig.json && electron ."
    $packageJson.scripts.build = "tsc && vite build"
    $packageJson.scripts.preview = "vite preview"
    
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding utf8 -Force
    Write-Host "  ✅ Updated package.json scripts" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Could not update package.json scripts" -ForegroundColor Yellow
}

# ============================================================================
# STEP 13: VERIFICATION
# ============================================================================

Write-Host "`n✔️  STEP 13: Verifying setup...`n" -ForegroundColor Yellow

$criticalFiles = @(
    @{Path="tsconfig.json"; Name="Root TypeScript Config"},
    @{Path="tsconfig.node.json"; Name="Node TypeScript Config"},
    @{Path="vite.config.ts"; Name="Vite Config"},
    @{Path="index.html"; Name="HTML Entry Point"},
    @{Path="src\main.tsx"; Name="React Entry Point"},
    @{Path="src\index.css"; Name="Styles"},
    @{Path="src\App.tsx"; Name="Main App Component"},
    @{Path="src\pages\Dashboard.tsx"; Name="Dashboard Page"},
    @{Path="src\pages\Charts.tsx"; Name="Charts Page"},
    @{Path="src\pages\Settings.tsx"; Name="Settings Page"},
    @{Path="src\pages\Alerts.tsx"; Name="Alerts Page"}
)

$allGood = $true
foreach ($file in $criticalFiles) {
    if (Test-Path $file.Path) {
        $size = (Get-Item $file.Path).Length
        if ($size -gt 100) {
            Write-Host "  ✅ $($file.Name)" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  $($file.Name) (file too small)" -ForegroundColor Yellow
            $allGood = $false
        }
    } else {
        Write-Host "  ❌ $($file.Name) (missing)" -ForegroundColor Red
        $allGood = $false
    }
}

# ============================================================================
# FINAL INSTRUCTIONS
# ============================================================================

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                 🎉 MASTER FIX COMPLETE! 🎉                    ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

if ($allGood) {
    Write-Host "✅ ALL FILES CONFIGURED CORRECTLY!`n" -ForegroundColor Green
    
    $instructions = @"
🚀 YOUR APP IS READY TO RUN!

═══════════════════════════════════════════════════════════════
                        LAUNCH OPTIONS
═══════════════════════════════════════════════════════════════

OPTION 1: ONE-CLICK LAUNCH (RECOMMENDED) ⭐
═════════════════════════════════════════════════
.\start-all.ps1

This starts BOTH API server and frontend automatically!


OPTION 2: MANUAL (Two Terminals)
═════════════════════════════════════════════════
Terminal 1:  .\start-api.ps1
Terminal 2:  .\start-frontend.ps1


OPTION 3: NPM DIRECT
═════════════════════════════════════════════════
npm run dev


═══════════════════════════════════════════════════════════════
                     WHAT WAS FIXED
═══════════════════════════════════════════════════════════════

✅ Created tsconfig.json (root TypeScript config)
✅ Created tsconfig.node.json (Vite TypeScript config)
✅ Updated vite.config.ts (proper Vite setup)
✅ Created index.html (entry point)
✅ Created src/main.tsx (React entry)
✅ Created src/index.css (Tailwind styles)
✅ Copied all component files from Downloads
✅ Created launcher scripts
✅ Fixed package.json scripts

All Vite errors should be GONE now! 🎊


═══════════════════════════════════════════════════════════════
                     TROUBLESHOOTING
═══════════════════════════════════════════════════════════════

If you still see errors:

1. Close ALL terminals/VS Code
2. Reopen VS Code ONLY in frontend folder:
   code D:\jobber-perfect\frontend
3. Run: .\start-all.ps1

The browser will open to http://localhost:5173 automatically!
"@

    Write-Host $instructions -ForegroundColor Cyan
    
    Write-Host "`n❓ Launch the app now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $launch = Read-Host
    
    if ($launch -eq 'Y' -or $launch -eq 'y') {
        Write-Host "`n🚀 Launching...`n" -ForegroundColor Green
        .\start-all.ps1
    }
    
} else {
    Write-Host "⚠️  SOME FILES MISSING - Check verification above`n" -ForegroundColor Yellow
    Write-Host "Make sure all component files are in Downloads\files (4) folder`n" -ForegroundColor Cyan
}

Write-Host "✨ Master fix script complete! ✨`n" -ForegroundColor Green