// frontend/electron/main/index.ts
// ============================================================================
// JOBBER PRO — Electron Main Process (FULLY WIRED)
// ============================================================================

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
} from 'electron';
import path from 'path';
import Store from 'electron-store';
import { AuthManager }     from './AuthManager';
import { AngelOneAdapter } from './AngelOneAdapter';
import { SignalEngine }    from './SignalEngine';
import { DataManager }     from './DataManager';
import { IntelligenceOrchestrator } from './intelligence-orchestrator';
import dotenv from 'dotenv';
// Load .env from frontend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============================================================================
// CONFIGURATION
// ============================================================================

const store   = new Store();
const isDev   = process.env.NODE_ENV !== 'production';
const API_URL = process.env.API_SERVER_URL || 'http://localhost:3000';
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

// ── Use a plain module-level flag instead of augmenting Electron's App type.
// (Augmenting App conflicts with the 'App' interface exported from electron.d.ts)
let isQuitting = false;

// ============================================================================
// MANAGER INSTANCES
// ============================================================================

let authManager:   AuthManager;
let angelAdapter:  AngelOneAdapter;
let signalEngine:  SignalEngine;
let dataManager:   DataManager;
let intel:         IntelligenceOrchestrator | null = null;

// ============================================================================
// WINDOW MANAGEMENT
// ============================================================================

let mainWindow:     BrowserWindow | null = null;
let chartsWindow:   BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let alertsWindow:   BrowserWindow | null = null;
let tray:           Tray | null = null;
let trayPollTimer:  ReturnType<typeof setInterval> | null = null;

function createMainWindow(): BrowserWindow {
  const windowState = store.get('mainWindowState', {
    width: 1400, height: 900, x: undefined, y: undefined,
  }) as any;

  mainWindow = new BrowserWindow({
    width:    windowState.width,
    height:   windowState.height,
    x:        windowState.x,
    y:        windowState.y,
    minWidth:  1200,
    minHeight: 700,
    title:    'JOBBER PRO — NIFTY Options Tracker',
    icon:     path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
    backgroundColor: '#0f172a',
    show:  false,
    frame: true,
  });

  if (isDev) {
    mainWindow.loadURL(`${VITE_DEV_SERVER_URL}#/dashboard`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'), {
      hash: '/dashboard',
    });
  }

  mainWindow.once('ready-to-show', () => { mainWindow?.show(); mainWindow?.focus(); });

  const saveWindowState = () => { if (mainWindow) store.set('mainWindowState', mainWindow.getBounds()); };
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move',   saveWindowState);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      new Notification({ title: 'JOBBER PRO', body: 'Minimized to system tray.' }).show();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

function createChartsWindow(): void {
  if (chartsWindow) { chartsWindow.focus(); return; }
  const ws = store.get('chartsWindowState', { width: 1200, height: 700 }) as any;
  chartsWindow = new BrowserWindow({
    width: ws.width, height: ws.height, minWidth: 900, minHeight: 600,
    title: 'Charts & Analysis', parent: mainWindow!,
    icon:  path.join(__dirname, '../../public/icon.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false },
    backgroundColor: '#0f172a',
  });
  chartsWindow.loadURL(isDev ? `${VITE_DEV_SERVER_URL}#/charts` : `file://${path.join(__dirname, '../../dist/index.html')}#/charts`);
  chartsWindow.on('resize', () => { if (chartsWindow) store.set('chartsWindowState', chartsWindow.getBounds()); });
  chartsWindow.on('closed', () => { chartsWindow = null; });
}

function createSettingsWindow(): void {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 700, height: 600, resizable: false, title: 'Settings', parent: mainWindow!,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false },
    backgroundColor: '#0f172a',
  });
  settingsWindow.loadURL(isDev ? `${VITE_DEV_SERVER_URL}#/settings` : `file://${path.join(__dirname, '../../dist/index.html')}#/settings`);
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createAlertsWindow(): void {
  if (alertsWindow) { alertsWindow.focus(); return; }
  alertsWindow = new BrowserWindow({
    width: 400, height: 500, title: 'Price Alerts', alwaysOnTop: true,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false },
    backgroundColor: '#0f172a',
  });
  alertsWindow.loadURL(isDev ? `${VITE_DEV_SERVER_URL}#/alerts` : `file://${path.join(__dirname, '../../dist/index.html')}#/alerts`);
  alertsWindow.on('closed', () => { alertsWindow = null; });
}

// ============================================================================
// SYSTEM TRAY
// ============================================================================

function updateTrayMenu(stats?: any): void {
  if (!tray) return;
  const niftyStr = stats?.nifty ? `₹${(stats.nifty as number).toFixed(0)}` : 'JOBBER PRO';
  const pcrStr   = stats?.pcr_oi != null ? `  PCR ${(stats.pcr_oi as number).toFixed(2)}` : '';
  const title    = `${niftyStr}${pcrStr}`;
  tray.setToolTip(title);

  const menu = Menu.buildFromTemplate([
    { label: title, enabled: false },
    { type: 'separator' },
    ...(stats ? [
      { label: `NIFTY  ₹${(stats.nifty ?? 0).toFixed(2)}`,         enabled: false },
      { label: `PCR OI  ${(stats.pcr_oi ?? 0).toFixed(2)}`,        enabled: false },
      { label: `Max Pain  ${stats.maxPain ?? '–'}`,                 enabled: false },
      { label: `Ticks  ${(stats.totalTicks ?? 0).toLocaleString()}`, enabled: false },
      { type: 'separator' as const },
    ] : []),
    { label: 'Open Dashboard',  click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Open Charts',     click: createChartsWindow },
    { label: 'Open Alerts',     click: createAlertsWindow },
    { label: 'Open Settings',   click: createSettingsWindow },
    { type: 'separator' },
    { label: 'Quit JOBBER PRO', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, '../../public/icon.png')
    : path.join(process.resourcesPath, 'icon.png');

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('JOBBER PRO');
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  updateTrayMenu();
}

function startTrayPoll(): void {
  if (trayPollTimer) clearInterval(trayPollTimer);
  trayPollTimer = setInterval(async () => {
    try {
      const http = await import('http');
      const statsRaw = await new Promise<string>((resolve, reject) => {
        const req = http.default.get(`${API_URL}/api/stats`, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(1500, () => { req.destroy(); reject(new Error('timeout')); });
      });
      const stats = (JSON.parse(statsRaw))?.data ?? JSON.parse(statsRaw);
      updateTrayMenu(stats);
      mainWindow?.webContents.send('tray:statsUpdated', stats);
    } catch { /* api-server not up yet */ }
  }, 2000);
}

// ============================================================================
// IPC SETUP
// ============================================================================

function setupWindowIPC(): void {
  ipcMain.handle('window:openCharts',     async () => createChartsWindow());
  ipcMain.handle('window:openSettings',   async () => createSettingsWindow());
  ipcMain.handle('window:openAlerts',     async () => createAlertsWindow());
  ipcMain.handle('window:minimizeToTray', async () => mainWindow?.hide());
}

function setupTrayIPC(): void {
  ipcMain.handle('tray:update', async (_, stats: any) => updateTrayMenu(stats));
  ipcMain.handle('notification:show', async (_, opts: { title: string; body: string }) => {
    if (Notification.isSupported()) new Notification({ title: opts.title, body: opts.body }).show();
  });
}

function setupStoreIPC(): void {
  ipcMain.handle('store:get',    async (_, key: string)             => store.get(key));
  ipcMain.handle('store:set',    async (_, key: string, value: any) => { store.set(key, value); return true; });
  ipcMain.handle('store:getAll', async ()                           => store.store);
}

function setupAppIPC(): void {
  ipcMain.handle('app:version', async () => app.getVersion());
  ipcMain.handle('app:path',    async () => app.getPath('userData'));
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

function setupAuthIPC(): void {
  ipcMain.handle('auth:login', async (_, identifier: string, password: string) => {
    try   { return { success: true,  data:  await authManager.login(identifier, password) }; }
    catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('auth:register', async (_, email: string, mobile: string, password: string) => {
    try   { return { success: true,  data:  await authManager.register(email, mobile, password) }; }
    catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      await authManager.logout();
      try { angelAdapter.disconnectWebSocket(); } catch {}
      try { signalEngine.stop(); }               catch {}
      return { success: true };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('auth:getUser',      async () => ({ success: true, data: authManager.getCurrentUser() }));
  ipcMain.handle('auth:isTrialValid', async () => ({
    success: true,
    data: {
      isValid:       authManager.isTrialValid(),
      daysRemaining: authManager.getRemainingTrialDays(),
      plan:          (authManager.getCurrentUser() as any)?.plan ?? 'TRIAL',
    },
  }));
}

// ── ANGEL ONE ─────────────────────────────────────────────────────────────────

function setupAngelIPC(): void {
  ipcMain.handle('angel:login', async (_, credentials: any) => {
    try {
      const profile = await angelAdapter.login(credentials);
      try { await authManager.bindAngelAccount(profile.clientId); } catch {}
      return { success: true, data: profile };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('angel:logout',      async () => { try { await angelAdapter.logout(); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('angel:connect',     async () => { try { await angelAdapter.connectWebSocket(); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('angel:disconnect',  async () => { try { angelAdapter.disconnectWebSocket(); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('angel:subscribe',   async (_, tokens: string[]) => { try { await angelAdapter.subscribe(tokens); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('angel:unsubscribe', async (_, tokens: string[]) => { try { await angelAdapter.unsubscribe(tokens); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('angel:getLTP',      async (_, ex: string, sym: string, token: string) => { try { return { success: true, data: await angelAdapter.getLTP(ex, sym, token) }; } catch (e) { return { success: false, error: (e as Error).message }; } });

  // getStatus — resilient: works with getStatus(), getConnectionStatus(), or falls back gracefully
  ipcMain.handle('angel:getStatus', async () => {
    try {
      const ad = angelAdapter as any;
      const status = typeof ad.getStatus === 'function'           ? ad.getStatus()
                   : typeof ad.getConnectionStatus === 'function' ? ad.getConnectionStatus()
                   : { connected: false };
      return { success: true, data: status };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });
}

function wireAngelEvents(): void {
  angelAdapter.on('connected',    ()            => mainWindow?.webContents.send('angel:connected'));
  angelAdapter.on('disconnected', (reason: any) => mainWindow?.webContents.send('angel:disconnected', String(reason ?? 'unknown')));
  angelAdapter.on('tick',         (tick: any)   => {
    mainWindow?.webContents.send('angel:tick', tick);
    // Feed intelligence engine — tick.ltp is already in rupees (divided by 100 in parser)
    intel?.feedAngelTick({
      token:                    tick.token,
      last_traded_price:        Math.round(tick.ltp * 100),  // orchestrator divides by 100 again
      best_5_buy_data:          tick.bidPrice ? [{ price: tick.bidPrice, quantity: tick.bidQty ?? 0 }] : undefined,
      best_5_sell_data:         tick.askPrice ? [{ price: tick.askPrice, quantity: tick.askQty ?? 0 }] : undefined,
      volume_trade_for_the_day: tick.volume ?? 0,
      open_interest:            tick.oi ?? 0,
      exchange_feed_time:       tick.timestamp ?? Date.now(),
    });
  });
  angelAdapter.on('error',        (err: any)    => mainWindow?.webContents.send('angel:error', err instanceof Error ? err.message : String(err)));
}

// ── SIGNAL ENGINE ─────────────────────────────────────────────────────────────

function setupSignalIPC(): void {
  ipcMain.handle('signals:start',        async () => { try { await signalEngine.start(); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('signals:stop',         async () => { try { signalEngine.stop(); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('signals:updateConfig', async (_, config: any) => {
    try { if (typeof (signalEngine as any).updateConfig === 'function') (signalEngine as any).updateConfig(config); return { success: true }; }
    catch (e) { return { success: false, error: (e as Error).message }; }
  });

  // getStatus — resilient: try getStatus(), isRunning(), or return {running:false}
  ipcMain.handle('signals:getStatus', async () => {
    try {
      const se = signalEngine as any;
      const status = typeof se.getStatus === 'function'   ? se.getStatus()
                   : typeof se.isRunning === 'function'   ? { running: se.isRunning() }
                   : { running: false };
      return { success: true, data: status };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });

  // getHistory — resilient: try getHistory(), getSignalHistory(), getSignals()
  ipcMain.handle('signals:getHistory', async (_, symbol?: string, limit?: number) => {
    try {
      const se = signalEngine as any;
      const signals: any[] = typeof se.getHistory === 'function'       ? se.getHistory(symbol, limit)
                           : typeof se.getSignalHistory === 'function'  ? se.getSignalHistory(symbol, limit)
                           : typeof se.getSignals === 'function'        ? se.getSignals(symbol, limit)
                           : [];
      return { success: true, data: signals };
    } catch (e) { return { success: false, data: [], error: (e as Error).message }; }
  });
}

function wireSignalEvents(): void {
  signalEngine.on('signal',  (s: any) => mainWindow?.webContents.send('signals:new', s));
  signalEngine.on('started', ()       => mainWindow?.webContents.send('signals:started'));
  signalEngine.on('stopped', ()       => mainWindow?.webContents.send('signals:stopped'));
}

// ── DATA MANAGER ──────────────────────────────────────────────────────────────

function setupDataIPC(): void {
  ipcMain.handle('data:getTickData', async (_, symbol: string, limit?: number) => {
    try   { return { success: true,  data: dataManager.getTickData(symbol, limit) }; }
    catch (e) { return { success: false, data: [], error: (e as Error).message }; }
  });

  // getOptionChain — resilient: DataManager uses insertOptionChain to write; reading method varies
  ipcMain.handle('data:getOptionChain', async (_, symbol: string, expiry: string) => {
    try {
      const dm = dataManager as any;
      const data = typeof dm.getOptionChain === 'function'      ? await dm.getOptionChain(symbol, expiry)
                 : typeof dm.getOptionChainData === 'function'  ? await dm.getOptionChainData(symbol, expiry)
                 : typeof dm.queryOptionChain === 'function'    ? await dm.queryOptionChain(symbol, expiry)
                 : [];
      return { success: true, data };
    } catch (e) { return { success: false, data: [], error: (e as Error).message }; }
  });

  ipcMain.handle('data:addToWatchlist',    async (_, sym: string, notes?: string) => { try { await dataManager.addToWatchlist(sym, notes); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('data:removeFromWatchlist', async (_, sym: string) =>              { try { await dataManager.removeFromWatchlist(sym); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; } });
  ipcMain.handle('data:getWatchlist',      async () =>                              { try { return { success: true, data: dataManager.getWatchlist() }; } catch (e) { return { success: false, data: [], error: (e as Error).message }; } });
  ipcMain.handle('data:getStats',          async () => {
    try {
      const dm = dataManager as any;
      const data = typeof dm.getStats === 'function' ? dm.getStats() : {};
      return { success: true, data };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });
}

// ── INTELLIGENCE ENGINE ───────────────────────────────────────────────────────

function setupIntelligenceIPC(): void {
  ipcMain.handle('intel-get-state',          () => intel?.getState() ?? null);
  ipcMain.handle('intel-update-fii',         (_evt, data: { longFutures: number; shortFutures: number }) => {
    intel?.updateFIIData(data.longFutures, data.shortFutures);
    return { ok: true };
  });
  ipcMain.handle('intel-update-cross-asset', (_evt, data: { sgxPrice?: number; usdInr?: number; crude?: number }) => {
    intel?.updateCrossAsset(data);
    return { ok: true };
  });
}

async function initIntelligence(): Promise<void> {
  if (!mainWindow) return;
  try {
    intel = new IntelligenceOrchestrator(mainWindow, {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'jobber_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      schema:   'nifty_premium_tracking',
    });
    await intel.init();


    // TEST: Full synthetic tick injector - spot + futures + options (remove before prod)
    setInterval(() => {
      if (!intel) return;
      const spot  = 24450 + (Math.random() - 0.5) * 60;
      const fut   = spot + 15 + (Math.random() - 0.5) * 10;

      // 1. Spot index
      intel.feedAngelTick({
        token: '99926000',
        last_traded_price: Math.round(spot * 100),
        volume_trade_for_the_day: 5000000,
        open_interest: 0,
        exchange_feed_time: Date.now(),
        best_5_buy_data:  [{ price: Math.round((spot - 0.5) * 100), quantity: 500 }],
        best_5_sell_data: [{ price: Math.round((spot + 0.5) * 100), quantity: 500 }],
      });

      // 2. Futures (token from your registerTokens call)
      intel.feedAngelTick({
        token: process.env.NIFTY_FUT_TOKEN || '51714',
        last_traded_price: Math.round(fut * 100),
        volume_trade_for_the_day: Math.floor(2000000 + Math.random() * 100000),
        open_interest: Math.floor(8500000 + Math.random() * 50000),
        exchange_feed_time: Date.now(),
        best_5_buy_data:  [{ price: Math.round((fut - 1) * 100), quantity: 75 }],
        best_5_sell_data: [{ price: Math.round((fut + 1) * 100), quantity: 75 }],
      });

      // 3. A few ATM options (CE and PE near spot)
      const strikes = [24400, 24450, 24500];
      const optTokens: Record<number,{ce:string,pe:string}> = { 24400: { ce: '45493', pe: '45493' }, 24450: { ce: '45497', pe: '45498' }, 24500: { ce: '45499', pe: '62673' } };
      for (const K of strikes) {
        const cePrice = Math.max(0.5, (spot - K) + 80 + Math.random() * 5);
        const pePrice = Math.max(0.5, (K - spot) + 80 + Math.random() * 5);
        intel.feedAngelTick({
          token: optTokens[K].ce,
          last_traded_price: Math.round(cePrice * 100),
          volume_trade_for_the_day: Math.floor(50000 + Math.random() * 5000),
          open_interest: Math.floor(1000000 + Math.random() * 10000),
          exchange_feed_time: Date.now(),
          best_5_buy_data:  [{ price: Math.round((cePrice - 0.25) * 100), quantity: 75 }],
          best_5_sell_data: [{ price: Math.round((cePrice + 0.25) * 100), quantity: 75 }],
        });
        intel.feedAngelTick({
          token: optTokens[K].pe,
          last_traded_price: Math.round(pePrice * 100),
          volume_trade_for_the_day: Math.floor(50000 + Math.random() * 5000),
          open_interest: Math.floor(1000000 + Math.random() * 10000),
          exchange_feed_time: Date.now(),
          best_5_buy_data:  [{ price: Math.round((pePrice - 0.25) * 100), quantity: 75 }],
          best_5_sell_data: [{ price: Math.round((pePrice + 0.25) * 100), quantity: 75 }],
        });
      }
    }, 1000);
    // Register test tokens using REAL tokens from nifty_options_cache.json
    // Options: 10MAR2026 nearest expiry ATM strikes
    // Futures: token from .env NIFTY_FUT_TOKEN (set to real FUTIDX token)
    const FUT_TOKEN = process.env.NIFTY_FUT_TOKEN || '26000';
    intel.registerTokens(
      [
        { token:'45493', symbol:'NIFTY10MAR2624400CE', strike:24400, expiry:'10MAR2026', optionType:'CE' },
        { token:'45498', symbol:'NIFTY10MAR2624450PE', strike:24450, expiry:'10MAR2026', optionType:'PE' },
        { token:'45497', symbol:'NIFTY10MAR2624450CE', strike:24450, expiry:'10MAR2026', optionType:'CE' },
        { token:'45499', symbol:'NIFTY10MAR2624500CE', strike:24500, expiry:'10MAR2026', optionType:'CE' },
        { token:'57837', symbol:'NIFTY17MAR2624450CE', strike:24450, expiry:'17MAR2026', optionType:'CE' },
        { token:'62665', symbol:'NIFTY24MAR2624450PE', strike:24450, expiry:'24MAR2026', optionType:'PE' },
        { token:'62673', symbol:'NIFTY24MAR2624500PE', strike:24500, expiry:'24MAR2026', optionType:'PE' },
      ],
      { token: FUT_TOKEN || '51714', symbol:'NIFTY30MAR26FUT' },
      { token:'99926000' }
    );
    console.log('[Intel] TEST full injector started (spot+futures+options)');

    // Load option tokens from nifty_options.json
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const niftyOptions = require('../../../backend/src/scripts/nifty_options.json');
      const validOptions = (niftyOptions as any[]).filter((o: any) => o.symbol?.startsWith('NIFTY'));
      intel.registerTokens(
        validOptions,
        // NIFTY near-month futures: find token in symbol_master.json
        // Search for instrumenttype=FUTIDX, symbol=NIFTY, nearest expiry
        { token: process.env.NIFTY_FUT_TOKEN || '26000', symbol: 'NIFTYFUT' },
        { token: '99926000' },  // NIFTY spot index
      );
    } catch (e) {
      console.warn('[intel] Could not load nifty_options.json:', (e as Error).message);
    }

    // Session context — update these daily
    const prevClose = parseFloat(process.env.PREV_NIFTY_CLOSE || '0') || 22000;
    const sgx715    = parseFloat(process.env.SGX_PRICE_715    || '0') || prevClose;
    intel.setSessionContext(prevClose, sgx715);

    console.log('[intel] Intelligence engine ready');
  } catch (e) {
    console.error('[intel] Failed to initialize:', (e as Error).message);
  }
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================

async function initializeManagers(): Promise<void> {
  authManager  = AuthManager.getInstance();
  angelAdapter = AngelOneAdapter.getInstance();
  signalEngine = SignalEngine.getInstance();
  dataManager  = DataManager.getInstance();

  try {
    if (await authManager.restoreSession()) console.log('[main] Auth session restored');
  } catch (e) { console.warn('[main] Session restore failed:', (e as Error).message); }
}

app.whenReady().then(async () => {
  await initializeManagers();

  setupWindowIPC();
  setupTrayIPC();
  setupStoreIPC();
  setupAppIPC();
  setupAuthIPC();
  setupAngelIPC();
  setupSignalIPC();
  setupDataIPC();
  setupIntelligenceIPC();

  wireAngelEvents();
  wireSignalEvents();

  createMainWindow();
  createTray();
  startTrayPoll();

  // Init intelligence engine after window is created
  await initIntelligence();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (trayPollTimer) { clearInterval(trayPollTimer); trayPollTimer = null; }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try { angelAdapter?.disconnectWebSocket(); } catch {}
  try { signalEngine?.stop(); }               catch {}
});