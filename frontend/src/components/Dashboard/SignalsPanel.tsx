const SignalsPanel: React.FC<{ [key: string]: any }> = ({ signals = [], ivAnalysis, expectedMove, loading = false }) => {
  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Loading signals...</div>;
  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {ivAnalysis && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-white font-semibold mb-3">📊 IV Analysis</h3>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'IV Percentile', value: `${Number(ivAnalysis.iv_percentile ?? 0).toFixed(1)}%`, color: 'text-blue-400' },
              { label: 'IV Rank', value: `${Number(ivAnalysis.iv_rank ?? 0).toFixed(1)}%`, color: 'text-purple-400' },
              { label: 'Current IV', value: `${Number(ivAnalysis.current_iv ?? 0).toFixed(1)}%`, color: 'text-white' },
              { label: 'Regime', value: ivAnalysis.regime ?? 'NORMAL', color: 'text-yellow-400' },
            ].map(item => (
              <div key={item.label} className="bg-gray-900 rounded p-2">
                <div className="text-gray-400 text-xs">{item.label}</div>
                <div className={`font-bold ${item.color}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {expectedMove && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-white font-semibold mb-3">📐 Expected Move</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Daily ±', value: `₹${Number(expectedMove.daily_move ?? 0).toFixed(0)}` },
              { label: 'Weekly ±', value: `₹${Number(expectedMove.weekly_move ?? 0).toFixed(0)}` },
              { label: 'Expiry ±', value: `₹${Number(expectedMove.expiry_move ?? 0).toFixed(0)}` },
            ].map(item => (
              <div key={item.label} className="bg-gray-900 rounded p-2 text-center">
                <div className="text-gray-400 text-xs">{item.label}</div>
                <div className="text-white font-bold">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-white font-semibold mb-3">⚡ Signals ({(signals as any[]).length})</h3>
        {(signals as any[]).length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-4">No signals. Deploy signals-engine.ts to enable.</div>
        ) : (
          <div className="space-y-2">
            {(signals as any[]).map((s: any, i: number) => (
              <div key={i} className="rounded-lg p-3 border border-gray-600 bg-gray-900">
                <div className="flex justify-between">
                  <span className="text-white font-medium">{(s.type ?? '').replace(/_/g,' ')}</span>
                  {s.confidence != null && <span className="text-gray-400 text-xs">{Number(s.confidence).toFixed(0)}%</span>}
                </div>
                {s.message && <div className="text-gray-300 text-sm mt-1">{s.message}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
export default SignalsPanel;

