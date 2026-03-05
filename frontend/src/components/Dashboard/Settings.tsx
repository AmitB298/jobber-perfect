import { useState } from 'react';
const Settings: React.FC<{ [key: string]: any }> = ({ refreshInterval = 3000, onRefreshIntervalChange, onClearData }) => {
  const [interval, setIntervalVal] = useState(refreshInterval);
  return (
    <div className="flex-1 overflow-auto p-6">
      <h2 className="text-white text-xl font-bold mb-6">⚙️ Settings</h2>
      <div className="max-w-xl space-y-6">
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 className="text-white font-semibold mb-3">Data Refresh</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-gray-400 text-sm">Auto-refresh</span><span className="text-blue-400 font-bold">{interval/1000}s</span></div>
            <input type="range" min={1000} max={10000} step={500} value={interval}
              onChange={e => { setIntervalVal(Number(e.target.value)); onRefreshIntervalChange?.(Number(e.target.value)); }}
              className="w-full accent-blue-500" />
            <div className="flex justify-between text-xs text-gray-500"><span>1s</span><span>5s</span><span>10s</span></div>
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 className="text-white font-semibold mb-3">API</h3>
          <div><label className="text-gray-400 text-xs block mb-1">Backend URL</label>
            <input type="text" defaultValue="http://localhost:3001" className="w-full bg-gray-900 text-white text-sm border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        {onClearData && (
          <div className="bg-gray-800 rounded-lg p-5 border border-red-900">
            <h3 className="text-red-400 font-semibold mb-3">⚠️ Danger Zone</h3>
            <button onClick={onClearData} className="px-4 py-2 bg-red-900 text-red-400 rounded-lg text-sm hover:bg-red-800 border border-red-700">Clear Cached Data</button>
          </div>
        )}
      </div>
    </div>
  );
};
export default Settings;

