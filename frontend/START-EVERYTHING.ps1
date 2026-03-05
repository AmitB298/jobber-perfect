Write-Host "`n🚀 NIFTY OPTIONS TRACKER - COMPLETE STARTUP`n" -ForegroundColor Cyan

# Kill everything first
Write-Host "🛑 Stopping all processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# Start API Server
Write-Host "`n📊 Starting API Server..." -ForegroundColor Green
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd D:\jobber-perfect\backend; `$env:DB_PASSWORD = 'Amit@1992'; Write-Host '🚀 API SERVER STARTING...' -ForegroundColor Cyan; npx ts-node api-server.ts"
)

# Wait for API to start
Write-Host "⏳ Waiting for API server..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test API
try {
    $response = Invoke-RestMethod http://localhost:3001/api/stats
    Write-Host "✅ API Server is READY!" -ForegroundColor Green
} catch {
    Write-Host "⚠️  API Server might not be ready yet" -ForegroundColor Yellow
}

# Start Frontend
Write-Host "`n🌐 Starting Frontend..." -ForegroundColor Green
cd D:\jobber-perfect\frontend
Start-Sleep -Seconds 2
npm run dev:vite
