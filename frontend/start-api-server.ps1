# Start API Server
Write-Host "`n🚀 Starting NIFTY Options API Server...`n" -ForegroundColor Cyan

cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"

Write-Host "✅ API Server running on http://localhost:3001" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow

npx ts-node api-server.ts
