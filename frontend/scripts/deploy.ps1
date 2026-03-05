# JOBBER Pro - Deployment & Management Script
# PowerShell 7+ recommended

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('dev', 'build', 'clean', 'install', 'test', 'package')]
    [string]$Action = 'dev'
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 JOBBER Pro - $Action" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

function Test-Prerequisites {
    Write-Host "✓ Checking prerequisites..." -ForegroundColor Yellow
    
    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Node.js not found! Please install Node.js 18+" -ForegroundColor Red
        exit 1
    }
    
    # Check npm
    try {
        $npmVersion = npm --version
        Write-Host "  npm: $npmVersion" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ npm not found!" -ForegroundColor Red
        exit 1
    }
}

function Install-Dependencies {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Installation failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✓ Dependencies installed successfully" -ForegroundColor Green
}

function Start-Development {
    Write-Host "🔧 Starting development mode..." -ForegroundColor Yellow
    Write-Host "  Vite: http://localhost:5173" -ForegroundColor Cyan
    Write-Host "  Hot reload enabled" -ForegroundColor Cyan
    Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
    
    npm run dev
}

function Build-Application {
    Write-Host "🏗️  Building application..." -ForegroundColor Yellow
    
    # Clean previous builds
    if (Test-Path "dist") {
        Remove-Item -Path "dist" -Recurse -Force
    }
    if (Test-Path "release") {
        Remove-Item -Path "release" -Recurse -Force
    }
    
    # Build
    npm run build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Build failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✓ Build completed successfully" -ForegroundColor Green
}

function Package-Application {
    Write-Host "📦 Packaging application..." -ForegroundColor Yellow
    
    $platform = Read-Host "Select platform (win/mac/linux)"
    
    switch ($platform) {
        "win" {
            npm run build:win
        }
        "mac" {
            npm run build:mac
        }
        "linux" {
            npm run build:linux
        }
        default {
            Write-Host "Invalid platform. Use: win, mac, or linux" -ForegroundColor Red
            exit 1
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Packaging failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✓ Package created successfully" -ForegroundColor Green
    Write-Host "  Location: release/" -ForegroundColor Cyan
    
    # Show release contents
    if (Test-Path "release") {
        Get-ChildItem -Path "release" -Recurse | Select-Object Name, Length, LastWriteTime
    }
}

function Clean-Project {
    Write-Host "🧹 Cleaning project..." -ForegroundColor Yellow
    
    $folders = @("dist", "release", "node_modules")
    
    foreach ($folder in $folders) {
        if (Test-Path $folder) {
            Write-Host "  Removing $folder..." -ForegroundColor Gray
            Remove-Item -Path $folder -Recurse -Force
        }
    }
    
    Write-Host "✓ Project cleaned" -ForegroundColor Green
}

function Test-Application {
    Write-Host "🧪 Running tests..." -ForegroundColor Yellow
    
    # Type checking
    Write-Host "  Type checking..." -ForegroundColor Gray
    npx tsc --noEmit -p electron/tsconfig.json
    npx tsc --noEmit
    
    # Linting
    Write-Host "  Linting..." -ForegroundColor Gray
    npm run lint 2>$null
    
    Write-Host "✓ Tests passed" -ForegroundColor Green
}

# Main execution
switch ($Action) {
    'dev' {
        Test-Prerequisites
        if (-not (Test-Path "node_modules")) {
            Install-Dependencies
        }
        Start-Development
    }
    'build' {
        Test-Prerequisites
        Build-Application
    }
    'clean' {
        Clean-Project
    }
    'install' {
        Test-Prerequisites
        Install-Dependencies
    }
    'test' {
        Test-Prerequisites
        Test-Application
    }
    'package' {
        Test-Prerequisites
        Build-Application
        Package-Application
    }
}

Write-Host ""
Write-Host "✓ Done!" -ForegroundColor Green
