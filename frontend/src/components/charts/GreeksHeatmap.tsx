import React from 'react';

interface GreeksRow {
  strike: number;
  ce_delta?: number | null;
  ce_gamma?: number | null;
  ce_theta?: number | null;
  ce_vega?: number | null;
  pe_delta?: number | null;
  pe_gamma?: number | null;
  pe_theta?: number | null;
  pe_vega?: number | null;
}

interface GreeksHeatmapProps {
  data: GreeksRow[];
  atmStrike: number;
}

function heatColor(value: number, min: number, max: number, invert = false): string {
  if (value == null) return '#1F2937';
  const range = max - min || 1;
  let ratio = (value - min) / range;
  if (invert) ratio = 1 - ratio;
  ratio = Math.max(0, Math.min(1, ratio));
  if (ratio < 0.5) {
    const g = Math.round(ratio * 2 * 255);
    return `rgb(0,${g},128)`;
  } else {
    const r = Math.round((ratio - 0.5) * 2 * 255);
    return `rgb(${r},255,128)`;
  }
}

export const GreeksHeatmap: React.FC<GreeksHeatmapProps> = ({ data, atmStrike }) => {
  const fmt = (v: number | null | undefined, d = 4) =>
    v != null ? Number(v).toFixed(d) : '-';

  const allDeltas = data.flatMap(r => [r.ce_delta, r.pe_delta]).filter((v): v is number => v != null);
  const allGammas = data.flatMap(r => [r.ce_gamma, r.pe_gamma]).filter((v): v is number => v != null);
  const allThetas = data.flatMap(r => [r.ce_theta, r.pe_theta]).filter((v): v is number => v != null);
  const minD = Math.min(...allDeltas); const maxD = Math.max(...allDeltas);
  const minG = Math.min(...allGammas); const maxG = Math.max(...allGammas);
  const minT = Math.min(...allThetas); const maxT = Math.max(...allThetas);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="px-2 py-1 text-left">Strike</th>
            <th className="px-2 py-1 text-center text-red-400" colSpan={4}>CALL</th>
            <th className="px-2 py-1 text-center text-green-400" colSpan={4}>PUT</th>
          </tr>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="px-2 py-1"></th>
            <th className="px-2 py-1">Δ Delta</th>
            <th className="px-2 py-1">Γ Gamma</th>
            <th className="px-2 py-1">Θ Theta</th>
            <th className="px-2 py-1">V Vega</th>
            <th className="px-2 py-1">Δ Delta</th>
            <th className="px-2 py-1">Γ Gamma</th>
            <th className="px-2 py-1">Θ Theta</th>
            <th className="px-2 py-1">V Vega</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isATM = row.strike === atmStrike;
            return (
              <tr
                key={row.strike}
                className={`border-b border-gray-800 ${isATM ? 'bg-yellow-900/20' : 'hover:bg-gray-800/40'}`}
              >
                <td className={`px-2 py-1 font-medium ${isATM ? 'text-yellow-400' : 'text-white'}`}>
                  {row.strike}{isATM ? ' ★' : ''}
                </td>
                <td className="px-2 py-1 text-center font-mono" style={{ background: row.ce_delta != null ? heatColor(row.ce_delta, minD, maxD) + '33' : undefined }}>
                  {fmt(row.ce_delta, 3)}
                </td>
                <td className="px-2 py-1 text-center font-mono" style={{ background: row.ce_gamma != null ? heatColor(row.ce_gamma, minG, maxG) + '33' : undefined }}>
                  {fmt(row.ce_gamma, 4)}
                </td>
                <td className="px-2 py-1 text-center font-mono text-red-300">
                  {fmt(row.ce_theta, 2)}
                </td>
                <td className="px-2 py-1 text-center font-mono text-blue-300">
                  {fmt(row.ce_vega, 2)}
                </td>
                <td className="px-2 py-1 text-center font-mono" style={{ background: row.pe_delta != null ? heatColor(row.pe_delta, minD, maxD) + '33' : undefined }}>
                  {fmt(row.pe_delta, 3)}
                </td>
                <td className="px-2 py-1 text-center font-mono" style={{ background: row.pe_gamma != null ? heatColor(row.pe_gamma, minG, maxG) + '33' : undefined }}>
                  {fmt(row.pe_gamma, 4)}
                </td>
                <td className="px-2 py-1 text-center font-mono text-red-300">
                  {fmt(row.pe_theta, 2)}
                </td>
                <td className="px-2 py-1 text-center font-mono text-blue-300">
                  {fmt(row.pe_vega, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
