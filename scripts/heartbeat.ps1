# ============================================================
# JOBBER PRO — Heartbeat Monitor
# Usage: .\scripts\heartbeat.ps1
# Press Ctrl+C to stop
# ============================================================

$BASE_URL = "http://localhost:3001"
$INTERVAL = 5  # seconds between checks

function Get-StatusColor($status) {
    switch ($status) {
        "OK"    { return "Green" }
        "WARN"  { return "Yellow" }
        "FAIL"  { return "Red" }
        default { return "Gray" }
    }
}

function Invoke-Endpoint($label, $url) {
    try {
        $sw  = [System.Diagnostics.Stopwatch]::StartNew()
        $res = Invoke-RestMethod -Uri $url -TimeoutSec 10 -ErrorAction Stop
        $sw.Stop()
        $ms = $sw.ElapsedMilliseconds
        # plain objects (like /api/system/stats) have no success field — treat as OK
        # only explicit success:false is WARN
        $status = if ($res.success -eq $false) { "WARN" } else { "OK" }
        return @{ Label=$label; Status=$status; Latency="${ms}ms"; Data=$res }
    } catch {
        return @{ Label=$label; Status="FAIL"; Latency="---"; Data=$null }
    }
}

function Format-DataAge($ms) {
    if ($null -eq $ms)  { return "N/A" }
    if ($ms -lt 1000)   { return "${ms}ms" }
    $s = [math]::Round($ms / 1000, 1)
    return "${s}s"
}

function Show-Heartbeat {
    Clear-Host
    $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║        ⚡ JOBBER PRO — Heartbeat Monitor                 ║" -ForegroundColor Cyan
    Write-Host "║        $now  |  Ctrl+C to stop              ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # ── 1. System Stats
    $stats = Invoke-Endpoint "System Stats" "$BASE_URL/api/system/stats"
    Write-Host "[ SYSTEM ]" -ForegroundColor Magenta
    if ($stats.Status -eq "OK") {
        $d          = $stats.Data
        $cacheAge   = if ($null -ne $d.cacheAge) { "$($d.cacheAge)ms" } else { "N/A" }
        $cacheColor = if ([int]$d.cacheAge -lt 2000) { "Green" } else { "Yellow" }
        $uptimeSec  = [int]$d.uptime
        $uptime     = "$([math]::Floor($uptimeSec/3600))h $([math]::Floor(($uptimeSec%3600)/60))m $($uptimeSec%60)s"
        $queueColor = if ([int]$d.dbQueue -lt 100) { "Green" } else { "Yellow" }
        Write-Host "  Uptime    : $uptime" -ForegroundColor Green
        Write-Host "  Cache Age : $cacheAge" -ForegroundColor $cacheColor
        Write-Host "  WS Clients: $($d.wsClients)" -ForegroundColor Cyan
        Write-Host "  DB Queue  : $($d.dbQueue)" -ForegroundColor $queueColor
        Write-Host "  Tick Store: $($d.tickStore.tickCount) ticks (~$($d.tickStore.estimatedRAMkb)kb)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ UNREACHABLE — Is the backend running?" -ForegroundColor Red
    }
    Write-Host ""

    # ── 2. NIFTY Spot + Change
    $greeks = Invoke-Endpoint "Greeks" "$BASE_URL/api/options/greeks"
    Write-Host "[ NIFTY ]" -ForegroundColor Magenta
    if ($greeks.Status -eq "OK") {
        $d             = $greeks.Data.data
        $changeRounded = [math]::Round($d.spotChange, 2)
        $pct           = [math]::Round($d.spotChangePercent, 2)
        $changeColor   = if ($d.spotChange -ge 0) { "Green" } else { "Red" }
        $changeSign    = if ($d.spotChange -ge 0) { "▲" } else { "▼" }
        $ageMs         = [double]$d.dataAgeMs
        $ageColor      = if ($ageMs -lt 10000) { "Green" } elseif ($ageMs -lt 60000) { "Yellow" } else { "Red" }
        $pcrColor      = if ($d.pcr_oi -lt 0.7) { "Red" } elseif ($d.pcr_oi -gt 1.3) { "Green" } else { "Yellow" }

        Write-Host "  Spot      : ₹$($d.spotPrice)" -ForegroundColor White
        Write-Host "  Change    : $changeSign $changeRounded ($pct%)" -ForegroundColor $changeColor
        Write-Host "  ATM Strike: $($d.atmStrike)" -ForegroundColor Yellow
        Write-Host "  PCR (OI)  : $([math]::Round($d.pcr_oi, 3))" -ForegroundColor $pcrColor
        Write-Host "  Max Pain  : $($d.maxPain)" -ForegroundColor Magenta
        Write-Host "  Data Age  : $(Format-DataAge $ageMs)" -ForegroundColor $ageColor
        Write-Host "  Chain Rows: $($d.chain.Count)" -ForegroundColor Gray

        $ms      = $d.marketStatus
        $msColor = if ($ms.isOpen) { "Green" } else { "Gray" }
        Write-Host "  Market    : [$($ms.session)] $($ms.note)" -ForegroundColor $msColor
        if ($null -ne $ms.nextOpen) {
            Write-Host "  Next Open : $($ms.nextOpen)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  ❌ FAIL ($($greeks.Latency))" -ForegroundColor Red
    }
    Write-Host ""

    # ── 3. Network
    $net = Invoke-Endpoint "Network" "$BASE_URL/api/network/status"
    Write-Host "[ NETWORK ]" -ForegroundColor Magenta
    if ($net.Status -eq "OK") {
        $d = $net.Data.data
        $qColor = switch ($d.quality) {
            "EXCELLENT" { "Green" }
            "GOOD"      { "Green" }
            "FAIR"      { "Yellow" }
            "POOR"      { "Red" }
            "OFFLINE"   { "Red" }
            default     { "Gray" }
        }
        $dl        = if ($null -ne $d.downloadMbps) { "$([math]::Round($d.downloadMbps, 1)) Mbps" } else { "N/A" }
        $lossColor = if ($d.packetLoss -eq 0) { "Green" } elseif ($d.packetLoss -lt 20) { "Yellow" } else { "Red" }
        Write-Host "  Quality   : $($d.quality)" -ForegroundColor $qColor
        Write-Host "  Latency   : $($d.latencyMs)ms  |  Jitter: $($d.jitterMs)ms" -ForegroundColor Cyan
        Write-Host "  Download  : $dl  |  Packet Loss: $($d.packetLoss)%" -ForegroundColor $lossColor
        if ($null -ne $d.alert) {
            $aColor = switch ($d.alert.level) {
                "CRITICAL"  { "Red" }
                "WARNING"   { "Yellow" }
                "RECOVERED" { "Green" }
                default     { "Gray" }
            }
            Write-Host "  Alert     : $($d.alert.message)" -ForegroundColor $aColor
        }
    } else {
        Write-Host "  ❌ FAIL" -ForegroundColor Red
    }
    Write-Host ""

    # ── 4. Daily Close Table
    $closeHist = Invoke-Endpoint "Close History" "$BASE_URL/api/admin/close-history"
    Write-Host "[ DAILY CLOSE ]" -ForegroundColor Magenta
    if ($closeHist.Status -eq "OK" -and $closeHist.Data.data.Count -gt 0) {
        $closeHist.Data.data | Select-Object -First 3 | ForEach-Object {
            $dt      = [datetime]$_.trade_date
            $dateStr = $dt.AddHours(5).AddMinutes(30).ToString("yyyy-MM-dd")
            Write-Host "  $dateStr  →  ₹$($_.close_price)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️  No close data found" -ForegroundColor Yellow
    }
    Write-Host ""

    # ── 5. Endpoint Ping Summary
    Write-Host "[ ENDPOINT PING ]" -ForegroundColor Magenta
    $endpoints = @(
        @{ Label="Spot NIFTY   "; Url="$BASE_URL/api/spot/nifty" },
        @{ Label="Options Chain"; Url="$BASE_URL/api/options/chain" },
        @{ Label="Signals      "; Url="$BASE_URL/api/analytics/signals" },
        @{ Label="PCR          "; Url="$BASE_URL/api/analytics/pcr" },
        @{ Label="Max Pain     "; Url="$BASE_URL/api/analytics/max-pain" },
        @{ Label="IV History   "; Url="$BASE_URL/api/analytics/iv-history" },
        @{ Label="Opportunities"; Url="$BASE_URL/api/analytics/opportunities" },
        @{ Label="Predictions  "; Url="$BASE_URL/api/premium/predictions" },
        @{ Label="GEX          "; Url="$BASE_URL/api/premium/gex" },
        @{ Label="Network      "; Url="$BASE_URL/api/network/status" }
    )
    foreach ($ep in $endpoints) {
        $r    = Invoke-Endpoint $ep.Label $ep.Url
        $icon = if ($r.Status -eq "OK") { "✅" } elseif ($r.Status -eq "WARN") { "⚠️ " } else { "❌" }
        $col  = Get-StatusColor $r.Status
        Write-Host "  $icon $($ep.Label)  $($r.Latency)" -ForegroundColor $col
    }

    Write-Host ""
    Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  Refreshing every ${INTERVAL}s  |  $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor DarkGray
}

# ── Main Loop
while ($true) {
    Show-Heartbeat
    Start-Sleep -Seconds $INTERVAL
}