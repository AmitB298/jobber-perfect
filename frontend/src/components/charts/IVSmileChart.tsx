import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface IVSmileData {
  strike: number;
  ce_iv: number | null;
  pe_iv: number | null;
}

interface IVSmileChartProps {
  data: IVSmileData[];
  atmStrike: number;
}

export const IVSmileChart: React.FC<IVSmileChartProps> = ({ data, atmStrike }) => {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 border border-gray-700 rounded p-3 text-xs">
          <p className="text-white font-semibold mb-1">Strike: {label}</p>
          {payload.map((entry: any) => (
            entry.value != null && (
              <p key={entry.name} style={{ color: entry.color }}>
                {entry.name}: {Number(entry.value).toFixed(2)}%
              </p>
            )
          ))}
        </div>
      );
    }
    return null;
  };

  const filteredData = data.filter(d => d.ce_iv != null || d.pe_iv != null);

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filteredData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="strike"
            tick={{ fill: '#9CA3AF', fontSize: 10 }}
            tickFormatter={(v) => v === atmStrike ? `${v}*` : String(v)}
          />
          <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            formatter={(value) => <span style={{ color: '#D1D5DB' }}>{value}</span>}
          />
          <ReferenceLine x={atmStrike} stroke="#FBBF24" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="ce_iv" name="CE IV" stroke="#EF4444" dot={false} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="pe_iv" name="PE IV" stroke="#22C55E" dot={false} strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
