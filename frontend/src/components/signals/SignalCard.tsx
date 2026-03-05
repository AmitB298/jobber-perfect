import React from 'react';

interface TradingSignal {
  id: string;
  type: 'DELTA_NEUTRAL' | 'THETA_DECAY' | 'GAMMA_SCALP' | 'IV_CRUSH' | 'IV_EXPANSION';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
  strategy: string;
  description: string;
  strikes: number[];
  action: string;
  expectedProfit: string;
  risk: string;
  timestamp: Date | string;
}

interface SignalCardProps {
  signal: TradingSignal;
}

const TYPE_CONFIG = {
  DELTA_NEUTRAL: { label: 'Delta Neutral', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700' },
  THETA_DECAY:   { label: 'Theta Decay',   color: 'text-green-400', bg: 'bg-green-900/20 border-green-700' },
  GAMMA_SCALP:   { label: 'Gamma Scalp',   color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700' },
  IV_CRUSH:      { label: 'IV Crush',      color: 'text-red-400', bg: 'bg-red-900/20 border-red-700' },
  IV_EXPANSION:  { label: 'IV Expansion',  color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-700' },
};

const PRIORITY_BADGE = {
  HIGH:   'bg-red-500 text-white',
  MEDIUM: 'bg-yellow-500 text-black',
  LOW:    'bg-gray-600 text-white',
};

export const SignalCard: React.FC<SignalCardProps> = ({ signal }) => {
  const cfg = TYPE_CONFIG[signal.type] || TYPE_CONFIG.DELTA_NEUTRAL;

  return (
    <div className={`rounded-lg border p-3 ${cfg.bg} text-xs`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${PRIORITY_BADGE[signal.priority]}`}>
            {signal.priority}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-gray-400">Confidence </span>
            <span className="text-white font-semibold">{signal.confidence}%</span>
          </div>
        </div>
      </div>

      <p className="text-white font-medium mb-1">{signal.strategy}</p>
      <p className="text-gray-400 mb-2">{signal.description}</p>

      <div className="mb-2">
        <span className="text-gray-500">Strikes: </span>
        {signal.strikes.map((s, i) => (
          <span key={i} className="text-yellow-300 font-mono mr-1">{s}</span>
        ))}
      </div>

      <div className="bg-gray-900/50 rounded p-2 mb-2">
        <p className="text-gray-400 text-xs mb-0.5">Action:</p>
        <p className="text-white">{signal.action}</p>
      </div>

      <div className="flex gap-4">
        <div>
          <span className="text-gray-500">Target: </span>
          <span className="text-green-400 font-medium">{signal.expectedProfit}</span>
        </div>
        <div>
          <span className="text-gray-500">Risk: </span>
          <span className="text-red-400 font-medium">{signal.risk}</span>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mt-2">
        <div className="w-full bg-gray-800 rounded-full h-1.5">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-green-400"
            style={{ width: `${signal.confidence}%` }}
          />
        </div>
      </div>
    </div>
  );
};
