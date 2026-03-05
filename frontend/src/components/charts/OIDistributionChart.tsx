import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface OIData {
  strike: number;
  ce_oi: number;
  pe_oi: number;
}

interface OIDistributionChartProps {
  data: OIData[];
  atmStrike: number;
  spotPrice?: number;
}

export const OIDistributionChart: React.FC<OIDistributionChartProps> = ({ data, atmStrike, spotPrice }) => {
  const formatOI = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return String(value);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 border border-gray-700 rounded p-3 text-xs">
          <p className="text-white font-semibold mb-1">Strike: {label}</p>
          {payload.map((entry: any) => (
            <p key={entry.name} style={{ color: entry.color }}>
              {entry.name}: {formatOI(entry.value)}
            </p>
          ))}
          {payload.length === 2 && (
            <p className="text-gray-400 mt-1 border-t border-gray-700 pt-1">
              PCR: {payload[1]?.value > 0 ? (payload[1].value / payload[0].value).toFixed(2) : 'N/A'}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="strike"
            tick={{ fill: '#9CA3AF', fontSize: 10 }}
            tickFormatter={(v) => v === atmStrike ? `${v}*` : String(v)}
          />
          <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={formatOI} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            formatter={(value) => <span style={{ color: '#D1D5DB' }}>{value}</span>}
          />
          {spotPrice && (
            <ReferenceLine x={atmStrike} stroke="#FBBF24" strokeDasharray="4 4" label={{ value: 'ATM', fill: '#FBBF24', fontSize: 10 }} />
          )}
          <Bar dataKey="ce_oi" name="CE OI" fill="#EF4444" radius={[2, 2, 0, 0]} opacity={0.85} />
          <Bar dataKey="pe_oi" name="PE OI" fill="#22C55E" radius={[2, 2, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
