// ============================================================================
// tabs/SignalsTab.tsx — Trading Signals + Strategy Alerts
// ============================================================================
import { SignalData } from '../../types';
import { n } from '../shared/helpers';

function SignalCard({ signal }: { signal: any }) {
  const colors: Record<string, string> = { HIGH: 'border-red-500/50 bg-red-950/30', MEDIUM: 'border-blue-500/50 bg-blue-950/30', LOW: 'border-gray-600/50 bg-gray-900/30' };
  const typeColors: Record<string, string> = { IV_CRUSH: '#EF4444', IV_EXPANSION: '#22C55E', DELTA_NEUTRAL: '#60A5FA', THETA_DECAY: '#FBBF24', GAMMA_SCALP: '#A78BFA' };
  const confidence = n(signal?.confidence, 0), typeColor = typeColors[signal?.type] || '#6B7280';
  return (
    <div className={`border rounded-xl p-4 mb-3 ${colors[signal?.priority] || colors.LOW}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-xs font-bold px-2 py-0.5 rounded mr-2" style={{ background: typeColor + '33', color: typeColor }}>{(signal?.type || '').replace('_', ' ')}</span>
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${signal?.priority === 'HIGH' ? 'bg-red-900/60 text-red-300' : signal?.priority === 'MEDIUM' ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>{signal?.priority}</span>
        </div>
        <div className="text-right"><div className="text-xs text-gray-500">Confidence</div><div className="font-bold" style={{ color: typeColor }}>{confidence}%</div></div>
      </div>
      <div className="text-sm font-bold text-white mb-1">{signal?.strategy}</div>
      <div className="text-xs text-gray-400 mb-3">{signal?.description}</div>
      <div className="h-1 bg-gray-700 rounded mb-3 overflow-hidden"><div className="h-full rounded" style={{ width: `${confidence}%`, background: typeColor }} /></div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><div className="text-gray-500 mb-0.5">Strikes</div><div className="text-yellow-400 font-bold">{(signal?.strikes || []).join(', ')}</div></div>
        <div><div className="text-gray-500 mb-0.5">Action</div><div className="text-white">{signal?.action}</div></div>
        <div><div className="text-gray-500 mb-0.5">Expected Profit</div><div className="text-green-400">{signal?.expectedProfit}</div></div>
        <div><div className="text-gray-500 mb-0.5">Risk</div><div className="text-red-400">{signal?.risk}</div></div>
      </div>
    </div>
  );
}

function TradingSignalsPanel({ signals }: { signals: any[] }) {
  const [filter, setFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  if (!signals || signals.length === 0) return <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">📡</div><div className="text-sm">Scanning market conditions…</div></div>;
  const filtered = filter === 'ALL' ? signals : signals.filter(s => s.priority === filter);
  const high = signals.filter(s => s.priority === 'HIGH').length, medium = signals.filter(s => s.priority === 'MEDIUM').length, low = signals.filter(s => s.priority === 'LOW').length;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-gray-500">Total {signals.length}</span>
        <span className="text-xs text-red-400">HIGH: {high}</span><span className="text-xs text-blue-400">MEDIUM: {medium}</span><span className="text-xs text-gray-400">LOW: {low}</span>
        <div className="ml-auto flex gap-1">{(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`text-xs px-2 py-0.5 rounded ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}>{f}</button>)}</div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>{filtered.map(s => <SignalCard key={s.id} signal={s} />)}</div>
    </div>
  );
}

// ============================================================================
// IV ANALYSIS PANEL
// ============================================================================

// ── SignalsTab wrapper ─────────────────────────────────────────────────────
export function SignalsTab({ signalData, ivSource, ivPoints }: { signalData: SignalData | null; ivSource?: string; ivPoints: number }) {
  return (
          <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">🎯 Trading Signals</h3>
                {ivSource && <span className={`text-xs px-2 py-0.5 rounded font-bold ${ivSource === 'real_db' ? 'bg-green-900/60 text-green-400' : 'bg-yellow-900/60 text-yellow-400'}`}>{ivSource === 'real_db' ? `📊 Real IV (${ivPoints}pts)` : `⚠️ Est. IV`}</span>}
              </div>
              <TradingSignalsPanel signals={signalData?.signals ?? []} />
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">🔔 Strategy Alerts</h3>
              {signalData?.signals?.length ? (
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 400 }}>
                  {signalData.signals.map(s => (
                    <div key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border ${s.priority === 'HIGH' ? 'border-red-500/40 bg-red-950/20' : s.priority === 'MEDIUM' ? 'border-yellow-500/40 bg-yellow-950/20' : 'border-gray-700 bg-gray-900/50'}`}>
                      <div className="text-xl mt-0.5">{s.type === 'IV_CRUSH' ? '🔥' : s.type === 'IV_EXPANSION' ? '🚀' : s.type === 'DELTA_NEUTRAL' ? '⚖️' : s.type === 'THETA_DECAY' ? '⏳' : '🎯'}</div>
                      <div className="flex-1"><div className="text-sm font-bold text-white">{s.strategy}</div><div className="text-xs text-gray-400 mt-0.5">{s.action}</div><div className="text-xs text-green-400 mt-1">{s.expectedProfit}</div></div>
                      <div className="text-right"><div className="text-xs font-bold text-white">{n(s.confidence)}%</div><div className="text-xs text-gray-500">confidence</div></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">🔕</div><div className="text-sm">No strategy setups detected</div></div>
              )}
            </div>
          </div>
        )}
  );
}

