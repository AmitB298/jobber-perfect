# Start Both API Server and Dev App
Write-Host "`n🚀 Starting NIFTY Options Tracker - Complete System`n" -ForegroundColor Cyan

# Start API Server in new window
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api-server.ps1"

# Wait for API to start
Write-Host "⏳ Waiting for API server to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Start Dev App in new window
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-dev-app.ps1"

Write-Host "`n✅ Both servers starting in separate windows!" -ForegroundColor Green
Write-Host "`n📊 Access your dashboard at: http://localhost:5173`n" -ForegroundColor Cyan
