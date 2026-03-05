// ============================================================================
// shared/NetComponents.tsx — SignalBars, NetWidget, NetToasts, OfflineBanner,
//                            NetworkDetailPanel
// ============================================================================
import { NetStatus, NetToast } from '../types';

export function SignalBars({ quality }: { quality: NetStatus['quality'] }) {
  const filled = { EXCELLENT: 4, GOOD: 3, FAIR: 2, POOR: 1, OFFLINE: 0 }[quality];
  const color  = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[quality];
  return (
    <div className="flex items-end gap-0.5" style={{ height: 14 }}>
      {[4, 7, 10, 14].map((h, i) => (
        <div key={i} style={{ width: 3, height: h, borderRadius: 1,
          background: i < filled ? color : 'rgba(255,255,255,0.15)',
          transition: 'background 0.4s' }} />
      ))}
    </div>
  );
}

// ============================================================================
// 🌐 NET WIDGET — top bar compact display
// ============================================================================

export function NetWidget({ net, onTest, isTesting }: { net: NetStatus; onTest: () => void; isTesting: boolean }) {
  const qColor = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[net.quality];
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-lg text-xs"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${qColor}30` }}>
      <SignalBars quality={net.quality} />
      <div className="flex flex-col leading-tight">
        <span style={{ color: qColor }} className="font-bold text-xs leading-none">
          {net.quality === 'OFFLINE' ? '● OFFLINE'
            : net.downloadMbps != null
              ? `${net.downloadMbps >= 1 ? net.downloadMbps.toFixed(1) : (net.downloadMbps * 1000).toFixed(0) + 'k'} Mbps`
              : net.quality}
        </span>
        <span className="text-gray-500 leading-none" style={{ fontSize: 9 }}>
          {net.latencyMs != null ? `${net.latencyMs}ms` : '–'}{net.jitterMs ? ` ±${net.jitterMs}ms` : ''}{net.packetLoss > 0 ? ` · ${net.packetLoss}%loss` : ''}
        </span>
      </div>
      <button onClick={onTest} disabled={isTesting} title="Run speed test"
        className="text-gray-500 hover:text-white transition-colors" style={{ fontSize: 11 }}>
        {isTesting ? '⟳' : '🔄'}
      </button>
    </div>
  );
}

// ============================================================================
// 🌐 TOAST NOTIFICATIONS
// ============================================================================

export function NetToasts({ toasts }: { toasts: NetToast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-14 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <style>{`@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      {toasts.map(t => {
        const bg     = t.level === 'CRITICAL' ? '#450a0a' : t.level === 'WARNING' ? '#431407' : '#052e16';
        const border = t.level === 'CRITICAL' ? '#dc2626' : t.level === 'WARNING' ? '#ea580c' : '#16a34a';
        const icon   = t.level === 'CRITICAL' ? '🔴'      : t.level === 'WARNING' ? '⚠️'      : '✅';
        return (
          <div key={t.id} style={{ background: bg, border: `1px solid ${border}`, borderLeft: `4px solid ${border}`, animation: 'slideIn 0.3s ease' }}
            className="rounded-lg px-4 py-3 text-sm text-white max-w-xs shadow-2xl pointer-events-auto">
            <div className="flex items-center gap-2"><span>{icon}</span><span className="font-semibold">{t.level}</span></div>
            <div className="text-gray-300 text-xs mt-1">{t.message}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 🌐 OFFLINE BANNER — full-width, hard to miss
// ============================================================================

export function OfflineBanner({ net }: { net: NetStatus }) {
  if (net.quality !== 'OFFLINE' && net.quality !== 'POOR') return null;
  const isCritical = net.quality === 'OFFLINE';
  return (
    <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 text-xs font-bold"
      style={{
        background: isCritical ? 'rgba(127,29,29,0.95)' : 'rgba(124,45,18,0.90)',
        borderBottom: `2px solid ${isCritical ? '#dc2626' : '#ea580c'}`,
        animation: isCritical ? 'pulse 2s infinite' : 'none',
      }}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{isCritical ? '🔴' : '🟠'}</span>
        <div>
          <div style={{ color: isCritical ? '#fca5a5' : '#fdba74' }}>
            {isCritical
              ? '⚠️ INTERNET CONNECTION LOST — Angel One WebSocket has disconnected!'
              : '⚠️ POOR INTERNET — High latency detected. Data feed may be delayed.'}
          </div>
          <div className="text-gray-400 font-normal mt-0.5">
            {isCritical
              ? `${net.consecutiveFailures} consecutive check failures · Both backend + browser internet check failed · Last checked: ${new Date(net.lastChecked).toLocaleTimeString('en-IN')}`
              : `Latency: ${net.latencyMs}ms · Jitter: ±${net.jitterMs}ms · Packet loss: ${net.packetLoss}%`}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div style={{ color: isCritical ? '#f87171' : '#fb923c' }}>{isCritical ? 'OFFLINE' : `${net.latencyMs}ms`}</div>
        <div className="text-gray-500 font-normal">{isCritical ? 'No packets' : 'HIGH LATENCY'}</div>
      </div>
    </div>
  );
}

// ============================================================================
// 🌐 NETWORK DETAIL TAB PANEL
// ============================================================================

export function NetworkDetailPanel({ net, onTest, isTesting }: { net: NetStatus; onTest: () => void; isTesting: boolean }) {
  const qual = net.quality;
  const qColor = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[qual];
  const speedPercent = Math.min(100, ((net.downloadMbps ?? 0) / 100) * 100);
  const latPct = Math.min(100, (1 - Math.min((net.latencyMs ?? 300) / 300, 1)) * 100);
  const tradingRating = qual === 'EXCELLENT' ? 'Optimal for live trading' : qual === 'GOOD' ? 'Suitable for trading' : qual === 'FAIR' ? 'Trade with caution — delayed fills possible' : qual === 'POOR' ? 'NOT recommended for live trading' : 'STOP TRADING — connection lost';
  const tradingColor = qual === 'EXCELLENT' || qual === 'GOOD' ? '#22C55E' : qual === 'FAIR' ? '#FACC15' : '#EF4444';
  const rows = [
    { label: 'Status',      value: qual,                           color: qColor },
    { label: 'Download',    value: net.downloadMbps != null ? `${net.downloadMbps >= 1 ? net.downloadMbps.toFixed(2) : (net.downloadMbps * 1000).toFixed(1) + 'k'} Mbps` : '–', color: '#60A5FA' },
    { label: 'Ping (Avg)',  value: net.latencyMs != null ? `${net.latencyMs} ms` : '–', color: net.latencyMs != null && net.latencyMs < 50 ? '#22C55E' : net.latencyMs && net.latencyMs < 120 ? '#FACC15' : '#EF4444' },
    { label: 'Jitter',      value: net.jitterMs != null ? `±${net.jitterMs} ms` : '–', color: '#A78BFA' },
    { label: 'Packet Loss', value: `${net.packetLoss}%`,           color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' },
    { label: 'Failures',    value: String(net.consecutiveFailures), color: net.consecutiveFailures === 0 ? '#22C55E' : '#EF4444' },
    { label: 'Last Check',  value: new Date(net.lastChecked).toLocaleTimeString('en-IN'), color: '#9CA3AF' },
  ];
  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="grid grid-cols-3 gap-4 max-w-4xl mx-auto">

        {/* Quality card */}
        <div className="col-span-1 bg-gray-900 rounded-xl border p-5 flex flex-col items-center justify-center" style={{ borderColor: qColor + '40' }}>
          <div className="mb-3"><SignalBars quality={qual} /></div>
          <div className="text-4xl font-black mb-1" style={{ color: qColor }}>{qual}</div>
          <div className="text-xs text-center" style={{ color: tradingColor }}>{tradingRating}</div>
          <button onClick={onTest} disabled={isTesting} className="mt-4 px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{ background: isTesting ? 'rgba(255,255,255,0.05)' : qColor + '20', border: `1px solid ${qColor}50`, color: isTesting ? '#6B7280' : qColor }}>
            {isTesting ? '⟳ Running...' : '🔄 Run Speed Test'}
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
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Download Speed</span>
              <span className="text-blue-400 font-bold">{net.downloadMbps != null ? `${net.downloadMbps.toFixed(1)} Mbps` : 'Testing…'}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${speedPercent}%`, background: 'linear-gradient(90deg,#3B82F6,#06B6D4)' }} />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5"><span>0</span><span>50</span><span>100+ Mbps</span></div>
          </div>
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Ping Quality</span>
              <span className="font-bold" style={{ color: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444' }}>{net.latencyMs != null ? `${net.latencyMs}ms` : '–'}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${latPct}%`, background: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444' }} />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5"><span>0ms</span><span>150ms</span><span>300ms+</span></div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Packet Loss</span>
              <span className="font-bold" style={{ color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' }}>{net.packetLoss}%</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex-1 h-3 rounded-sm transition-all duration-500"
                  style={{ background: net.packetLoss >= (i + 1) * 10 ? (net.packetLoss >= 50 ? '#EF4444' : '#F97316') : '#1F2937' }} />
              ))}
            </div>
          </div>
        </div>

        {/* Trading impact */}
        <div className="col-span-3 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">📡 Trading Impact Analysis</h3>
          <div className="grid grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Angel One WebSocket', ok: qual !== 'OFFLINE',                       note: qual === 'OFFLINE' ? 'DISCONNECTED' : qual === 'POOR' ? 'Unstable'  : 'Connected' },
              { label: 'Order Execution',     ok: !['OFFLINE', 'POOR'].includes(qual),      note: qual === 'OFFLINE' ? 'BLOCKED'      : qual === 'POOR' ? 'Delayed'   : 'Normal' },
              { label: 'Live Data Feed',      ok: !['OFFLINE', 'POOR'].includes(qual),      note: qual === 'OFFLINE' ? 'STOPPED'      : qual === 'POOR' ? 'Lagging'   : 'Live' },
              { label: 'DB Write Speed',      ok: qual !== 'OFFLINE',                       note: qual === 'OFFLINE' ? 'Local only'                                    : 'Normal' },
            ].map(item => (
              <div key={item.label} className="rounded-lg p-3 text-center"
                style={{ background: item.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.12)', border: `1px solid ${item.ok ? '#22C55E30' : '#EF444430'}` }}>
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

