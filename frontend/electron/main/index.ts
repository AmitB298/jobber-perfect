// electron/main/index.ts - Advanced Main Process
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell } from 'electron';
import path from 'path';
import Store from 'electron-store';

// ============================================================================
// CONFIGURATION
// ============================================================================

const store = new Store();
const isDev = process.env.NODE_ENV !== 'production';
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

interface AppStats {
  nifty: number;
  pcr_oi: number;
  pcr_volume: number;
  maxPain: number;
  totalTicks: number;
}

// ============================================================================
// WINDOW MANAGEMENT
// ============================================================================

let mainWindow: BrowserWindow | null = null;
let chartsWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let alertsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Create Main Dashboard Window
function createMainWindow() {
  const windowState = store.get('mainWindowState', {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined,
  }) as any;

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1200,
    minHeight: 700,
    title: 'NIFTY Options Tracker - Desktop',
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#0f172a',
    show: false,
    frame: true,
    titleBarStyle: 'default',
  });

  // Load app
  if (isDev) {
    mainWindow.loadURL(`${VITE_DEV_SERVER_URL}#/dashboard`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'), {
      hash: '/dashboard'
    });
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Save window state on resize/move
  const saveWindowState = () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      store.set('mainWindowState', bounds);
    }
  };

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Handle close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      
      // Show notification
      new Notification({
        title: 'NIFTY Options Tracker',
        body: 'App minimized to system tray. Click the tray icon to restore.',
      }).show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

// Create Charts Window
function createChartsWindow() {
  if (chartsWindow) {
    chartsWindow.focus();
    return;
  }

  const windowState = store.get('chartsWindowState', {
    width: 1200,
    height: 700,
  }) as any;

  chartsWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    title: 'Premium Charts & Analysis',
    parent: mainWindow!,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
  });

  const chartsUrl = isDev 
    ? `${VITE_DEV_SERVER_URL}#/charts`
    : `file://${path.join(__dirname, '../../dist/index.html')}#/charts`;

  chartsWindow.loadURL(chartsUrl);

  const saveChartsWindowState = () => {
    if (chartsWindow) {
      const bounds = chartsWindow.getBounds();
      store.set('chartsWindowState', { width: bounds.width, height: bounds.height });
    }
  };

  chartsWindow.on('resize', saveChartsWindowState);

  chartsWindow.on('closed', () => {
    chartsWindow = null;
  });
}

// Create Settings Window
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 700,
    height: 600,
    resizable: false,
    title: 'Settings',
    parent: mainWindow!,
    modal: false,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
  });

  const settingsUrl = isDev 
    ? `${VITE_DEV_SERVER_URL}#/settings`
    : `file://${path.join(__dirname, '../../dist/index.html')}#/settings`;

  settingsWindow.loadURL(settingsUrl);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Create Alerts Window (Floating)
function createAlertsWindow() {
  if (alertsWindow) {
    alertsWindow.focus();
    return;
  }

  alertsWindow = new BrowserWindow({
    width: 400,
    height: 500,
    title: 'Price Alerts',
    alwaysOnTop: true,
    frame: true,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
  });

  const alertsUrl = isDev 
    ? `${VITE_DEV_SERVER_URL}#/alerts`
    : `file://${path.join(__dirname, '../../dist/index.html')}#/alerts`;

  alertsWindow.loadURL(alertsUrl);

  alertsWindow.on('closed', () => {
    alertsWindow = null;
  });
}

// ============================================================================
// SYSTEM TRAY
// ============================================================================

function createTray() {
  // Create tray icon (16x16 for Windows)
  const iconPath = isDev
    ? path.join(__dirname, '../../public/tray-icon.png')
    : path.join(process.resourcesPath, 'tray-icon.png');
  
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // Fallback: create a simple colored square if icon not found
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon);
  
  // Set tooltip
  tray.setToolTip('NIFTY Options Tracker - Click to open');
  
  // Double-click to show main window
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  updateTrayMenu();
}

function updateTrayMenu(stats?: AppStats) {
  if (!tray) return;

  const template: any[] = [
    {
      label: '📊 NIFTY Options Tracker',
      enabled: false,
    },
    { type: 'separator' },
  ];

  // Add stats if available
  if (stats) {
    template.push(
      { label: `NIFTY: ₹${stats.nifty.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, enabled: false },
      { label: `PCR (OI): ${stats.pcr_oi?.toFixed(2) || 'N/A'}`, enabled: false },
      { label: `PCR (Vol): ${stats.pcr_volume?.toFixed(2) || 'N/A'}`, enabled: false },
      { label: `Max Pain: ${stats.maxPain?.toLocaleString('en-IN') || 'N/A'}`, enabled: false },
      { label: `Total Ticks: ${stats.totalTicks?.toLocaleString('en-IN') || '0'}`, enabled: false },
      { type: 'separator' }
    );
  }

  template.push(
    {
      label: '🪟 Open Dashboard',
      click: () => {
        if (!mainWindow) {
          createMainWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '📈 Open Charts',
      click: createChartsWindow,
    },
    {
      label: '🔔 Price Alerts',
      click: createAlertsWindow,
    },
    { type: 'separator' },
    {
      label: '⚙️ Settings',
      click: createSettingsWindow,
    },
    { type: 'separator' },
    {
      label: 'Refresh Data',
      click: () => {
        mainWindow?.webContents.send('refresh-data');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function showNotification(title: string, body: string, urgent = false) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title,
    body,
    icon: path.join(__dirname, '../../public/icon.png'),
    urgency: urgent ? 'critical' : 'normal',
    silent: !urgent,
  });

  notification.show();

  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ============================================================================
// APPLICATION MENU
// ============================================================================

function createApplicationMenu() {
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Data',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow?.webContents.send('refresh-data');
          },
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: createSettingsWindow,
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            (app as any).isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.show(),
        },
        {
          label: 'Charts',
          accelerator: 'CmdOrCtrl+2',
          click: createChartsWindow,
        },
        {
          label: 'Alerts',
          accelerator: 'CmdOrCtrl+3',
          click: createAlertsWindow,
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow?.hide(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/yourusername/nifty-options-tracker');
          },
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/yourusername/nifty-options-tracker/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const aboutWindow = new BrowserWindow({
              width: 400,
              height: 300,
              resizable: false,
              minimizable: false,
              maximizable: false,
              title: 'About',
              parent: mainWindow!,
              modal: true,
            });
            aboutWindow.loadURL(`data:text/html;charset=utf-8,
              <html>
                <head><title>About</title></head>
                <body style="font-family: Arial; padding: 40px; text-align: center; background: #0f172a; color: white;">
                  <h1>NIFTY Options Tracker</h1>
                  <p>Version 1.0.0</p>
                  <p>Real-time NIFTY options analysis platform</p>
                  <p style="margin-top: 30px; color: #94a3b8;">Built with Electron, React, and TypeScript</p>
                </body>
              </html>
            `);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

// Window management
ipcMain.handle('open-charts', () => {
  createChartsWindow();
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('open-alerts', () => {
  createAlertsWindow();
});

ipcMain.handle('minimize-to-tray', () => {
  mainWindow?.hide();
});

// Tray updates
ipcMain.handle('update-tray', (_event, stats: AppStats) => {
  updateTrayMenu(stats);
});

// Notifications
ipcMain.handle('show-notification', (_event, { title, body, urgent }) => {
  showNotification(title, body, urgent);
});

// Settings
ipcMain.handle('get-setting', (_event, key: string) => {
  return store.get(key);
});

ipcMain.handle('set-setting', (_event, key: string, value: any) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('get-all-settings', () => {
  return store.store;
});

// App info
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  createApplicationMenu();

  // Set app user model id for Windows
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.niftytracker.app');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, just hide to tray
    // Uncomment below to quit instead:
    // app.quit();
  }
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ============================================================================
// AUTO-UPDATE
// ============================================================================

import { autoUpdater } from 'electron-updater';

if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify();
  
  autoUpdater.on('update-available', () => {
    showNotification('Update Available', 'A new version is downloading in the background...');
  });

  autoUpdater.on('update-downloaded', () => {
    showNotification(
      'Update Ready',
      'Click to restart and install the update.',
      true
    );
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Log to file in production
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
