// ============================================================================
// tabs/AnalyticsTab.tsx — IV Analysis + Expected Move
// ============================================================================
import { SignalData } from '../../types';
import { n } from '../shared/helpers';

function IVAnalysisPanel({ ivAnalysis }: { ivAnalysis: any }) {
  if (!ivAnalysis) return <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">📊</div><div className="text-sm">Loading IV analysis…</div></div>;
  const rank = n(ivAnalysis.ivRank, 50), percentile = n(ivAnalysis.ivPercentile, 50), currentIV = n(ivAnalysis.currentIV, 20);
  const statusColors: Record<string, string> = { LOW: '#22C55E', NORMAL: '#60A5FA', HIGH: '#F97316', EXTREME: '#EF4444' };
  const statusColor = statusColors[ivAnalysis.status] || '#6B7280';
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 text-center border" style={{ borderColor: statusColor + '50', background: statusColor + '15' }}>
        <div className="text-lg font-bold mb-1" style={{ color: statusColor }}>{ivAnalysis.status} IV</div>
        <div className="text-xs text-gray-400">{ivAnalysis.status === 'LOW' ? 'Consider buying options (cheap premium)' : ivAnalysis.status === 'HIGH' ? 'Consider selling options (rich premium)' : ivAnalysis.status === 'EXTREME' ? 'Extreme IV — high risk' : 'No strong edge — be selective'}</div>
        <div className="text-sm font-bold mt-2" style={{ color: ivAnalysis.signal === 'BUY_PREMIUM' ? '#22C55E' : ivAnalysis.signal === 'SELL_PREMIUM' ? '#EF4444' : '#FCD34D' }}>— {ivAnalysis.signal?.replace('_', ' ') || 'NEUTRAL'} —</div>
      </div>
      <div className="text-center"><div className="text-xs text-gray-500 mb-1">ATM Implied Volatility</div><div className="text-3xl font-bold" style={{ color: ivColor(currentIV) }}>{currentIV.toFixed(2)}%</div></div>
      <div className="grid grid-cols-2 gap-4">
        {[{ label: 'IV Percentile', value: percentile }, { label: 'IV Rank', value: rank }].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-xs text-gray-500 mb-2">{label}</div>
            <div className="relative w-24 h-24 mx-auto">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#374151" strokeWidth="3" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="#60A5FA" strokeWidth="3" strokeDasharray={`${(value / 100) * 87.96} 87.96`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold text-white">{Math.round(value)}</span></div>
            </div>
          </div>
        ))}
      </div>
      {ivAnalysis.historicalRange && (
        <div className="space-y-1 text-xs">
          <div className="text-gray-500 mb-1">52-Week Historical Range</div>
          {[{ label: 'Min IV', value: ivAnalysis.historicalRange.min, color: '#22C55E' }, { label: 'Mean IV', value: ivAnalysis.historicalRange.mean, color: '#60A5FA' }, { label: 'Max IV', value: ivAnalysis.historicalRange.max, color: '#EF4444' }, { label: 'Current', value: currentIV, color: '#FCD34D' }].map(row => (
            <div key={row.label} className="flex justify-between"><span className="text-gray-500">{row.label}</span><span className="font-bold" style={{ color: row.color }}>{n(row.value).toFixed(2)}%</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXPECTED MOVE CALCULATOR
// ============================================================================

function ExpectedMoveCalculator({ expectedMove, spotPrice, atmIV, daysToExpiry }: { expectedMove: any; spotPrice: number; atmIV: number; daysToExpiry: number }) {
  const spot = n(spotPrice), upper = n(expectedMove?.upperRange, spot + 500), lower = n(expectedMove?.lowerRange, spot - 500);
  const toExp = n(expectedMove?.toExpiry, 300), daily = n(expectedMove?.daily, 100), weekly = n(expectedMove?.weekly, 220);
  const range = upper - lower || 1, spotPct = ((spot - lower) / range) * 100;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-800 rounded-lg p-3"><div className="text-gray-500 text-xs mb-1">Days to Expiry</div><div className="text-white font-bold text-lg">{daysToExpiry}</div></div>
        <div className="bg-gray-800 rounded-lg p-3"><div className="text-gray-500 text-xs mb-1">ATM IV (%)</div><div className="text-white font-bold text-lg">{n(atmIV).toFixed(1)}</div></div>
      </div>
      <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl p-3">
        <div className="text-xs text-blue-400 font-bold mb-2">1σ Expected Move</div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-red-400 font-bold">{lower.toFixed(0)}</span>
          <div className="text-center"><div className="text-yellow-400 font-bold">±{toExp.toFixed(0)}</div><div className="text-gray-500 text-xs">±{((toExp / spot) * 100).toFixed(1)}%</div></div>
          <span className="text-green-400 font-bold">{upper.toFixed(0)}</span>
        </div>
        <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden mt-2">
          <div className="absolute top-0 h-full w-0.5 bg-yellow-400" style={{ left: `${spotPct}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">{lower.toFixed(0)} — {spot.toFixed(0)} — {upper.toFixed(0)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[{ label: '1σ', pct: '68.2%', move: `±${toExp.toFixed(0)}`, color: '#60A5FA' }, { label: '2σ', pct: '95.4%', move: `±${(toExp * 2).toFixed(0)}`, color: '#A78BFA' }, { label: '3σ', pct: '99.7%', move: `±${(toExp * 3).toFixed(0)}`, color: '#F472B6' }].map(row => (
          <div key={row.label} className="bg-gray-800 rounded-lg p-2"><div className="font-bold text-sm mb-1" style={{ color: row.color }}>{row.label}</div><div className="text-white font-bold">{row.pct}</div><div className="text-gray-400">{row.move}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-center">
        <div className="bg-gray-800 rounded p-2"><div className="text-gray-500">Daily Move</div><div className="text-white font-bold">±{daily.toFixed(0)}</div></div>
        <div className="bg-gray-800 rounded p-2"><div className="text-gray-500">Weekly Move</div><div className="text-white font-bold">±{weekly.toFixed(0)}</div></div>
      </div>
    </div>
  );
}

// ============================================================================
// PAYOFF CHART (SVG — no external deps)
// ============================================================================

// ── AnalyticsTab wrapper ───────────────────────────────────────────────────
export function AnalyticsTab({ signalData, ivSource, ivPoints, spotPrice, atmIV, dte }: {
  signalData: SignalData | null; ivSource?: string; ivPoints: number;
  spotPrice: number; atmIV: number | null; dte: number;
}) {
  return (
          <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">📊 IV Analysis</h3>
                {ivSource && <span className={`text-xs px-2 py-0.5 rounded font-bold ${ivSource === 'real_db' ? 'bg-green-900/60 text-green-400' : 'bg-yellow-900/60 text-yellow-400'}`}>{ivSource === 'real_db' ? `✅ Real DB (${ivPoints}pts)` : `⚠️ Est.`}</span>}
              </div>
              <IVAnalysisPanel ivAnalysis={signalData?.ivAnalysis} />
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">📐 Expected Move</h3>
              <ExpectedMoveCalculator expectedMove={signalData?.expectedMove} spotPrice={signalData?.spotPrice ?? spotPrice} atmIV={signalData?.currentIV ?? n(atmIV, 20)} daysToExpiry={signalData?.daysToExpiry ?? dte} />
            </div>
          </div>
        )}

  );
}

