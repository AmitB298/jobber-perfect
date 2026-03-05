# JOBBER Pro - Quick Start Guide

## 🎯 60-Second Setup

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env

# 3. Start development
npm run dev

# App will launch automatically!
```

## 🚀 What You Get

### ✅ Fully Integrated
- Trial enforcement (30 days)
- Device fingerprinting (anti-fraud)
- Angel One WebSocket (live data)
- SQLite cache (7 days, WAL mode)
- Sentry crash reporting
- PostHog analytics
- Auto-updates

### ✅ Production Ready
- Code signing support
- Installer generation
- Auto-update server
- Health monitoring
- Error tracking

### ✅ Security Hardened
- OS keychain integration
- AES-256-GCM encryption
- Device binding
- Trial enforcement
- Tamper detection
- Context isolation

## 📁 Key Files

```
electron/main/
├── index.ts              ← Main process (START HERE)
├── AngelOneAdapter.ts    ← Broker integration
├── AuthManager.ts        ← Trial + auth logic
├── SecurityManager.ts    ← Device fingerprint
├── DataManager.ts        ← SQLite cache
├── SignalEngine.ts       ← YOUR SIGNAL ENGINES GO HERE
└── MonitoringManager.ts  ← Health + logging

src/
├── App.tsx               ← React root
├── components/
│   ├── Auth/Login.tsx    ← Login screen
│   └── Dashboard/        ← Main UI (TODO: finish components)
└── store/appStore.ts     ← Global state
```

## 🔧 Integrate Your Signals

**File:** `electron/main/SignalEngine.ts`

```typescript
// Line 95 - Replace placeholder:
private async generateSignals(symbol: string, ticks: any[]): Promise<Signal[]> {
  const signals: Signal[] = [];

  // ADD YOUR ENGINES HERE:
  // 1. Import your engines at top of file
  // 2. Initialize in constructor
  // 3. Call them here:
  
  const premiumSignal = await this.premiumEngine.analyze(ticks);
  const dealerSignal = await this.dealerEngine.analyze(ticks);
  
  if (premiumSignal.confidence > 0.7) {
    signals.push({
      id: `${symbol}-${Date.now()}`,
      symbol,
      type: 'PREMIUM_INTELLIGENCE',
      signal: premiumSignal.direction,
      confidence: premiumSignal.confidence,
      reason: premiumSignal.reason,
      timestamp: Date.now(),
      layers: premiumSignal.layers  // Your 6-layer data
    });
  }

  return signals;
}
```

## 🌐 Setup Backend

Your backend needs these endpoints:

```typescript
POST /auth/register
POST /auth/login  
POST /auth/logout
POST /auth/refresh
GET  /auth/me
POST /auth/bind-angel
```

**Request example (register):**
```json
{
  "email": "user@example.com",
  "mobile": "+919876543210",
  "password": "secure123",
  "deviceFingerprint": {
    "fingerprint": "abc123...",
    "machineId": "xyz789...",
    "platform": "win32"
  }
}
```

**Response example:**
```json
{
  "user": {
    "id": "uuid",
    "plan": "TRIAL",
    "trialEndDate": "2024-12-01T00:00:00Z"
  },
  "tokens": {
    "accessToken": "jwt...",
    "refreshToken": "jwt...",
    "expiresAt": 1234567890
  },
  "requiresAngelLogin": true
}
```

## 📦 Build Installer

```bash
# Windows
npm run build:win
# → release/[version]/JOBBER-Pro-[version]-Setup.exe

# macOS
npm run build:mac
# → release/[version]/JOBBER-Pro-[version].dmg

# Linux
npm run build:linux
# → release/[version]/JOBBER-Pro-[version].AppImage
```

## 🎨 Customize UI

**Colors:** `tailwind.config.js`
```javascript
colors: {
  'jobber': {
    primary: '#3b82f6',  // Your brand color
    bg: '#0a0a0a',       // Background
    surface: '#141414'    // Cards
  }
}
```

**Logo:** Replace in `src/components/Auth/Login.tsx`

## 🔐 Environment Variables

**Required:**
```env
BACKEND_URL=https://api.yourbackend.com
```

**Optional:**
```env
SENTRY_DSN=https://your-sentry-dsn
POSTHOG_API_KEY=your-posthog-key
```

## 🐛 Debug Mode

```bash
# Enable DevTools
npm run dev

# View logs
# Logs location:
# Windows: %APPDATA%/jobber-pro/logs
# macOS: ~/Library/Logs/jobber-pro
# Linux: ~/.config/jobber-pro/logs
```

## ⚡ PowerShell Helper

```powershell
# All commands
.\scripts\deploy.ps1 -Action dev      # Start dev
.\scripts\deploy.ps1 -Action build    # Build
.\scripts\deploy.ps1 -Action package  # Create installer
.\scripts\deploy.ps1 -Action clean    # Clean project
.\scripts\deploy.ps1 -Action install  # Install deps
.\scripts\deploy.ps1 -Action test     # Run tests
```

## 📊 Monitoring

**Sentry Dashboard:**
- Crashes auto-reported
- Stack traces with source maps
- User context attached

**PostHog Dashboard:**
- User behavior tracking
- Feature usage analytics
- Performance metrics

**Health Metrics:**
```typescript
// Check app health
window.electronAPI.monitoring.getMetrics()

// Returns:
{
  cpu: 15.3,
  memory: { used: 450000000, total: 16000000000, percentage: 2.8 },
  uptime: 3600,
  wsConnected: true
}
```

## 🚨 Common Issues

**Issue:** "Module not found: better-sqlite3"
```bash
npm rebuild better-sqlite3
```

**Issue:** "WebSocket connection failed"
```bash
# Check Angel credentials
# Verify network connectivity
# Check DevTools console for errors
```

**Issue:** "Trial not enforcing"
```bash
# Ensure backend is returning correct trialEndDate
# Check AuthManager.isTrialValid() logic
# Verify system clock is accurate
```

## 🎯 Next Steps

1. ✅ Run `npm install`
2. ✅ Run `npm run dev`
3. ⬜ Connect backend API
4. ⬜ Integrate your signal engines
5. ⬜ Test trial flow
6. ⬜ Build installer
7. ⬜ Deploy!

## 📚 Full Documentation

See `README.md` for complete architecture, API specs, and deployment guide.

---

**Questions? Check README.md or open an issue!**
