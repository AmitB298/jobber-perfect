# install-collector-v43.ps1
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File "D:\jobber-perfect\install-collector-v43.ps1"

$src  = "$PSScriptRoot\websocket-collector.ts"
$dest = "D:\jobber-perfect\backend\src\scripts\websocket-collector.ts"
$bak  = "D:\jobber-perfect\backend\src\scripts\websocket-collector.ts.backup-v4.1"

if (-not (Test-Path $src)) {
    Write-Host "ERROR: websocket-collector.ts not found next to this script at $src" -ForegroundColor Red
    exit 1
}

# Backup old file
if (Test-Path $dest) {
    Copy-Item $dest $bak -Force
    Write-Host "Backed up old file to: $bak" -ForegroundColor Yellow
}

# Copy new file
Copy-Item $src $dest -Force
Write-Host "Installed v4.3 to: $dest" -ForegroundColor Green

# Verify
$banner = Select-String -Path $dest -Pattern "v4.3" | Select-Object -First 1
if ($banner) {
    Write-Host "Verified: $($banner.Line.Trim())" -ForegroundColor Green
    Write-Host ""
    Write-Host "Now run:" -ForegroundColor Cyan
    Write-Host "  cd D:\jobber-perfect\backend" -ForegroundColor White
    Write-Host "  npx ts-node src/scripts/websocket-collector.ts" -ForegroundColor White
} else {
    Write-Host "WARNING: v4.3 banner not found — check the file" -ForegroundColor Red
}
