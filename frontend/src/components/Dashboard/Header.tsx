const Header: React.FC<{ [key: string]: any }> = ({ spotPrice = 0, spotChange = 0, spotChangePercent = 0, isConnected = false, lastUpdated = '', onLogout }) => {
  const up = Number(spotChange) >= 0;
  return (
    <div className="h-14 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="text-blue-400 font-bold text-lg">⚡ JOBBER PRO</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${isConnected ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
          {isConnected ? '● LIVE' : '● OFFLINE'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-sm">NIFTY</span>
        <span className="text-white font-bold text-lg">₹{Number(spotPrice).toFixed(2)}</span>
        <span className={`text-sm font-medium ${up ? 'text-green-400' : 'text-red-400'}`}>
          {up ? '▲' : '▼'} {Math.abs(Number(spotChange)).toFixed(2)} ({Math.abs(Number(spotChangePercent)).toFixed(2)}%)
        </span>
      </div>
      <div className="flex items-center gap-3">
        {lastUpdated && <span className="text-gray-500 text-xs">{lastUpdated}</span>}
        {onLogout && <button onClick={onLogout} className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 border border-gray-700 rounded">Logout</button>}
      </div>
    </div>
  );
};
export default Header;

