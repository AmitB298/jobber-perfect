import React from 'react';

interface IVAnalysis {
  currentIV: number;
  ivPercentile: number;
  ivRank: number;
  status: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  historicalRange: { min: number; max: number; mean: number };
  signal: 'BUY_PREMIUM' | 'SELL_PREMIUM' | 'NEUTRAL';
}

interface IVAnalysisPanelProps {
  ivAnalysis: IVAnalysis | null;
  isLoading?: boolean;
}

const STATUS_CONFIG = {
  LOW:     { color: 'text-green-400', bg: 'bg-green-900/20', label: 'LOW IV', desc: 'Consider buying premium' },
  NORMAL:  { color: 'text-blue-400',  bg: 'bg-blue-900/20',  label: 'NORMAL IV', desc: 'No strong edge' },
  HIGH:    { color: 'text-yellow-400', bg: 'bg-yellow-900/20', label: 'HIGH IV', desc: 'Consider selling premium' },
  EXTREME: { color: 'text-red-400',   bg: 'bg-red-900/20',   label: 'EXTREME IV', desc: 'Strong sell premium signal' },
};

const SIGNAL_CONFIG = {
  BUY_PREMIUM:  { color: 'text-green-400', label: '▲ BUY PREMIUM' },
  SELL_PREMIUM: { color: 'text-red-400',   label: '▼ SELL PREMIUM' },
  NEUTRAL:      { color: 'text-gray-400',  label: '— NEUTRAL' },
};

function GaugeArc({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(value / max, 1);
  const angle = -180 + pct * 180;
  const rad = (angle * Math.PI) / 180;
  const x = 50 + 40 * Math.cos(rad);
  const y = 50 + 40 * Math.sin(rad);

  const getColor = () => {
    if (pct < 0.3) return '#22C55E';
    if (pct < 0.6) return '#3B82F6';
    if (pct < 0.8) return '#FBBF24';
    return '#EF4444';
  };

  return (
    <svg viewBox="0 0 100 55" className="w-full max-w-xs mx-auto">
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#374151" strokeWidth="8" strokeLinecap="round" />
      <path
        d={`M 10 50 A 40 40 0 0 1 ${x} ${y}`}
        fill="none"
        stroke={getColor()}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx={x} cy={y} r="4" fill="white" />
      <text x="50" y="48" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">
        {value.toFixed(0)}
      </text>
      <text x="10" y="54" fill="#6B7280" fontSize="7">0</text>
      <text x="85" y="54" fill="#6B7280" fontSize="7">{max}</text>
    </svg>
  );
}

export const IVAnalysisPanel: React.FC<IVAnalysisPanelProps> = ({ ivAnalysis, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm animate-pulse">
        Calculating IV analysis...
      </div>
    );
  }

  if (!ivAnalysis) {
    return (
      <div className="text-center text-gray-500 text-sm py-6">
        IV analysis unavailable — deploy signals-engine.ts
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[ivAnalysis.status];
  const signalCfg = SIGNAL_CONFIG[ivAnalysis.signal];

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`rounded-lg p-3 ${statusCfg.bg} border border-current text-center`}>
        <p className={`text-lg font-bold ${statusCfg.color}`}>{statusCfg.label}</p>
        <p className="text-gray-400 text-xs">{statusCfg.desc}</p>
        <p className={`mt-1 font-semibold ${signalCfg.color}`}>{signalCfg.label}</p>
      </div>

      {/* Current IV */}
      <div className="text-center">
        <p className="text-gray-400 text-xs mb-1">ATM Implied Volatility</p>
        <p className="text-3xl font-bold text-white">{Number(ivAnalysis.currentIV).toFixed(2)}%</p>
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs text-center mb-1">IV Percentile</p>
          <GaugeArc value={ivAnalysis.ivPercentile} />
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs text-center mb-1">IV Rank</p>
          <GaugeArc value={ivAnalysis.ivRank} />
        </div>
      </div>

      {/* Historical range */}
      <div className="bg-gray-800/50 rounded-lg p-3 text-xs">
        <p className="text-gray-400 font-medium mb-2">52-Week Historical Range</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Min IV</span>
            <span className="text-green-400 font-mono">{Number(ivAnalysis.historicalRange.min).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Mean IV</span>
            <span className="text-blue-400 font-mono">{Number(ivAnalysis.historicalRange.mean).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Max IV</span>
            <span className="text-red-400 font-mono">{Number(ivAnalysis.historicalRange.max).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Current</span>
            <span className="text-white font-mono font-bold">{Number(ivAnalysis.currentIV).toFixed(2)}%</span>
          </div>
        </div>
        {/* Range bar */}
        <div className="mt-2">
          <div className="w-full bg-gray-700 rounded-full h-2 relative">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-green-500 via-yellow-400 to-red-500"
              style={{ width: '100%' }}
            />
            <div
              className="absolute top-0 w-1 h-2 bg-white rounded-full"
              style={{
                left: `${((ivAnalysis.currentIV - ivAnalysis.historicalRange.min) / (ivAnalysis.historicalRange.max - ivAnalysis.historicalRange.min)) * 100}%`
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
