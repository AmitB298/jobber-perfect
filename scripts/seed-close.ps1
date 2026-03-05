# ============================================================
# JOBBER PRO — Close Price Seeder
# Usage: .\scripts\seed-close.ps1
# Use on holidays or if auto-save missed
# ============================================================

$BASE_URL = "http://localhost:3001"

function Show-Header {
    Clear-Host
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║        ⚡ JOBBER PRO — Close Price Seeder                ║" -ForegroundColor Cyan
    Write-Host "║        $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')                          ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Show-CloseHistory {
    Write-Host "[ STORED CLOSE PRICES ]" -ForegroundColor Magenta
    try {
        $res = Invoke-RestMethod -Uri "$BASE_URL/api/admin/close-history" -TimeoutSec 5
        if ($res.data.Count -eq 0) {
            Write-Host "  ⚠️  No close prices stored yet" -ForegroundColor Yellow
        } else {
            $res.data | Select-Object -First 5 | ForEach-Object {
                $dt      = [datetime]$_.trade_date
                $dateStr = $dt.AddHours(5).AddMinutes(30).ToString("yyyy-MM-dd")
                Write-Host "  $dateStr  →  ₹$($_.close_price)" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "  ❌ Cannot reach backend at $BASE_URL" -ForegroundColor Red
        Write-Host "  Make sure backend is running first." -ForegroundColor DarkGray
        exit 1
    }
    Write-Host ""
}

function Get-NiftyLTP {
    try {
        $res = Invoke-RestMethod -Uri "$BASE_URL/api/options/greeks" -TimeoutSec 5
        return $res.data.spotPrice
    } catch {
        return $null
    }
}

function Write-ClosePrice($date, $close) {
    try {
        $body = "{`"date`":`"$date`",`"close`":$close}"
        $res  = Invoke-RestMethod `
                    -Uri "$BASE_URL/api/admin/set-close" `
                    -Method POST `
                    -ContentType "application/json" `
                    -Body $body `
                    -TimeoutSec 5
        if ($res.success) {
            Write-Host "  ✅ $($res.message)" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Failed: $($res.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ Error: $_" -ForegroundColor Red
    }
}

function Write-ClosePriceNow {
    try {
        $res = Invoke-RestMethod `
                    -Uri "$BASE_URL/api/admin/save-close-now" `
                    -Method POST `
                    -TimeoutSec 5
        if ($res.success) {
            Write-Host "  ✅ $($res.message)" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Failed" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ Error: $_" -ForegroundColor Red
    }
}

# ── MAIN ──────────────────────────────────────────────────
Show-Header
Show-CloseHistory

# Show current LTP as a hint
$ltp = Get-NiftyLTP
if ($null -ne $ltp) {
    Write-Host "  💡 Current NIFTY LTP : ₹$ltp" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "[ OPTIONS ]" -ForegroundColor Magenta
Write-Host "  1 — Seed a specific date and close price manually" -ForegroundColor White
Write-Host "  2 — Save current NIFTY LTP as today's close right now" -ForegroundColor White
Write-Host "  3 — Seed multiple dates at once" -ForegroundColor White
Write-Host "  4 — Show close history and exit" -ForegroundColor White
Write-Host "  Q — Quit" -ForegroundColor DarkGray
Write-Host ""

$choice = Read-Host "  Enter choice (1/2/3/4/Q)"

switch ($choice.ToUpper()) {

    "1" {
        Write-Host ""
        $defaultDate = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
        $dateInput   = Read-Host "  Enter date (yyyy-MM-dd) [default: $defaultDate]"
        if ([string]::IsNullOrWhiteSpace($dateInput)) { $dateInput = $defaultDate }

        try {
            $null = [datetime]::ParseExact($dateInput, "yyyy-MM-dd", $null)
        } catch {
            Write-Host "  ❌ Invalid date format. Use yyyy-MM-dd (e.g. 2026-03-05)" -ForegroundColor Red
            exit 1
        }

        $closeInput = Read-Host "  Enter close price (e.g. 24865.70)"
        if ($closeInput -notmatch '^\d+(\.\d+)?$') {
            Write-Host "  ❌ Invalid price. Enter a number like 24865.70" -ForegroundColor Red
            exit 1
        }

        Write-Host ""
        Write-Host "  Seeding: NIFTY ₹$closeInput on $dateInput ..." -ForegroundColor DarkGray
        Write-ClosePrice $dateInput $closeInput
    }

    "2" {
        Write-Host ""
        if ($null -ne $ltp) {
            Write-Host "  Saving current LTP ₹$ltp as today's close..." -ForegroundColor DarkGray
            Write-ClosePriceNow
        } else {
            Write-Host "  ❌ Could not fetch current LTP from backend" -ForegroundColor Red
        }
    }

    "3" {
        Write-Host ""
        Write-Host "  Enter multiple date,price pairs. Type DONE when finished." -ForegroundColor DarkGray
        Write-Host "  Format: yyyy-MM-dd,price  (e.g. 2026-03-04,24865.70)" -ForegroundColor DarkGray
        Write-Host ""
        $count = 0
        while ($true) {
            $line = Read-Host "  Entry $($count + 1)"
            if ($line.ToUpper() -eq "DONE" -or [string]::IsNullOrWhiteSpace($line)) { break }
            $parts = $line.Split(",")
            if ($parts.Count -ne 2) {
                Write-Host "  ⚠️  Skipping invalid format: $line" -ForegroundColor Yellow
                continue
            }
            $d = $parts[0].Trim()
            $p = $parts[1].Trim()
            if ($p -notmatch '^\d+(\.\d+)?$') {
                Write-Host "  ⚠️  Skipping invalid price: $p" -ForegroundColor Yellow
                continue
            }
            Write-ClosePrice $d $p
            $count++
        }
        Write-Host ""
        Write-Host "  ✅ Seeded $count entries" -ForegroundColor Green
    }

    "4" {
        Write-Host ""
        Show-CloseHistory
    }

    "Q" {
        Write-Host "  Bye!" -ForegroundColor DarkGray
        exit 0
    }

    default {
        Write-Host "  ❌ Invalid choice" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[ UPDATED CLOSE HISTORY ]" -ForegroundColor Magenta
try {
    $res = Invoke-RestMethod -Uri "$BASE_URL/api/admin/close-history" -TimeoutSec 5
    $res.data | Select-Object -First 5 | ForEach-Object {
        $dt      = [datetime]$_.trade_date
        $dateStr = $dt.AddHours(5).AddMinutes(30).ToString("yyyy-MM-dd")
        Write-Host "  $dateStr  →  ₹$($_.close_price)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ❌ Could not fetch history" -ForegroundColor Red
}

Write-Host ""
Write-Host "  Done. Run .\scripts\heartbeat.ps1 to monitor." -ForegroundColor DarkGray