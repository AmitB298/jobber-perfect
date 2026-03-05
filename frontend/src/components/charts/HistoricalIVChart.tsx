import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface HistoricalIVData {
  timestamp: string;
  iv: number;
  iv_percentile?: number;
}

interface HistoricalIVChartProps {
  data: HistoricalIVData[];
  currentIV?: number;
  ivPercentile?: number;
  ivRank?: number;
}

export const HistoricalIVChart: React.FC<HistoricalIVChartProps> = ({ data, currentIV, ivPercentile, ivRank }) => {
  const meanIV = data.length > 0 ? data.reduce((s, d) => s + d.iv, 0) / data.length : 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
          <p className="text-gray-400">{label}</p>
          <p className="text-purple-400">IV: {Number(payload[0]?.value).toFixed(2)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full">
      {(currentIV != null || ivPercentile != null) && (
        <div className="flex gap-4 mb-2 text-xs">
          {currentIV != null && (
            <span className="text-purple-400">Current IV: <strong>{Number(currentIV).toFixed(2)}%</strong></span>
          )}
          {ivPercentile != null && (
            <span className="text-blue-400">IV %ile: <strong>{Number(ivPercentile).toFixed(0)}</strong></span>
          )}
          {ivRank != null && (
            <span className="text-yellow-400">IV Rank: <strong>{Number(ivRank).toFixed(0)}</strong></span>
          )}
        </div>
      )}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="ivGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#A855F7" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#A855F7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="timestamp" tick={{ fill: '#9CA3AF', fontSize: 9 }} tickFormatter={(v) => v.slice(5, 10)} />
            <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={meanIV} stroke="#6B7280" strokeDasharray="4 4" label={{ value: `Avg ${meanIV.toFixed(1)}%`, fill: '#6B7280', fontSize: 9 }} />
            {currentIV != null && (
              <ReferenceLine y={currentIV} stroke="#FBBF24" strokeDasharray="4 4" />
            )}
            <Area type="monotone" dataKey="iv" stroke="#A855F7" fill="url(#ivGradient)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
