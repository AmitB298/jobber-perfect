// ============================================================================
// tabs/NetworkTab.tsx — Network quality detail panel
// ============================================================================
import type { NetStatus } from '../../types';
import { SignalBars } from '../shared/NetComponents';

interface Props {
  net: NetStatus;
  onTest: () => void;
  isTesting: boolean;
}

export function NetworkTab({ net, onTest, isTesting }: Props) {
  const qual = net.quality;
  const qColor = {
    EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15',
    POOR: '#F97316', OFFLINE: '#EF4444',
  }[qual];

  const speedPercent = Math.min(100, ((net.downloadMbps ?? 0) / 100) * 100);
  const latPct       = Math.min(100, (1 - Math.min((net.latencyMs ?? 300) / 300, 1)) * 100);

  const tradingRating =
    qual === 'EXCELLENT' ? 'Optimal for live trading'
    : qual === 'GOOD'    ? 'Suitable for trading'
    : qual === 'FAIR'    ? 'Trade with caution — delayed fills possible'
    : qual === 'POOR'    ? 'NOT recommended for live trading'
    :                      'STOP TRADING — connection lost';

  const tradingColor = (qual === 'EXCELLENT' || qual === 'GOOD') ? '#22C55E'
    : qual === 'FAIR' ? '#FACC15' : '#EF4444';

  const rows: Array<{ label: string; value: string; color: string }> = [
    { label: 'Status',
      value: qual,
      color: qColor },
    { label: 'Download',
      value: net.downloadMbps != null
        ? `${net.downloadMbps >= 1 ? net.downloadMbps.toFixed(2) : (net.downloadMbps * 1000).toFixed(1) + 'k'} Mbps`
        : '–',
      color: '#60A5FA' },
    { label: 'Ping (Avg)',
      value: net.latencyMs != null ? `${net.latencyMs} ms` : '–',
      color: net.latencyMs != null && net.latencyMs < 50 ? '#22C55E'
        : net.latencyMs && net.latencyMs < 120 ? '#FACC15' : '#EF4444' },
    { label: 'Jitter',
      value: net.jitterMs != null ? `±${net.jitterMs} ms` : '–',
      color: '#A78BFA' },
    { label: 'Packet Loss',
      value: `${net.packetLoss}%`,
      color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' },
    { label: 'Failures',
      value: String(net.consecutiveFailures),
      color: net.consecutiveFailures === 0 ? '#22C55E' : '#EF4444' },
    { label: 'Last Check',
      value: new Date(net.lastChecked).toLocaleTimeString('en-IN'),
      color: '#9CA3AF' },
  ];

  const impacts = [
    { label: 'Angel One WebSocket',
      ok: qual !== 'OFFLINE',
      note: qual === 'OFFLINE' ? 'DISCONNECTED' : qual === 'POOR' ? 'Unstable' : 'Connected' },
    { label: 'Order Execution',
      ok: !(['OFFLINE', 'POOR'] as const).includes(qual),
      note: qual === 'OFFLINE' ? 'BLOCKED' : qual === 'POOR' ? 'Delayed' : 'Normal' },
    { label: 'Live Data Feed',
      ok: !(['OFFLINE', 'POOR'] as const).includes(qual),
      note: qual === 'OFFLINE' ? 'STOPPED' : qual === 'POOR' ? 'Lagging' : 'Live' },
    { label: 'DB Write Speed',
      ok: qual !== 'OFFLINE',
      note: qual === 'OFFLINE' ? 'Local only' : 'Normal' },
  ];

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="grid grid-cols-3 gap-4 max-w-4xl mx-auto">

        {/* Quality card */}
        <div
          className="col-span-1 bg-gray-900 rounded-xl border p-5 flex flex-col items-center justify-center"
          style={{ borderColor: qColor + '40' }}
        >
          <div className="mb-3"><SignalBars quality={qual} /></div>
          <div className="text-4xl font-black mb-1" style={{ color: qColor }}>{qual}</div>
          <div className="text-xs text-center" style={{ color: tradingColor }}>{tradingRating}</div>
          <button
            onClick={onTest}
            disabled={isTesting}
            className="mt-4 px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              background: isTesting ? 'rgba(255,255,255,0.05)' : qColor + '20',
              border: `1px solid ${qColor}50`,
              color: isTesting ? '#6B7280' : qColor,
            }}
          >
            {isTesting ? '⟳ Running…' : '🔄 Run Speed Test'}
          </button>
        </div>

        {/* Stats */}
        <div className="col-span-1 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Network Stats</h3>
          <div className="space-y-3">
            {rows.map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">{r.label}</span>
                <span className="text-xs font-bold" style={{ color: r.color }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gauges */}
        <div className="col-span-1 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Live Gauges</h3>

          {/* Download speed */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Download Speed</span>
              <span className="text-blue-400 font-bold">
                {net.downloadMbps != null ? `${net.downloadMbps.toFixed(1)} Mbps` : 'Testing…'}
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${speedPercent}%`, background: 'linear-gradient(90deg,#3B82F6,#06B6D4)' }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5">
              <span>0</span><span>50</span><span>100+ Mbps</span>
            </div>
          </div>

          {/* Ping quality */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Ping Quality</span>
              <span className="font-bold" style={{ color: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444' }}>
                {net.latencyMs != null ? `${net.latencyMs}ms` : '–'}
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${latPct}%`,
                  background: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444',
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5">
              <span>0ms</span><span>150ms</span><span>300ms+</span>
            </div>
          </div>

          {/* Packet loss */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Packet Loss</span>
              <span
                className="font-bold"
                style={{ color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' }}
              >
                {net.packetLoss}%
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 h-3 rounded-sm transition-all duration-500"
                  style={{
                    background: net.packetLoss >= (i + 1) * 10
                      ? (net.packetLoss >= 50 ? '#EF4444' : '#F97316')
                      : '#1F2937',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Trading impact */}
        <div className="col-span-3 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">
            📡 Trading Impact Analysis
          </h3>
          <div className="grid grid-cols-4 gap-3 text-xs">
            {impacts.map(item => (
              <div
                key={item.label}
                className="rounded-lg p-3 text-center"
                style={{
                  background: item.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${item.ok ? '#22C55E30' : '#EF444430'}`,
                }}
              >
                <div className="text-lg mb-1">{item.ok ? '✅' : '❌'}</div>
                <div className="font-bold text-white">{item.label}</div>
                <div style={{ color: item.ok ? '#22C55E' : '#EF4444' }}>{item.note}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

