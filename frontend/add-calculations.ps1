# ============================================================================
# ADD ADVANCED CALCULATIONS TO DASHBOARD
# ============================================================================

Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        ADDING ADVANCED CALCULATIONS TO YOUR DASHBOARD        ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

cd D:\jobber-perfect\frontend

# ============================================================================
# STEP 1: CREATE SERVICES DIRECTORY
# ============================================================================

Write-Host "📁 STEP 1: Creating services directory...`n" -ForegroundColor Yellow

if (!(Test-Path "src\services")) {
    New-Item -ItemType Directory -Path "src\services" -Force | Out-Null
    Write-Host "  ✅ Created src/services" -ForegroundColor Green
} else {
    Write-Host "  ℹ️  src/services already exists" -ForegroundColor Gray
}

# ============================================================================
# STEP 2: DOWNLOAD FILES FROM CHAT
# ============================================================================

Write-Host "`n📥 STEP 2: Download these files from the chat:`n" -ForegroundColor Yellow

Write-Host "  1. calculations.ts" -ForegroundColor Cyan
Write-Host "     → Save to: D:\jobber-perfect\frontend\src\services\calculations.ts`n" -ForegroundColor Gray

Write-Host "  2. Dashboard-Enhanced.tsx" -ForegroundColor Cyan
Write-Host "     → Save to: D:\jobber-perfect\frontend\src\pages\Dashboard.tsx" -ForegroundColor Gray
Write-Host "     (Replace the existing Dashboard.tsx)`n" -ForegroundColor Yellow

# ============================================================================
# STEP 3: VERIFY FILES
# ============================================================================

Write-Host "`n✔️  STEP 3: Verifying files...`n" -ForegroundColor Yellow

$requiredFiles = @(
    @{Path="src\services\calculations.ts"; Name="Calculations Service"},
    @{Path="src\pages\Dashboard.tsx"; Name="Enhanced Dashboard"}
)

$allPresent = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file.Path) {
        $size = (Get-Item $file.Path).Length
        if ($size -gt 1000) {
            Write-Host "  ✅ $($file.Name) ($([math]::Round($size/1024, 1)) KB)" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  $($file.Name) (file too small - may not be downloaded yet)" -ForegroundColor Yellow
            $allPresent = $false
        }
    } else {
        Write-Host "  ❌ $($file.Name) (not found - please download)" -ForegroundColor Red
        $allPresent = $false
    }
}

# ============================================================================
# STEP 4: RESTART FRONTEND
# ============================================================================

if ($allPresent) {
    Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║              ✅ ALL FILES READY! ✅                           ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

    Write-Host "🚀 Ready to restart with advanced calculations!`n" -ForegroundColor Cyan

    Write-Host "❓ Restart the frontend now? (Y/N): " -ForegroundColor Yellow -NoNewline
    $restart = Read-Host

    if ($restart -eq 'Y' -or $restart -eq 'y') {
        Write-Host "`n🛑 Stopping frontend...`n" -ForegroundColor Yellow
        Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2

        Write-Host "🚀 Starting frontend with calculations...`n" -ForegroundColor Green
        npm run dev:vite
    } else {
        Write-Host "`nRun 'npm run dev:vite' when ready!`n" -ForegroundColor Cyan
    }
} else {
    Write-Host "`n╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "║          ⚠️  PLEASE DOWNLOAD MISSING FILES ⚠️                ║" -ForegroundColor Yellow
    Write-Host "╚═══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Yellow

    Write-Host "Download the files shown above from the chat, then run this script again!`n" -ForegroundColor Cyan
}

Write-Host "✨ Integration script complete! ✨`n" -ForegroundColor Green
