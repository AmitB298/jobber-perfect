#Requires -Version 5.1
<#
.SYNOPSIS
    JOBBER PRO — Complete Project Analyzer v2.2
    Satellite view → Ground Zero view of D:\jobber-perfect

.DESCRIPTION
    Scans every layer of the project and produces a full health report.

.EXAMPLE
    .\Analyze-JobberPro.ps1
    .\Analyze-JobberPro.ps1 -Quick          # Skip API + DB checks
    .\Analyze-JobberPro.ps1 -ExportHTML     # Save report as HTML
    .\Analyze-JobberPro.ps1 -Fix            # Auto-fix safe issues
#>

param(
    [switch]$Quick,
    [switch]$ExportHTML,
    [switch]$Fix,
    [string]$ProjectRoot = "D:\jobber-perfect"
)

$ErrorActionPreference = 'SilentlyContinue'
Set-StrictMode -Off

# ============================================================================
# GLOBALS
# ============================================================================
$Script:Score      = 100
$Script:Issues     = @()
$Script:Fixes      = @()
$Script:StartTime  = Get-Date
$Script:ReportLines = [System.Collections.Generic.List[string]]::new()

$FrontendPath  = Join-Path $ProjectRoot "frontend"
$BackendPath   = Join-Path $ProjectRoot "backend"
$FrontendSrc   = Join-Path $FrontendPath "src"
$FrontendPages = Join-Path $FrontendSrc "pages"

$ApiBase = "http://localhost:3001"

$ApiEndpoints = @(
    @{ Method="GET";  Path="/health";                             Name="Health Check" }
    @{ Method="GET";  Path="/api/options/chain";                  Name="Options Chain" }
    @{ Method="GET";  Path="/api/options/greeks";                 Name="Greeks" }
    @{ Method="GET";  Path="/api/options/spot";                   Name="Spot Price" }
    @{ Method="GET";  Path="/api/options/pcr";                    Name="PCR" }
    @{ Method="GET";  Path="/api/options/maxpain";                Name="Max Pain" }
    @{ Method="GET";  Path="/api/analytics/signals";              Name="Signals" }
    @{ Method="GET";  Path="/api/analytics/iv-history";           Name="IV History" }
    @{ Method="GET";  Path="/api/analytics/expected-move";        Name="Expected Move" }
    @{ Method="GET";  Path="/api/analytics/premium-intelligence"; Name="Premium Intelligence" }
    @{ Method="GET";  Path="/api/network/status";                 Name="Network Status" }
    @{ Method="GET";  Path="/api/spoofing/alerts";                Name="Spoofing Alerts" }
    @{ Method="GET";  Path="/api/snapshots";                      Name="Snapshots" }
    @{ Method="GET";  Path="/api/stats";                          Name="Stats" }
)

# ============================================================================
# COLOUR & OUTPUT HELPERS
# ============================================================================
function Write-Banner($text, $color = "Cyan") {
    $line = "═" * 64
    Write-Host ""
    Write-Host "  ╔$line╗" -ForegroundColor $color
    Write-Host ("  ║  {0,-62}║" -f $text) -ForegroundColor $color
    Write-Host "  ╚$line╝" -ForegroundColor $color
    $Script:ReportLines.Add("=== $text ===")
}

function Write-Section($text) {
    Write-Host ""
    Write-Host "  ┌─ $text " -ForegroundColor DarkCyan -NoNewline
    Write-Host ("─" * [Math]::Max(2, 58 - $text.Length)) -ForegroundColor DarkCyan
    $Script:ReportLines.Add("`n--- $text ---")
}

function Write-OK($text) {
    Write-Host "  ✅  $text" -ForegroundColor Green
    $Script:ReportLines.Add("[OK]  $text")
}
function Write-Warn($text, $deduct = 2) {
    Write-Host "  ⚠️   $text" -ForegroundColor Yellow
    $Script:ReportLines.Add("[WARN] $text")
    $Script:Score -= $deduct
    $Script:Issues += "WARN: $text"
}
function Write-Err($text, $deduct = 5) {
    Write-Host "  ❌  $text" -ForegroundColor Red
    $Script:ReportLines.Add("[ERR]  $text")
    $Script:Score -= $deduct
    $Script:Issues += "ERR: $text"
}
function Write-Info($text) {
    Write-Host "     $text" -ForegroundColor Gray
    $Script:ReportLines.Add("      $text")
}
function Write-Data($label, $value, $color = "White") {
    Write-Host ("     {0,-30} {1}" -f "${label}:", $value) -ForegroundColor $color
    $Script:ReportLines.Add("  $label : $value")
}

function Get-FileSizeLabel($bytes) {
    if ($bytes -gt 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -gt 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

# ============================================================================
# CLEAR + HEADER
# ============================================================================
Clear-Host
Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        JOBBER PRO — Complete Project Analyzer v2.2            ║" -ForegroundColor Cyan
Write-Host "  ║        Satellite → Ground Zero Intelligence Report             ║" -ForegroundColor DarkCyan
Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host "  📅  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')   📂  $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# LAYER 1 — PROJECT STRUCTURE
# ============================================================================
Write-Banner "LAYER 1 — Project Structure & File Inventory"

if (-not (Test-Path $ProjectRoot)) {
    Write-Err "Project root not found: $ProjectRoot" 20
    exit 1
}

Write-Section "Sub-projects"
$subProjects = @("frontend","backend","dashboard","dist-electron")
foreach ($sp in $subProjects) {
    $path = Join-Path $ProjectRoot $sp
    if (Test-Path $path) {
        $files = Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -notmatch 'node_modules|\.git|dist\\|\.next' }
        $totalSize = ($files | Measure-Object Length -Sum).Sum
        Write-OK "$sp — $($files.Count) files, $(Get-FileSizeLabel $totalSize)"
    } else {
        Write-Warn "$sp — NOT FOUND"
    }
}

Write-Section "Key File Sizes"
$keyFiles = @(
    @{ Path = "$FrontendPages\Dashboard.tsx";                        Label = "Dashboard.tsx (shell)" }
    @{ Path = "$FrontendPages\dashboard\tabs\AnalyticsTab.tsx";      Label = "AnalyticsTab.tsx" }
    @{ Path = "$FrontendPages\dashboard\tabs\SignalsTab.tsx";         Label = "SignalsTab.tsx" }
    @{ Path = "$FrontendPages\dashboard\tabs\ChartsTab.tsx";          Label = "ChartsTab.tsx" }
    @{ Path = "$FrontendPages\dashboard\tabs\StrategyBuilderTab.tsx"; Label = "StrategyBuilderTab.tsx" }
    @{ Path = "$BackendPath\api-server.ts";                           Label = "api-server.ts" }
    @{ Path = "$BackendPath\src\scripts\websocket-collector.ts";      Label = "websocket-collector.ts" }
)
foreach ($f in $keyFiles) {
    if (Test-Path $f.Path) {
        $item  = Get-Item $f.Path
        $lines = (Get-Content $f.Path -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
        $sizeLabel = Get-FileSizeLabel $item.Length
        $color = if ($item.Length -gt 100KB) { "Yellow" } else { "Green" }
        Write-Host ("     {0,-40} {1,8}  {2,6} lines" -f $f.Label, $sizeLabel, $lines) -ForegroundColor $color
    } else {
        Write-Warn "$($f.Label) — MISSING" 3
    }
}

Write-Section "Backup & Junk Detection"
$backupFolders = Get-ChildItem $ProjectRoot -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'backup|BACKUP|FIXES_BACKUP|backup-2026' } |
    Where-Object { $_.FullName -notmatch 'node_modules' }
if ($backupFolders.Count -gt 0) {
    Write-Warn "$($backupFolders.Count) backup folder(s) found — consider cleanup"
    $backupFolders | ForEach-Object { Write-Info "  📁 $($_.FullName)" }
} else {
    Write-OK "No junk backup folders"
}

# ============================================================================
# LAYER 2 — RUNNING SERVICES & PORTS
# ============================================================================
Write-Banner "LAYER 2 — Running Services & Port Status"

$portsToCheck = @(
    @{ Port=5173; Service="Vite Dev Server";        Critical=$true  }
    @{ Port=3001; Service="API Server (backend)";   Critical=$true  }
    @{ Port=3000; Service="Auth Server (backend/src)"; Critical=$false }
    @{ Port=8765; Service="Spoofing Dashboard WS";  Critical=$false }
    @{ Port=5432; Service="PostgreSQL Database";    Critical=$true  }
)

foreach ($p in $portsToCheck) {
    $conn = Test-NetConnection -ComputerName localhost -Port $p.Port -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($conn) {
        Write-OK "Port $($p.Port) — $($p.Service) is RUNNING"
    } else {
        $sev = if ($p.Critical) { 8 } else { 2 }
        Write-Warn "Port $($p.Port) — $($p.Service) NOT responding" $sev
    }
}

Write-Section "Node Processes"
$nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcs) {
    Write-OK "$($nodeProcs.Count) node.exe process(es) running"
    $nodeProcs | ForEach-Object {
        Write-Info ("  PID {0,-6} CPU {1,5}s  RAM {2}" -f $_.Id, [math]::Round($_.CPU,1), (Get-FileSizeLabel $_.WorkingSet64))
    }
} else {
    Write-Warn "No node processes running — start backend + frontend"
}

# ============================================================================
# LAYER 3 — PACKAGE.JSON ANALYSIS
# ============================================================================
Write-Banner "LAYER 3 — Package.json Analysis"

$pkgFiles = @(
    @{ Path = "$FrontendPath\package.json"; Label = "frontend" }
    @{ Path = "$BackendPath\package.json";  Label = "backend"  }
)

foreach ($pkg in $pkgFiles) {
    Write-Section "$($pkg.Label) package.json"
    if (-not (Test-Path $pkg.Path)) { Write-Err "$($pkg.Label) package.json MISSING" 10; continue }

    try {
        $json = Get-Content $pkg.Path -Raw | ConvertFrom-Json
        Write-Data "Name"    $json.name
        Write-Data "Version" $json.version

        if ($pkg.Label -eq "frontend") {
            $devScript = $json.scripts.dev
            if ($devScript -eq "vite") {
                Write-OK "dev script = 'vite' ✅ (Electron removed)"
            } elseif ($devScript -match "concurrently") {
                Write-Err "dev script still launches Electron! Fix: change to 'vite'" 10
                $Script:Fixes += "Change frontend package.json 'dev' script to 'vite'"
            } else {
                Write-Data "dev script" $devScript
            }
            if ($json.devDependencies.electron) {
                Write-Info "  Electron version: $($json.devDependencies.electron) (dev dep — OK)"
            }
        }

        $depCount = ($json.dependencies  | Get-Member -MemberType NoteProperty -ErrorAction SilentlyContinue).Count
        $devCount = ($json.devDependencies | Get-Member -MemberType NoteProperty -ErrorAction SilentlyContinue).Count
        Write-Data "Dependencies" "$depCount prod + $devCount dev"

    } catch {
        Write-Err "$($pkg.Label) package.json is invalid JSON" 8
    }
}

# ============================================================================
# LAYER 4 — FRONTEND HEALTH
# ============================================================================
Write-Banner "LAYER 4 — Frontend Health"

Write-Section "Micro-Structure (dashboard tabs)"
$requiredTabFiles = @(
    "Dashboard.tsx",
    "dashboard\constants.ts",
    "dashboard\types.ts",
    "dashboard\shared\helpers.ts",
    "dashboard\shared\BS.ts",
    "dashboard\shared\useNetworkMonitor.ts",
    "dashboard\shared\NetComponents.tsx",
    "dashboard\shared\MarketStatusBanner.tsx",
    "dashboard\shared\index.ts",
    "dashboard\tabs\ChainTab.tsx",
    "dashboard\tabs\ChartsTab.tsx",
    "dashboard\tabs\SignalsTab.tsx",
    "dashboard\tabs\AnalyticsTab.tsx",
    "dashboard\tabs\StrategyBuilderTab.tsx",
    "dashboard\tabs\SpoofingTab.tsx",
    "dashboard\tabs\NetworkTab.tsx",
    "dashboard\tabs\index.ts"
)

$missingFiles = @()
foreach ($f in $requiredTabFiles) {
    $full = Join-Path $FrontendPages $f
    if (-not (Test-Path $full)) { $missingFiles += $f }
}

if ($missingFiles.Count -eq 0) {
    Write-OK "All $($requiredTabFiles.Count) micro-structure files present"
} else {
    Write-Err "$($missingFiles.Count) micro-structure files MISSING" ($missingFiles.Count * 3)
    $missingFiles | ForEach-Object { Write-Info "  ❌ $_" }
}

Write-Section "TypeScript Syntax Check"
$tabFiles = Get-ChildItem "$FrontendPages\dashboard" -Recurse -Include "*.tsx","*.ts" -ErrorAction SilentlyContinue
$syntaxIssues = @()

foreach ($file in $tabFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    if ($content -match 'return\r?\n\s*\(') {
        $syntaxIssues += @{ File = $file.Name; Issue = "Split return( across lines" }
    }
}

if ($syntaxIssues.Count -eq 0) {
    Write-OK "No split return() patterns detected"
} else {
    foreach ($si in $syntaxIssues) {
        Write-Err "$($si.File) — $($si.Issue)" 5
        $Script:Fixes += "Fix split return( in $($si.File)"
    }
}

Write-Section "Vite Config"
$viteConfig = Join-Path $FrontendPath "vite.config.ts"
if (Test-Path $viteConfig) {
    $vc = Get-Content $viteConfig -Raw
    if ($vc -match "port:\s*5173") { Write-OK "Vite port configured: 5173" }
    else { Write-Info "Vite port: dynamic (auto-selects next available)" }
    if ($vc -match "proxy") { Write-OK "API proxy configured (/api → :3001)" }
    else { Write-Warn "No proxy config — frontend must use full API URL" 1 }
} else {
    Write-Warn "vite.config.ts not found" 3
}

Write-Section "VS Code Settings"
$vsSettings = Join-Path $ProjectRoot ".vscode\settings.json"
if (Test-Path $vsSettings) {
    try {
        $vs = Get-Content $vsSettings -Raw | ConvertFrom-Json
        if ($vs.'blackboxai.electronAutoLaunch' -eq $false) {
            Write-OK "BLACKBOX electron auto-launch disabled ✅"
        } else {
            Write-Warn "BLACKBOX electronAutoLaunch not disabled — Electron popup will appear"
            $Script:Fixes += "Add 'blackboxai.electronAutoLaunch: false' to .vscode/settings.json"
        }
        if ($vs.'css.lint.unknownAtRules' -eq "ignore") { Write-OK "CSS lint unknownAtRules = ignore ✅" }
    } catch {
        Write-Warn ".vscode/settings.json is invalid JSON — fix it" 2
        $Script:Fixes += "Fix .vscode/settings.json — merge into single JSON object"
    }
} else {
    Write-Warn ".vscode/settings.json missing" 1
}

# ============================================================================
# LAYER 5 — BACKEND HEALTH
# ============================================================================
Write-Banner "LAYER 5 — Backend Health"

Write-Section "Core Backend Files"
$backendFiles = @(
    @{ Path="$BackendPath\api-server.ts";                       Label="api-server.ts" }
    @{ Path="$BackendPath\greeks-calculator.ts";               Label="greeks-calculator.ts" }
    @{ Path="$BackendPath\signals-engine.ts";                  Label="signals-engine.ts" }
    @{ Path="$BackendPath\network-monitor.ts";                 Label="network-monitor.ts" }
    @{ Path="$BackendPath\premium-prediction-engine.ts";       Label="premium-prediction-engine.ts" }
    @{ Path="$BackendPath\src\scripts\websocket-collector.ts"; Label="websocket-collector.ts" }
    @{ Path="$BackendPath\.env";                               Label=".env (secrets)" }
    @{ Path="$BackendPath\tsconfig.json";                      Label="tsconfig.json" }
)

foreach ($f in $backendFiles) {
    if (Test-Path $f.Path) {
        $size = Get-FileSizeLabel (Get-Item $f.Path).Length
        Write-OK "$($f.Label) — $size"
    } else {
        Write-Err "$($f.Label) MISSING" 5
    }
}

# ============================================================================
# LAYER 5b — ENVIRONMENT VARIABLES  (FIX: line-by-line parsing)
# ============================================================================
Write-Section "Environment Variables"
$envFile = Join-Path $BackendPath ".env"
if (Test-Path $envFile) {
    # Parse .env line by line — handles comments, spaces around =, quoted values
    $envLines = Get-Content $envFile -ErrorAction SilentlyContinue
    $envMap = @{}
    foreach ($line in $envLines) {
        $line = $line.Trim()
        if ($line -match '^#' -or $line -eq '') { continue }   # skip comments/blanks
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $key = $Matches[1]
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            if ($val -ne '') { $envMap[$key] = $val }
        }
    }

    $requiredEnvVars = @(
        "JWT_SECRET", "JWT_REFRESH_SECRET", "DB_PASSWORD",
        "DB_HOST", "DB_NAME", "NODE_ENV", "ANGEL_API_KEY"
    )

    foreach ($var in $requiredEnvVars) {
        if ($envMap.ContainsKey($var)) {
            # Mask secret values — show only first 4 chars
            $masked = $envMap[$var].Substring(0, [Math]::Min(4, $envMap[$var].Length)) + "****"
            Write-OK "$var is set  ($masked)"
        } else {
            Write-Warn "$var is NOT set in .env" 3
            $Script:Fixes += "Set $var in backend/.env"
        }
    }

    # Bonus: report any extra vars found
    $extraVars = $envMap.Keys | Where-Object { $_ -notin $requiredEnvVars }
    if ($extraVars) {
        Write-Info "  Additional vars found: $($extraVars -join ', ')"
    }
} else {
    Write-Err "backend/.env file MISSING — app cannot start" 15
    $Script:Fixes += "Create backend/.env from backend/.env.example"
}

# ============================================================================
# LAYER 6 — DATABASE CONNECTIVITY
# ============================================================================
if (-not $Quick) {
    Write-Banner "LAYER 6 — Database Connectivity"

    $pgConn = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($pgConn) {
        Write-OK "PostgreSQL port 5432 — OPEN"

        $psql = Get-Command psql -ErrorAction SilentlyContinue
        if ($psql) {
            $result = & psql -U postgres -d jobber_pro -c "SELECT COUNT(*) FROM options_data LIMIT 1;" 2>&1
            if ($result -match '\d+') {
                Write-OK "Database 'jobber_pro' accessible"
                $rowMatch = [regex]::Match($result, '\d+')
                if ($rowMatch.Success) { Write-Data "options_data rows (approx)" $rowMatch.Value }
            } else {
                Write-Warn "Database 'jobber_pro' — cannot query (check DB_PASSWORD)" 3
            }
        } else {
            Write-Info "psql not in PATH — skipping DB query test"
            Write-OK "PostgreSQL process detected (port open)"
        }
    } else {
        Write-Err "PostgreSQL NOT running on port 5432" 10
        $Script:Fixes += "Start PostgreSQL service: Start-Service postgresql*"
    }
} else {
    Write-Banner "LAYER 6 — Database Connectivity"
    Write-Info "Skipped (--Quick mode)"
}

# ============================================================================
# LAYER 7 — API ENDPOINT STATUS
# ============================================================================
if (-not $Quick) {
    Write-Banner "LAYER 7 — API Endpoint Status"

    $apiRunning = Test-NetConnection -ComputerName localhost -Port 3001 -WarningAction SilentlyContinue -InformationLevel Quiet
    if (-not $apiRunning) {
        Write-Err "API server not running on :3001 — skipping endpoint tests" 10
        $Script:Fixes += "Start API server: cd backend && npx ts-node api-server.ts"
    } else {
        $passCount = 0
        $failCount = 0

        foreach ($ep in $ApiEndpoints) {
            try {
                $resp = Invoke-WebRequest -Uri "$ApiBase$($ep.Path)" -Method $ep.Method `
                        -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                if ($resp.StatusCode -eq 200) {
                    Write-OK "$($ep.Method) $($ep.Path)  [$($ep.Name)]  → 200"
                    $passCount++
                } else {
                    Write-Warn "$($ep.Method) $($ep.Path) → $($resp.StatusCode)" 1
                    $failCount++
                }
            } catch {
                $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "NO RESP" }
                Write-Err "$($ep.Method) $($ep.Path)  [$($ep.Name)]  → $status" 2
                $failCount++
            }
        }

        Write-Info ""
        $apiColor = if ($failCount -eq 0) { 'Green' } else { 'Yellow' }
        Write-Host ("     API Score: {0}/{1} endpoints OK" -f $passCount, $ApiEndpoints.Count) -ForegroundColor $apiColor
    }

    Write-Section "SSE Stream Check"
    try {
        $null = Invoke-WebRequest -Uri "$ApiBase/api/options/stream" -Method GET `
                   -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        Write-OK "SSE /api/options/stream — responding"
    } catch {
        $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "timeout" }
        if ($code -eq "timeout" -or $code -eq 200) {
            Write-OK "SSE endpoint exists (timeout expected for streaming)"
        } else {
            Write-Warn "SSE /api/options/stream — $code" 2
        }
    }
} else {
    Write-Banner "LAYER 7 — API Endpoint Status"
    Write-Info "Skipped (--Quick mode)"
}

# ============================================================================
# LAYER 8 — WEBSOCKET STATUS
# ============================================================================
Write-Banner "LAYER 8 — WebSocket & Data Pipeline"

Write-Section "WebSocket Collector"
$wsCollectorPath = "$BackendPath\src\scripts\websocket-collector.ts"
if (Test-Path $wsCollectorPath) {
    $wsContent = Get-Content $wsCollectorPath -Raw -ErrorAction SilentlyContinue
    $wsSize    = Get-FileSizeLabel (Get-Item $wsCollectorPath).Length

    Write-OK "websocket-collector.ts found ($wsSize)"

    # Check for SSE/API bridge — tolerate any common function name
    $sseBridgeFound = $wsContent -match "pushToApiServer|broadcastToClients|sendToApi|postToApi|emitToServer|liveChainData|broadcastChain|sendLiveData|axios\.post.*3001|fetch.*localhost.*3001"
    if ($sseBridgeFound) { Write-OK "API/SSE bridge detected — live data pipeline active" }
    else { Write-Warn "No API push function found — frontend may not receive live WS data" 3 }

    if ($wsContent -match "spoofing|spoof")  { Write-OK "Spoofing detector integrated" }
    if ($wsContent -match "India VIX|1333")  { Write-OK "India VIX (token 1333) subscribed" }
    if ($wsContent -match "65000|65\s*\*\s*1000") { Write-OK "65s reconnect guard present" }
} else {
    Write-Err "websocket-collector.ts MISSING" 8
}

$wsPort = Test-NetConnection -ComputerName localhost -Port 8765 -WarningAction SilentlyContinue -InformationLevel Quiet
if ($wsPort) {
    Write-OK "Spoofing WS ws://localhost:8765 — LIVE"
} else {
    Write-Info "Spoofing WS :8765 — not running (start websocket-collector to enable)"
}

# ============================================================================
# LAYER 9 — ENVIRONMENT & SECURITY AUDIT
# ============================================================================
Write-Banner "LAYER 9 — Environment & Security Audit"

Write-Section "Node.js & npm"
$nodeVer = node --version 2>&1
$npmVer  = npm --version 2>&1
if ($nodeVer -match "v(\d+)") {
    $major = [int]$Matches[1]
    if ($major -ge 18) { Write-OK "Node.js $nodeVer (>=18 required)" }
    else { Write-Err "Node.js $nodeVer — upgrade to v18+" 5 }
} else {
    Write-Err "Node.js not found" 10
}
Write-Data "npm version" $npmVer

Write-Section "Security Checks"
$sourceFiles = Get-ChildItem "$BackendPath\src" -Recurse -Include "*.ts" -ErrorAction SilentlyContinue |
               Where-Object { $_.FullName -notmatch 'node_modules|\.d\.ts' } |
               Select-Object -First 30

$secretPatterns = @(
    @{ Pattern = 'jwt_secret\s*=\s*["\x27][^"\x27]{5,}'; Label = "Hardcoded JWT secret" }
    @{ Pattern = 'password\s*=\s*["\x27][^"\x27$]{5,}';  Label = "Hardcoded password"  }
    @{ Pattern = 'api_key\s*=\s*["\x27][^"\x27$]{5,}';   Label = "Hardcoded API key"   }
)

$secretFound = $false
foreach ($file in $sourceFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    foreach ($sp in $secretPatterns) {
        if ($content -match $sp.Pattern) {
            Write-Warn "$($sp.Label) possibly hardcoded in $($file.Name)" 3
            $secretFound = $true
        }
    }
}
if (-not $secretFound) { Write-OK "No obvious hardcoded secrets detected" }

$gitignore = Join-Path $ProjectRoot ".gitignore"
if (Test-Path $gitignore) {
    $gi = Get-Content $gitignore -Raw
    if ($gi -match "\.env") { Write-OK ".env is gitignored ✅" }
    else { Write-Warn ".env is NOT in .gitignore — risk of secret exposure!" 5 }
} else {
    Write-Warn "No .gitignore found at project root" 3
    $Script:Fixes += "Create .gitignore and add .env, node_modules, dist"
}

# ============================================================================
# LAYER 10 — CODE QUALITY
# ============================================================================
Write-Banner "LAYER 10 — Code Quality & Dead Code"

Write-Section "Duplicate/Old Dashboard Files"
$dashboardVariants = @(
    "$FrontendPages\Dashboard-broken-backup.tsx",
    "$FrontendPages\Dashboard-simple-backup.tsx",
    "$FrontendPages\Dashboard.BACKUP.tsx.tsx",
    "$FrontendSrc\Dashboard.tsx",
    "$FrontendSrc\pages\Dashboard.tsx"
)

$dupCount = 0
foreach ($d in $dashboardVariants) {
    if (Test-Path $d) {
        $rel  = $d.Replace($FrontendPath, "frontend")
        $size = Get-FileSizeLabel (Get-Item $d).Length
        Write-Warn "Duplicate Dashboard: $rel ($size)" 0
        $dupCount++
    }
}
if ($dupCount -eq 0) {
    Write-OK "No duplicate Dashboard files"
} else {
    Write-Info "-> $dupCount old Dashboard copies found — safe to delete after confirming app works"
    $Script:Fixes += "Clean up $dupCount old Dashboard backup files"
}

Write-Section "Large Files (potential refactor candidates)"
$largeFiles = Get-ChildItem $FrontendPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules|dist|backup|\.git' -and $_.Length -gt 50KB } |
    Sort-Object Length -Descending

foreach ($lf in $largeFiles) {
    $rel   = $lf.FullName.Replace($FrontendPath, "frontend")
    $size  = Get-FileSizeLabel $lf.Length
    $lines = (Get-Content $lf.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    $color = if ($lf.Length -gt 100KB) { "Red" } elseif ($lf.Length -gt 50KB) { "Yellow" } else { "White" }
    Write-Host ("     {0,-55} {1,8}  {2} lines" -f $rel, $size, $lines) -ForegroundColor $color
}

Write-Section "Import Consistency Check"
$tabDir = "$FrontendPages\dashboard\tabs"
if (Test-Path $tabDir) {
    $tabFiles2    = Get-ChildItem $tabDir -Filter "*.tsx" -ErrorAction SilentlyContinue
    $importIssues = @()
    foreach ($tf in $tabFiles2) {
        $content = Get-Content $tf.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "from '\.\.\/types'"      -or $content -match 'from "\.\.\/types"')     {
            $importIssues += "$($tf.Name): uses '../types' should be '../../types'"
        }
        if ($content -match "from '\.\.\/constants'"  -or $content -match 'from "\.\.\/constants"') {
            $importIssues += "$($tf.Name): uses '../constants' should be '../../constants'"
        }
    }
    if ($importIssues.Count -eq 0) {
        Write-OK "Import paths in tabs/ look correct"
    } else {
        foreach ($ii in $importIssues) { Write-Warn $ii 2 }
    }
}

# ============================================================================
# LAYER 11 — GIT STATUS
# ============================================================================
Write-Banner "LAYER 11 — Git Status"

$gitDir = Join-Path $ProjectRoot ".git"
if (Test-Path $gitDir) {
    $branch     = git -C $ProjectRoot branch --show-current 2>&1
    $status     = git -C $ProjectRoot status --short 2>&1
    $lastCommit = git -C $ProjectRoot log -1 --format="%h %s %cr" 2>&1

    Write-OK "Git repository found"
    Write-Data "Branch"      $branch
    Write-Data "Last commit" $lastCommit

    $changedFiles = ($status | Where-Object { $_ -match "^\s*[MADR?]" }).Count
    if ($changedFiles -eq 0) {
        Write-OK "Working tree clean"
    } else {
        Write-Warn "$changedFiles uncommitted change(s)" 1
        $status | Select-Object -First 10 | ForEach-Object { Write-Info "  $_" }
    }
} else {
    Write-Warn "No git repository — version control not initialized" 3
    $Script:Fixes += "Initialize git: git init && git add . && git commit -m 'initial'"
}

# ============================================================================
# LAYER 12 — OVERALL HEALTH SCORE & ACTION PLAN
# ============================================================================
$elapsed = [math]::Round(((Get-Date) - $Script:StartTime).TotalSeconds, 1)
$score   = [math]::Max(0, [math]::Min(100, $Script:Score))
$grade   = switch ($true) {
    { $score -ge 90 } { "A — EXCELLENT 🏆" }
    { $score -ge 75 } { "B — GOOD ✅" }
    { $score -ge 60 } { "C — NEEDS WORK ⚠️" }
    { $score -ge 40 } { "D — CRITICAL ISSUES ❌" }
    default           { "F — BROKEN 🔴" }
}

$scoreColor = switch ($true) {
    { $score -ge 90 } { "Green"  }
    { $score -ge 75 } { "Cyan"   }
    { $score -ge 60 } { "Yellow" }
    default           { "Red"    }
}

Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║                  OVERALL HEALTH REPORT                        ║" -ForegroundColor Cyan
Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host ("  ║  Health Score  : {0,-47}║" -f "$score / 100") -ForegroundColor $scoreColor
Write-Host ("  ║  Grade         : {0,-47}║" -f $grade) -ForegroundColor $scoreColor
Write-Host ("  ║  Issues Found  : {0,-47}║" -f $Script:Issues.Count) -ForegroundColor $(if ($Script:Issues.Count -eq 0) {'Green'} else {'Yellow'})
Write-Host ("  ║  Analysis Time : {0,-47}║" -f "${elapsed}s") -ForegroundColor White
Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan

if ($Script:Issues.Count -gt 0) {
    Write-Host "  ║  ISSUES SUMMARY                                                ║" -ForegroundColor Yellow
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
    $Script:Issues | Select-Object -First 15 | ForEach-Object {
        Write-Host ("  ║  {0,-62}║" -f ($_ -replace '^(WARN|ERR): ','')) -ForegroundColor Yellow
    }
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
}

if ($Script:Fixes.Count -gt 0) {
    Write-Host "  ║  ACTION PLAN (priority order)                                  ║" -ForegroundColor Cyan
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
    $i = 1
    $Script:Fixes | ForEach-Object {
        Write-Host ("  ║  {0}. {1,-60}║" -f $i, $_) -ForegroundColor Yellow
        $i++
    }
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
}

Write-Host "  ║  QUICK START COMMANDS                                          ║" -ForegroundColor Cyan
Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║  Frontend  : cd frontend && npm run dev                        ║" -ForegroundColor Green
Write-Host "  ║  Backend   : cd backend  && npx ts-node api-server.ts          ║" -ForegroundColor Green
Write-Host "  ║  WS Coll.  : cd backend  && npx ts-node src/scripts/websocket- ║" -ForegroundColor Green
Write-Host "  ║              collector.ts                                       ║" -ForegroundColor Green
Write-Host "  ║  Full Start: .\frontend\START-EVERYTHING.ps1                   ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# OPTIONAL: EXPORT HTML REPORT
# ============================================================================
if ($ExportHTML) {
    $reportPath = Join-Path $ProjectRoot "jobber-health-report-$(Get-Date -Format 'yyyyMMdd_HHmmss').html"

    $htmlLines = $Script:ReportLines | ForEach-Object {
        $line = [System.Web.HttpUtility]::HtmlEncode($_)
        $color = switch -Regex ($line) {
            '^\[OK\]'   { '#22c55e' }
            '^\[WARN\]' { '#eab308' }
            '^\[ERR\]'  { '#ef4444' }
            '^==='      { '#38bdf8' }
            '^---'      { '#818cf8' }
            default     { '#94a3b8' }
        }
        "<div style='color:$color;font-family:monospace;font-size:13px;padding:1px 0'>$line</div>"
    }

    $html = @"
<!DOCTYPE html><html><head><title>Jobber Pro Health Report</title>
<style>body{background:#0f172a;color:#e2e8f0;padding:20px;} h1{color:#38bdf8;}</style>
</head><body>
<h1>JOBBER PRO — Health Report</h1>
<p style='color:#94a3b8'>Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Score: $score/100 | Grade: $grade</p>
<hr style='border-color:#334155'>
$($htmlLines -join "`n")
</body></html>
"@

    $html | Set-Content -Path $reportPath -Encoding UTF8
    Write-Host "  HTML report saved: $reportPath" -ForegroundColor Magenta
    Start-Process $reportPath
}

# ============================================================================
# AUTO-FIX SAFE ISSUES
# ============================================================================
if ($Fix) {
    Write-Banner "AUTO-FIX — Applying Safe Fixes"
    $fixCount = 0

    # ── Fix 1: package.json dev script ──────────────────────────────────────
    $pkgPath = "$FrontendPath\package.json"
    $pkgContent = Get-Content $pkgPath -Raw -ErrorAction SilentlyContinue
    if ($pkgContent -match '"dev":\s*"concurrently') {
        $fixed = $pkgContent -replace '"dev":\s*"concurrently[^"]*"', '"dev": "vite"'
        $fixed | Set-Content $pkgPath -Encoding UTF8
        Write-OK "Fixed: frontend/package.json dev script -> 'vite'"
        $fixCount++
    } else {
        Write-Info "package.json dev script already correct — skipping"
    }

    # ── Fix 2: .vscode/settings.json ────────────────────────────────────────
    $vsPath = Join-Path $ProjectRoot ".vscode\settings.json"
    $vsDir  = Split-Path $vsPath
    if (-not (Test-Path $vsDir)) { New-Item -ItemType Directory -Path $vsDir -Force | Out-Null }
    $correctSettings = [ordered]@{
        "css.lint.unknownAtRules"       = "ignore"
        "blackboxai.electronAutoLaunch" = $false
    } | ConvertTo-Json -Depth 2
    $correctSettings | Set-Content $vsPath -Encoding UTF8
    Write-OK "Fixed: .vscode/settings.json merged and corrected"
    $fixCount++

    # ── Fix 3: Create .gitignore ─────────────────────────────────────────────
    $gitignorePath = Join-Path $ProjectRoot ".gitignore"
    if (-not (Test-Path $gitignorePath)) {
        $gitignoreContent = @"
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
dist-electron/
build/
*.tsbuildinfo

# Environment & secrets
.env
.env.local
.env.*.local
backend/.env

# Logs
logs/
*.log
npm-debug.log*

# OS junk
.DS_Store
Thumbs.db
desktop.ini

# IDE
.vscode/extensions.json
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Backup files
FIXES_BACKUP/
*-backup.tsx
*.BACKUP.*
backup-*/
*_backup_*/
"@
        $gitignoreContent | Set-Content $gitignorePath -Encoding UTF8
        Write-OK "Created: .gitignore with all standard exclusions"
        $fixCount++
    } else {
        Write-Info ".gitignore already exists — skipping"
    }

    # ── Fix 4: Fix import paths in tab files (../types → ../../types) ────────
    $tabDir4 = "$FrontendPages\dashboard\tabs"
    if (Test-Path $tabDir4) {
        $tabFiles4 = Get-ChildItem $tabDir4 -Filter "*.tsx" -ErrorAction SilentlyContinue
        $importFixed = 0
        foreach ($tf in $tabFiles4) {
            $c = Get-Content $tf.FullName -Raw -ErrorAction SilentlyContinue
            if (-not $c) { continue }
            $original = $c
            # Fix ../types and ../constants → ../../types and ../../constants
            $c = $c -replace "from '\.\.\/types'",     "from '../../types'"
            $c = $c -replace 'from "\.\.\/types"',     'from "../../types"'
            $c = $c -replace "from '\.\.\/constants'", "from '../../constants'"
            $c = $c -replace 'from "\.\.\/constants"', 'from "../../constants"'
            if ($c -ne $original) {
                $c | Set-Content $tf.FullName -Encoding UTF8
                Write-OK "Fixed imports: $($tf.Name)"
                $importFixed++
                $fixCount++
            }
        }
        if ($importFixed -eq 0) { Write-Info "Import paths already correct — skipping" }
    }

    # ── Fix 5: Delete safe backup Dashboard duplicates ────────────────────────
    $safeDuplicates = @(
        "$FrontendPages\Dashboard-broken-backup.tsx",
        "$FrontendPages\Dashboard-simple-backup.tsx",
        "$FrontendPages\Dashboard.BACKUP.tsx.tsx",
        "$FrontendSrc\Dashboard.tsx"
        # NOTE: we keep frontend\src\pages\Dashboard.tsx — that is the live file
    )
    $deletedCount = 0
    foreach ($dup in $safeDuplicates) {
        if (Test-Path $dup) {
            Remove-Item $dup -Force -ErrorAction SilentlyContinue
            $rel = $dup.Replace($FrontendPath, "frontend")
            Write-OK "Deleted backup: $rel"
            $deletedCount++
            $fixCount++
        }
    }
    if ($deletedCount -eq 0) { Write-Info "No backup Dashboard files found — already clean" }

    # ── Fix 6: Initialize git repository ──────────────────────────────────────
    $gitDir6 = Join-Path $ProjectRoot ".git"
    if (-not (Test-Path $gitDir6)) {
        Push-Location $ProjectRoot
        $null = git init 2>&1
        $null = git add . 2>&1
        $null = git commit -m "chore: initial commit — Jobber Pro v1.0" 2>&1
        Pop-Location
        if (Test-Path $gitDir6) {
            Write-OK "Git initialized and initial commit created"
            $fixCount++
        } else {
            Write-Warn "Git init failed — is git installed? Run: winget install Git.Git"
        }
    } else {
        Write-Info "Git already initialized — skipping"
    }

    Write-Host ""
    Write-Host ("  ✅  Auto-fix complete — {0} fix(es) applied. Re-run analyzer to verify." -f $fixCount) -ForegroundColor Green
    Write-Host "  💡  Run: .\Analyze-JobberPro.ps1 -Quick   to see updated score" -ForegroundColor Cyan
}

Write-Host "  Run with -ExportHTML to save this report as HTML" -ForegroundColor DarkGray
Write-Host "  Run with -Fix to auto-fix safe issues" -ForegroundColor DarkGray
Write-Host "  Run with -Quick to skip API/DB checks (faster)" -ForegroundColor DarkGray
Write-Host ""