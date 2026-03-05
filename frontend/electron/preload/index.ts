// electron/preload/index.ts - Secure IPC Bridge
import { contextBridge, ipcRenderer } from 'electron';

// ============================================================================
// ELECTRON API - Exposed to Renderer
// ============================================================================

const electronAPI = {
  // Window Management
  openCharts: () => ipcRenderer.invoke('open-charts'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openAlerts: () => ipcRenderer.invoke('open-alerts'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),

  // Tray Updates
  updateTray: (stats: any) => ipcRenderer.invoke('update-tray', stats),

  // Notifications
  showNotification: (options: { title: string; body: string; urgent?: boolean }) =>
    ipcRenderer.invoke('show-notification', options),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),

  // App Info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // Event Listeners
  onRefreshData: (callback: () => void) => {
    ipcRenderer.on('refresh-data', callback);
    return () => ipcRenderer.removeListener('refresh-data', callback);
  },

  onThemeChange: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-change', (_event, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners('theme-change');
  },

  // Platform Info
  platform: process.platform,
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
};

// ============================================================================
// EXPOSE API TO RENDERER
// ============================================================================

contextBridge.exposeInMainWorld('electron', electronAPI);

// ============================================================================
// TYPE DEFINITIONS (for TypeScript)
// ============================================================================

export type ElectronAPI = typeof electronAPI;

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
