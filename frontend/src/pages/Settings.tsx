// src/pages/Settings.tsx - Application Settings
import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Bell, Database, Palette, Info, Save, RotateCcw } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    // Notifications
    enableNotifications: true,
    priceAlerts: true,
    pcrAlerts: true,
    soundEnabled: true,
    
    // Data
    autoRefresh: true,
    refreshInterval: 2,
    cacheData: true,
    
    // Appearance
    theme: 'dark',
    compactMode: false,
    
    // API
    apiUrl: 'http://localhost:3001',
  });

  const [appVersion, setAppVersion] = useState('1.0.0');
  const [appPath, setAppPath] = useState('');

  useEffect(() => {
    loadSettings();
    loadAppInfo();
  }, []);

  const loadSettings = async () => {
    if (window.electron) {
      const allSettings = await window.electron.getAllSettings();
      setSettings({ ...settings, ...allSettings });
    }
  };

  const loadAppInfo = async () => {
    if (window.electron) {
      const version = await window.electron.getAppVersion();
      const path = await window.electron.getAppPath();
      setAppVersion(version);
      setAppPath(path);
    }
  };

  const handleSave = async () => {
    if (window.electron) {
      for (const [key, value] of Object.entries(settings)) {
        await window.electron.setSetting(key, value);
      }
      
      window.electron.showNotification({
        title: 'Settings Saved',
        body: 'Your settings have been saved successfully.',
      });
    }
  };

  const handleReset = () => {
    setSettings({
      enableNotifications: true,
      priceAlerts: true,
      pcrAlerts: true,
      soundEnabled: true,
      autoRefresh: true,
      refreshInterval: 2,
      cacheData: true,
      theme: 'dark',
      compactMode: false,
      apiUrl: 'http://localhost:3001',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <SettingsIcon className="text-blue-400" size={32} />
            Settings
          </h1>
          <p className="text-gray-400 mt-2">Configure your NIFTY Options Tracker experience</p>
        </div>

        <div className="space-y-6">
          {/* Notifications */}
          <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Bell className="text-orange-400" size={20} />
              Notifications
            </h2>
            
            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Enable Desktop Notifications</span>
                <input
                  type="checkbox"
                  checked={settings.enableNotifications}
                  onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Price Change Alerts</span>
                <input
                  type="checkbox"
                  checked={settings.priceAlerts}
                  onChange={(e) => setSettings({ ...settings, priceAlerts: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              
              <label className="flex items-center justify-between">
                <span className="text-gray-300">PCR Change Alerts</span>
                <input
                  type="checkbox"
                  checked={settings.pcrAlerts}
                  onChange={(e) => setSettings({ ...settings, pcrAlerts: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Sound Effects</span>
                <input
                  type="checkbox"
                  checked={settings.soundEnabled}
                  onChange={(e) => setSettings({ ...settings, soundEnabled: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
          </div>

          {/* Data Settings */}
          <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Database className="text-green-400" size={20} />
              Data Management
            </h2>
            
            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Auto-Refresh Data</span>
                <input
                  type="checkbox"
                  checked={settings.autoRefresh}
                  onChange={(e) => setSettings({ ...settings, autoRefresh: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              
              <div>
                <label className="block text-gray-300 mb-2">
                  Refresh Interval (seconds)
                </label>
                <select
                  value={settings.refreshInterval}
                  onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                >
                  <option value={1}>1 second</option>
                  <option value={2}>2 seconds</option>
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                </select>
              </div>
              
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Cache Data Locally</span>
                <input
                  type="checkbox"
                  checked={settings.cacheData}
                  onChange={(e) => setSettings({ ...settings, cacheData: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              
              <div>
                <label className="block text-gray-300 mb-2">
                  API Server URL
                </label>
                <input
                  type="text"
                  value={settings.apiUrl}
                  onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                  placeholder="http://localhost:3001"
                />
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Palette className="text-purple-400" size={20} />
              Appearance
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2">
                  Theme
                </label>
                <select
                  value={settings.theme}
                  onChange={(e) => setSettings({ ...settings, theme: e.target.value })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light (Coming Soon)</option>
                </select>
              </div>
              
              <label className="flex items-center justify-between">
                <span className="text-gray-300">Compact Mode</span>
                <input
                  type="checkbox"
                  checked={settings.compactMode}
                  onChange={(e) => setSettings({ ...settings, compactMode: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
          </div>

          {/* App Info */}
          <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Info className="text-blue-400" size={20} />
              Application Info
            </h2>
            
            <div className="space-y-3 text-gray-300">
              <div className="flex justify-between">
                <span>Version:</span>
                <span className="font-mono">{appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span>Data Path:</span>
                <span className="font-mono text-xs truncate max-w-xs">{appPath}</span>
              </div>
              <div className="flex justify-between">
                <span>Platform:</span>
                <span className="font-mono">{window.electron?.platform || 'Unknown'}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={handleSave}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Save size={18} />
              Save Settings
            </button>
            
            <button
              onClick={handleReset}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={18} />
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
