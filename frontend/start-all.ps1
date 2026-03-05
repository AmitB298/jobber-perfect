Write-Host "`n🚀 NIFTY Options Tracker - Starting All Services`n" -ForegroundColor Cyan

Write-Host "📊 Starting API Server..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-api.ps1"

Start-Sleep -Seconds 3

Write-Host "🌐 Starting Frontend..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd D:\jobber-perfect\frontend; .\start-frontend.ps1"

Start-Sleep -Seconds 5

Write-Host "`n✅ Both services starting!`n" -ForegroundColor Green
Write-Host "📊 API Server: http://localhost:3001" -ForegroundColor Cyan
Write-Host "🌐 Frontend:   http://localhost:5173" -ForegroundColor Cyan
Write-Host "`nOpening browser..." -ForegroundColor Yellow

Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
