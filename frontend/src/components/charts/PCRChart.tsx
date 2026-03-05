import React from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface PCRData {
  timestamp: string;
  pcr_oi: number;
  pcr_volume: number;
}

interface PCRChartProps {
  data: PCRData[];
  currentPCR?: number;
}

export const PCRChart: React.FC<PCRChartProps> = ({ data, currentPCR }) => {
  const sentiment = currentPCR != null
    ? currentPCR > 1.2 ? { label: 'Bullish', color: '#22C55E' }
    : currentPCR < 0.8 ? { label: 'Bearish', color: '#EF4444' }
    : { label: 'Neutral', color: '#FBBF24' }
    : null;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
          <p className="text-gray-400">{label}</p>
          {payload.map((entry: any) => (
            <p key={entry.name} style={{ color: entry.color }}>
              {entry.name}: {Number(entry.value).toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full">
      {sentiment && (
        <div className="flex items-center gap-3 mb-2 text-xs">
          <span className="text-gray-400">PCR OI: <strong className="text-white">{Number(currentPCR).toFixed(2)}</strong></span>
          <span style={{ color: sentiment.color }} className="font-semibold">{sentiment.label}</span>
          <span className="text-gray-500">| &gt;1.2 Bullish &lt;0.8 Bearish</span>
        </div>
      )}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="timestamp" tick={{ fill: '#9CA3AF', fontSize: 9 }} tickFormatter={(v) => v.slice(11, 16)} />
            <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '11px' }} formatter={(v) => <span style={{ color: '#D1D5DB' }}>{v}</span>} />
            <ReferenceLine y={1} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Neutral 1.0', fill: '#6B7280', fontSize: 9 }} />
            <ReferenceLine y={1.2} stroke="#22C55E" strokeDasharray="2 2" />
            <ReferenceLine y={0.8} stroke="#EF4444" strokeDasharray="2 2" />
            <Bar dataKey="pcr_volume" name="PCR Volume" fill="#6366F1" opacity={0.5} radius={[2, 2, 0, 0]} />
            <Line type="monotone" dataKey="pcr_oi" name="PCR OI" stroke="#FBBF24" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
