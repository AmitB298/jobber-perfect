import React, { useState } from 'react';
import { SignalCard } from './SignalCard';

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

interface TradingSignalsPanelProps {
  signals: TradingSignal[];
  isLoading?: boolean;
  lastUpdated?: string;
}

const FILTER_OPTIONS = ['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const TYPE_OPTIONS = ['ALL', 'DELTA_NEUTRAL', 'THETA_DECAY', 'GAMMA_SCALP', 'IV_CRUSH', 'IV_EXPANSION'] as const;

export const TradingSignalsPanel: React.FC<TradingSignalsPanelProps> = ({ signals, isLoading, lastUpdated }) => {
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'confidence' | 'priority'>('confidence');

  const filtered = signals
    .filter(s => priorityFilter === 'ALL' || s.priority === priorityFilter)
    .filter(s => typeFilter === 'ALL' || s.type === typeFilter)
    .sort((a, b) => {
      if (sortBy === 'confidence') return b.confidence - a.confidence;
      const pOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return pOrder[a.priority] - pOrder[b.priority];
    });

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  signals.forEach(s => counts[s.priority]++);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        <div className="animate-pulse">Loading signals...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex gap-4 text-xs">
        <span className="text-gray-400">Total: <strong className="text-white">{signals.length}</strong></span>
        <span className="text-red-400">HIGH: <strong>{counts.HIGH}</strong></span>
        <span className="text-yellow-400">MEDIUM: <strong>{counts.MEDIUM}</strong></span>
        <span className="text-gray-400">LOW: <strong>{counts.LOW}</strong></span>
        {lastUpdated && <span className="text-gray-600 ml-auto">Updated: {lastUpdated}</span>}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f}
              onClick={() => setPriorityFilter(f)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                priorityFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-0.5 border border-gray-700"
        >
          {TYPE_OPTIONS.map(t => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
        <button
          onClick={() => setSortBy(s => s === 'confidence' ? 'priority' : 'confidence')}
          className="ml-auto px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700"
        >
          Sort: {sortBy === 'confidence' ? 'Confidence' : 'Priority'}
        </button>
      </div>

      {/* Signal cards */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">
          No signals match the current filters
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filtered.map(signal => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
};
