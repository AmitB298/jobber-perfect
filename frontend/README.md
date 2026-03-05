# JOBBER Pro - Professional NIFTY 50 Options Analysis Platform

## 🎯 Overview

JOBBER Pro is an industry-grade desktop application for professional NIFTY 50 options trading analysis. Built with Electron, React, and TypeScript, it provides real-time market data, advanced signal engines, and comprehensive analytics.

## 🏗️ Architecture

```
┌────────────────────────────────────────┐
│ Electron Renderer (React + TypeScript) │
│ - Professional UI/UX                   │
│ - Real-time Charts                     │
│ - Signal Visualization                 │
│ - NO direct broker access              │
└───────────────┬────────────────────────┘
                │ IPC (Context Bridge)
┌───────────────▼────────────────────────┐
│ Electron MAIN (Enforcement Layer)       │
│ - AngelOneAdapter                      │
│ - Trial Timer Enforcement              │
│ - Device Fingerprinting                │
│ - Signal Engine Runner                 │
│ - SQLite Cache (7 days)                │
└───────────────┬────────────────────────┘
                │ HTTPS (JWT)
┌───────────────▼────────────────────────┐
│ YOUR BACKEND (Authority)               │
│ - User Auth                            │
│ - Trial Tracking                       │
│ - Device Registry                      │
│ - Angel Account Binding                │
│ - Subscription Management              │
└───────────────┬────────────────────────┘
                │ Secure API
┌───────────────▼────────────────────────┐
│ Angel One SmartAPI                     │
│ - REST API                             │
│ - WebSocket (Live Data)                │
└────────────────────────────────────────┘
```

## 🔐 Security Features

- **Device Fingerprinting**: Hardware-based unique identification
- **OS Keychain Integration**: Secure credential storage (keytar)
- **End-to-End Encryption**: AES-256-GCM for sensitive data
- **Trial Enforcement**: Hard lock after 30 days
- **Angel Account Binding**: One account, one device
- **Tamper Detection**: App integrity validation
- **Auto-lock**: Idle timeout protection

## 🚀 Features

### Core
- ✅ 30-day full-feature trial
- ✅ Real-time WebSocket market data
- ✅ Multi-signal engine support
- ✅ 7-day local data cache (SQLite + WAL)
- ✅ Professional dark theme UI
- ✅ Auto-updates (electron-updater)

### Data & Monitoring
- ✅ Crash reporting (Sentry)
- ✅ Analytics (PostHog)
- ✅ Structured logging (Pino)
- ✅ Health metrics (CPU, memory, network)
- ✅ Performance tracking

### Integration Ready
- 🔲 Your PremiumIntelligenceEngine
- 🔲 Your DealerGammaIntelligenceEngine
- 🔲 Your CEPE-MotionPredictor™
- 🔲 Backend API endpoints

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop** | Electron 28, TypeScript 5.3 |
| **UI** | React 18, TailwindCSS, Recharts |
| **State** | Zustand, React Query |
| **Data** | better-sqlite3 (WAL mode) |
| **Security** | keytar, node-machine-id, crypto |
| **Monitoring** | Sentry, PostHog, Pino |
| **Broker** | Angel One SmartAPI + WebSocket |
| **Build** | Vite 5, electron-builder |

## 🛠️ Setup Instructions

### Prerequisites

```bash
Node.js 18+ (LTS recommended)
npm 9+
Windows 10/11 or macOS 12+ or Linux
```

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/jobber-desktop.git
cd jobber-desktop

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration
```

### Environment Variables

Create `.env` file:

```env
# Backend
BACKEND_URL=https://api.yourbackend.com

# Monitoring (Optional)
SENTRY_DSN=https://your-sentry-dsn
POSTHOG_API_KEY=your-posthog-key

# Build
NODE_ENV=development
```

### Development

```bash
# Run in development mode
npm run dev

# This starts:
# - Vite dev server (React frontend) on :5173
# - Electron main process
# - Hot reload enabled
```

### Build for Production

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux

# Output: release/[version]/JOBBER-Pro-[version]-Setup.exe
```

## 🧱 Project Structure

```
jobber-desktop/
├── electron/
│   ├── main/
│   │   ├── index.ts                 # Main process entry
│   │   ├── AuthManager.ts           # Auth + trial enforcement
│   │   ├── SecurityManager.ts       # Encryption + fingerprinting
│   │   ├── DataManager.ts           # SQLite cache
│   │   ├── AngelOneAdapter.ts       # Broker integration
│   │   ├── SignalEngine.ts          # Signal placeholder
│   │   └── MonitoringManager.ts     # Health + logging
│   └── preload/
│       └── index.ts                 # IPC bridge
├── src/
│   ├── components/
│   │   ├── Auth/
│   │   │   └── Login.tsx            # Login/Register
│   │   └── Dashboard/
│   │       ├── Dashboard.tsx        # Main layout
│   │       ├── Sidebar.tsx          # Navigation
│   │       ├── Header.tsx           # Top bar
│   │       ├── MarketWatch.tsx      # Live data
│   │       ├── SignalsPanel.tsx     # Signals view
│   │       ├── Analytics.tsx        # Charts
│   │       └── Settings.tsx         # Config
│   ├── store/
│   │   └── appStore.ts              # Zustand state
│   ├── types/
│   │   └── electron.d.ts            # Type definitions
│   ├── App.tsx                      # Root component
│   ├── main.tsx                     # Entry point
│   └── index.css                    # Global styles
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

## 🔌 Integrating Your Signal Engines

Replace placeholder in `electron/main/SignalEngine.ts`:

```typescript
// TODO: Import your engines
import { PremiumIntelligenceEngine } from './engines/PremiumIntelligenceEngine';
import { DealerGammaIntelligenceEngine } from './engines/DealerGammaIntelligenceEngine';
import { CEPEMotionPredictor } from './engines/CEPEMotionPredictor';

private async generateSignals(symbol: string, ticks: any[]): Promise<Signal[]> {
  const signals: Signal[] = [];

  // YOUR LOGIC HERE
  const premiumSignal = await this.premiumEngine.analyze(ticks);
  const dealerSignal = await this.dealerEngine.analyze(ticks);
  const motionSignal = await this.motionPredictor.predict(ticks);

  if (premiumSignal.confidence > 0.7) {
    signals.push({
      id: `${symbol}-${Date.now()}`,
      symbol,
      type: 'PREMIUM_INTELLIGENCE',
      signal: premiumSignal.direction,
      confidence: premiumSignal.confidence,
      reason: premiumSignal.reason,
      timestamp: Date.now(),
      layers: premiumSignal.layers
    });
  }

  return signals;
}
```

## 🎨 UI Customization

### Theme Colors

Edit `tailwind.config.js`:

```javascript
colors: {
  'jobber': {
    bg: '#0a0a0a',           // Main background
    surface: '#141414',       // Cards, panels
    border: '#2a2a2a',        // Borders
    hover: '#1f1f1f',         // Hover states
    primary: '#3b82f6',       // Your brand color
    success: '#10b981',       // Green signals
    danger: '#ef4444',        // Red signals
    warning: '#f59e0b',       // Warnings
  }
}
```

## 📊 Database Schema

SQLite database (`jobber-data.db`) includes:

```sql
tick_data          # Real-time tick cache (7 days)
option_chain       # Option chain snapshots
signals            # Signal history with metadata
watchlist          # User's watchlist
settings           # App preferences
```

All tables have time-series indexes for fast queries.

## 🔐 Trial & Subscription Flow

### 1. Registration
```
User registers → Backend creates trial (30 days)
→ Device fingerprint stored
→ JWT issued
```

### 2. Angel Login
```
User connects Angel → Backend binds (userId + angelClientId + device)
→ Angel session created
→ WebSocket connected
```

### 3. Trial Expiry
```
Day 30 → App locks
→ WS disconnected
→ Angel session destroyed
→ Upgrade prompt shown
```

### 4. Payment
```
User pays → Backend updates plan to PAID
→ App unlocks automatically
→ No re-login needed
```

## 🚨 Fraud Prevention

| Attack Vector | Protection |
|---------------|-----------|
| Reinstall abuse | Device fingerprint + Angel binding |
| VM hopping | MAC + disk serial + machine ID |
| Angel ID reuse | Backend enforces 1:1 mapping |
| Multiple devices | Trial allows 1 device only |
| API abuse | Rate limiting + token bucket |
| Credential sharing | Device validation on each request |

## 📈 Monitoring & Analytics

### Sentry (Crash Reporting)
```typescript
// Automatic crash capture
// User context attached
// Breadcrumb trail
// Source maps enabled
```

### PostHog (Analytics)
```typescript
// Events tracked:
monitoring.trackEvent('signal_generated', {
  type: signal.type,
  confidence: signal.confidence
});

monitoring.trackEvent('angel_connected');
monitoring.trackEvent('trial_expired');
```

### Health Metrics
```typescript
// Collected every 30 seconds:
{
  cpu: number,
  memory: { used, total, percentage },
  uptime: number,
  wsConnected: boolean,
  tickLatency: number
}
```

## 🔧 Backend API Requirements

Your backend must implement:

### Auth Endpoints
```
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
GET  /auth/me
POST /auth/bind-angel
```

### Expected Responses
```typescript
// Login/Register
{
  user: User,
  tokens: { accessToken, refreshToken, expiresAt },
  requiresAngelLogin: boolean
}

// Device Fingerprint (sent in requests)
{
  machineId: string,
  platform: string,
  cpuModel: string,
  macAddress: string,
  fingerprint: string  // SHA-256 hash
}
```

## 🚀 Deployment Checklist

- [ ] Backend API deployed and tested
- [ ] Environment variables configured
- [ ] Sentry DSN added
- [ ] PostHog key added
- [ ] Code signing certificate obtained
- [ ] App icons created (build/icon.*)
- [ ] NSIS installer customized
- [ ] Auto-update server configured
- [ ] GitHub releases configured

## 📝 Build & Distribute

```bash
# 1. Build app
npm run build:win

# 2. Sign executable (optional)
# Use electron-builder config for code signing

# 3. Upload to distribution
# - GitHub Releases (auto-update)
# - Your own CDN
# - App stores

# 4. Generate delta updates
# electron-builder handles this automatically
```

## 🐛 Troubleshooting

### WebSocket not connecting
```
Check Angel One API credentials
Verify feed token is valid
Check network logs in DevTools
```

### SQLite errors
```
Ensure write permissions to userData directory
Check disk space
Verify better-sqlite3 native module compiled
```

### Auto-update failing
```
Verify GitHub token has release permissions
Check update server configuration
Test with electron-updater debug logs
```

## 📚 Resources

- [Electron Documentation](https://electronjs.org/docs)
- [Angel One SmartAPI](https://smartapi.angelbroking.com/docs)
- [React Query](https://tanstack.com/query/latest)
- [Zustand](https://github.com/pmndrs/zustand)
- [Tailwind CSS](https://tailwindcss.com)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 📄 License

MIT License - See LICENSE file

## 🎯 Next Steps

1. **Implement Backend**: Create the auth + trial API
2. **Integrate Signals**: Add your actual signal engines
3. **Test Trial Flow**: Full registration → expiry → payment
4. **Deploy**: Build installers and setup distribution
5. **Monitor**: Watch Sentry + PostHog for issues

---

**Built with ⚡️ for Professional Traders**
