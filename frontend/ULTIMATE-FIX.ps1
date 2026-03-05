#Requires -Version 5.1
<#
.SYNOPSIS
    Advanced Project Analyzer for D:\jobber-perfect  —  Version 3.0
    All bugs from v2 live run fixed. Mono-repo / multi-root aware.
    Build artefacts (.next, dist, node_modules) fully excluded.

.DESCRIPTION
    · Project structure & file inventory
    · package.json analysis (handles multiple sub-projects)
    · Security pattern scan (secrets, injection, weak crypto …)
    · Environment / .env validation
    · TypeScript config audit
    · Database schema analysis
    · API route analysis
    · Code quality & duplicate detection
    · Auth / JWT README issues #1–#8 check
    · Interactive colour-coded HTML report

.PARAMETER ProjectPath   Root folder.  Default: D:\jobber-perfect
.PARAMETER OutputDir     HTML report destination.  Default: Desktop
.PARAMETER OpenReport    Open report after generation.  Default: $true

.EXAMPLE
    .\Analyze-JobberProject.ps1
    .\Analyze-JobberProject.ps1 -ProjectPath "D:\jobber-perfect" -OpenReport $false
#>

[CmdletBinding()]
param(
    [string]$ProjectPath = "D:\jobber-perfect",
    [string]$OutputDir   = [Environment]::GetFolderPath("Desktop"),
    [bool]  $OpenReport  = $true
)

# v2 BUG FIX: Set-StrictMode Off — prevents PropertyNotFoundException on missing JSON props
Set-StrictMode -Off
$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue

# ─────────────────────────────────────────────────────────────────────────────
#  COLOUR HELPERS
# ─────────────────────────────────────────────────────────────────────────────
function Write-Header  { param([string]$T) Write-Host "`n$('═'*68)" -ForegroundColor Cyan;   Write-Host "  $T" -ForegroundColor Cyan;   Write-Host "$('═'*68)" -ForegroundColor Cyan }
function Write-Section { param([string]$T) Write-Host "`n  ── $T" -ForegroundColor Yellow }
function Write-OK      { param([string]$T) Write-Host "  ✔  $T" -ForegroundColor Green  }
function Write-Warn    { param([string]$T) Write-Host "  ⚠  $T" -ForegroundColor Yellow }
function Write-Fail    { param([string]$T) Write-Host "  ✘  $T" -ForegroundColor Red    }
function Write-Info    { param([string]$T) Write-Host "  ℹ  $T" -ForegroundColor Gray   }

# ─────────────────────────────────────────────────────────────────────────────
#  GLOBALS
# ─────────────────────────────────────────────────────────────────────────────
$Script:Results   = [System.Collections.Generic.List[PSObject]]::new()
$Script:Stats     = @{
    TotalFiles=0; TotalLines=0; TotalSizeKB=0
    TSFiles=0; JSFiles=0; SQLFiles=0; JSONFiles=0
    CriticalIssues=0; HighIssues=0; MediumIssues=0; LowIssues=0
    SecurityFindings=0; TODOs=0
}
$Script:Timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$Script:ReportPath = Join-Path $OutputDir "JobberAnalysis_$($Script:Timestamp).html"

# Directories to EXCLUDE from all scans
$Script:SkipPatterns = @('node_modules','\.git','\\dist\\','\\build\\','\.next\\','\\coverage\\','\.turbo\\')

function ShouldSkip([string]$fullPath) {
    # v2 BUG FIX: also skip files with '[' in name (bracket-named Next.js chunks are unreadable)
    if ($fullPath -match '\[') { return $true }
    foreach ($pat in $Script:SkipPatterns) {
        if ($fullPath -match $pat) { return $true }
    }
    return $false
}

function Add-Finding {
    param(
        [ValidateSet("CRITICAL","HIGH","MEDIUM","LOW","INFO","OK")]
        [string]$Severity,
        [string]$Category,
        [string]$File        = "",
        [int]   $Line        = 0,
        [string]$Message,
        [string]$Detail      = "",
        [string]$Rec         = ""
    )
    $Script:Results.Add([PSCustomObject]@{
        Severity  = $Severity; Category = $Category
        File      = $File;     Line     = $Line
        Message   = $Message;  Detail   = $Detail;  Rec = $Rec
    })
    switch ($Severity) {
        "CRITICAL" { $Script:Stats.CriticalIssues++; Write-Fail  "[$Severity] $Message" }
        "HIGH"     { $Script:Stats.HighIssues++;      Write-Fail  "[$Severity] $Message" }
        "MEDIUM"   { $Script:Stats.MediumIssues++;    Write-Warn  "[$Severity] $Message" }
        "LOW"      { $Script:Stats.LowIssues++;       Write-Info  "[$Severity] $Message" }
        "INFO"     { Write-Info "[$Severity] $Message" }
        "OK"       { Write-OK   "$Message" }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  SAFE JSON HELPERS  (v2 BUG FIX: no more PropertyNotFoundException)
# ─────────────────────────────────────────────────────────────────────────────
function JProp([object]$o, [string]$k) {
    if ($null -eq $o) { return $null }
    try { return $o.$k } catch { return $null }
}

function JKeys([object]$o) {
    if ($null -eq $o) { return @() }
    try { return ($o | Get-Member -MemberType NoteProperty -EA SilentlyContinue | Select-Object -ExpandProperty Name) }
    catch { return @() }
}

# ─────────────────────────────────────────────────────────────────────────────
#  1. PREFLIGHT
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-Preflight {
    Write-Header "PREFLIGHT CHECKS"

    if (-not (Test-Path $ProjectPath)) {
        Add-Finding -Severity CRITICAL -Category "Setup" -File $ProjectPath -Message "Project path NOT found: $ProjectPath"
        Write-Fail "Cannot continue."; exit 1
    }
    Add-Finding -Severity OK -Category "Setup" -File $ProjectPath -Message "Project path found: $ProjectPath"

    foreach ($t in @("node","npm")) {
        $v = & $t --version 2>$null
        if ($LASTEXITCODE -eq 0) { Add-Finding -Severity OK   -Category "Tools" -Message "$t $v detected" }
        else                      { Add-Finding -Severity HIGH -Category "Tools" -Message "$t not in PATH — some checks skipped" }
    }

    if (Test-Path (Join-Path $ProjectPath ".git")) {
        $br = git -C $ProjectPath rev-parse --abbrev-ref HEAD 2>$null
        Add-Finding -Severity OK -Category "Git" -File ".git" -Message "Git repo — branch: $br"
        $dirty = @(git -C $ProjectPath status --porcelain 2>$null).Count
        if ($dirty -gt 0) { Add-Finding -Severity LOW -Category "Git" -Message "$dirty uncommitted change(s)" }
    } else {
        Add-Finding -Severity LOW -Category "Setup" -Message "Not a Git repository"
    }

    Write-Section "Layout Detection"
    foreach ($sub in @("backend","dashboard","frontend","api","src")) {
        if (Test-Path (Join-Path $ProjectPath $sub)) { Write-Info "Sub-project detected: $sub/" }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  2. FILE INVENTORY
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-FileInventory {
    Write-Header "FILE INVENTORY"

    $all = Get-ChildItem -Path $ProjectPath -Recurse -File -EA SilentlyContinue |
               Where-Object { -not (ShouldSkip $_.FullName) }

    $Script:Stats.TotalFiles  = $all.Count
    $Script:Stats.TotalSizeKB = [math]::Round(($all | Measure-Object Length -Sum).Sum / 1KB, 1)
    Write-Info "Files (excl. build): $($Script:Stats.TotalFiles)  |  Size: $($Script:Stats.TotalSizeKB) KB"

    $all | Group-Object Extension | Sort-Object Count -Descending | ForEach-Object {
        switch ($_.Name) {
            ".ts"  { $Script:Stats.TSFiles  += $_.Count }
            ".tsx" { $Script:Stats.TSFiles  += $_.Count }
            ".js"  { $Script:Stats.JSFiles  += $_.Count }
            ".sql" { $Script:Stats.SQLFiles  = $_.Count }
            ".json"{ $Script:Stats.JSONFiles = $_.Count }
        }
        Write-Info "$($_.Name.PadRight(12)) → $($_.Count)"
    }

    # ── Critical file presence ─────────────────────────────────────────
    Write-Section "Critical File Presence"
    $roots = @($ProjectPath)
    foreach ($s in @("backend","dashboard","api","frontend")) {
        $p = Join-Path $ProjectPath $s; if (Test-Path $p) { $roots += $p }
    }

    $needed = @(
        @{Rel="package.json";                Sev="HIGH";   D="Root package.json"},
        @{Rel="src\config\environment.ts";   Sev="HIGH";   D="Env config module"},
        @{Rel="src\database\db.ts";          Sev="HIGH";   D="DB connection manager"},
        @{Rel="src\routes\auth.ts";           Sev="HIGH";   D="Auth routes (flat)"},
        @{Rel="src\routes\v1\auth.routes.ts"; Sev="MEDIUM"; D="Auth routes (nested v1)"},
        @{Rel="src\utils\jwt.ts";             Sev="HIGH";   D="JWT utilities"},
        @{Rel="src\middleware\csrf.ts";        Sev="HIGH";   D="CSRF middleware"},
        @{Rel="database\schema.sql";          Sev="MEDIUM"; D="Main DB schema"},
        @{Rel="tsconfig.json";               Sev="MEDIUM"; D="TypeScript config"},
        @{Rel=".env.example";                Sev="MEDIUM"; D=".env template"},
        @{Rel=".gitignore";                  Sev="MEDIUM"; D="Git ignore rules"}
    )

    foreach ($cf in $needed) {
        $hit = $false
        foreach ($r in $roots) { if (Test-Path (Join-Path $r $cf.Rel)) { $hit = $true; break } }
        if ($hit) { Add-Finding -Severity OK -Category "Structure" -File $cf.Rel -Message "Found: $($cf.Rel) — $($cf.D)" }
        else      { Add-Finding -Severity $cf.Sev -Category "Structure" -File $cf.Rel `
                        -Message "Missing: $($cf.Rel) ($($cf.D))" `
                        -Rec "Create this file per the project README." }
    }

    # ── .env committed? ───────────────────────────────────────────────
    $envHits = Get-ChildItem -Path $ProjectPath -Recurse -Filter ".env" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' }
    foreach ($ef in $envHits) {
        $rel = $ef.FullName.Replace($ProjectPath+"\","")
        Add-Finding -Severity CRITICAL -Category "Security" -File $rel `
            -Message ".env file committed to repo: $rel" `
            -Rec "Add .env to .gitignore and rotate ALL secrets immediately."
    }

    # ── .log files ────────────────────────────────────────────────────
    $logHits = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter "*.log" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    if ($logHits.Count -gt 0) {
        Add-Finding -Severity MEDIUM -Category "Security" -File "*.log" `
            -Message "$($logHits.Count) .log file(s) in repository — may contain sensitive data" `
            -Rec "Add *.log to .gitignore."
    }

    # ── .gitignore entries ────────────────────────────────────────────
    $gi = Join-Path $ProjectPath ".gitignore"
    if (Test-Path $gi) {
        $txt = Get-Content $gi -Raw -EA SilentlyContinue
        foreach ($must in @(".env","node_modules","dist","build","*.log",".next")) {
            if ($txt -notmatch [regex]::Escape($must)) {
                Add-Finding -Severity MEDIUM -Category "Security" -File ".gitignore" `
                    -Message ".gitignore missing entry: $must" `
                    -Rec "Add '$must' to .gitignore."
            }
        }
        Add-Finding -Severity OK -Category "Security" -File ".gitignore" -Message ".gitignore exists"
    } else {
        Add-Finding -Severity HIGH -Category "Security" -File ".gitignore" `
            -Message ".gitignore not found in project root" `
            -Rec "Create .gitignore with standard Node.js entries."
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  3. PACKAGE.JSON  (v2 BUG FIX: multi-file, safe property access, no inline if in param)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-PackageAnalysis {
    Write-Header "PACKAGE.JSON ANALYSIS"

    $pkgFiles = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter "package.json" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })

    if ($pkgFiles.Count -eq 0) {
        Add-Finding -Severity CRITICAL -Category "Deps" -File "package.json" -Message "No package.json found!"
        return
    }

    foreach ($pf in $pkgFiles) {
        $rel = $pf.FullName.Replace($ProjectPath+"\","")
        Write-Section "Parsing: $rel"

        $raw = Get-Content $pf.FullName -Raw -EA SilentlyContinue
        if (-not $raw) { continue }
        $pkg = $null
        try { $pkg = $raw | ConvertFrom-Json -EA Stop } catch { Add-Finding -Severity CRITICAL -Category "Deps" -File $rel -Message "Invalid JSON: $_"; continue }

        # Scripts
        $scripts = JProp $pkg "scripts"
        if ($scripts) {
            $sk = JKeys $scripts
            foreach ($s in @("start","dev","build","test","lint")) {
                if ($sk -contains $s) { Add-Finding -Severity OK -Category "Scripts" -File $rel -Message "Script '$s' present" }
                else                   { Add-Finding -Severity MEDIUM -Category "Scripts" -File $rel -Message "Missing script: '$s'" -Rec "Add '$s' to scripts in $rel" }
            }
        } else {
            Add-Finding -Severity LOW -Category "Scripts" -File $rel -Message "No scripts section (may be workspace root)"
        }

        # Deps
        $deps    = JProp $pkg "dependencies"
        $devDeps = JProp $pkg "devDependencies"
        $dk  = JKeys $deps
        $ddk = JKeys $devDeps
        $all = @($dk) + @($ddk) | Where-Object { $_ } | Select-Object -Unique

        Write-Info "Prod: $($dk.Count)  Dev: $($ddk.Count)"

        # Dual redis/ioredis
        if (($all -contains "redis") -and ($all -contains "ioredis")) {
            Add-Finding -Severity HIGH -Category "Deps" -File $rel `
                -Message "Both 'redis' and 'ioredis' present — conflict" `
                -Rec "Choose one Redis client (ioredis recommended)."
        }

        # Missing security packages (backend only — skip dashboard)
        if ($rel -notmatch 'dashboard') {
            foreach ($sd in @("helmet","express-rate-limit","cors","joi","zod")) {
                if ($all -notcontains $sd) {
                    Add-Finding -Severity MEDIUM -Category "Security" -File $rel `
                        -Message "Security package missing: $sd" `
                        -Rec "Add '$sd' for production hardening."
                }
            }
        }

        # Unpinned versions
        $unpinned = @()
        foreach ($k in $all) {
            $ver = $null
            if ($dk -contains $k) { $ver = JProp $deps $k } else { $ver = JProp $devDeps $k }
            if ($ver -and $ver -match '^\^|^~') { $unpinned += "$k@$ver" }
        }
        if ($unpinned.Count -gt 0) {
            Add-Finding -Severity LOW -Category "Deps" -File $rel `
                -Message "$($unpinned.Count) unpinned dependencies (^ or ~)" `
                -Detail ($unpinned -join ", ") `
                -Rec "Commit package-lock.json or pin exact versions in production."
        }

        # engines
        if (-not (JProp $pkg "engines")) {
            Add-Finding -Severity LOW -Category "Deps" -File $rel `
                -Message "No 'engines' field — Node.js version unconstrained" `
                -Rec 'Add "engines": {"node": ">=18.0.0"} to package.json'
        }
    }

    # npm audit at root
    Write-Section "npm audit"
    $rootPkg = Join-Path $ProjectPath "package.json"
    if ((Test-Path $rootPkg) -and (Get-Command npm -EA SilentlyContinue)) {
        $raw = & npm audit --json --prefix $ProjectPath 2>$null
        if ($raw) {
            try {
                $a = $raw | ConvertFrom-Json -EA Stop
                $v = $a.metadata.vulnerabilities
                $c=[int]($v.critical); $h=[int]($v.high); $m=[int]($v.moderate); $l=[int]($v.low)
                if ($c -gt 0) { Add-Finding -Severity CRITICAL -Category "Audit" -File "package.json" -Message "npm audit: $c CRITICAL vulnerabilities" }
                if ($h -gt 0) { Add-Finding -Severity HIGH     -Category "Audit" -File "package.json" -Message "npm audit: $h HIGH vulnerabilities" }
                if ($m -gt 0) { Add-Finding -Severity MEDIUM   -Category "Audit" -File "package.json" -Message "npm audit: $m MODERATE vulnerabilities" }
                if ($l -gt 0) { Add-Finding -Severity LOW      -Category "Audit" -File "package.json" -Message "npm audit: $l LOW vulnerabilities" }
                if (($c+$h+$m+$l) -eq 0) { Add-Finding -Severity OK -Category "Audit" -File "package.json" -Message "npm audit: no known vulnerabilities" }
            } catch {}
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  4. SECURITY SCAN  (v2 BUG FIX: all patterns use single-quoted strings; no $1 in double-quote)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-SecurityScan {
    Write-Header "SECURITY SCAN"

    $src = Get-ChildItem -Path $ProjectPath -Recurse -Include "*.ts","*.tsx","*.js","*.mjs" -EA SilentlyContinue |
               Where-Object { -not (ShouldSkip $_.FullName) }
    Write-Info "Scanning $($src.Count) source files..."

    # All regex in single-quoted strings — safe from PowerShell variable expansion
    $pats = @(
        ('CRITICAL','Secrets',    'JWT_SECRET\s*=\s*[''"][^$''"\s]{3,}[''"]',
            'Hardcoded JWT secret',           'Use environment variables only.'),
        ('CRITICAL','Secrets',    'ENCRYPTION_KEY\s*=\s*[''"][^$''"\s]{3,}[''"]',
            'Hardcoded encryption key',       'Load from env vars, never hardcode.'),
        ('CRITICAL','Secrets',    '(?i)password\s*[:=]\s*[''"][^$''"\s]{4,}[''"]',
            'Possible hardcoded password',    'Use env vars or a secrets manager.'),
        ('CRITICAL','Secrets',    '(?i)api[_-]?key\s*[:=]\s*[''"][A-Za-z0-9_\-]{10,}[''"]',
            'Possible hardcoded API key',     'Move to environment variables.'),
        ('CRITICAL','Injection',  'eval\s*\(',
            'eval() usage detected',          'Remove eval(). Use safer alternatives.'),
        ('CRITICAL','Injection',  'new Function\s*\(',
            'new Function() — code injection risk', 'Avoid dynamic code generation.'),
        ('HIGH','SQL',            'WHERE.{0,60}\$\{',
            'Possible SQL injection via template literal', 'Use parameterised queries with positional placeholders.'),
        ('HIGH','Auth',           'Math\.random\(\)',
            'Math.random() not cryptographically secure', 'Use crypto.randomBytes() for tokens/secrets.'),
        ('HIGH','Auth',           'algorithm\s*:\s*[''"]none[''"]',
            'JWT algorithm set to none',      'Use RS256 or HS256 — never none.'),
        ('HIGH','Security',       'process\.exit\s*\(',
            'process.exit() — abrupt shutdown', 'Emit shutdown signal and drain connections instead.'),
        ('HIGH','Security',       '(?i)console\.(log|info)\s*\(.*(?:password|token|secret|key)',
            'Logging sensitive data',         'Never log credentials, tokens, or keys.'),
        ('HIGH','XSS',            '\.innerHTML\s*=',
            'innerHTML assignment — XSS risk', 'Use textContent or DOMPurify.'),
        ('MEDIUM','Security',     'http://(?!localhost)',
            'Plain HTTP URL (non-localhost)', 'Replace with https://'),
        ('MEDIUM','Security',     'cors\s*\(\s*\)',
            'CORS with no config — allows all origins', 'Pass allowed origins to cors({origin:...}).'),
        ('MEDIUM','Crypto',       '(?i)\bmd5\b|\bsha1\b',
            'Weak hash algorithm (MD5/SHA1)', 'Use SHA-256 or bcrypt for passwords.'),
        ('MEDIUM','Auth',         'bcrypt\.hash\s*\([^,]+,\s*[1-9]\b(?!\d)',
            'bcrypt rounds < 10',             'Use at least 12 rounds in production.'),
        ('MEDIUM','Quality',      '(?i)\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b',
            'TODO/FIXME/HACK comment',        'Resolve before production deployment.'),
        ('LOW','Quality',         '(?<!\w)any\b',
            'TypeScript any type',            'Replace with properly typed interfaces.'),
        ('LOW','Quality',         '//\s*@ts-ignore',
            '@ts-ignore suppresses errors',   'Fix the underlying type error instead.'),
        ('LOW','Quality',         'console\.(log|debug)\s*\(',
            'console.log/debug in source code', 'Use a structured logger (winston/pino).'),
        ('LOW','Async',           'new Promise\s*\(\s*(resolve|res)\b',
            'Manual Promise wrapping',        'Prefer util.promisify or async/await directly.')
    )

    # Pre-compile regexes
    $compiled = $pats | ForEach-Object {
        [PSCustomObject]@{
            Sev = $_[0]; Cat = $_[1]
            Rx  = [regex]::new($_[2])
            Msg = $_[3]; Rec = $_[4]
        }
    }

    foreach ($f in $src) {
        $lines = $null
        try { $lines = Get-Content $f.FullName -EA Stop } catch { continue }
        $rel = $f.FullName.Replace($ProjectPath+"\","")
        $n = 0
        foreach ($line in $lines) {
            $n++; $Script:Stats.TotalLines++
            foreach ($p in $compiled) {
                if ($p.Rx.IsMatch($line)) {
                    if ($p.Sev -in @("CRITICAL","HIGH")) { $Script:Stats.SecurityFindings++ }
                    if ($line -match '(?i)TODO|FIXME|HACK')   { $Script:Stats.TODOs++ }
                    Add-Finding -Severity $p.Sev -Category $p.Cat -File $rel -Line $n `
                        -Message $p.Msg -Detail "L${n}: $($line.Trim())" -Rec $p.Rec
                }
            }
        }
    }
    Write-Info "Security scan done — $($Script:Stats.SecurityFindings) critical/high hits"
}

# ─────────────────────────────────────────────────────────────────────────────
#  5. ENVIRONMENT VALIDATION  (v2 BUG FIX: searches all subdirs for .env.example)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-EnvValidation {
    Write-Header "ENVIRONMENT VALIDATION"

    $examples = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter ".env.example" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })

    if ($examples.Count -eq 0) {
        Add-Finding -Severity HIGH -Category "Config" -File ".env.example" `
            -Message ".env.example not found anywhere in project" `
            -Rec "Create .env.example documenting every required env variable."
        return
    }

    $vars = @(
        @{N="JWT_SECRET";         L=32; S="CRITICAL"},
        @{N="JWT_REFRESH_SECRET"; L=32; S="CRITICAL"},
        @{N="ENCRYPTION_KEY";     L=32; S="CRITICAL"},
        @{N="COOKIE_SECRET";      L=32; S="HIGH"},
        @{N="DB_HOST";            L=3;  S="HIGH"},
        @{N="DB_PORT";            L=1;  S="HIGH"},
        @{N="DB_NAME";            L=1;  S="HIGH"},
        @{N="DB_USER";            L=1;  S="HIGH"},
        @{N="DB_PASSWORD";        L=1;  S="HIGH"},
        @{N="NODE_ENV";           L=1;  S="MEDIUM"},
        @{N="PORT";               L=1;  S="MEDIUM"},
        @{N="BCRYPT_ROUNDS";      L=1;  S="MEDIUM"},
        @{N="CORS_ORIGIN";        L=1;  S="MEDIUM"},
        @{N="LOG_LEVEL";          L=1;  S="LOW"}
    )

    foreach ($ex in $examples) {
        $rel = $ex.FullName.Replace($ProjectPath+"\","")
        Write-Info "Checking: $rel"
        $txt = Get-Content $ex.FullName -Raw -EA SilentlyContinue
        if (-not $txt) { continue }
        foreach ($v in $vars) {
            if ($txt -match "(?m)^#?\s*$($v.N)\s*=") {
                Add-Finding -Severity OK -Category "Config" -File $rel -Message "Documented: $($v.N)"
            } else {
                Add-Finding -Severity $v.S -Category "Config" -File $rel `
                    -Message "NOT documented in .env.example: $($v.N)" `
                    -Rec "Add $($v.N)=<description> to $rel"
            }
        }
    }

    # Quality-check actual .env files
    $envFiles = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter ".env" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    foreach ($ef in $envFiles) {
        $rel = $ef.FullName.Replace($ProjectPath+"\","")
        Write-Section ".env value quality: $rel"
        $lines = Get-Content $ef.FullName -EA SilentlyContinue
        if (-not $lines) { continue }
        foreach ($v in $vars | Where-Object { $_.S -in @("CRITICAL","HIGH") }) {
            $hit = $lines | Where-Object { $_ -match "^$($v.N)=(.+)$" } | Select-Object -First 1
            if ($hit) {
                $val = ($hit -replace "^$($v.N)=","").Trim()
                if ($val.Length -lt $v.L) {
                    Add-Finding -Severity $v.S -Category "Config" -File $rel `
                        -Message "$($v.N) value too short ($($val.Length)/$($v.L) chars)" `
                        -Rec 'Generate: node -e "console.log(require(''crypto'').randomBytes(32).toString(''hex''))"'
                } elseif ($val -match '(?i)^(changeme|secret|password|example|test|todo|placeholder|your[_-]|xxx|dummy|fake)') {
                    Add-Finding -Severity CRITICAL -Category "Secrets" -File $rel `
                        -Message "$($v.N) appears to be a placeholder" `
                        -Rec "Replace with a cryptographically secure random value."
                } else {
                    Add-Finding -Severity OK -Category "Config" -File $rel -Message "$($v.N) set and non-trivial"
                }
            } else {
                Add-Finding -Severity $v.S -Category "Config" -File $rel `
                    -Message "$($v.N) not set in $rel" `
                    -Rec "Add $($v.N) before starting the server."
            }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  6. TYPESCRIPT CONFIG  (v2 BUG FIX: searches all subdirs)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-TSConfig {
    Write-Header "TYPESCRIPT CONFIG"

    $tscs = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter "tsconfig.json" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })

    if ($tscs.Count -eq 0) {
        Add-Finding -Severity HIGH -Category "TypeScript" -File "tsconfig.json" `
            -Message "No tsconfig.json found anywhere in project" `
            -Rec "Create tsconfig.json with strict mode enabled."
        return
    }

    foreach ($tc in $tscs) {
        $rel = $tc.FullName.Replace($ProjectPath+"\","")
        try {
            $ts = Get-Content $tc.FullName -Raw | ConvertFrom-Json -EA Stop
            $co = JProp $ts "compilerOptions"
            if (-not $co) { Write-Info "$rel has no compilerOptions"; continue }

            $strict = JProp $co "strict"
            if ($strict -eq $true) { Add-Finding -Severity OK -Category "TypeScript" -File $rel -Message "strict: true enabled" }
            else                    { Add-Finding -Severity HIGH -Category "TypeScript" -File $rel -Message "strict mode OFF in $rel" -Rec 'Set "strict": true for maximum type safety.' }

            $target = JProp $co "target"
            if ($target -and $target -match '^(ES5|ES6|ES2015|ES2016|ES2017)$') {
                Add-Finding -Severity LOW -Category "TypeScript" -File $rel `
                    -Message "Old compile target: $target" `
                    -Rec "Use ES2020 or ESNext for modern Node.js."
            }

            $skip = JProp $co "skipLibCheck"
            if ($skip -eq $true) {
                Add-Finding -Severity LOW -Category "TypeScript" -File $rel `
                    -Message "skipLibCheck: true — hides type errors in dependencies" `
                    -Rec "Only use if absolutely required by third-party types."
            }

            Add-Finding -Severity OK -Category "TypeScript" -File $rel -Message "tsconfig parsed OK: $rel"
        } catch {
            Add-Finding -Severity MEDIUM -Category "TypeScript" -File $rel -Message "Could not parse tsconfig: $_"
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  7. DATABASE SCHEMA
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-DatabaseAnalysis {
    Write-Header "DATABASE SCHEMA ANALYSIS"

    $sqls = @(Get-ChildItem -Path $ProjectPath -Recurse -Include "*.sql" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })

    if ($sqls.Count -eq 0) {
        Add-Finding -Severity MEDIUM -Category "Database" -Message "No .sql files found" `
            -Rec "Ensure database/schema.sql exists as per README."
        return
    }

    foreach ($sql in $sqls) {
        $rel = $sql.FullName.Replace($ProjectPath+"\","")
        $c = Get-Content $sql.FullName -Raw -EA SilentlyContinue
        if (-not $c) { continue }

        if ($c -match "CREATE INDEX")                       { Add-Finding -Severity OK     -Category "Database" -File $rel -Message "Indexes defined in schema" }
        else                                                 { Add-Finding -Severity MEDIUM -Category "Database" -File $rel -Message "No CREATE INDEX found" -Rec "Add indexes on FKs and query hot-paths." }
        if ($c -match "CONSTRAINT|FOREIGN KEY|REFERENCES")  { Add-Finding -Severity OK     -Category "Database" -File $rel -Message "FK constraints present" }
        else                                                 { Add-Finding -Severity HIGH   -Category "Database" -File $rel -Message "No FK constraints found" -Rec "Add FOREIGN KEY constraints for referential integrity." }
        if ($c -match "NOT NULL")                           { Add-Finding -Severity OK     -Category "Database" -File $rel -Message "NOT NULL constraints used" }
        if ($c -match "UNIQUE")                             { Add-Finding -Severity OK     -Category "Database" -File $rel -Message "UNIQUE constraints defined" }
        if ($c -match "DROP TABLE(?! IF EXISTS)")            { Add-Finding -Severity HIGH   -Category "Database" -File $rel -Message "DROP TABLE without IF EXISTS" -Rec "Use DROP TABLE IF EXISTS." }
        if ($c -match "VARCHAR\(255\)")                     { Add-Finding -Severity LOW    -Category "Database" -File $rel -Message "Generic VARCHAR(255) — verify if appropriate" -Rec "Use TEXT or precise length constraints." }
        if ($c -notmatch "created_at|updated_at")           { Add-Finding -Severity LOW    -Category "Database" -File $rel -Message "No audit timestamp columns" -Rec "Add created_at DEFAULT NOW(), updated_at." }
        if ($c -match "\bSERIAL\b|\bBIGSERIAL\b")          { Add-Finding -Severity LOW    -Category "Database" -File $rel -Message "SERIAL used — consider UUID PKs for distributed systems" -Rec "Use gen_random_uuid() from pgcrypto." }

        Add-Finding -Severity INFO -Category "Database" -File $rel -Message "Schema analysed: $rel"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  8. ROUTE ANALYSIS
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-RouteAnalysis {
    Write-Header "API ROUTE ANALYSIS"

    $routes = @(Get-ChildItem -Path $ProjectPath -Recurse -Include "*.ts","*.js" -EA SilentlyContinue |
        Where-Object { $_.FullName -match '\\routes\\' -and (-not (ShouldSkip $_.FullName)) })

    if ($routes.Count -eq 0) {
        Add-Finding -Severity MEDIUM -Category "Routes" -Message "No route files found under /routes/" `
            -Rec "Check your Express router file structure."
        return
    }

    Write-Info "Found $($routes.Count) route file(s)"

    foreach ($rf in $routes) {
        $rel   = $rf.FullName.Replace($ProjectPath+"\","")
        $lines = Get-Content $rf.FullName -EA SilentlyContinue
        if (-not $lines) { continue }
        $body  = $lines -join "`n"
        $rCnt  = ($lines | Select-String -Pattern '\.(get|post|put|patch|delete)\s*\(').Count
        Write-Info "$rel : $rCnt route(s)"

        # Auth middleware
        if ($body -match "authenticate|isAuth|requireAuth|verifyToken|authMiddleware|protect\b") {
            Add-Finding -Severity OK -Category "Routes" -File $rel -Message "Auth middleware found ($rCnt routes)"
        } else {
            Add-Finding -Severity HIGH -Category "Routes" -File $rel `
                -Message "No auth middleware detected in $rel" `
                -Rec "Protect routes using auth middleware."
        }

        # Input validation
        if ($body -match "joi|zod|celebrate|express-validator|validate\(|schema\.parse") {
            Add-Finding -Severity OK -Category "Routes" -File $rel -Message "Input validation found"
        } else {
            Add-Finding -Severity HIGH -Category "Routes" -File $rel `
                -Message "No input validation in $rel" `
                -Rec "Add Joi/Zod validation for all request bodies and params."
        }

        # Rate limiting
        if ($body -match "rateLimit|rate-limit|limiter|throttle") {
            Add-Finding -Severity OK -Category "Routes" -File $rel -Message "Rate limiting applied"
        } else {
            Add-Finding -Severity MEDIUM -Category "Routes" -File $rel `
                -Message "No rate limiting in $rel" `
                -Rec "Apply express-rate-limit to all auth/sensitive endpoints."
        }

        # Async error handling
        $asyncCnt = ($lines | Select-String -Pattern "async\s+").Count
        $tryCnt   = ($lines | Select-String -Pattern "try\s*\{").Count
        if ($asyncCnt -gt 0 -and $tryCnt -eq 0) {
            Add-Finding -Severity MEDIUM -Category "Routes" -File $rel `
                -Message "$asyncCnt async function(s) with no try/catch — unhandled rejections possible" `
                -Rec "Wrap async handlers in try/catch or use an asyncWrapper helper."
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  9. CODE QUALITY  (v2 BUG FIX: .Count on array wrapped safely; .next excluded)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-CodeQuality {
    Write-Header "CODE QUALITY METRICS"

    $src = Get-ChildItem -Path $ProjectPath -Recurse -Include "*.ts","*.tsx","*.js" -EA SilentlyContinue |
               Where-Object { -not (ShouldSkip $_.FullName) }

    $largeFiles = [System.Collections.Generic.List[PSObject]]::new()
    $sigSet     = [System.Collections.Generic.HashSet[string]]::new()
    $dupes      = [System.Collections.Generic.List[string]]::new()

    foreach ($f in $src) {
        $lines = $null
        try { $lines = Get-Content $f.FullName -EA Stop } catch { continue }
        if ($lines.Count -gt 400) {
            $rel = $f.FullName.Replace($ProjectPath+"\","")
            $largeFiles.Add([PSCustomObject]@{File=$rel; Lines=$lines.Count})
        }
        $sigs = $lines | Select-String -Pattern '^\s*(export\s+)?(async\s+)?function\s+(\w+)' |
            ForEach-Object { $_.Line.Trim() -replace '\s+',' ' }
        foreach ($s in $sigs) {
            if (-not $sigSet.Add($s)) { $dupes.Add($s) | Out-Null }
        }
    }

    $nonBuild = $largeFiles | Where-Object { $_.File -notmatch '\.next' } | Sort-Object Lines -Descending
    Write-Section "Large files (>400 lines, excluding build output)"
    if ($nonBuild.Count -gt 0) {
        foreach ($lf in $nonBuild) {
            Add-Finding -Severity MEDIUM -Category "Quality" -File $lf.File `
                -Message "Large file: $($lf.Lines) lines — $($lf.File)" `
                -Rec "Split into smaller, focused modules."
        }
    } else {
        Write-OK "No oversized source files found"
    }

    if ($dupes.Count -gt 0) {
        Add-Finding -Severity LOW -Category "Quality" `
            -Message "$($dupes.Count) potentially duplicated function signatures" `
            -Detail ($dupes | Select-Object -Unique | Select-Object -First 12 | Join-String -Separator "; ") `
            -Rec "Review for code duplication; extract shared utilities."
    }

    # Tests
    $tests = @(Get-ChildItem -Path $ProjectPath -Recurse -Include "*.test.ts","*.spec.ts","*.test.js","*.spec.js" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    if ($tests.Count -eq 0) {
        Add-Finding -Severity HIGH -Category "Testing" `
            -Message "No test files found (.test.ts / .spec.ts)" `
            -Rec "Add Jest/Mocha tests. README targets 87% coverage."
    } else {
        Add-Finding -Severity OK -Category "Testing" -Message "$($tests.Count) test file(s) found"
    }

    # ESLint
    $lint = @(Get-ChildItem -Path $ProjectPath -Recurse -Include ".eslintrc",".eslintrc.js",".eslintrc.json",".eslintrc.yaml","eslint.config.js","eslint.config.mjs" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    if ($lint.Count -gt 0) { Add-Finding -Severity OK -Category "Quality" -File $lint[0].Name -Message "ESLint config found" }
    else { Add-Finding -Severity MEDIUM -Category "Quality" -Message "No ESLint config" -Rec "Add .eslintrc.json with TypeScript + security rules." }

    # Prettier
    $pre = @(Get-ChildItem -Path $ProjectPath -Recurse -Include ".prettierrc",".prettierrc.json",".prettierrc.js","prettier.config.js" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    if ($pre.Count -gt 0) { Add-Finding -Severity OK -Category "Quality" -File $pre[0].Name -Message "Prettier config found" }
    else { Add-Finding -Severity LOW -Category "Quality" -Message "No Prettier config" -Rec "Add .prettierrc for consistent formatting." }

    # Husky
    if (Test-Path (Join-Path $ProjectPath ".husky")) {
        Add-Finding -Severity OK -Category "Quality" -File ".husky" -Message "Husky git hooks configured"
    } else {
        Add-Finding -Severity LOW -Category "Quality" -Message "No Husky pre-commit hooks" -Rec "Add Husky + lint-staged for commit-time quality gates."
    }

    # CI/CD
    $ci = @(".github\workflows","Jenkinsfile","azure-pipelines.yml",".circleci\config.yml",".gitlab-ci.yml","*.yml") |
        Where-Object { Test-Path (Join-Path $ProjectPath $_) } | Select-Object -First 1
    if ($ci) { Add-Finding -Severity OK -Category "CI/CD" -File $ci -Message "CI/CD configuration found: $ci" }
    else { Add-Finding -Severity MEDIUM -Category "CI/CD" -Message "No CI/CD configuration found" -Rec "Add GitHub Actions or similar pipeline." }

    # Docker
    $docker = @(Get-ChildItem -Path $ProjectPath -Recurse -Include "Dockerfile","docker-compose.yml","docker-compose.yaml" -EA SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules' })
    if ($docker.Count -gt 0) { Add-Finding -Severity OK -Category "Docker" -Message "Docker configuration present ($($docker.Count) file(s))" }
    else { Add-Finding -Severity LOW -Category "Docker" -Message "No Dockerfile / docker-compose found" -Rec "Add Docker for reproducible deployments." }
}

# ─────────────────────────────────────────────────────────────────────────────
#  10. AUTH & JWT CHECKS  (v2 BUG FIX: searches all subdirs for auth files)
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-AuthJWTChecks {
    Write-Header "AUTH & JWT CHECKS (README Issues #1-#8)"

    $authFiles = @(Get-ChildItem -Path $ProjectPath -Recurse -Include "auth.ts","auth.routes.ts" -EA SilentlyContinue |
        Where-Object { -not (ShouldSkip $_.FullName) })

    if ($authFiles.Count -eq 0) {
        Add-Finding -Severity CRITICAL -Category "Auth" -File "auth.ts" `
            -Message "No auth.ts or auth.routes.ts found anywhere in project" `
            -Rec "Create auth route files per the README specification."
    }

    foreach ($af in $authFiles) {
        $rel = $af.FullName.Replace($ProjectPath+"\","")
        $c   = Get-Content $af.FullName -Raw -EA SilentlyContinue
        if (-not $c) { continue }
        Write-Section "Auth file: $rel"

        # Issue #5 — integer overflow
        if ($c -match "MAX_FAILED_ATTEMPTS|Math\.min.*failed_login|Math\.min.*failedAttempts") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Issue #5 FIXED: integer overflow guard on failed_login_attempts"
        } else {
            Add-Finding -Severity CRITICAL -Category "Auth" -File $rel `
                -Message "Issue #5 OPEN: no integer overflow guard on failed_login_attempts" `
                -Rec "Add: const n = Math.min((user.failed_login_attempts||0)+1, 2147483647);"
        }

        # Issue #6 — TOCTOU
        if ($c -match "atomic|UPDATE.{0,80}CASE|RETURNING.{0,30}plan") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Issue #6 FIXED: atomic trial expiry check"
        } else {
            Add-Finding -Severity CRITICAL -Category "Auth" -File $rel `
                -Message "Issue #6 OPEN: TOCTOU race in trial expiry check" `
                -Rec "Use atomic UPDATE...CASE...RETURNING instead of SELECT then UPDATE."
        }

        # Issue #7 — CSRF
        if ($c -match "csrf|csurf|csrfToken|x-csrf") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Issue #7 FIXED: CSRF protection on auth routes"
        } else {
            Add-Finding -Severity HIGH -Category "Auth" -File $rel `
                -Message "Issue #7 OPEN: no CSRF protection on auth routes" `
                -Rec "Create src/middleware/csrf.ts and apply to state-changing routes."
        }

        # Issue #8 — timing attack
        if ($c -match "DUMMY_HASH|timingSafeEqual|dummyHash") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Issue #8 FIXED: timing attack mitigation present"
        } else {
            Add-Finding -Severity HIGH -Category "Auth" -File $rel `
                -Message "Issue #8 OPEN: timing attack possible on login" `
                -Rec "Run bcrypt.compare even for unknown users using a pre-computed DUMMY_HASH."
        }

        # Account lockout
        if ($c -match "account_locked|is_locked|lockout|failed_login_attempts|MAX_ATTEMPTS") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Account lockout logic present"
        } else {
            Add-Finding -Severity HIGH -Category "Auth" -File $rel `
                -Message "No account lockout after repeated failures" `
                -Rec "Lock account after N failed attempts (e.g. 5) with exponential backoff."
        }

        # Password strength
        if ($c -match "zxcvbn|passwordStrength|strongPassword|\[A-Z\].*\[0-9\]") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Password strength validation present"
        } else {
            Add-Finding -Severity MEDIUM -Category "Auth" -File $rel `
                -Message "No strong password validation regex" `
                -Rec "Require uppercase + lowercase + digit + symbol, min 12 chars."
        }

        # Email verification
        if ($c -match "email_verified|verification_token|verify_email|emailToken") {
            Add-Finding -Severity OK -Category "Auth" -File $rel -Message "Email verification flow present"
        } else {
            Add-Finding -Severity MEDIUM -Category "Auth" -File $rel `
                -Message "No email verification flow" `
                -Rec "Send verification email on registration; block login until verified."
        }
    }

    # JWT utilities
    $jwtFiles = @(Get-ChildItem -Path $ProjectPath -Recurse -Filter "jwt.ts" -EA SilentlyContinue |
        Where-Object { -not (ShouldSkip $_.FullName) })

    if ($jwtFiles.Count -eq 0) {
        Add-Finding -Severity HIGH -Category "JWT" -File "jwt.ts" `
            -Message "jwt.ts not found anywhere in project" `
            -Rec "Create src/utils/jwt.ts with signing and verification helpers."
    } else {
        foreach ($jf in $jwtFiles) {
            $rel = $jf.FullName.Replace($ProjectPath+"\","")
            $c   = Get-Content $jf.FullName -Raw -EA SilentlyContinue
            if (-not $c) { continue }
            Write-Section "JWT file: $rel"

            if ($c -match "tokenFamily|familyId|jti")       { Add-Finding -Severity OK -Category "JWT" -File $rel -Message "Token family tracking present (rotation protection)" }
            else { Add-Finding -Severity HIGH -Category "JWT" -File $rel -Message "No token family tracking — refresh reuse attack possible" -Rec "Invalidate entire family on reuse detection." }

            if ($c -match "expiresIn|exp\b")                { Add-Finding -Severity OK -Category "JWT" -File $rel -Message "JWT expiry configured" }
            else { Add-Finding -Severity CRITICAL -Category "JWT" -File $rel -Message "JWT tokens may never expire" -Rec "Set expiresIn: '15m' (access) and '7d' (refresh)." }

            if ($c -match "algorithms\s*:\s*\[")            { Add-Finding -Severity OK -Category "JWT" -File $rel -Message "Algorithm allowlist specified in verify()" }
            else { Add-Finding -Severity HIGH -Category "JWT" -File $rel -Message "No algorithm allowlist in verify() — alg:none attack possible" -Rec "Pass algorithms: ['HS256'] to jwt.verify()." }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  HTML REPORT
# ─────────────────────────────────────────────────────────────────────────────
function New-HTMLReport {
    Write-Header "GENERATING HTML REPORT"

    $sevCol  = @{CRITICAL="#dc2626";HIGH="#ea580c";MEDIUM="#d97706";LOW="#2563eb";INFO="#6b7280";OK="#16a34a"}
    $sevIcon = @{CRITICAL="🔴";HIGH="🟠";MEDIUM="🟡";LOW="🔵";INFO="⚪";OK="🟢"}
    $ord     = @{CRITICAL=0;HIGH=1;MEDIUM=2;LOW=3;INFO=4;OK=5}

    $sorted = $Script:Results | Sort-Object { $ord[$_.Severity] }

    $rows = $sorted | ForEach-Object {
        $col  = $sevCol[$_.Severity]; $ico = $sevIcon[$_.Severity]
        $file = if ($_.File) { "<code>$([System.Web.HttpUtility]::HtmlEncode($_.File))</code>" } else { "<em>—</em>" }
        $line = if ($_.Line -gt 0) { "<span style='color:#94a3b8'> L$($_.Line)</span>" } else { "" }
        $msg  = [System.Web.HttpUtility]::HtmlEncode($_.Message)
        $det  = if ($_.Detail) { "<div class='det'>$([System.Web.HttpUtility]::HtmlEncode($_.Detail))</div>" } else { "" }
        $rec  = if ($_.Rec)    { "<div class='rec'>💡 $([System.Web.HttpUtility]::HtmlEncode($_.Rec))</div>"  } else { "" }
        "<tr data-sev='$($_.Severity)'><td><span class='badge' style='background:$col'>$ico $($_.Severity)</span></td><td>$($_.Category)</td><td>$file$line</td><td>$msg$det$rec</td></tr>"
    }

    $cats = $Script:Results | Where-Object { $_.Severity -ne "OK" } | Group-Object Category |
        Sort-Object Count -Descending |
        ForEach-Object { "<tr><td>$($_.Name)</td><td><b>$($_.Count)</b></td></tr>" }

    $riskScore = ($Script:Stats.CriticalIssues*10)+($Script:Stats.HighIssues*4)+($Script:Stats.MediumIssues*2)+$Script:Stats.LowIssues
    $riskPct   = [Math]::Min([Math]::Round($riskScore/2,0),100)
    $riskCol   = if ($riskPct -ge 70){"#dc2626"} elseif ($riskPct -ge 40){"#d97706"} else {"#16a34a"}
    $riskLbl   = if ($riskPct -ge 70){"HIGH RISK"} elseif ($riskPct -ge 40){"MEDIUM RISK"} else {"LOW RISK"}

    $cardHtml = @(
        @{L="Critical"; C=$Script:Stats.CriticalIssues;  X="#dc2626"},
        @{L="High";     C=$Script:Stats.HighIssues;       X="#ea580c"},
        @{L="Medium";   C=$Script:Stats.MediumIssues;     X="#d97706"},
        @{L="Low";      C=$Script:Stats.LowIssues;        X="#2563eb"},
        @{L="Security"; C=$Script:Stats.SecurityFindings; X="#7c3aed"},
        @{L="TODOs";    C=$Script:Stats.TODOs;            X="#0891b2"}
    ) | ForEach-Object {
        "<div class='card' style='border-top:4px solid $($_.X)'><div class='cnum' style='color:$($_.X)'>$($_.C)</div><div class='clbl'>$($_.L)</div></div>"
    }

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Jobber Pro — Analysis v3</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.5}
header{background:linear-gradient(135deg,#1e40af,#7c3aed);padding:2rem;text-align:center}
header h1{font-size:1.9rem;font-weight:800;color:#fff}
header p{color:#c7d2fe;margin-top:.4rem;font-size:.88rem}
.container{max-width:1400px;margin:0 auto;padding:2rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:#1e293b;border-radius:12px;padding:1.2rem;text-align:center}
.cnum{font-size:2.3rem;font-weight:800}
.clbl{font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:.2rem}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:1rem;margin-bottom:2rem}
.sbox{background:#1e293b;border-radius:10px;padding:1rem}
.sbox h4{color:#94a3b8;font-size:.72rem;text-transform:uppercase;margin-bottom:.35rem}
.sbox p{font-size:1.4rem;font-weight:700}
h2{color:#f1f5f9;font-size:1.15rem;margin:2rem 0 .8rem;padding-bottom:.4rem;border-bottom:1px solid #334155}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;margin-bottom:2rem}
th{background:#0f172a;color:#94a3b8;font-size:.73rem;text-transform:uppercase;letter-spacing:.06em;padding:.65rem 1rem;text-align:left}
td{padding:.6rem 1rem;border-bottom:1px solid #0f172a;vertical-align:top;font-size:.86rem;word-break:break-word}
tr:hover td{background:#1e3a5f}
.badge{display:inline-block;padding:.18rem .5rem;border-radius:5px;font-size:.7rem;font-weight:700;color:#fff;white-space:nowrap}
.det{margin-top:.3rem;font-family:monospace;font-size:.76rem;color:#94a3b8;white-space:pre-wrap;word-break:break-all}
.rec{margin-top:.3rem;font-size:.76rem;color:#86efac;background:#14532d22;padding:.3rem .5rem;border-radius:4px;border-left:3px solid #16a34a}
code{background:#0f172a;padding:.1rem .3rem;border-radius:4px;font-size:.8rem;color:#93c5fd;word-break:break-all}
.risk{background:#1e293b;border-radius:10px;padding:1.5rem;margin-bottom:2rem}
.prog{height:10px;background:#0f172a;border-radius:5px;overflow:hidden;margin-top:.8rem}
.fill{height:100%;border-radius:5px}
.fbar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem}
.fb{padding:.32rem .75rem;border:1px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:6px;cursor:pointer;font-size:.76rem;transition:.15s}
.fb:hover,.fb.on{background:#2563eb;border-color:#2563eb}
#q{width:100%;padding:.5rem 1rem;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;font-size:.86rem;margin-bottom:.7rem}
footer{text-align:center;color:#475569;padding:1.5rem;font-size:.76rem}
</style>
</head>
<body>
<header>
  <h1>🎯 Jobber Pro — Project Analysis Report v3.0</h1>
  <p>Path: <code style='color:#a5b4fc'>$ProjectPath</code> &nbsp;·&nbsp; $(Get-Date -Format "yyyy-MM-dd HH:mm") &nbsp;·&nbsp; PowerShell Analyzer v3.0 (all bugs fixed)</p>
</header>
<div class="container">

<div class="cards">$($cardHtml -join '')</div>

<h2>📊 Project Statistics</h2>
<div class="stat-grid">
  <div class="sbox"><h4>Total Files</h4><p>$($Script:Stats.TotalFiles)</p></div>
  <div class="sbox"><h4>Lines Scanned</h4><p>$($Script:Stats.TotalLines)</p></div>
  <div class="sbox"><h4>Size (excl. build)</h4><p>$($Script:Stats.TotalSizeKB) KB</p></div>
  <div class="sbox"><h4>TS/TSX Files</h4><p>$($Script:Stats.TSFiles)</p></div>
  <div class="sbox"><h4>SQL Files</h4><p>$($Script:Stats.SQLFiles)</p></div>
  <div class="sbox"><h4>Total Findings</h4><p>$($Script:Results.Count)</p></div>
</div>

<h2>🔥 Risk Assessment</h2>
<div class="risk">
  <span style="font-size:1.4rem;font-weight:800;color:$riskCol">$riskLbl</span>
  <span style="color:#94a3b8;font-size:.85rem;margin-left:1rem">Score: $riskScore</span>
  <div class="prog"><div class="fill" style="width:$riskPct%;background:$riskCol"></div></div>
</div>

<h2>📂 Findings by Category</h2>
<table><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>$($cats -join '')</tbody></table>

<h2>🔍 All Findings</h2>
<input type="text" id="q" placeholder="🔎 Search findings — message, file, category...">
<div class="fbar">
  <button class="fb on" onclick="flt('ALL',this)">All ($($Script:Results.Count))</button>
  <button class="fb" onclick="flt('CRITICAL',this)" style="border-color:#dc2626">🔴 Critical ($($Script:Stats.CriticalIssues))</button>
  <button class="fb" onclick="flt('HIGH',this)"     style="border-color:#ea580c">🟠 High ($($Script:Stats.HighIssues))</button>
  <button class="fb" onclick="flt('MEDIUM',this)"   style="border-color:#d97706">🟡 Medium ($($Script:Stats.MediumIssues))</button>
  <button class="fb" onclick="flt('LOW',this)"      style="border-color:#2563eb">🔵 Low ($($Script:Stats.LowIssues))</button>
  <button class="fb" onclick="flt('OK',this)"       style="border-color:#16a34a">🟢 OK</button>
</div>
<table id="t"><thead><tr><th>Severity</th><th>Category</th><th>File / Line</th><th>Finding &amp; Recommendation</th></tr></thead>
<tbody>$($rows -join '')</tbody></table>

</div>
<footer>Jobber Pro Analyzer v3.0 (all v2 bugs fixed) · $(Get-Date -Format "yyyy-MM-dd") · $($Script:Results.Count) findings</footer>
<script>
let cur='ALL';
const q=document.getElementById('q');
function flt(s,b){cur=s;document.querySelectorAll('.fb').forEach(x=>x.classList.remove('on'));b.classList.add('on');go();}
function go(){
  const v=q.value.toLowerCase();
  document.querySelectorAll('#t tbody tr').forEach(r=>{
    const ok=(cur==='ALL'||r.dataset.sev===cur)&&(!v||r.innerText.toLowerCase().includes(v));
    r.style.display=ok?'':'none';
  });
}
q.addEventListener('input',go);
</script>
</body>
</html>
"@

    $html | Out-File -FilePath $Script:ReportPath -Encoding UTF8
    Add-Finding -Severity OK -Category "Report" -File $Script:ReportPath -Message "HTML report saved: $Script:ReportPath"
}

# ─────────────────────────────────────────────────────────────────────────────
#  SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
function Show-Summary {
    Write-Header "ANALYSIS COMPLETE — FINAL SUMMARY"
    $total = $Script:Stats.CriticalIssues + $Script:Stats.HighIssues + $Script:Stats.MediumIssues + $Script:Stats.LowIssues
    Write-Host ""
    Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "  │         JOBBER PRO — ANALYSIS RESULTS v3        │" -ForegroundColor Cyan
    Write-Host "  ├─────────────────────────────────────────────────┤" -ForegroundColor Cyan
    Write-Host "  │  🔴 Critical : $($Script:Stats.CriticalIssues.ToString().PadLeft(5))                              │" -ForegroundColor Red
    Write-Host "  │  🟠 High     : $($Script:Stats.HighIssues.ToString().PadLeft(5))                              │" -ForegroundColor DarkYellow
    Write-Host "  │  🟡 Medium   : $($Script:Stats.MediumIssues.ToString().PadLeft(5))                              │" -ForegroundColor Yellow
    Write-Host "  │  🔵 Low      : $($Script:Stats.LowIssues.ToString().PadLeft(5))                              │" -ForegroundColor Blue
    Write-Host "  │  ──────────────────────────────────────────────  │" -ForegroundColor Cyan
    Write-Host "  │  ⚠  Total   : $($total.ToString().PadLeft(5))  |  Sec hits: $($Script:Stats.SecurityFindings.ToString().PadLeft(4))            │" -ForegroundColor White
    Write-Host "  │  📝 TODOs   : $($Script:Stats.TODOs.ToString().PadLeft(5))  |  Files: $($Script:Stats.TotalFiles.ToString().PadLeft(6))            │" -ForegroundColor Gray
    Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  📊 Report: $Script:ReportPath" -ForegroundColor Green
    Write-Host ""

    if ($Script:Stats.CriticalIssues -gt 0) {
        Write-Host "  ❗ CRITICAL — fix before any deployment:" -ForegroundColor Red
        $Script:Results | Where-Object { $_.Severity -eq "CRITICAL" } |
            ForEach-Object { Write-Host "     • [$($_.Category)] $($_.Message)" -ForegroundColor Red }
        Write-Host ""
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"

  ╔════════════════════════════════════════════════════════════════════╗
  ║    JOBBER PRO — ADVANCED POWERSHELL PROJECT ANALYZER  v3.0        ║
  ║    All v2 bugs fixed · Mono-repo aware · Build dirs excluded      ║
  ╚════════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

$t0 = Get-Date
Invoke-Preflight
Invoke-FileInventory
Invoke-PackageAnalysis
Invoke-SecurityScan
Invoke-EnvValidation
Invoke-TSConfig
Invoke-DatabaseAnalysis
Invoke-RouteAnalysis
Invoke-CodeQuality
Invoke-AuthJWTChecks
New-HTMLReport
Show-Summary

$elapsed = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
Write-Info "Total analysis time: ${elapsed}s"

if ($OpenReport -and (Test-Path $Script:ReportPath)) { Start-Process $Script:ReportPath }