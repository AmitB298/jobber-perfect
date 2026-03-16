// frontend/src/types/electron.d.ts
// ============================================================================
// SHARED DOMAIN TYPES  (used by renderer, preload, and main)
// ============================================================================

export interface User {
  id: string;
  email: string;
  mobile?: string;
  name?: string;
  angel_one_client_id?: string;
  plan: 'TRIAL' | 'PAID' | 'EXPIRED';
  status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  trialStartDate?: string;
  trialEndDate?: string;
  subscriptionEndDate?: string;
  permissions: string[];
}

export interface AngelCredentials {
  clientId: string;
  password: string;
  totp: string;
}

export interface AngelProfile {
  clientId: string;
  name: string;
  email: string;
  mobile: string;
  exchanges: string[];
  products: string[];
}

export interface MarketTick {
  token: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  bidQty?: number;
  askQty?: number;
  bidPrice?: number;
  askPrice?: number;
  timestamp: number;
}

export interface Signal {
  id: string;
  type: 'IV_CRUSH' | 'IV_EXPANSION' | 'DELTA_NEUTRAL' | 'THETA_DECAY' | 'GAMMA_SCALP';
  strategy: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
  action: string;
  description: string;
  strikes: number[];
  expectedProfit: string;
  risk: string;
  timestamp: number;
}

export interface AppStats {
  nifty: number;
  pcr_oi: number;
  pcr_volume: number;
  maxPain: number;
  totalTicks: number;
}

export interface SignalConfig {
  enabled: boolean;
  confidence_threshold: number;
  lookback_period: number;
}

export interface SignalEngineStatus {
  running: boolean;
  signalCount: number;
  config: SignalConfig;
}

export interface AngelStatus {
  connected: boolean;
  authenticated: boolean;
  subscriptionCount: number;
  clientId?: string;
}

export interface TrialStatus {
  isValid: boolean;
  daysRemaining: number;
  plan: 'TRIAL' | 'PAID' | 'EXPIRED';
}

export interface WatchlistItem {
  symbol: string;
  notes?: string;
  addedAt: number;
}

export interface DataStats {
  totalTicks: number;
  watchlistCount: number;
  dbSize: number;
}

// ============================================================================
// ELECTRON API INTERFACE
// Full IPC surface exposed to renderer via contextBridge
// ============================================================================

export interface ElectronAPI {
  // ── Window Management ─────────────────────────────────────────────────────
  openCharts: () => Promise<void>;
  openSettings: () => Promise<void>;
  openAlerts: () => Promise<void>;
  minimizeToTray: () => Promise<void>;

  // ── System Tray ───────────────────────────────────────────────────────────
  updateTray: (stats: AppStats) => Promise<void>;

  // ── Notifications ─────────────────────────────────────────────────────────
  showNotification: (options: {
    title: string;
    body: string;
    urgent?: boolean;
  }) => Promise<void>;

  // ── Electron-store Settings ───────────────────────────────────────────────
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<boolean>;
  getAllSettings: () => Promise<Record<string, any>>;

  // ── App Info ──────────────────────────────────────────────────────────────
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;

  // ── Platform Info ─────────────────────────────────────────────────────────
  platform: string;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;

  // ── UI Events ─────────────────────────────────────────────────────────────
  onRefreshData: (callback: () => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;

  // ==========================================================================
  // AUTH IPC
  // ==========================================================================

  /** Login with email/mobile + password. Returns user on success. */
  authLogin: (
    identifier: string,
    password: string
  ) => Promise<{ success: boolean; data?: User; error?: string }>;

  /** Register new account */
  authRegister: (
    email: string,
    mobile: string,
    password: string
  ) => Promise<{ success: boolean; data?: User; error?: string }>;

  /** Logout — clears session, stops Angel One + signal engine */
  authLogout: () => Promise<{ success: boolean; error?: string }>;

  /** Returns current logged-in user or null */
  authGetUser: () => Promise<{ success: boolean; data: User | null }>;

  /** Returns trial validity and days remaining */
  authIsTrialValid: () => Promise<{ success: boolean; data: TrialStatus }>;

  // ==========================================================================
  // ANGEL ONE IPC
  // ==========================================================================

  /** Login to Angel One SmartAPI */
  angelLogin: (
    credentials: AngelCredentials
  ) => Promise<{ success: boolean; data?: AngelProfile; error?: string }>;

  /** Logout from Angel One */
  angelLogout: () => Promise<{ success: boolean; error?: string }>;

  /** Open the SmartAPI WebSocket for live market data */
  angelConnect: () => Promise<{ success: boolean; error?: string }>;

  /** Close the SmartAPI WebSocket */
  angelDisconnect: () => Promise<{ success: boolean; error?: string }>;

  /** Subscribe tokens (batch of up to 50 at a time) */
  angelSubscribe: (
    tokens: string[]
  ) => Promise<{ success: boolean; error?: string }>;

  /** Unsubscribe tokens */
  angelUnsubscribe: (
    tokens: string[]
  ) => Promise<{ success: boolean; error?: string }>;

  /** Get last traded price for a single instrument */
  angelGetLTP: (
    exchange: string,
    symbol: string,
    token: string
  ) => Promise<{ success: boolean; data?: number; error?: string }>;

  /** Get current Angel One connection status */
  angelGetStatus: () => Promise<{ success: boolean; data: AngelStatus }>;

  // Angel One — real-time events
  /** Fires when Angel One WebSocket connects successfully */
  onAngelConnected: (callback: () => void) => () => void;

  /** Fires when Angel One WebSocket disconnects */
  onAngelDisconnected: (callback: (reason: string) => void) => () => void;

  /** Fires for every incoming market tick */
  onAngelTick: (callback: (tick: MarketTick) => void) => () => void;

  /** Fires on Angel One API / WebSocket errors */
  onAngelError: (callback: (error: string) => void) => () => void;

  // ==========================================================================
  // SIGNAL ENGINE IPC
  // ==========================================================================

  /** Start the signal detection engine */
  signalStart: () => Promise<{ success: boolean; error?: string }>;

  /** Stop the signal detection engine */
  signalStop: () => Promise<{ success: boolean; error?: string }>;

  /** Get signal engine status + config */
  signalGetStatus: () => Promise<{ success: boolean; data: SignalEngineStatus }>;

  /** Update signal engine config */
  signalUpdateConfig: (
    config: Partial<SignalConfig>
  ) => Promise<{ success: boolean; error?: string }>;

  /** Get historical signals */
  signalGetHistory: (
    symbol?: string,
    limit?: number
  ) => Promise<{ success: boolean; data: Signal[] }>;

  // Signal engine — real-time events
  /** Fires when a new signal is generated */
  onSignal: (callback: (signal: Signal) => void) => () => void;

  /** Fires when signal engine starts */
  onSignalEngineStarted: (callback: () => void) => () => void;

  /** Fires when signal engine stops */
  onSignalEngineStopped: (callback: () => void) => () => void;

  // ==========================================================================
  // DATA IPC
  // ==========================================================================

  /** Get raw tick data for a symbol */
  dataGetTicks: (
    symbol: string,
    limit?: number
  ) => Promise<{ success: boolean; data: any[] }>;

  /** Get option chain snapshot from local DB */
  dataGetOptionChain: (
    symbol: string,
    expiry: string
  ) => Promise<{ success: boolean; data: any[] }>;

  /** Add symbol to watchlist */
  dataAddToWatchlist: (
    symbol: string,
    notes?: string
  ) => Promise<{ success: boolean; error?: string }>;

  /** Remove symbol from watchlist */
  dataRemoveFromWatchlist: (
    symbol: string
  ) => Promise<{ success: boolean; error?: string }>;

  /** Get full watchlist */
  dataGetWatchlist: () => Promise<{ success: boolean; data: WatchlistItem[] }>;

  /** Get aggregate data stats */
  dataGetStats: () => Promise<{ success: boolean; data: DataStats }>;

  // ==========================================================================
  // AUTO-UPDATER EVENTS
  // ==========================================================================

  onUpdateAvailable: (callback: () => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;

  // ==========================================================================
  // INTELLIGENCE ENGINE IPC
  // ==========================================================================

  /** Get current full intelligence engine state snapshot */
  intelGetState: () => Promise<any>;

  /** Update FII futures participant data (from NSE EOD report) */
  intelUpdateFII: (data: {
    longFutures: number;
    shortFutures: number;
  }) => Promise<{ ok: boolean }>;

  /** Update cross-asset data (SGX, USD/INR, Crude) */
  intelUpdateCrossAsset: (data: {
    sgxPrice?: number;
    usdInr?: number;
    crude?: number;
  }) => Promise<{ ok: boolean }>;

  /** Fires every ~1 second with updated AppState from all 25 signal engines */
  onIntelUpdate: (callback: (state: any) => void) => () => void;

  /** Fires when composite confidence crosses the alert threshold (≥68%) */
  onIntelAlert: (callback: (alert: {
    confidence: number;
    direction: string;
    hypothesis: string;
    spot: number;
  }) => void) => () => void;
}

// ============================================================================
// GLOBAL WINDOW AUGMENTATION
// ============================================================================

declare global {
  interface Window {
    /** Present when running inside Electron via contextBridge */
    electron: ElectronAPI;

    /**
     * Legacy namespace used by backup App.tsx versions.
     * New code should use window.electron (flat API).
     * @deprecated use window.electron
     */
    electronAPI?: {
      auth: {
        login: ElectronAPI['authLogin'];
        register: ElectronAPI['authRegister'];
        logout: ElectronAPI['authLogout'];
        getUser: ElectronAPI['authGetUser'];
        isTrialValid: ElectronAPI['authIsTrialValid'];
      };
      angel: {
        login: ElectronAPI['angelLogin'];
        connect: ElectronAPI['angelConnect'];
        disconnect: ElectronAPI['angelDisconnect'];
        subscribe: ElectronAPI['angelSubscribe'];
        unsubscribe: ElectronAPI['angelUnsubscribe'];
        getLTP: ElectronAPI['angelGetLTP'];
        getStatus: ElectronAPI['angelGetStatus'];
        onConnected: ElectronAPI['onAngelConnected'];
        onDisconnected: ElectronAPI['onAngelDisconnected'];
        onTick: ElectronAPI['onAngelTick'];
        onError: ElectronAPI['onAngelError'];
      };
      signals: {
        start: ElectronAPI['signalStart'];
        stop: ElectronAPI['signalStop'];
        getStatus: ElectronAPI['signalGetStatus'];
        updateConfig: ElectronAPI['signalUpdateConfig'];
        getHistory: ElectronAPI['signalGetHistory'];
        onSignal: ElectronAPI['onSignal'];
        onStarted: ElectronAPI['onSignalEngineStarted'];
        onStopped: ElectronAPI['onSignalEngineStopped'];
      };
      data: {
        getTickData: ElectronAPI['dataGetTicks'];
        getOptionChain: ElectronAPI['dataGetOptionChain'];
        addToWatchlist: ElectronAPI['dataAddToWatchlist'];
        removeFromWatchlist: ElectronAPI['dataRemoveFromWatchlist'];
        getWatchlist: ElectronAPI['dataGetWatchlist'];
        getStats: ElectronAPI['dataGetStats'];
      };
    };
  }
}

export {};

