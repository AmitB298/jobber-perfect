# JOBBER Pro Backend - Quick Setup Script
# PowerShell 7+ recommended

param(
    [Parameter(Mandatory=$false)]
    [string]$DBPassword = ""
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 JOBBER Pro Backend Setup" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found! Please install Node.js 18+" -ForegroundColor Red
    exit 1
}

# Check if PostgreSQL is installed
try {
    $psqlVersion = psql --version
    Write-Host "✓ PostgreSQL installed" -ForegroundColor Green
} catch {
    Write-Host "✗ PostgreSQL not found! Please install PostgreSQL" -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ npm install failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Dependencies installed" -ForegroundColor Green

# Create .env if it doesn't exist
if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "📝 Creating .env file..." -ForegroundColor Yellow
    
    if ($DBPassword -eq "") {
        $DBPassword = Read-Host "Enter PostgreSQL password for user 'postgres'"
    }
    
    $envContent = @"
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jobber_pro
DB_USER=postgres
DB_PASSWORD=$DBPassword

# JWT Secrets
JWT_SECRET=$(New-Guid)
JWT_REFRESH_SECRET=$(New-Guid)

# CORS
CORS_ORIGIN=http://localhost:5173

# Logging
LOG_LEVEL=info
"@
    
    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    Write-Host "✓ .env file created" -ForegroundColor Green
} else {
    Write-Host "✓ .env file already exists" -ForegroundColor Green
}

# Create database
Write-Host ""
Write-Host "📊 Setting up database..." -ForegroundColor Yellow

$env:PGPASSWORD = $DBPassword

# Check if database exists
$dbExists = psql -U postgres -lqt | Select-String -Pattern "jobber_pro"

if (-not $dbExists) {
    Write-Host "Creating database 'jobber_pro'..." -ForegroundColor Gray
    psql -U postgres -c "CREATE DATABASE jobber_pro;"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to create database" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✓ Database created" -ForegroundColor Green
} else {
    Write-Host "✓ Database already exists" -ForegroundColor Green
}

# Run migrations
Write-Host ""
Write-Host "📋 Running database schema..." -ForegroundColor Yellow
npm run build 2>$null
node dist/database/setup.js

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Schema migration failed" -ForegroundColor Red
    exit 1
}

# Success message
Write-Host ""
Write-Host "✅ Backend setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Run: npm run dev" -ForegroundColor White
Write-Host "2. Test: http://localhost:3000/health" -ForegroundColor White
Write-Host "3. Update Electron app .env with: BACKEND_URL=http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "Start backend now? (Y/n): " -NoNewline -ForegroundColor Yellow

$response = Read-Host

if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
    Write-Host ""
    Write-Host "🚀 Starting backend..." -ForegroundColor Cyan
    npm run dev
}
