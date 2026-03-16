// frontend/electron/preload/index.ts
// Secure IPC bridge — exposes window.electron to the renderer process.
// All IPC communication MUST go through this file (contextIsolation: true).

import { contextBridge, ipcRenderer } from 'electron';

// ============================================================================
// HELPERS
// ============================================================================

/** Register a one-time listener, return an unsubscribe fn */
function on(channel: string, cb: (...args: any[]) => void): () => void {
  const wrapped = (_: Electron.IpcRendererEvent, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// ============================================================================
// FLAT API  (matches ElectronAPI in electron.d.ts exactly)
// ============================================================================

const electronAPI = {
  // ── Window Management ─────────────────────────────────────────────────────
  openCharts:      () => ipcRenderer.invoke('window:openCharts'),
  openSettings:    () => ipcRenderer.invoke('window:openSettings'),
  openAlerts:      () => ipcRenderer.invoke('window:openAlerts'),
  minimizeToTray:  () => ipcRenderer.invoke('window:minimizeToTray'),

  // ── System Tray ───────────────────────────────────────────────────────────
  updateTray: (stats: any) => ipcRenderer.invoke('tray:update', stats),

  // ── Notifications ─────────────────────────────────────────────────────────
  showNotification: (options: { title: string; body: string; urgent?: boolean }) =>
    ipcRenderer.invoke('notification:show', options),

  // ── Electron-store Settings ───────────────────────────────────────────────
  getSetting:    (key: string)             => ipcRenderer.invoke('store:get', key),
  setSetting:    (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
  getAllSettings: ()                        => ipcRenderer.invoke('store:getAll'),

  // ── App Info ──────────────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getAppPath:    () => ipcRenderer.invoke('app:path'),

  // ── Platform Info ─────────────────────────────────────────────────────────
  platform:  process.platform,
  isWindows: process.platform === 'win32',
  isMac:     process.platform === 'darwin',
  isLinux:   process.platform === 'linux',

  // ── UI Events ─────────────────────────────────────────────────────────────
  onRefreshData:  (cb: () => void)              => on('ui:refreshData', cb),
  onThemeChange:  (cb: (theme: string) => void) => on('ui:themeChange', cb),

  // ==========================================================================
  // AUTH IPC
  // ==========================================================================

  authLogin: (identifier: string, password: string) =>
    ipcRenderer.invoke('auth:login', identifier, password),

  authRegister: (email: string, mobile: string, password: string) =>
    ipcRenderer.invoke('auth:register', email, mobile, password),

  authLogout: () =>
    ipcRenderer.invoke('auth:logout'),

  authGetUser: () =>
    ipcRenderer.invoke('auth:getUser'),

  authIsTrialValid: () =>
    ipcRenderer.invoke('auth:isTrialValid'),

  // ==========================================================================
  // ANGEL ONE IPC
  // ==========================================================================

  angelLogin: (credentials: any) =>
    ipcRenderer.invoke('angel:login', credentials),

  angelLogout: () =>
    ipcRenderer.invoke('angel:logout'),

  angelConnect: () =>
    ipcRenderer.invoke('angel:connect'),

  angelDisconnect: () =>
    ipcRenderer.invoke('angel:disconnect'),

  angelSubscribe: (tokens: string[]) =>
    ipcRenderer.invoke('angel:subscribe', tokens),

  angelUnsubscribe: (tokens: string[]) =>
    ipcRenderer.invoke('angel:unsubscribe', tokens),

  angelGetLTP: (exchange: string, symbol: string, token: string) =>
    ipcRenderer.invoke('angel:getLTP', exchange, symbol, token),

  angelGetStatus: () =>
    ipcRenderer.invoke('angel:getStatus'),

  // Angel One — real-time events
  onAngelConnected:    (cb: () => void)                  => on('angel:connected', cb),
  onAngelDisconnected: (cb: (reason: string) => void)    => on('angel:disconnected', cb),
  onAngelTick:         (cb: (tick: any) => void)         => on('angel:tick', cb),
  onAngelError:        (cb: (error: string) => void)     => on('angel:error', cb),

  // ==========================================================================
  // SIGNAL ENGINE IPC
  // ==========================================================================

  signalStart: () =>
    ipcRenderer.invoke('signals:start'),

  signalStop: () =>
    ipcRenderer.invoke('signals:stop'),

  signalGetStatus: () =>
    ipcRenderer.invoke('signals:getStatus'),

  signalUpdateConfig: (config: any) =>
    ipcRenderer.invoke('signals:updateConfig', config),

  signalGetHistory: (symbol?: string, limit?: number) =>
    ipcRenderer.invoke('signals:getHistory', symbol, limit),

  // Signal engine — real-time events
  onSignal:              (cb: (signal: any) => void) => on('signals:new', cb),
  onSignalEngineStarted: (cb: () => void)            => on('signals:started', cb),
  onSignalEngineStopped: (cb: () => void)            => on('signals:stopped', cb),

  // ==========================================================================
  // DATA IPC
  // ==========================================================================

  dataGetTicks: (symbol: string, limit?: number) =>
    ipcRenderer.invoke('data:getTickData', symbol, limit),

  dataGetOptionChain: (symbol: string, expiry: string) =>
    ipcRenderer.invoke('data:getOptionChain', symbol, expiry),

  dataAddToWatchlist: (symbol: string, notes?: string) =>
    ipcRenderer.invoke('data:addToWatchlist', symbol, notes),

  dataRemoveFromWatchlist: (symbol: string) =>
    ipcRenderer.invoke('data:removeFromWatchlist', symbol),

  dataGetWatchlist: () =>
    ipcRenderer.invoke('data:getWatchlist'),

  dataGetStats: () =>
    ipcRenderer.invoke('data:getStats'),

  // ==========================================================================
  // AUTO-UPDATER EVENTS
  // ==========================================================================

  onUpdateAvailable: (cb: () => void) => on('update:available', cb),
  onUpdateDownloaded: (cb: () => void) => on('update:downloaded', cb),

  // ==========================================================================
  // INTELLIGENCE ENGINE IPC
  // ==========================================================================

  intelGetState: () =>
    ipcRenderer.invoke('intel-get-state'),

  intelUpdateFII: (data: { longFutures: number; shortFutures: number }) =>
    ipcRenderer.invoke('intel-update-fii', data),

  intelUpdateCrossAsset: (data: { sgxPrice?: number; usdInr?: number; crude?: number }) =>
    ipcRenderer.invoke('intel-update-cross-asset', data),

  onIntelUpdate: (cb: (state: any) => void) => on('intel-update', cb),
  onIntelAlert:  (cb: (alert: any) => void)  => on('intel-alert',  cb),
};

// ============================================================================
// EXPOSE TO RENDERER
// ── accessible as window.electron
// ============================================================================

contextBridge.exposeInMainWorld('electron', electronAPI);

// ============================================================================
// LEGACY NAMESPACE  (window.electronAPI — used by backup App.tsx files)
// Proxies to the flat API above so old code keeps working without changes.
// ============================================================================

const legacyAPI = {
  auth: {
    login:        electronAPI.authLogin,
    register:     electronAPI.authRegister,
    logout:       electronAPI.authLogout,
    getUser:      electronAPI.authGetUser,
    isTrialValid: electronAPI.authIsTrialValid,
  },
  angel: {
    login:        electronAPI.angelLogin,
    connect:      electronAPI.angelConnect,
    disconnect:   electronAPI.angelDisconnect,
    subscribe:    electronAPI.angelSubscribe,
    unsubscribe:  electronAPI.angelUnsubscribe,
    getLTP:       electronAPI.angelGetLTP,
    getStatus:    electronAPI.angelGetStatus,
    onConnected:  electronAPI.onAngelConnected,
    onDisconnected: electronAPI.onAngelDisconnected,
    onTick:       electronAPI.onAngelTick,
    onError:      electronAPI.onAngelError,
  },
  signals: {
    start:         electronAPI.signalStart,
    stop:          electronAPI.signalStop,
    getStatus:     electronAPI.signalGetStatus,
    updateConfig:  electronAPI.signalUpdateConfig,
    getHistory:    electronAPI.signalGetHistory,
    onSignal:      electronAPI.onSignal,
    onStarted:     electronAPI.onSignalEngineStarted,
    onStopped:     electronAPI.onSignalEngineStopped,
  },
  data: {
    getTickData:           electronAPI.dataGetTicks,
    getOptionChain:        electronAPI.dataGetOptionChain,
    addToWatchlist:        electronAPI.dataAddToWatchlist,
    removeFromWatchlist:   electronAPI.dataRemoveFromWatchlist,
    getWatchlist:          electronAPI.dataGetWatchlist,
    getStats:              electronAPI.dataGetStats,
  },
};

contextBridge.exposeInMainWorld('electronAPI', legacyAPI);