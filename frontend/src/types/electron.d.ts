// src/types/electron.d.ts
export interface ElectronAPI {
  openCharts: () => Promise<void>;
  openSettings: () => Promise<void>;
  openAlerts: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  updateTray: (stats: any) => Promise<void>;
  showNotification: (options: { title: string; body: string; urgent?: boolean }) => Promise<void>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<boolean>;
  getAllSettings: () => Promise<any>;
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  onRefreshData: (callback: () => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  platform: string;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
