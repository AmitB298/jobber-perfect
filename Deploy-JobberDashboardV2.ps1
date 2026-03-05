#Requires -Version 5.1
<#
.SYNOPSIS
    JOBBER PRO — Dashboard v2 Micro-Structure Deployer
.EXAMPLE
    .\Deploy-JobberDashboardV2.ps1
    .\Deploy-JobberDashboardV2.ps1 -DryRun
    .\Deploy-JobberDashboardV2.ps1 -SkipBackup
    .\Deploy-JobberDashboardV2.ps1 -Force
#>

param(
    [switch]$DryRun,
    [switch]$SkipBackup,
    [switch]$Force,
    [string]$DownloadsPath = "$env:USERPROFILE\Downloads",
    [string]$ProjectRoot   = "D:\jobber-perfect\frontend\src\pages"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ============================================================================
# COLOUR HELPERS
# ============================================================================
function Write-Header($text) {
    Write-Host ""
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ("  " + "─" * ($text.Length)) -ForegroundColor DarkCyan
}
function Write-Step($icon, $text) { Write-Host "  $icon  $text" -ForegroundColor White }
function Write-OK($text)          { Write-Host "  ✅  $text" -ForegroundColor Green }
function Write-Warn($text)        { Write-Host "  ⚠️   $text" -ForegroundColor Yellow }
function Write-Err($text)         { Write-Host "  ❌  $text" -ForegroundColor Red }
function Write-Info($text)        { Write-Host "     $text" -ForegroundColor Gray }

# ============================================================================
# BANNER
# ============================================================================
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║       JOBBER PRO — Dashboard v2 Deployment Script           ║" -ForegroundColor Cyan
Write-Host "  ║       Micro-Structure: constants / shared / tabs            ║" -ForegroundColor DarkCyan
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  🔍  DRY RUN MODE — no files will be written" -ForegroundColor Magenta
}
Write-Host ""

# ============================================================================
# HELPER — Recursively find the real source root containing Dashboard.tsx
# ============================================================================
function Find-SourceRoot {
    param([string]$SearchBase)

    # Check directly in this folder first
    if (Test-Path (Join-Path $SearchBase "Dashboard.tsx")) {
        return $SearchBase
    }

    # Search up to 4 levels deep
    $found = Get-ChildItem -Path $SearchBase -Filter "Dashboard.tsx" `
                           -Recurse -Depth 4 -ErrorAction SilentlyContinue |
             Select-Object -First 1

    if ($found) {
        return $found.DirectoryName
    }

    return $null
}

# ============================================================================
# STEP 1 — FIND SOURCE
# ============================================================================
Write-Header "STEP 1  Finding jobber_dashboard_v2 in Downloads"

$sourceRoot = $null

# ── Priority 1: already-extracted folder ────────────────────────────────────
$candidateFolder = Join-Path $DownloadsPath "jobber_dashboard_v2"
if (Test-Path $candidateFolder -PathType Container) {
    Write-Step "📁" "Found folder: $candidateFolder — scanning for Dashboard.tsx…"
    $sourceRoot = Find-SourceRoot -SearchBase $candidateFolder
    if ($sourceRoot) {
        Write-OK "Source root resolved: $sourceRoot"
    } else {
        Write-Warn "Folder exists but Dashboard.tsx not found inside — will try zip"
    }
}

# ── Priority 2: zip file ─────────────────────────────────────────────────────
if (-not $sourceRoot) {
    $candidateZips = @(
        (Join-Path $DownloadsPath "jobber_dashboard_v2.zip"),
        (Join-Path $DownloadsPath "jobber_dashboard_v2 (1).zip"),
        (Join-Path $DownloadsPath "jobber_dashboard_v2 (2).zip")
    )

    $zipFile = $null
    foreach ($z in $candidateZips) {
        if (Test-Path $z -PathType Leaf) {
            $zipFile = $z
            Write-OK "Found zip: $z"
            break
        }
    }

    if ($zipFile) {
        Write-Step "📦" "Extracting zip…"
        $extractDest = Join-Path $DownloadsPath "jobber_dashboard_v2_extracted"
        if (Test-Path $extractDest) { Remove-Item $extractDest -Recurse -Force }
        Expand-Archive -Path $zipFile -DestinationPath $extractDest
        Write-Step "🔍" "Scanning extracted content for Dashboard.tsx…"
        $sourceRoot = Find-SourceRoot -SearchBase $extractDest
        if ($sourceRoot) {
            Write-OK "Source root resolved: $sourceRoot"
        }
    }
}

# ── Fallback: scan entire Downloads folder ───────────────────────────────────
if (-not $sourceRoot) {
    Write-Step "🔎" "Fallback: scanning all of Downloads for Dashboard.tsx…"
    $found = Get-ChildItem -Path $DownloadsPath -Filter "Dashboard.tsx" `
                           -Recurse -Depth 5 -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($found) {
        $sourceRoot = $found.DirectoryName
        Write-Warn "Found via fallback scan: $sourceRoot"
    }
}

# ── Nothing found — show diagnostics ─────────────────────────────────────────
if (-not $sourceRoot) {
    Write-Err "Cannot locate Dashboard.tsx anywhere in $DownloadsPath"
    Write-Host ""
    Write-Host "  📋  Jobber-related items in your Downloads:" -ForegroundColor Yellow
    Get-ChildItem -Path $DownloadsPath -Filter "*jobber*" -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Info "  $($_.FullName)" }
    Write-Host ""
    Write-Info "The zip should unpack to a folder containing:"
    Write-Info "  Dashboard.tsx  constants.ts  types.ts  shared\  tabs\"
    exit 1
}

# ── Show resolved source contents ────────────────────────────────────────────
Write-Host ""
Write-Host "  📂  Resolved source root contents:" -ForegroundColor DarkCyan
Get-ChildItem -Path $sourceRoot | ForEach-Object {
    $icon = if ($_.PSIsContainer) { "📁" } else { "📄" }
    Write-Info "  $icon  $($_.Name)"
}
Write-Host ""

# ── Verify all 17 required files ─────────────────────────────────────────────
$requiredSourceFiles = @(
    "Dashboard.tsx",
    "types.ts",
    "constants.ts",
    "shared\helpers.ts",
    "shared\BS.ts",
    "shared\useNetworkMonitor.ts",
    "shared\NetComponents.tsx",
    "shared\MarketStatusBanner.tsx",
    "shared\index.ts",
    "tabs\ChainTab.tsx",
    "tabs\ChartsTab.tsx",
    "tabs\SignalsTab.tsx",
    "tabs\AnalyticsTab.tsx",
    "tabs\StrategyBuilderTab.tsx",
    "tabs\SpoofingTab.tsx",
    "tabs\NetworkTab.tsx",
    "tabs\index.ts"
)

Write-Step "🔍" "Verifying all required source files…"
$missingSource = @()
foreach ($f in $requiredSourceFiles) {
    $full = Join-Path $sourceRoot $f
    if (-not (Test-Path $full)) { $missingSource += $f }
}

if ($missingSource.Count -gt 0) {
    Write-Err "Source is incomplete — missing $($missingSource.Count) file(s):"
    $missingSource | ForEach-Object { Write-Info "  • $_" }
    Write-Host ""
    Write-Host "  📋  All files actually present in source root:" -ForegroundColor Yellow
    Get-ChildItem -Path $sourceRoot -Recurse | ForEach-Object {
        $rel = $_.FullName.Replace($sourceRoot + "\", "")
        Write-Info "  $rel"
    }
    exit 1
}
Write-OK "All $($requiredSourceFiles.Count) source files found"

# ============================================================================
# STEP 2 — VERIFY PROJECT TARGET EXISTS
# ============================================================================
Write-Header "STEP 2  Verifying project target"

if (-not (Test-Path $ProjectRoot -PathType Container)) {
    Write-Err "Target path not found: $ProjectRoot"
    Write-Info "Expected: D:\jobber-perfect\frontend\src\pages"
    exit 1
}

$currentDashboard = Join-Path $ProjectRoot "Dashboard.tsx"
if (-not (Test-Path $currentDashboard)) {
    Write-Warn "No existing Dashboard.tsx found — this will be a fresh deploy"
} else {
    $size = [math]::Round((Get-Item $currentDashboard).Length / 1KB, 1)
    Write-OK "Current Dashboard.tsx found ($size KB)"
}
Write-OK "Target root: $ProjectRoot"

# ============================================================================
# STEP 3 — BACKUP
# ============================================================================
Write-Header "STEP 3  Backing up current code"

if ($SkipBackup) {
    Write-Warn "Backup skipped (-SkipBackup flag)"
} else {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupDir = Join-Path $ProjectRoot "dashboard_backup_$timestamp"

    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }

    if (Test-Path $currentDashboard) {
        if (-not $DryRun) {
            Copy-Item $currentDashboard -Destination (Join-Path $backupDir "Dashboard.tsx")
        }
        Write-OK "Backed up Dashboard.tsx → dashboard_backup_$timestamp\"
    }

    $existingDashDir = Join-Path $ProjectRoot "dashboard"
    if (Test-Path $existingDashDir -PathType Container) {
        if (-not $DryRun) {
            Copy-Item $existingDashDir -Destination (Join-Path $backupDir "dashboard") -Recurse
        }
        Write-OK "Backed up existing dashboard\ subfolder"
    }

    Write-Info "Backup location: $backupDir"
}

# ============================================================================
# STEP 4 — CONFIRM (unless -Force or -DryRun)
# ============================================================================
if (-not $Force -and -not $DryRun) {
    Write-Host ""
    Write-Host "  📋  DEPLOYMENT PLAN" -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkYellow
    Write-Host "  FROM: $sourceRoot" -ForegroundColor Gray
    Write-Host "    TO: $ProjectRoot" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Files that will be written:" -ForegroundColor White
    Write-Host "    pages\Dashboard.tsx            ← replaces monolith" -ForegroundColor Green
    Write-Host "    pages\dashboard\constants.ts" -ForegroundColor Green
    Write-Host "    pages\dashboard\types.ts" -ForegroundColor Green
    Write-Host "    pages\dashboard\shared\ (6 files)" -ForegroundColor Green
    Write-Host "    pages\dashboard\tabs\   (8 files)" -ForegroundColor Green
    Write-Host ""
    $confirm = Read-Host "  Deploy now? [Y/n]"
    if ($confirm -match '^[Nn]') {
        Write-Warn "Deployment cancelled by user."
        exit 0
    }
}

# ============================================================================
# STEP 5 — DEPLOY
# ============================================================================
Write-Header "STEP 5  Deploying files"

$deployMap = [ordered]@{
    "Dashboard.tsx"                 = "Dashboard.tsx"
    "constants.ts"                  = "dashboard\constants.ts"
    "types.ts"                      = "dashboard\types.ts"
    "shared\helpers.ts"             = "dashboard\shared\helpers.ts"
    "shared\BS.ts"                  = "dashboard\shared\BS.ts"
    "shared\useNetworkMonitor.ts"   = "dashboard\shared\useNetworkMonitor.ts"
    "shared\NetComponents.tsx"      = "dashboard\shared\NetComponents.tsx"
    "shared\MarketStatusBanner.tsx" = "dashboard\shared\MarketStatusBanner.tsx"
    "shared\index.ts"               = "dashboard\shared\index.ts"
    "tabs\ChainTab.tsx"             = "dashboard\tabs\ChainTab.tsx"
    "tabs\ChartsTab.tsx"            = "dashboard\tabs\ChartsTab.tsx"
    "tabs\SignalsTab.tsx"           = "dashboard\tabs\SignalsTab.tsx"
    "tabs\AnalyticsTab.tsx"         = "dashboard\tabs\AnalyticsTab.tsx"
    "tabs\StrategyBuilderTab.tsx"   = "dashboard\tabs\StrategyBuilderTab.tsx"
    "tabs\SpoofingTab.tsx"          = "dashboard\tabs\SpoofingTab.tsx"
    "tabs\NetworkTab.tsx"           = "dashboard\tabs\NetworkTab.tsx"
    "tabs\index.ts"                 = "dashboard\tabs\index.ts"
}

$deployed    = 0
$overwritten = 0
$errors      = @()

foreach ($entry in $deployMap.GetEnumerator()) {
    $srcFile  = Join-Path $sourceRoot $entry.Key
    $destFile = Join-Path $ProjectRoot $entry.Value
    $destDir  = Split-Path $destFile -Parent

    if (-not $DryRun -and -not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    $existed = Test-Path $destFile
    $label   = if ($existed) { "OVERWRITE" } else { "NEW      " }
    $colour  = if ($existed) { "Yellow" } else { "Green" }

    try {
        if (-not $DryRun) {
            Copy-Item -Path $srcFile -Destination $destFile -Force
            if (-not (Test-Path $destFile)) { throw "File not found after copy" }
            $destSize = [math]::Round((Get-Item $destFile).Length / 1KB, 1)
        } else {
            $destSize = [math]::Round((Get-Item $srcFile).Length / 1KB, 1)
        }

        $dryIcon = if ($DryRun) { "📋" } else { "✅" }
        Write-Host ("  $dryIcon  [$label]  $($entry.Value)  ($destSize KB)") -ForegroundColor $colour
        $deployed++
        if ($existed) { $overwritten++ }
    } catch {
        Write-Err "Failed: $($entry.Value) — $_"
        $errors += $entry.Value
    }
}

# ============================================================================
# STEP 6 — POST-DEPLOY VERIFICATION
# ============================================================================
Write-Header "STEP 6  Verifying deployment"

$verifyOK   = 0
$verifyFail = 0

foreach ($entry in $deployMap.GetEnumerator()) {
    $destFile = Join-Path $ProjectRoot $entry.Value
    if ($DryRun) { $verifyOK++; continue }
    if (Test-Path $destFile) {
        if ((Get-Item $destFile).Length -gt 0) { $verifyOK++ }
        else { Write-Warn "Zero-byte file: $($entry.Value)"; $verifyFail++ }
    } else {
        Write-Err "Missing after deploy: $($entry.Value)"
        $verifyFail++
    }
}

if ($verifyFail -eq 0) {
    Write-OK "All $verifyOK files verified successfully"
} else {
    Write-Err "$verifyFail file(s) failed verification"
}

# ============================================================================
# STEP 7 — SUMMARY
# ============================================================================
$newFiles = $deployed - $overwritten

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║                   DEPLOYMENT SUMMARY                        ║" -ForegroundColor Cyan
Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host ("  ║  Files deployed  : {0,-43}║" -f $deployed)     -ForegroundColor White
Write-Host ("  ║  New files       : {0,-43}║" -f $newFiles)     -ForegroundColor Green
Write-Host ("  ║  Overwritten     : {0,-43}║" -f $overwritten)  -ForegroundColor Yellow
Write-Host ("  ║  Errors          : {0,-43}║" -f $errors.Count) -ForegroundColor $(if ($errors.Count -gt 0) { 'Red' } else { 'White' })
Write-Host ("  ║  Verified OK     : {0,-43}║" -f $verifyOK)    -ForegroundColor Green
Write-Host ("  ║  DryRun          : {0,-43}║" -f $DryRun)      -ForegroundColor $(if ($DryRun) { 'Magenta' } else { 'White' })
Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║  TARGET STRUCTURE                                            ║" -ForegroundColor Cyan
Write-Host "  ║  src\pages\                                                  ║" -ForegroundColor Gray
Write-Host "  ║    Dashboard.tsx            ← thin shell (~200 lines)        ║" -ForegroundColor Green
Write-Host "  ║    dashboard\                                                ║" -ForegroundColor Gray
Write-Host "  ║      constants.ts  types.ts                                  ║" -ForegroundColor Green
Write-Host "  ║      shared\  helpers.ts BS.ts useNetworkMonitor.ts          ║" -ForegroundColor Green
Write-Host "  ║               NetComponents.tsx MarketStatusBanner.tsx       ║" -ForegroundColor Green
Write-Host "  ║      tabs\  ChainTab ChartsTab SignalsTab AnalyticsTab        ║" -ForegroundColor Green
Write-Host "  ║             StrategyBuilderTab SpoofingTab NetworkTab        ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║  NEXT STEPS                                                  ║" -ForegroundColor Cyan
Write-Host "  ║  1. cd D:\jobber-perfect\frontend                            ║" -ForegroundColor Yellow
Write-Host "  ║  2. npm run dev                                              ║" -ForegroundColor Yellow
Write-Host "  ║  3. Open http://localhost:5173                               ║" -ForegroundColor Yellow
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($errors.Count -gt 0) {
    Write-Err "Deployment completed with $($errors.Count) error(s). Check above."
    exit 1
}

if ($DryRun) {
    Write-Host "  🔍  DRY RUN COMPLETE — run without -DryRun to actually deploy" -ForegroundColor Magenta
} else {
    Write-Host "  🚀  DEPLOYMENT COMPLETE — run npm run dev to start" -ForegroundColor Green
}
Write-Host ""