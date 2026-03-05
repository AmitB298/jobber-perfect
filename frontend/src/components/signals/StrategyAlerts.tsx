import React from 'react';

interface StrategyAlert {
  id: string;
  type: 'IRON_CONDOR' | 'BUTTERFLY' | 'STRADDLE' | 'STRANGLE' | 'CALENDAR';
  strikes: number[];
  premium: number;
  maxProfit: number;
  maxLoss: number;
  breakevenLow: number;
  breakevenHigh: number;
  probability: number;
  description: string;
}

interface StrategyAlertsProps {
  strategies: StrategyAlert[];
  isLoading?: boolean;
}

const STRATEGY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  IRON_CONDOR: { label: 'Iron Condor', color: 'text-orange-400', icon: '🦅' },
  BUTTERFLY:   { label: 'Butterfly',   color: 'text-purple-400', icon: '🦋' },
  STRADDLE:    { label: 'Straddle',    color: 'text-blue-400',   icon: '⚡' },
  STRANGLE:    { label: 'Strangle',    color: 'text-yellow-400', icon: '🎯' },
  CALENDAR:    { label: 'Calendar',    color: 'text-green-400',  icon: '📅' },
};

export const StrategyAlerts: React.FC<StrategyAlertsProps> = ({ strategies, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 text-sm animate-pulse">
        Scanning for strategies...
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="text-center text-gray-500 text-sm py-6">
        <p>No strategy setups detected currently</p>
        <p className="text-xs mt-1 text-gray-600">Strategies appear when market conditions align</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {strategies.map(strat => {
        const cfg = STRATEGY_CONFIG[strat.type] || { label: strat.type, color: 'text-gray-400', icon: '📊' };
        return (
          <div key={strat.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span>{cfg.icon}</span>
                <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Win Prob:</span>
                <span className={`font-bold ${strat.probability >= 60 ? 'text-green-400' : strat.probability >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {strat.probability}%
                </span>
              </div>
            </div>

            <p className="text-gray-300 mb-2">{strat.description}</p>

            <div className="flex gap-3 text-xs mb-2">
              {strat.strikes.map((s, i) => (
                <span key={i} className="bg-gray-700 rounded px-1.5 py-0.5 text-yellow-300 font-mono">{s}</span>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center bg-gray-900/50 rounded p-2">
              <div>
                <p className="text-gray-500 text-xs">Premium</p>
                <p className="text-white font-medium">₹{Number(strat.premium).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Max Profit</p>
                <p className="text-green-400 font-medium">₹{Number(strat.maxProfit).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Max Loss</p>
                <p className="text-red-400 font-medium">₹{Number(strat.maxLoss).toFixed(0)}</p>
              </div>
            </div>

            <div className="flex gap-4 mt-2 text-center">
              <div>
                <span className="text-gray-500">BEP Low: </span>
                <span className="text-red-300 font-mono">{strat.breakevenLow}</span>
              </div>
              <div>
                <span className="text-gray-500">BEP High: </span>
                <span className="text-green-300 font-mono">{strat.breakevenHigh}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
