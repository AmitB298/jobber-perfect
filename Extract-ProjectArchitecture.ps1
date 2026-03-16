#Requires -Version 5.1
<#
.SYNOPSIS
    Advanced Project Architecture & Technical Detail Extractor
.DESCRIPTION
    Extracts complete architecture, tech stack, dependencies, patterns, APIs,
    database schemas, configuration, and generates a full technical report.
.PARAMETER ProjectPath
    Root path of the project (default: D:\jobber-perfect)
.PARAMETER OutputPath
    Where to save the report (default: Desktop)
.PARAMETER OutputFormat
    Report format: HTML, JSON, TXT, or ALL (default: ALL)
.EXAMPLE
    .\Extract-ProjectArchitecture.ps1 -ProjectPath "D:\jobber-perfect" -OutputFormat ALL
#>

param(
    [string]$ProjectPath = "D:\jobber-perfect",
    [string]$OutputPath  = [Environment]::GetFolderPath("Desktop"),
    [ValidateSet("HTML","JSON","TXT","ALL")]
    [string]$OutputFormat = "ALL"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────
function Write-Step($msg) { Write-Host "  ► $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  ✔ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }

function Get-FilesByExtension($root, [string[]]$exts) {
    Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $exts -contains $_.Extension.ToLower() -and
                       $_.FullName -notmatch '\\(node_modules|\.git|\.next|dist|build|coverage|__pycache__|\.venv|venv|bin|obj)\\' }
}

function Get-RelativePath($base, $full) {
    $full.Replace($base, "").TrimStart("\", "/")
}

function Read-JsonFile($path) {
    try { Get-Content $path -Raw | ConvertFrom-Json } catch { $null }
}

# ─────────────────────────────────────────────
#  VALIDATION
# ─────────────────────────────────────────────
if (-not (Test-Path $ProjectPath)) {
    Write-Host "`n  ✖ Project path not found: $ProjectPath" -ForegroundColor Red
    exit 1
}

$timestamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$reportBase  = Join-Path $OutputPath "ProjectArchitecture_$timestamp"
$data        = [ordered]@{}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
Write-Host "   PROJECT ARCHITECTURE EXTRACTOR" -ForegroundColor White
Write-Host "   Target: $ProjectPath" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Magenta

# ═══════════════════════════════════════════════
#  1. PROJECT OVERVIEW
# ═══════════════════════════════════════════════
Write-Step "Scanning project overview..."

$allFiles = Get-ChildItem -Path $ProjectPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|\.next|dist|build|coverage|__pycache__|\.venv|venv|bin|obj)\\' }

$totalSize = ($allFiles | Measure-Object -Property Length -Sum).Sum
$extGroups = $allFiles | Group-Object Extension | Sort-Object Count -Descending

$data["overview"] = [ordered]@{
    projectName    = Split-Path $ProjectPath -Leaf
    rootPath       = $ProjectPath
    analysisDate   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    totalFiles     = $allFiles.Count
    totalSizeMB    = [math]::Round($totalSize / 1MB, 2)
    fileExtensions = ($extGroups | Select-Object -First 20 | ForEach-Object { "$($_.Name)($($_.Count))" }) -join ", "
    topFolders     = (Get-ChildItem -Path $ProjectPath -Directory | Select-Object -First 15 Name | ForEach-Object { $_.Name }) -join ", "
}
Write-OK "Overview complete — $($allFiles.Count) files, $([math]::Round($totalSize/1MB,2)) MB"

# ═══════════════════════════════════════════════
#  2. TECHNOLOGY STACK DETECTION
# ═══════════════════════════════════════════════
Write-Step "Detecting technology stack..."

$techStack = [ordered]@{
    languages        = [System.Collections.Generic.List[string]]::new()
    frameworks       = [System.Collections.Generic.List[string]]::new()
    databases        = [System.Collections.Generic.List[string]]::new()
    cloudServices    = [System.Collections.Generic.List[string]]::new()
    devTools         = [System.Collections.Generic.List[string]]::new()
    testingTools     = [System.Collections.Generic.List[string]]::new()
    packageManagers  = [System.Collections.Generic.List[string]]::new()
    containerization = [System.Collections.Generic.List[string]]::new()
    ciCd             = [System.Collections.Generic.List[string]]::new()
}

# Language detection by extension
$langMap = @{
    ".ts"=>"TypeScript"; ".tsx"=>"TypeScript/React"; ".js"=>"JavaScript";
    ".jsx"=>"JavaScript/React"; ".py"=>"Python"; ".cs"=>"C#"; ".java"=>"Java";
    ".go"=>"Go"; ".rb"=>"Ruby"; ".php"=>"PHP"; ".rs"=>"Rust"; ".swift"=>"Swift";
    ".kt"=>"Kotlin"; ".cpp"=>"C++"; ".c"=>"C"; ".html"=>"HTML"; ".css"=>"CSS";
    ".scss"=>"SCSS/Sass"; ".less"=>"LESS"; ".sql"=>"SQL"; ".graphql"=>"GraphQL";
    ".prisma"=>"Prisma"; ".tf"=>"Terraform"
}
foreach ($ext in $extGroups.Name) {
    if ($langMap.ContainsKey($ext)) { $techStack.languages.Add($langMap[$ext]) | Out-Null }
}
$techStack.languages = $techStack.languages | Select-Object -Unique

# Config/tool file detection
$rootFiles = Get-ChildItem -Path $ProjectPath -File | Select-Object -ExpandProperty Name

$fileChecks = @{
    "package.json"         = { $techStack.packageManagers.Add("npm/yarn/pnpm") | Out-Null }
    "yarn.lock"            = { $techStack.packageManagers.Add("Yarn") | Out-Null }
    "pnpm-lock.yaml"       = { $techStack.packageManagers.Add("pnpm") | Out-Null }
    "Pipfile"              = { $techStack.packageManagers.Add("Pipenv") | Out-Null }
    "requirements.txt"     = { $techStack.packageManagers.Add("pip") | Out-Null }
    "Dockerfile"           = { $techStack.containerization.Add("Docker") | Out-Null }
    "docker-compose.yml"   = { $techStack.containerization.Add("Docker Compose") | Out-Null }
    "docker-compose.yaml"  = { $techStack.containerization.Add("Docker Compose") | Out-Null }
    ".github"              = { $techStack.ciCd.Add("GitHub Actions") | Out-Null }
    "Jenkinsfile"          = { $techStack.ciCd.Add("Jenkins") | Out-Null }
    ".gitlab-ci.yml"       = { $techStack.ciCd.Add("GitLab CI") | Out-Null }
    "azure-pipelines.yml"  = { $techStack.ciCd.Add("Azure DevOps") | Out-Null }
    "jest.config.*"        = { $techStack.testingTools.Add("Jest") | Out-Null }
    "vitest.config.*"      = { $techStack.testingTools.Add("Vitest") | Out-Null }
    "cypress.json"         = { $techStack.testingTools.Add("Cypress") | Out-Null }
    "playwright.config.*"  = { $techStack.testingTools.Add("Playwright") | Out-Null }
    "eslint*"              = { $techStack.devTools.Add("ESLint") | Out-Null }
    "prettier*"            = { $techStack.devTools.Add("Prettier") | Out-Null }
    "tsconfig.json"        = { $techStack.devTools.Add("TypeScript Compiler") | Out-Null }
    ".env*"                = { $techStack.devTools.Add("Environment Variables") | Out-Null }
}
foreach ($check in $fileChecks.Keys) {
    if ($rootFiles -like $check -or (Test-Path (Join-Path $ProjectPath $check))) {
        & $fileChecks[$check]
    }
}

# Framework detection from package.json
$pkgJson = Read-JsonFile (Join-Path $ProjectPath "package.json")
if ($pkgJson) {
    $allDeps = @()
    if ($pkgJson.dependencies)    { $allDeps += $pkgJson.dependencies.PSObject.Properties.Name }
    if ($pkgJson.devDependencies) { $allDeps += $pkgJson.devDependencies.PSObject.Properties.Name }

    $fwMap = @{
        "next"=>"Next.js"; "react"=>"React"; "vue"=>"Vue.js"; "nuxt"=>"Nuxt.js";
        "angular"=>"Angular"; "@angular/core"=>"Angular"; "svelte"=>"Svelte";
        "express"=>"Express.js"; "fastify"=>"Fastify"; "koa"=>"Koa"; "hapi"=>"Hapi";
        "nestjs"=>"NestJS"; "@nestjs/core"=>"NestJS"; "graphql"=>"GraphQL";
        "apollo-server"=>"Apollo Server"; "@apollo/server"=>"Apollo Server";
        "prisma"=>"Prisma ORM"; "@prisma/client"=>"Prisma ORM";
        "sequelize"=>"Sequelize ORM"; "typeorm"=>"TypeORM"; "mongoose"=>"Mongoose";
        "drizzle-orm"=>"Drizzle ORM"; "socket.io"=>"Socket.IO";
        "tailwindcss"=>"Tailwind CSS"; "styled-components"=>"Styled Components";
        "redux"=>"Redux"; "@reduxjs/toolkit"=>"Redux Toolkit"; "zustand"=>"Zustand";
        "mobx"=>"MobX"; "recoil"=>"Recoil"; "jotai"=>"Jotai";
        "react-query"=>"React Query"; "@tanstack/react-query"=>"TanStack Query";
        "trpc"=>"tRPC"; "@trpc/server"=>"tRPC"; "zod"=>"Zod (Validation)";
        "joi"=>"Joi"; "yup"=>"Yup"; "stripe"=>"Stripe"; "twilio"=>"Twilio";
        "aws-sdk"=>"AWS SDK"; "@aws-sdk/client-s3"=>"AWS S3"; "firebase"=>"Firebase";
        "supabase"=>"Supabase"; "@supabase/supabase-js"=>"Supabase";
        "redis"=>"Redis"; "ioredis"=>"Redis (ioredis)"; "bull"=>"Bull Queue";
        "bullmq"=>"BullMQ"; "jest"=>"Jest"; "vitest"=>"Vitest"; "mocha"=>"Mocha";
        "cypress"=>"Cypress"; "playwright"=>"Playwright"; "storybook"=>"Storybook";
        "@storybook/react"=>"Storybook"; "webpack"=>"Webpack"; "vite"=>"Vite";
        "turbopack"=>"Turbopack"; "esbuild"=>"esbuild"; "rollup"=>"Rollup";
        "dotenv"=>"dotenv"; "winston"=>"Winston Logger"; "pino"=>"Pino Logger";
        "axios"=>"Axios"; "node-fetch"=>"node-fetch"; "swr"=>"SWR";
        "framer-motion"=>"Framer Motion"; "three"=>"Three.js"; "d3"=>"D3.js";
        "chart.js"=>"Chart.js"; "recharts"=>"Recharts"; "shadcn"=>"shadcn/ui";
        "@radix-ui"=>"Radix UI"; "lucide-react"=>"Lucide Icons";
        "react-hook-form"=>"React Hook Form"; "formik"=>"Formik";
        "next-auth"=>"NextAuth.js"; "clerk"=>"Clerk Auth";
        "@clerk/nextjs"=>"Clerk Auth"; "passport"=>"Passport.js";
        "jsonwebtoken"=>"JWT"; "bcrypt"=>"bcrypt"; "sharp"=>"Sharp (Image)";
        "multer"=>"Multer (Upload)"; "nodemailer"=>"Nodemailer";
        "resend"=>"Resend Email"; "sendgrid"=>"SendGrid";
    }
    foreach ($dep in $allDeps) {
        foreach ($key in $fwMap.Keys) {
            if ($dep -eq $key -or $dep -like "$key*") {
                $techStack.frameworks.Add($fwMap[$key]) | Out-Null
                break
            }
        }
    }
    $techStack.frameworks = $techStack.frameworks | Select-Object -Unique
}

$data["techStack"] = $techStack
Write-OK "Tech stack detected"

# ═══════════════════════════════════════════════
#  3. PROJECT STRUCTURE
# ═══════════════════════════════════════════════
Write-Step "Mapping project structure..."

function Build-Tree($path, $indent = 0, $maxDepth = 4, $maxItems = 12) {
    if ($indent -ge $maxDepth) { return }
    $items = Get-ChildItem -Path $path -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '^(node_modules|\.git|\.next|dist|build|coverage|__pycache__|\.venv|venv|bin|obj|\.cache)$' } |
        Sort-Object { -not $_.PSIsContainer }, Name | Select-Object -First $maxItems

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $items) {
        $prefix = ("│   " * [math]::Max(0,$indent-1)) + (if ($indent -gt 0) { "├── " } else { "" })
        if ($item.PSIsContainer) {
            $lines.Add("$prefix📁 $($item.Name)/") | Out-Null
            $sub = Build-Tree $item.FullName ($indent+1) $maxDepth $maxItems
            $lines.AddRange($sub) | Out-Null
        } else {
            $lines.Add("$prefix📄 $($item.Name)") | Out-Null
        }
    }
    if ((Get-ChildItem $path -ErrorAction SilentlyContinue).Count -gt $maxItems) {
        $p2 = ("│   " * [math]::Max(0,$indent-1)) + (if ($indent -gt 0) {"└── "} else {""})
        $lines.Add("${p2}... (more items)") | Out-Null
    }
    return $lines
}

$treeLines = Build-Tree $ProjectPath
$data["projectStructure"] = [ordered]@{
    tree = $treeLines -join "`n"
    topLevelFolders = (Get-ChildItem $ProjectPath -Directory |
        Where-Object { $_.Name -notmatch '^(node_modules|\.git|dist|build|coverage)$' } |
        Select-Object -ExpandProperty Name)
}
Write-OK "Structure mapped"

# ═══════════════════════════════════════════════
#  4. DEPENDENCIES (package.json / requirements)
# ═══════════════════════════════════════════════
Write-Step "Analyzing dependencies..."

$deps = [ordered]@{ production = @(); development = @(); python = @(); dotnet = @() }

if ($pkgJson) {
    if ($pkgJson.dependencies)    { $deps.production   = $pkgJson.dependencies.PSObject.Properties    | ForEach-Object { "$($_.Name): $($_.Value)" } }
    if ($pkgJson.devDependencies) { $deps.development  = $pkgJson.devDependencies.PSObject.Properties | ForEach-Object { "$($_.Name): $($_.Value)" } }
}
$reqFile = Join-Path $ProjectPath "requirements.txt"
if (Test-Path $reqFile) { $deps.python = Get-Content $reqFile | Where-Object { $_ -notmatch '^#' -and $_ -ne "" } }

$csprojFiles = Get-ChildItem $ProjectPath -Recurse -Filter "*.csproj" -ErrorAction SilentlyContinue | Select-Object -First 5
foreach ($csp in $csprojFiles) {
    ([xml](Get-Content $csp.FullName -ErrorAction SilentlyContinue))?.Project?.ItemGroup?.PackageReference | ForEach-Object {
        if ($_?.Include) { $deps.dotnet += "$($_.Include): $($_.Version)" }
    }
}

$data["dependencies"] = $deps
Write-OK "Dependencies: $($deps.production.Count) prod, $($deps.development.Count) dev"

# ═══════════════════════════════════════════════
#  5. ENVIRONMENT & CONFIGURATION
# ═══════════════════════════════════════════════
Write-Step "Extracting environment config..."

$envConfig = [ordered]@{ envFiles = @(); envKeys = @(); configFiles = @() }

$envFiles = Get-ChildItem $ProjectPath -File | Where-Object { $_.Name -match "^\.env" }
foreach ($ef in $envFiles) {
    $envConfig.envFiles += $ef.Name
    $keys = Get-Content $ef.FullName | Where-Object { $_ -match "^[A-Z_][A-Z0-9_]*=" } | ForEach-Object { ($_ -split "=")[0] }
    $envConfig.envKeys += $keys
}
$envConfig.envKeys = $envConfig.envKeys | Select-Object -Unique | Sort-Object

$configPatterns = @("*.config.js","*.config.ts","*.config.json","appsettings*.json","web.config","app.config","*.yaml","*.yml")
foreach ($pat in $configPatterns) {
    Get-ChildItem $ProjectPath -Filter $pat -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "package|lock|node_modules" } |
        ForEach-Object { $envConfig.configFiles += Get-RelativePath $ProjectPath $_.FullName }
}

$data["environment"] = $envConfig
Write-OK "Found $($envConfig.envKeys.Count) env keys across $($envConfig.envFiles.Count) env files"

# ═══════════════════════════════════════════════
#  6. API ROUTES & ENDPOINTS
# ═══════════════════════════════════════════════
Write-Step "Scanning API routes and endpoints..."

$apiRoutes = [System.Collections.Generic.List[object]]::new()

# Next.js app router
$appApiDirs = Get-ChildItem $ProjectPath -Recurse -Directory -Filter "api" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules' }
foreach ($apiDir in $appApiDirs) {
    Get-ChildItem $apiDir.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "route\.(ts|js)$|index\.(ts|js)$|\[" } |
        ForEach-Object {
            $rel = Get-RelativePath $ProjectPath $_.FullName
            $methods = Select-String -Path $_.FullName -Pattern "export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)" -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Matches[0].Groups[2].Value } | Select-Object -Unique
            $apiRoutes.Add([ordered]@{ file=$rel; methods=($methods -join ","); type="Next.js API Route" }) | Out-Null
        }
}

# Express/Fastify/Koa routes
$routeFiles = Get-FilesByExtension $ProjectPath @(".js",".ts") |
    Where-Object { $_.Name -match "route|controller|handler|api" -and $_.Name -notmatch "test|spec" }
foreach ($rf in $routeFiles) {
    $content = Get-Content $rf.FullName -Raw -ErrorAction SilentlyContinue
    $routeMatches = [regex]::Matches($content, '(?:router|app|server)\.(get|post|put|delete|patch)\s*\(\s*[''"`]([^''"`]+)[''"`]')
    foreach ($m in $routeMatches) {
        $apiRoutes.Add([ordered]@{
            file    = Get-RelativePath $ProjectPath $rf.FullName
            method  = $m.Groups[1].Value.ToUpper()
            route   = $m.Groups[2].Value
            type    = "Express/REST"
        }) | Out-Null
    }
}

$data["apiRoutes"] = $apiRoutes
Write-OK "Found $($apiRoutes.Count) API routes/endpoints"

# ═══════════════════════════════════════════════
#  7. DATABASE SCHEMA & MODELS
# ═══════════════════════════════════════════════
Write-Step "Extracting database schema and models..."

$dbInfo = [ordered]@{ type = @(); models = @(); schemas = @(); migrations = @() }

# Prisma schema
$prismaSchema = Get-ChildItem $ProjectPath -Recurse -Filter "schema.prisma" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($prismaSchema) {
    $pContent = Get-Content $prismaSchema.FullName -Raw
    $dbMatches = [regex]::Matches($pContent, 'provider\s*=\s*"([^"]+)"')
    foreach ($m in $dbMatches) { $dbInfo.type += $m.Groups[1].Value }
    $modelMatches = [regex]::Matches($pContent, 'model\s+(\w+)\s*\{([^}]+)\}')
    foreach ($m in $modelMatches) {
        $fields = [regex]::Matches($m.Groups[2].Value, '(\w+)\s+(\w+)') |
            ForEach-Object { "$($_.Groups[1].Value): $($_.Groups[2].Value)" }
        $dbInfo.models += [ordered]@{ name=$m.Groups[1].Value; fields=($fields -join ", ") }
    }
    $dbInfo.schemas += Get-RelativePath $ProjectPath $prismaSchema.FullName
}

# TypeORM / Mongoose
$modelFiles = Get-FilesByExtension $ProjectPath @(".ts",".js") |
    Where-Object { $_.Name -match "model|entity|schema" -and $_.Name -notmatch "test|spec" } |
    Select-Object -First 30
foreach ($mf in $modelFiles) {
    $c = Get-Content $mf.FullName -Raw -ErrorAction SilentlyContinue
    if ($c -match "@Entity|@Schema|mongoose\.Schema|new Schema") {
        $dbInfo.models += [ordered]@{ name=$mf.BaseName; file=Get-RelativePath $ProjectPath $mf.FullName; type="ORM Model" }
    }
}

# SQL files
$sqlFiles = Get-FilesByExtension $ProjectPath @(".sql") | Select-Object -First 20
foreach ($sf in $sqlFiles) {
    $c = Get-Content $sf.FullName -Raw -ErrorAction SilentlyContinue
    $tables = [regex]::Matches($c, 'CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?[`"\[]?(\w+)[`"\]]?') |
        ForEach-Object { $_.Groups[1].Value }
    if ($tables) { $dbInfo.schemas += "$($sf.Name): Tables=[$($tables -join ', ')]" }
}

# Migration files
$migrationDirs = Get-ChildItem $ProjectPath -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "migration" -and $_.FullName -notmatch 'node_modules' }
foreach ($md in $migrationDirs) {
    $count = (Get-ChildItem $md.FullName -File -ErrorAction SilentlyContinue).Count
    $dbInfo.migrations += "$($md.Name): $count migration files"
}

# Detect DB from env keys
foreach ($k in $envConfig.envKeys) {
    if ($k -match "MONGO|MONGODB")    { $dbInfo.type += "MongoDB" }
    if ($k -match "POSTGRES|PG_")     { $dbInfo.type += "PostgreSQL" }
    if ($k -match "MYSQL")            { $dbInfo.type += "MySQL" }
    if ($k -match "REDIS")            { $dbInfo.type += "Redis" }
    if ($k -match "SQLITE")           { $dbInfo.type += "SQLite" }
    if ($k -match "SUPABASE")         { $dbInfo.type += "Supabase (PostgreSQL)" }
    if ($k -match "DYNAMO|DYNAMODB")  { $dbInfo.type += "DynamoDB" }
}
$dbInfo.type = $dbInfo.type | Select-Object -Unique

$data["database"] = $dbInfo
Write-OK "Database: $($dbInfo.type -join ', ') | Models: $($dbInfo.models.Count)"

# ═══════════════════════════════════════════════
#  8. ARCHITECTURE PATTERNS
# ═══════════════════════════════════════════════
Write-Step "Identifying architecture patterns..."

$patterns = [System.Collections.Generic.List[string]]::new()

$allSrcFiles = Get-FilesByExtension $ProjectPath @(".ts",".tsx",".js",".jsx",".cs",".py") | Select-Object -First 200
$combinedContent = ($allSrcFiles | ForEach-Object { Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue }) -join "`n"

$patternChecks = @{
    "MVC (Model-View-Controller)"   = '\\(models?|views?|controllers?)\\|\b(Controller|ViewController)\b'
    "Repository Pattern"            = '\b(Repository|IRepository|BaseRepository)\b'
    "Service Layer Pattern"         = '\b(Service|IService|BaseService)\b.*\{|class \w+Service'
    "Factory Pattern"               = '\b(Factory|createInstance|getInstance)\b'
    "Singleton Pattern"             = '\bgetInstance\(\)|private static \w+ instance'
    "Observer/Event-Driven"         = '\b(EventEmitter|on\(|emit\(|subscribe\(|addEventListener)\b'
    "Middleware Pattern"            = '\bmiddleware\b|\buse\(.*=>\s*\{|\bapp\.use\b'
    "Dependency Injection"          = '\b(@Injectable|@Inject|inject\(|container\.resolve)\b'
    "CQRS Pattern"                  = '\b(Command|CommandHandler|QueryHandler|Dispatcher)\b'
    "GraphQL API"                   = '\b(typeDefs|resolvers|gql`|GraphQLSchema)\b'
    "REST API"                      = '\b(router\.(get|post|put|delete)|app\.(get|post))\b'
    "Microservices"                 = '\b(microservice|ServiceBus|MessageQueue|RabbitMQ|Kafka)\b'
    "Clean Architecture"            = '\\(domain|application|infrastructure|presentation)\\'
    "Hexagonal Architecture"        = '\b(port|adapter|driven|driving)\b'
    "React Component Pattern"       = 'export\s+(default\s+)?function\s+\w+\s*\(\s*\{|React\.FC'
    "Custom Hooks (React)"          = 'export\s+(function\s+|const\s+)use[A-Z]\w+'
    "Context API (React)"           = '\bReact\.createContext\b|createContext\('
    "SSR/SSG (Next.js)"            = '\b(getServerSideProps|getStaticProps|getStaticPaths)\b'
    "Server Actions (Next.js)"      = "'use server'"
    "Server Components (Next.js)"   = "'use client'"
    "Job/Queue Processing"          = '\b(Queue|Worker|Bull|BullMQ|agenda|cron)\b'
    "JWT Authentication"            = '\bjwt\b|jsonwebtoken|verify.*token'
    "OAuth/Social Auth"             = '\b(passport|oauth|nextauth|clerk|auth0)\b'
    "File Upload Handling"          = '\b(multer|formidable|busboy|sharp|upload)\b'
    "WebSocket/Real-time"           = '\b(socket\.io|WebSocket|ws\b|real-?time)\b'
    "Email Service"                 = '\b(nodemailer|sendgrid|resend|mailgun|ses)\b'
    "Payment Integration"           = '\b(stripe|paypal|braintree|razorpay)\b'
    "Search (Elasticsearch/Algolia)"= '\b(elasticsearch|algolia|meilisearch)\b'
    "Rate Limiting"                 = '\b(rateLimit|rate-limit|throttle|express-rate-limit)\b'
    "Caching Strategy"              = '\b(cache|redis\.get|redis\.set|memcached|node-cache)\b'
    "Logging System"                = '\b(winston|pino|morgan|log4j|console\.log)\b'
    "Testing (Unit/Integration)"    = '\b(describe|it\(|test\(|expect\(|beforeEach|afterEach)\b'
    "Error Boundary (React)"        = '\b(ErrorBoundary|componentDidCatch)\b'
    "Type Safety (Zod/Yup)"        = '\bz\.(object|string|number)|yup\.object\b'
    "Monorepo"                      = '\b(workspaces|turborepo|nx|lerna)\b'
    "ORM Usage"                     = '\b(prisma|sequelize|typeorm|mongoose|drizzle)\b'
    "Multi-tenancy"                 = '\b(tenant|organization|workspace|multi-tenant)\b'
    "Role-Based Access Control"     = '\b(RBAC|role|permission|authorize|can\()\b'
    "Serverless Functions"          = '\b(lambda|serverless|edge function|vercel function)\b'
    "API Gateway Pattern"           = '\b(gateway|proxy|api-gateway|kong|nginx)\b'
    "Feature Flags"                 = '\b(featureFlag|feature-flag|launchDarkly|unleash)\b'
    "Internationalization (i18n)"   = '\b(i18n|next-intl|react-intl|useTranslation)\b'
}

foreach ($pattern in $patternChecks.Keys) {
    if ($combinedContent -match $patternChecks[$pattern]) {
        $patterns.Add($pattern) | Out-Null
    }
}

$data["architecturePatterns"] = $patterns | Sort-Object
Write-OK "Detected $($patterns.Count) architecture patterns"

# ═══════════════════════════════════════════════
#  9. COMPONENT & MODULE ANALYSIS
# ═══════════════════════════════════════════════
Write-Step "Analyzing components and modules..."

$components = [ordered]@{
    reactComponents = @()
    pages           = @()
    hooks           = @()
    utilities       = @()
    services        = @()
    middleware      = @()
    contexts        = @()
    types           = @()
}

$srcFiles = Get-FilesByExtension $ProjectPath @(".ts",".tsx",".js",".jsx") | Select-Object -First 500

foreach ($file in $srcFiles) {
    $rel  = Get-RelativePath $ProjectPath $file.FullName
    $name = $file.BaseName

    if ($rel -match "\\(pages|app)\\.*\.(tsx?|jsx?)$" -and $name -notmatch "layout|loading|error|not-found|_app|_document") {
        $components.pages += $rel
    } elseif ($name -match "^use[A-Z]") {
        $components.hooks += $rel
    } elseif ($rel -match "\\(util|helper|lib)\\") {
        $components.utilities += $rel
    } elseif ($rel -match "\\service") {
        $components.services += $rel
    } elseif ($rel -match "\\middleware") {
        $components.middleware += $rel
    } elseif ($rel -match "\\(context|provider)") {
        $components.contexts += $rel
    } elseif ($rel -match "\\(type|interface|dto)\\" -or $name -match "\.(types|interfaces|dto)$") {
        $components.types += $rel
    } elseif ($file.Extension -in @(".tsx",".jsx") -or ($file.Extension -in @(".ts",".js") -and
              (Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue) -match "export\s+(default\s+)?function\s+[A-Z]|React\.FC")) {
        $components.reactComponents += $rel
    }
}

# Trim lists
foreach ($k in $components.Keys) {
    $components[$k] = $components[$k] | Select-Object -First 50
}

$data["components"] = $components
Write-OK "Pages: $($components.pages.Count) | Components: $($components.reactComponents.Count) | Hooks: $($components.hooks.Count)"

# ═══════════════════════════════════════════════
#  10. AUTHENTICATION & SECURITY
# ═══════════════════════════════════════════════
Write-Step "Scanning authentication & security..."

$security = [ordered]@{
    authMechanisms = @()
    securityHeaders = @()
    cors = $false
    helmet = $false
    rateLimit = $false
    envSecrets = @()
}

if ($combinedContent -match "NextAuth|next-auth")       { $security.authMechanisms += "NextAuth.js" }
if ($combinedContent -match "clerk|@clerk")             { $security.authMechanisms += "Clerk" }
if ($combinedContent -match "passport")                 { $security.authMechanisms += "Passport.js" }
if ($combinedContent -match "jwt|jsonwebtoken")         { $security.authMechanisms += "JWT" }
if ($combinedContent -match "bcrypt|argon2|crypto")     { $security.authMechanisms += "Password Hashing" }
if ($combinedContent -match "oauth|OAuth")              { $security.authMechanisms += "OAuth" }
if ($combinedContent -match "session|express-session")  { $security.authMechanisms += "Session-based Auth" }
if ($combinedContent -match "cookie|cookie-parser")     { $security.authMechanisms += "Cookie Auth" }
if ($combinedContent -match "helmet")                   { $security.helmet = $true }
if ($combinedContent -match "cors\(|enableCors")        { $security.cors = $true }
if ($combinedContent -match "rateLimit|rate-limit")     { $security.rateLimit = $true }

$secretKeys = $envConfig.envKeys | Where-Object { $_ -match "SECRET|KEY|TOKEN|PASSWORD|PRIVATE|API_KEY|CLIENT_SECRET" }
$security.envSecrets = $secretKeys | ForEach-Object { "$_ (⚠ keep private)" }

$data["security"] = $security
Write-OK "Auth: $($security.authMechanisms -join ', ')"

# ═══════════════════════════════════════════════
#  11. PERFORMANCE & OPTIMIZATION
# ═══════════════════════════════════════════════
Write-Step "Checking performance optimizations..."

$perf = [ordered]@{ optimizations = @(); bundler = ""; imageOptimization = $false; lazyLoading = $false; caching = @() }

if ($combinedContent -match "dynamic\(|React\.lazy")         { $perf.lazyLoading = $true; $perf.optimizations += "Lazy Loading" }
if ($combinedContent -match "next/image|<Image")              { $perf.imageOptimization = $true; $perf.optimizations += "Next.js Image Optimization" }
if ($combinedContent -match "useMemo|useCallback")            { $perf.optimizations += "React Memoization (useMemo/useCallback)" }
if ($combinedContent -match "React\.memo|memo\(")             { $perf.optimizations += "React.memo" }
if ($combinedContent -match "ISR|revalidate\s*:|\bISR\b")     { $perf.optimizations += "ISR (Incremental Static Regeneration)" }
if ($combinedContent -match "getStaticProps")                 { $perf.optimizations += "Static Site Generation (SSG)" }
if ($combinedContent -match "getServerSideProps")             { $perf.optimizations += "Server-Side Rendering (SSR)" }
if ($combinedContent -match "redis|ioredis")                  { $perf.caching += "Redis" }
if ($combinedContent -match "node-cache|lru-cache")           { $perf.caching += "In-Memory Cache" }
if ($combinedContent -match "CDN|cloudfront|cloudflare")      { $perf.caching += "CDN" }
if ($combinedContent -match "compression\(|gzip|brotli")      { $perf.optimizations += "Response Compression" }
if ($combinedContent -match "turbopack|webpack|vite|rollup")  {
    if ($combinedContent -match "turbopack") { $perf.bundler = "Turbopack" }
    elseif ($combinedContent -match "vite")  { $perf.bundler = "Vite" }
    elseif ($combinedContent -match "webpack"){ $perf.bundler = "Webpack" }
    else                                      { $perf.bundler = "Rollup" }
}

$data["performance"] = $perf
Write-OK "Optimizations: $($perf.optimizations.Count) detected"

# ═══════════════════════════════════════════════
#  12. TESTING COVERAGE
# ═══════════════════════════════════════════════
Write-Step "Analyzing test coverage..."

$testInfo = [ordered]@{ testFiles = @(); frameworks = @(); coverageConfig = $false; totalTests = 0 }

$testFiles = Get-FilesByExtension $ProjectPath @(".ts",".tsx",".js",".jsx") |
    Where-Object { $_.Name -match "\.(test|spec)\." -or $_.Directory.Name -match "^(__tests__|tests|test|e2e)$" }

$testInfo.testFiles = ($testFiles | Select-Object -First 30 | ForEach-Object { Get-RelativePath $ProjectPath $_.FullName })
$testInfo.totalTests = $testFiles.Count

foreach ($tf in ($testFiles | Select-Object -First 50)) {
    $c = Get-Content $tf.FullName -Raw -ErrorAction SilentlyContinue
    if ($c -match "describe|it\(|test\(") { if ("Jest/Vitest" -notin $testInfo.frameworks) { $testInfo.frameworks += "Jest/Vitest" } }
    if ($c -match "cy\.|Cypress")         { if ("Cypress" -notin $testInfo.frameworks) { $testInfo.frameworks += "Cypress" } }
    if ($c -match "page\.|playwright")    { if ("Playwright" -notin $testInfo.frameworks) { $testInfo.frameworks += "Playwright" } }
}

$testInfo.coverageConfig = (Test-Path (Join-Path $ProjectPath "jest.config.*")) -or
                            (Test-Path (Join-Path $ProjectPath "vitest.config.*"))

$data["testing"] = $testInfo
Write-OK "Test files: $($testInfo.totalTests)"

# ═══════════════════════════════════════════════
#  13. DEPLOYMENT & INFRASTRUCTURE
# ═══════════════════════════════════════════════
Write-Step "Checking deployment configuration..."

$deploy = [ordered]@{ platform = @(); docker = @(); cicd = @(); cloud = @(); ports = @() }

if (Test-Path (Join-Path $ProjectPath "vercel.json"))     { $deploy.platform += "Vercel" }
if (Test-Path (Join-Path $ProjectPath "netlify.toml"))    { $deploy.platform += "Netlify" }
if (Test-Path (Join-Path $ProjectPath "fly.toml"))        { $deploy.platform += "Fly.io" }
if (Test-Path (Join-Path $ProjectPath "render.yaml"))     { $deploy.platform += "Render" }
if (Test-Path (Join-Path $ProjectPath "Procfile"))        { $deploy.platform += "Heroku" }
if (Test-Path (Join-Path $ProjectPath ".platform"))       { $deploy.platform += "AWS Elastic Beanstalk" }

$dockerFile = Join-Path $ProjectPath "Dockerfile"
if (Test-Path $dockerFile) {
    $dc = Get-Content $dockerFile -Raw
    $baseImage = [regex]::Match($dc, 'FROM\s+(\S+)').Groups[1].Value
    $expose    = [regex]::Matches($dc, 'EXPOSE\s+(\d+)') | ForEach-Object { $_.Groups[1].Value }
    $deploy.docker = [ordered]@{ baseImage=$baseImage; exposedPorts=($expose -join ",") }
}

$composeFile = Get-ChildItem $ProjectPath -Filter "docker-compose*" | Select-Object -First 1
if ($composeFile) {
    $yContent = Get-Content $composeFile.FullName -Raw
    $ports = [regex]::Matches($yContent, '"(\d+):(\d+)"') | ForEach-Object { $_.Groups[1].Value }
    $deploy.ports = $ports | Select-Object -Unique
}

if (Test-Path (Join-Path $ProjectPath ".github\workflows")) {
    $workflows = Get-ChildItem (Join-Path $ProjectPath ".github\workflows") -File
    $deploy.cicd = $workflows | ForEach-Object { $_.Name }
}

foreach ($k in $envConfig.envKeys) {
    if ($k -match "AWS_")      { if ("AWS" -notin $deploy.cloud) { $deploy.cloud += "AWS" } }
    if ($k -match "GCP_|GOOGLE_CLOUD") { if ("Google Cloud" -notin $deploy.cloud) { $deploy.cloud += "Google Cloud" } }
    if ($k -match "AZURE_")    { if ("Azure" -notin $deploy.cloud) { $deploy.cloud += "Azure" } }
    if ($k -match "VERCEL_")   { if ("Vercel" -notin $deploy.platform) { $deploy.platform += "Vercel" } }
    if ($k -match "SUPABASE_") { if ("Supabase" -notin $deploy.cloud) { $deploy.cloud += "Supabase" } }
}

$data["deployment"] = $deploy
Write-OK "Platforms: $($deploy.platform -join ', ')"

# ═══════════════════════════════════════════════
#  14. CODE METRICS
# ═══════════════════════════════════════════════
Write-Step "Computing code metrics..."

$metrics = [ordered]@{
    totalLinesOfCode      = 0
    byLanguage            = @{}
    largestFiles          = @()
    mostComplexFiles      = @()
    averageFileSizeLines  = 0
}

$codeExts = @(".ts",".tsx",".js",".jsx",".py",".cs",".java",".go",".rb",".php",".sql",".css",".scss")
$codeFiles = Get-FilesByExtension $ProjectPath $codeExts

$fileSizes = [System.Collections.Generic.List[object]]::new()
foreach ($cf in $codeFiles) {
    $lines = 0
    try { $lines = (Get-Content $cf.FullName -ErrorAction SilentlyContinue).Count } catch {}
    $metrics.totalLinesOfCode += $lines
    $ext = $cf.Extension.ToLower()
    if (-not $metrics.byLanguage.ContainsKey($ext)) { $metrics.byLanguage[$ext] = 0 }
    $metrics.byLanguage[$ext] += $lines
    $fileSizes.Add([pscustomobject]@{ file=Get-RelativePath $ProjectPath $cf.FullName; lines=$lines }) | Out-Null
}

$metrics.largestFiles   = ($fileSizes | Sort-Object lines -Descending | Select-Object -First 10 |
    ForEach-Object { "$($_.file) ($($_.lines) lines)" })
$metrics.averageFileSizeLines = if ($codeFiles.Count -gt 0) { [math]::Round($metrics.totalLinesOfCode/$codeFiles.Count,0) } else { 0 }

$byLangFormatted = [ordered]@{}
foreach ($k in ($metrics.byLanguage.Keys | Sort-Object)) { $byLangFormatted[$k] = $metrics.byLanguage[$k] }
$metrics.byLanguage = $byLangFormatted

$data["codeMetrics"] = $metrics
Write-OK "Total LOC: $($metrics.totalLinesOfCode.ToString('N0')) across $($codeFiles.Count) code files"

# ═══════════════════════════════════════════════
#  15. EXTERNAL INTEGRATIONS
# ═══════════════════════════════════════════════
Write-Step "Detecting external integrations..."

$integrations = [System.Collections.Generic.List[string]]::new()

$integrationMap = @{
    "stripe"=>"Stripe (Payments)"; "paypal"=>"PayPal (Payments)"; "razorpay"=>"Razorpay (Payments)"
    "twilio"=>"Twilio (SMS/Voice)"; "sendgrid"=>"SendGrid (Email)"; "mailgun"=>"Mailgun (Email)"
    "nodemailer"=>"Nodemailer (Email)"; "resend"=>"Resend (Email)"
    "aws-sdk|@aws-sdk"=>"Amazon Web Services"; "firebase"=>"Firebase (Google)"
    "supabase"=>"Supabase"; "cloudinary"=>"Cloudinary (Media)"
    "algolia"=>"Algolia (Search)"; "elasticsearch"=>"Elasticsearch"
    "google-maps|@googlemaps"=>"Google Maps API"; "mapbox"=>"Mapbox"
    "pusher"=>"Pusher (Real-time)"; "socket\.io"=>"Socket.IO (Real-time)"
    "openai"=>"OpenAI"; "anthropic"=>"Anthropic AI"; "langchain"=>"LangChain"
    "sentry"=>"Sentry (Error Tracking)"; "datadog"=>"Datadog (Monitoring)"
    "mixpanel"=>"Mixpanel (Analytics)"; "segment"=>"Segment (Analytics)"
    "intercom"=>"Intercom (Support)"; "hubspot"=>"HubSpot (CRM)"
    "shopify"=>"Shopify"; "wordpress"=>"WordPress"; "contentful"=>"Contentful (CMS)"
    "sanity"=>"Sanity (CMS)"; "notion"=>"Notion API"; "slack"=>"Slack API"
    "github"=>"GitHub API"; "google-auth"=>"Google OAuth"; "facebook"=>"Facebook/Meta API"
    "apple"=>"Apple Sign In"; "recaptcha"=>"Google reCAPTCHA"; "hcaptcha"=>"hCaptcha"
}

foreach ($key in $integrationMap.Keys) {
    if ($combinedContent -match $key) { $integrations.Add($integrationMap[$key]) | Out-Null }
}
foreach ($dep in ($deps.production + $deps.development)) {
    foreach ($key in $integrationMap.Keys) {
        if ($dep -match $key -and $integrationMap[$key] -notin $integrations) {
            $integrations.Add($integrationMap[$key]) | Out-Null
        }
    }
}

$data["integrations"] = ($integrations | Select-Object -Unique | Sort-Object)
Write-OK "External integrations: $($data['integrations'].Count)"

# ═══════════════════════════════════════════════
#  16. SCRIPTS & COMMANDS
# ═══════════════════════════════════════════════
$data["scripts"] = [ordered]@{}
if ($pkgJson -and $pkgJson.scripts) {
    $pkgJson.scripts.PSObject.Properties | ForEach-Object {
        $data["scripts"][$_.Name] = $_.Value
    }
}

# ═══════════════════════════════════════════════
#  SAVE OUTPUTS
# ═══════════════════════════════════════════════
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
Write-Host "  GENERATING REPORTS..." -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Magenta

# ── JSON ──────────────────────────────────────
if ($OutputFormat -in @("JSON","ALL")) {
    $jsonPath = "$reportBase.json"
    $data | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8
    Write-OK "JSON → $jsonPath"
}

# ── TXT ───────────────────────────────────────
if ($OutputFormat -in @("TXT","ALL")) {
    $txtPath = "$reportBase.txt"
    $sb = [System.Text.StringBuilder]::new()
    $line = "=" * 80
    $sb.AppendLine($line) | Out-Null
    $sb.AppendLine("  PROJECT ARCHITECTURE REPORT: $($data.overview.projectName)") | Out-Null
    $sb.AppendLine("  Generated: $($data.overview.analysisDate)") | Out-Null
    $sb.AppendLine($line) | Out-Null

    function Add-Section($title, $content) {
        $sb.AppendLine("`n$("-"*60)") | Out-Null
        $sb.AppendLine("  $title") | Out-Null
        $sb.AppendLine("-"*60) | Out-Null
        $sb.AppendLine($content) | Out-Null
    }

    Add-Section "OVERVIEW" (
        "  Project  : $($data.overview.projectName)`n" +
        "  Files    : $($data.overview.totalFiles)`n" +
        "  Size     : $($data.overview.totalSizeMB) MB`n" +
        "  Top Ext  : $($data.overview.fileExtensions)`n" +
        "  Folders  : $($data.overview.topFolders)"
    )
    Add-Section "TECH STACK" (
        "  Languages   : $($data.techStack.languages -join ', ')`n" +
        "  Frameworks  : $($data.techStack.frameworks -join ', ')`n" +
        "  Databases   : $($data.database.type -join ', ')`n" +
        "  Pkg Manager : $($data.techStack.packageManagers -join ', ')`n" +
        "  Containers  : $($data.techStack.containerization -join ', ')`n" +
        "  CI/CD       : $($data.techStack.ciCd -join ', ')`n" +
        "  Testing     : $($data.techStack.testingTools -join ', ')"
    )
    Add-Section "ARCHITECTURE PATTERNS" ($data.architecturePatterns | ForEach-Object { "  ✓ $_" } | Out-String)
    Add-Section "PROJECT STRUCTURE" $data.projectStructure.tree
    Add-Section "API ROUTES ($($data.apiRoutes.Count))" (
        $data.apiRoutes | Select-Object -First 40 | ForEach-Object {
            "  [$($_.method ?? $_.methods ?? '?')] $($_.route ?? $_.file)"
        } | Out-String
    )
    Add-Section "DATABASE" (
        "  Type: $($data.database.type -join ', ')`n" +
        "  Models ($($data.database.models.Count)):`n" +
        ($data.database.models | Select-Object -First 20 | ForEach-Object { "    • $($_.name)" } | Out-String)
    )
    Add-Section "SECURITY & AUTH" (
        "  Auth: $($data.security.authMechanisms -join ', ')`n" +
        "  Helmet: $($data.security.helmet) | CORS: $($data.security.cors) | Rate Limit: $($data.security.rateLimit)`n" +
        "  Secret Env Keys: $($data.security.envSecrets.Count)"
    )
    Add-Section "EXTERNAL INTEGRATIONS" ($data.integrations | ForEach-Object { "  • $_" } | Out-String)
    Add-Section "CODE METRICS" (
        "  Total LOC : $($data.codeMetrics.totalLinesOfCode.ToString('N0'))`n" +
        "  Avg File  : $($data.codeMetrics.averageFileSizeLines) lines`n" +
        "  Largest Files:`n" +
        ($data.codeMetrics.largestFiles | ForEach-Object { "    $_ " } | Out-String)
    )
    Add-Section "DEPLOYMENT" (
        "  Platform : $($data.deployment.platform -join ', ')`n" +
        "  Cloud    : $($data.deployment.cloud -join ', ')`n" +
        "  Ports    : $($data.deployment.ports -join ', ')"
    )
    Add-Section "NPM SCRIPTS" ($data.scripts.Keys | ForEach-Object { "  $($_): $($data.scripts[$_])" } | Out-String)

    $sb.ToString() | Set-Content $txtPath -Encoding UTF8
    Write-OK "TXT  → $txtPath"
}

# ── HTML ──────────────────────────────────────
if ($OutputFormat -in @("HTML","ALL")) {
    $htmlPath = "$reportBase.html"
    $techBadges  = ($data.techStack.frameworks | Select-Object -Unique | ForEach-Object { "<span class='badge fw'>$_</span>" }) -join ""
    $langBadges  = ($data.techStack.languages  | Select-Object -Unique | ForEach-Object { "<span class='badge lang'>$_</span>" }) -join ""
    $dbBadges    = ($data.database.type        | Select-Object -Unique | ForEach-Object { "<span class='badge db'>$_</span>" }) -join ""
    $patternHtml = ($data.architecturePatterns | ForEach-Object { "<li><span class='tick'>✓</span> $_</li>" }) -join ""
    $routeHtml   = ($data.apiRoutes | Select-Object -First 60 | ForEach-Object {
        $m = if ($_.method) { $_.method } elseif ($_.methods) { $_.methods } else { "?" }
        $r = if ($_.route)  { $_.route  } elseif ($_.file)    { $_.file   } else { "-" }
        $c = switch ($m.ToUpper()) { "GET" {"get"} "POST" {"post"} "PUT" {"put"} "DELETE" {"del"} "PATCH" {"patch"} default {"get"} }
        "<tr><td><span class='method $c'>$m</span></td><td class='mono'>$r</td><td>$($_.type ?? 'API')</td></tr>"
    }) -join ""
    $modelHtml   = ($data.database.models | Select-Object -First 20 | ForEach-Object {
        "<tr><td class='mono'>$($_.name)</td><td>$($_.type ?? 'Model')</td><td class='mono small'>$($_.fields ?? '')</td></tr>"
    }) -join ""
    $intHtml     = ($data.integrations | ForEach-Object { "<span class='badge int'>$_</span>" }) -join ""
    $envHtml     = ($data.environment.envKeys | ForEach-Object { "<code>$_</code>" }) -join " "
    $perfHtml    = ($data.performance.optimizations | ForEach-Object { "<li>$_</li>" }) -join ""
    $scriptHtml  = ($data.scripts.Keys | ForEach-Object { "<tr><td class='mono key'>$_</td><td class='mono'>$($data.scripts[$_])</td></tr>" }) -join ""
    $structHtml  = $data.projectStructure.tree -replace "<","&lt;" -replace ">","&gt;"
    $largestHtml = ($data.codeMetrics.largestFiles | ForEach-Object { "<li class='mono small'>$_</li>" }) -join ""
    $depHtml     = ($data.dependencies.production | Select-Object -First 30 | ForEach-Object { "<span class='badge dep'>$_</span>" }) -join ""
    $devDepHtml  = ($data.dependencies.development | Select-Object -First 30 | ForEach-Object { "<span class='badge devdep'>$_</span>" }) -join ""

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Architecture Report – $($data.overview.projectName)</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#58a6ff;--green:#3fb950;--orange:#d29922;--red:#f85149;--purple:#bc8cff;--cyan:#39d353;--yellow:#e3b341}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;font-size:14px}
  header{background:linear-gradient(135deg,#1a1f35 0%,#0d1117 100%);border-bottom:1px solid var(--border);padding:32px 40px;display:flex;align-items:center;gap:20px}
  header .icon{font-size:40px}
  header h1{font-size:24px;font-weight:700;color:#fff}
  header p{color:var(--muted);font-size:13px;margin-top:4px}
  .container{max-width:1400px;margin:0 auto;padding:24px 40px}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px}
  .stat-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;text-align:center}
  .stat-card .num{font-size:28px;font-weight:700;color:var(--blue)}
  .stat-card .lbl{font-size:12px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px}
  @media(max-width:900px){.grid2,.grid3{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:16px}
  .card h2{font-size:15px;font-weight:600;color:var(--blue);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;margin:2px;font-weight:500}
  .badge.fw   {background:#1a3a5c;color:#58a6ff;border:1px solid #2a5a8c}
  .badge.lang {background:#1a3d1a;color:#3fb950;border:1px solid #2a6a2a}
  .badge.db   {background:#3d2a1a;color:#d29922;border:1px solid #6a4a2a}
  .badge.int  {background:#2a1a3d;color:#bc8cff;border:1px solid #4a2a6a}
  .badge.dep  {background:#162032;color:#79c0ff;border:1px solid #264266}
  .badge.devdep{background:#1a2416;color:#56d364;border:1px solid #2d5022}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#1c2128;color:var(--muted);text-align:left;padding:8px 12px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
  td{padding:8px 12px;border-bottom:1px solid #1c2128;vertical-align:top}
  tr:hover td{background:#1c2128}
  .method{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace}
  .method.get   {background:#1a3d1a;color:#3fb950}
  .method.post  {background:#1a3a5c;color:#58a6ff}
  .method.put   {background:#3d2a00;color:#d29922}
  .method.del   {background:#3d1a1a;color:#f85149}
  .method.patch {background:#2a1a3d;color:#bc8cff}
  .mono{font-family:'Courier New',monospace;font-size:12px}
  .small{font-size:11px}
  .key{color:var(--yellow)}
  .tick{color:var(--green);margin-right:6px}
  ul.patterns{list-style:none;columns:2;gap:16px}
  ul.patterns li{padding:4px 0;font-size:13px;break-inside:avoid}
  pre.tree{background:#0a0e14;border:1px solid var(--border);border-radius:6px;padding:16px;font-family:'Courier New',monospace;font-size:11px;overflow-x:auto;white-space:pre;line-height:1.5;color:#adbac7;max-height:400px;overflow-y:auto}
  code{background:#1c2128;padding:2px 6px;border-radius:3px;font-family:monospace;font-size:12px;color:var(--cyan)}
  .env-keys{display:flex;flex-wrap:wrap;gap:6px}
  .section-title{font-size:18px;font-weight:700;color:#fff;margin:28px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .perf ul,.db-list ul{list-style:none}
  .perf ul li,.db-list ul li{padding:3px 0;font-size:13px}
  .perf ul li::before,.db-list ul li::before{content:"⚡ ";color:var(--yellow)}
  footer{text-align:center;color:var(--muted);font-size:12px;padding:24px;border-top:1px solid var(--border);margin-top:32px}
</style>
</head>
<body>
<header>
  <div class="icon">🏗️</div>
  <div>
    <h1>$($data.overview.projectName)</h1>
    <p>Architecture & Technical Report &nbsp;•&nbsp; Generated $($data.overview.analysisDate)</p>
  </div>
</header>
<div class="container">

  <!-- STATS -->
  <div class="stats-grid">
    <div class="stat-card"><div class="num">$($data.overview.totalFiles.ToString('N0'))</div><div class="lbl">Total Files</div></div>
    <div class="stat-card"><div class="num">$($data.overview.totalSizeMB)</div><div class="lbl">Size (MB)</div></div>
    <div class="stat-card"><div class="num">$($data.codeMetrics.totalLinesOfCode.ToString('N0'))</div><div class="lbl">Lines of Code</div></div>
    <div class="stat-card"><div class="num">$($data.apiRoutes.Count)</div><div class="lbl">API Routes</div></div>
    <div class="stat-card"><div class="num">$($data.database.models.Count)</div><div class="lbl">DB Models</div></div>
    <div class="stat-card"><div class="num">$($data.testing.totalTests)</div><div class="lbl">Test Files</div></div>
    <div class="stat-card"><div class="num">$($data.architecturePatterns.Count)</div><div class="lbl">Patterns</div></div>
    <div class="stat-card"><div class="num">$($data.integrations.Count)</div><div class="lbl">Integrations</div></div>
  </div>

  <!-- TECH STACK -->
  <div class="section-title">⚙️ Technology Stack</div>
  <div class="grid3">
    <div class="card"><h2>🧑‍💻 Languages</h2>$langBadges</div>
    <div class="card"><h2>🚀 Frameworks & Libraries</h2>$techBadges</div>
    <div class="card"><h2>🗄️ Databases</h2>$dbBadges</div>
  </div>

  <!-- ARCHITECTURE PATTERNS -->
  <div class="section-title">🏛️ Architecture Patterns</div>
  <div class="card">
    <ul class="patterns">$patternHtml</ul>
  </div>

  <!-- PROJECT STRUCTURE -->
  <div class="section-title">📁 Project Structure</div>
  <div class="card"><pre class="tree">$structHtml</pre></div>

  <!-- API ROUTES & DB -->
  <div class="section-title">🔌 API & Database</div>
  <div class="grid2">
    <div class="card">
      <h2>📡 API Routes / Endpoints</h2>
      <table><thead><tr><th>Method</th><th>Route / File</th><th>Type</th></tr></thead><tbody>$routeHtml</tbody></table>
    </div>
    <div class="card">
      <h2>🗄️ Database Models</h2>
      <table><thead><tr><th>Model</th><th>Type</th><th>Fields (sample)</th></tr></thead><tbody>$modelHtml</tbody></table>
    </div>
  </div>

  <!-- SECURITY & PERFORMANCE -->
  <div class="section-title">🔒 Security & Performance</div>
  <div class="grid2">
    <div class="card">
      <h2>🛡️ Security</h2>
      <p><strong>Auth:</strong> $($data.security.authMechanisms -join ', ')</p>
      <p style="margin-top:8px"><strong>Helmet:</strong> $($data.security.helmet) &nbsp; <strong>CORS:</strong> $($data.security.cors) &nbsp; <strong>Rate Limit:</strong> $($data.security.rateLimit)</p>
      <p style="margin-top:8px"><strong>Secret Keys ($($data.security.envSecrets.Count)):</strong></p>
      <div style="margin-top:6px">$($data.security.envSecrets | Select-Object -First 10 | ForEach-Object { "<code>$_</code> " })</div>
    </div>
    <div class="perf card">
      <h2>⚡ Performance Optimizations</h2>
      <ul>$perfHtml</ul>
      $(if($data.performance.bundler){"<p style='margin-top:10px'><strong>Bundler:</strong> $($data.performance.bundler)</p>"})
      $(if($data.performance.caching){"<p style='margin-top:6px'><strong>Caching:</strong> $($data.performance.caching -join ', ')</p>"})
    </div>
  </div>

  <!-- ENVIRONMENT & INTEGRATIONS -->
  <div class="section-title">🌐 Environment & Integrations</div>
  <div class="grid2">
    <div class="card">
      <h2>🔑 Environment Keys ($($data.environment.envKeys.Count))</h2>
      <div class="env-keys">$envHtml</div>
    </div>
    <div class="card">
      <h2>🔗 External Integrations</h2>
      $intHtml
    </div>
  </div>

  <!-- DEPLOYMENT -->
  <div class="section-title">🚀 Deployment & Infrastructure</div>
  <div class="card">
    <table>
      <tr><th>Platform</th><td>$($data.deployment.platform -join ', ')</td></tr>
      <tr><th>Cloud</th><td>$($data.deployment.cloud -join ', ')</td></tr>
      <tr><th>Containerization</th><td>$($data.techStack.containerization -join ', ')</td></tr>
      <tr><th>CI/CD</th><td>$($data.deployment.cicd -join ', ')</td></tr>
      <tr><th>Exposed Ports</th><td>$($data.deployment.ports -join ', ')</td></tr>
      $(if($data.deployment.docker.baseImage){"<tr><th>Docker Base</th><td>$($data.deployment.docker.baseImage)</td></tr>"})
    </table>
  </div>

  <!-- DEPENDENCIES -->
  <div class="section-title">📦 Dependencies</div>
  <div class="grid2">
    <div class="card"><h2>🔵 Production ($($data.dependencies.production.Count))</h2>$depHtml</div>
    <div class="card"><h2>🟢 Development ($($data.dependencies.development.Count))</h2>$devDepHtml</div>
  </div>

  <!-- NPM SCRIPTS -->
  <div class="section-title">📜 Scripts & Commands</div>
  <div class="card">
    <table><thead><tr><th>Script</th><th>Command</th></tr></thead><tbody>$scriptHtml</tbody></table>
  </div>

  <!-- CODE METRICS -->
  <div class="section-title">📊 Code Metrics</div>
  <div class="grid2">
    <div class="card">
      <h2>📏 Lines by Language</h2>
      <table><thead><tr><th>Extension</th><th>Lines</th></tr></thead><tbody>
        $($data.codeMetrics.byLanguage.Keys | ForEach-Object { "<tr><td class='mono'>$_</td><td>$($data.codeMetrics.byLanguage[$_].ToString('N0'))</td></tr>" })
      </tbody></table>
    </div>
    <div class="card db-list">
      <h2>📄 Largest Files</h2>
      <ul>$largestHtml</ul>
    </div>
  </div>

</div>
<footer>Generated by Extract-ProjectArchitecture.ps1 &nbsp;•&nbsp; $($data.overview.analysisDate)</footer>
</body>
</html>
"@

    $html | Set-Content $htmlPath -Encoding UTF8
    Write-OK "HTML → $htmlPath"
}

# ─────────────────────────────────────────────
#  SUMMARY
# ─────────────────────────────────────────────
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  ✅  ANALYSIS COMPLETE" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Project    : $($data.overview.projectName)" -ForegroundColor White
Write-Host "  Files      : $($data.overview.totalFiles)" -ForegroundColor Gray
Write-Host "  LOC        : $($data.codeMetrics.totalLinesOfCode.ToString('N0'))" -ForegroundColor Gray
Write-Host "  Languages  : $($data.techStack.languages -join ', ')" -ForegroundColor Gray
Write-Host "  Frameworks : $($data.techStack.frameworks[0..4] -join ', ')..." -ForegroundColor Gray
Write-Host "  Patterns   : $($data.architecturePatterns.Count) detected" -ForegroundColor Gray
Write-Host "  API Routes : $($data.apiRoutes.Count)" -ForegroundColor Gray
Write-Host "  DB Models  : $($data.database.models.Count)" -ForegroundColor Gray
Write-Host "  Reports    : $reportBase.*" -ForegroundColor Cyan
Write-Host ""

# Open HTML automatically
if ($OutputFormat -in @("HTML","ALL")) {
    $openIt = Read-Host "  Open HTML report now? [Y/n]"
    if ($openIt -ne 'n') { Start-Process "$reportBase.html" }
}