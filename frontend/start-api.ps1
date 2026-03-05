Write-Host "`n🚀 Starting API Server...`n" -ForegroundColor Cyan
cd D:\jobber-perfect\backend
$env:DB_PASSWORD = "Amit@1992"
npx ts-node api-server.ts
