// src/pages/Alerts.tsx - Price Alerts Manager
import React, { useState } from 'react';
import { Bell, Plus, Trash2, Check, X } from 'lucide-react';

interface Alert {
  id: string;
  type: 'nifty' | 'ce' | 'pe' | 'pcr';
  strike?: number;
  condition: 'above' | 'below';
  value: number;
  enabled: boolean;
  triggered: boolean;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([
    {
      id: '1',
      type: 'nifty',
      condition: 'above',
      value: 25500,
      enabled: true,
      triggered: false,
    },
    {
      id: '2',
      type: 'pcr',
      condition: 'above',
      value: 1.3,
      enabled: true,
      triggered: false,
    },
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlert, setNewAlert] = useState<Partial<Alert>>({
    type: 'nifty',
    condition: 'above',
    value: 0,
    enabled: true,
  });

  const addAlert = () => {
    if (newAlert.value && newAlert.value > 0) {
      const alert: Alert = {
        id: Date.now().toString(),
        type: newAlert.type as Alert['type'],
        strike: newAlert.strike,
        condition: newAlert.condition as Alert['condition'],
        value: newAlert.value,
        enabled: true,
        triggered: false,
      };
      
      setAlerts([...alerts, alert]);
      setShowAddForm(false);
      setNewAlert({
        type: 'nifty',
        condition: 'above',
        value: 0,
        enabled: true,
      });

      if (window.electron) {
        window.electron.showNotification({
          title: 'Alert Created',
          body: `New ${alert.type.toUpperCase()} alert added`,
        });
      }
    }
  };

  const deleteAlert = (id: string) => {
    setAlerts(alerts.filter(a => a.id !== id));
  };

  const toggleAlert = (id: string) => {
    setAlerts(alerts.map(a => 
      a.id === id ? { ...a, enabled: !a.enabled } : a
    ));
  };

  const getAlertLabel = (alert: Alert) => {
    let label = alert.type.toUpperCase();
    if (alert.strike) label += ` ${alert.strike}`;
    label += ` ${alert.condition} ${alert.value}`;
    return label;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-orange-900 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-2xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Bell className="text-orange-400" size={32} />
                Price Alerts
              </h1>
              <p className="text-sm text-gray-400 mt-2">
                Get notified when prices hit your targets
              </p>
            </div>
            
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus size={18} />
              New Alert
            </button>
          </div>
        </div>

        {/* Add Alert Form */}
        {showAddForm && (
          <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xl font-semibold text-white mb-4">Create New Alert</h2>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-gray-300 mb-2 text-sm">Type</label>
                <select
                  value={newAlert.type}
                  onChange={(e) => setNewAlert({ ...newAlert, type: e.target.value as Alert['type'] })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                >
                  <option value="nifty">NIFTY Spot</option>
                  <option value="ce">Call Option</option>
                  <option value="pe">Put Option</option>
                  <option value="pcr">PCR</option>
                </select>
              </div>
              
              {(newAlert.type === 'ce' || newAlert.type === 'pe') && (
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Strike</label>
                  <input
                    type="number"
                    value={newAlert.strike || ''}
                    onChange={(e) => setNewAlert({ ...newAlert, strike: parseInt(e.target.value) })}
                    className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                    placeholder="25450"
                  />
                </div>
              )}
              
              <div>
                <label className="block text-gray-300 mb-2 text-sm">Condition</label>
                <select
                  value={newAlert.condition}
                  onChange={(e) => setNewAlert({ ...newAlert, condition: e.target.value as Alert['condition'] })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                >
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
              </div>
              
              <div>
                <label className="block text-gray-300 mb-2 text-sm">Value</label>
                <input
                  type="number"
                  step="0.01"
                  value={newAlert.value || ''}
                  onChange={(e) => setNewAlert({ ...newAlert, value: parseFloat(e.target.value) })}
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded-lg px-4 py-2"
                  placeholder="25500"
                />
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={addAlert}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Check size={18} />
                Create Alert
              </button>
              
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <X size={18} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Alerts List */}
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-12 border border-slate-700 text-center">
              <Bell className="mx-auto text-gray-600 mb-4" size={48} />
              <p className="text-gray-400">No alerts configured</p>
              <p className="text-gray-500 text-sm mt-2">Click "New Alert" to create one</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-4 border ${
                  alert.triggered
                    ? 'border-orange-500'
                    : alert.enabled
                    ? 'border-slate-700'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <input
                      type="checkbox"
                      checked={alert.enabled}
                      onChange={() => toggleAlert(alert.id)}
                      className="w-5 h-5 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                    />
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${alert.enabled ? 'text-white' : 'text-gray-500'}`}>
                          {getAlertLabel(alert)}
                        </span>
                        {alert.triggered && (
                          <span className="text-xs bg-orange-900/50 text-orange-300 px-2 py-1 rounded">
                            TRIGGERED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {alert.enabled ? 'Active' : 'Disabled'}
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => deleteAlert(alert.id)}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
          <p className="text-blue-300 text-sm font-medium mb-2">💡 How Alerts Work</p>
          <p className="text-blue-200 text-xs">
            Desktop notifications will appear when your conditions are met. Make sure notifications are enabled in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
