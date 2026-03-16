// ============================================================================
// tabs/ChartsTab.tsx — OI Distribution, IV Smile, Greeks Heatmap, PCR, Hist IV
// ============================================================================
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ChainRow, DashData } from '../../types';
import { n, fmt, fmtK, ivColor } from '../shared/helpers';
import { API_BASE } from '../../constants';

function OIDistributionChart({ data, atmStrike }: { data: any[]; atmStrike: number }) {
  if (!data || data.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const maxOI = Math.max(...data.map(d => Math.max(n(d.ce_oi), n(d.pe_oi))), 1);
  const atm5 = data.filter(d => Math.abs(n(d.strike) - atmStrike) <= 250).slice(0, 14);
  return (
    <div className="space-y-1 overflow-y-auto max-h-64">
      {atm5.map(d => {
        const cePct = (n(d.ce_oi) / maxOI) * 100, pePct = (n(d.pe_oi) / maxOI) * 100;
        const isAtm = n(d.strike) === atmStrike;
        return (
          <div key={d.strike} className={`flex items-center gap-2 text-xs ${isAtm ? 'bg-yellow-900/30 rounded' : ''}`}>
            <div className="w-14 text-right text-green-400" style={{ fontSize: 10 }}>{fmtK(d.ce_oi)}</div>
            <div className="flex-1 flex gap-0.5 h-4 items-center">
              <div className="flex-1 flex justify-end"><div className="bg-green-600/70 h-3 rounded-l" style={{ width: `${cePct}%`, minWidth: cePct > 0 ? 2 : 0 }} /></div>
              <div className="text-gray-400 text-center w-12" style={{ fontSize: 9 }}>{isAtm ? '◄►' : n(d.strike)}</div>
              <div className="flex-1"><div className="bg-red-600/70 h-3 rounded-r" style={{ width: `${pePct}%`, minWidth: pePct > 0 ? 2 : 0 }} /></div>
            </div>
            <div className="w-14 text-left text-red-400" style={{ fontSize: 10 }}>{fmtK(d.pe_oi)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// IV SMILE CHART (custom SVG — no recharts)
// ============================================================================

function IVSmileTooltip({ active, payload, label, atmStrike, spotPrice }: any) {
  if (!active || !payload || !payload.length) return null;
  const strike = Number(label);
  const ceIV = payload.find((p: any) => p.dataKey === 'ce_iv');
  const peIV = payload.find((p: any) => p.dataKey === 'pe_iv');
  const ceVal = ceIV?.value != null ? Number(ceIV.value) : null;
  const peVal = peIV?.value != null ? Number(peIV.value) : null;
  const isATM = strike === atmStrike;
  const moneyness = spotPrice > 0 ? ((strike - spotPrice) / spotPrice * 100) : 0;
  const skew = (ceVal != null && peVal != null) ? peVal - ceVal : null;
  const ivCol = (v: number | null) => { if (v == null) return '#6B7280'; if (v < 12) return '#22C55E'; if (v < 18) return '#84CC16'; if (v < 25) return '#FBBF24'; if (v < 35) return '#F97316'; return '#EF4444'; };
  const ivLabel = (v: number | null) => { if (v == null) return '–'; if (v < 12) return 'Very Low'; if (v < 18) return 'Low'; if (v < 25) return 'Normal'; if (v < 35) return 'High'; return 'Extreme'; };
  return (
    <div style={{ background: 'rgba(10,10,26,0.97)', border: `1px solid ${isATM ? '#FBBF24' : '#374151'}`, borderRadius: 8, padding: '10px 14px', minWidth: 200, boxShadow: isATM ? '0 0 16px rgba(251,191,36,0.25)' : '0 4px 20px rgba(0,0,0,0.6)', fontFamily: 'monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontWeight: 'bold', fontSize: 15, color: isATM ? '#FBBF24' : '#F1F5F9' }}>Strike {strike.toLocaleString('en-IN')}</span>
        {isATM && <span style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid #FBBF24', color: '#FBBF24', fontSize: 9, fontWeight: 'bold', padding: '1px 5px', borderRadius: 3, letterSpacing: 1 }}>ATM ★</span>}
        <span style={{ marginLeft: 'auto', color: moneyness > 0 ? '#F97316' : '#22C55E', fontSize: 10 }}>{moneyness >= 0 ? '+' : ''}{moneyness.toFixed(2)}%</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>📗 CE (Call) IV</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: ceVal != null ? ivCol(ceVal) : '#6B7280', fontWeight: 'bold', fontSize: 14 }}>{ceVal != null ? `${ceVal.toFixed(2)}%` : '–'}</span>
          {ceVal != null && <span style={{ color: ivCol(ceVal), fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{ivLabel(ceVal)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>📕 PE (Put) IV</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: peVal != null ? ivCol(peVal) : '#6B7280', fontWeight: 'bold', fontSize: 14 }}>{peVal != null ? `${peVal.toFixed(2)}%` : '–'}</span>
          {peVal != null && <span style={{ color: ivCol(peVal), fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{ivLabel(peVal)}</span>}
        </div>
      </div>
      {skew != null && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#9CA3AF', fontSize: 11 }}>⚖️ IV Skew (PE−CE)</span>
            <span style={{ color: skew > 2 ? '#EF4444' : skew < -2 ? '#22C55E' : '#FBBF24', fontWeight: 'bold', fontSize: 13 }}>{skew >= 0 ? '+' : ''}{skew.toFixed(2)}%</span>
          </div>
          <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: skew > 3 ? 'rgba(239,68,68,0.12)' : skew < -3 ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.08)', border: `1px solid ${skew > 3 ? 'rgba(239,68,68,0.3)' : skew < -3 ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.2)'}`, textAlign: 'center' }}>
            <span style={{ fontSize: 10, color: skew > 3 ? '#FCA5A5' : skew < -3 ? '#86EFAC' : '#FDE68A', fontWeight: 'bold' }}>
              {skew > 5 ? '🔴 Strong Put Skew — Fear/Hedging' : skew > 2 ? '🟠 Put Skew — Mild Bearish Bias' : skew < -5 ? '🟢 Strong Call Skew — Bullish Sentiment' : skew < -2 ? '🟢 Call Skew — Mild Bullish Bias' : '🟡 Neutral — Balanced IV'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function IVSmileChart({ data, atmStrike, spotPrice }: { data: any[]; atmStrike: number; spotPrice?: number }) {
  if (!data || data.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const valid = data.filter(d => d.ce_iv != null || d.pe_iv != null);
  if (valid.length === 0) return <div className="text-gray-500 text-sm p-4">Calculating IV…</div>;
  const near = valid.filter(d => Math.abs(n(d.strike) - atmStrike) <= 700).slice(0, 24);
  const spot = spotPrice || atmStrike;
  const allIVs = near.flatMap(d => [d.ce_iv, d.pe_iv].filter((v): v is number => v != null));
  const maxIV = Math.max(...allIVs, 1), minIV = Math.max(0, Math.min(...allIVs) - 2);
  return <div style={{ position: 'relative', width: '100%', height: 180 }}><IVSmileInner near={near} atmStrike={atmStrike} spot={spot} minIV={minIV} maxIV={maxIV} /></div>;
}

function IVSmileInner({ near, atmStrike, spot, minIV, maxIV }: any) {
  const [hovered, setHovered] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 540, H = 180, PL = 32, PR = 8, PT = 10, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const strikes = near.map((d: any) => n(d.strike));
  const minS = Math.min(...strikes), maxS = Math.max(...strikes);
  const xScale = (s: number) => PL + ((s - minS) / (maxS - minS + 1)) * chartW;
  const yScale = (iv: number) => PT + chartH - ((iv - minIV) / (maxIV - minIV + 0.001)) * chartH;
  const cePoints = near.filter((d: any) => d.ce_iv != null).map((d: any) => `${xScale(n(d.strike))},${yScale(n(d.ce_iv))}`).join(' ');
  const pePoints = near.filter((d: any) => d.pe_iv != null).map((d: any) => `${xScale(n(d.strike))},${yScale(n(d.pe_iv))}`).join(' ');
  const yTickValues = Array.from({ length: 5 }, (_, i) => minIV + (maxIV - minIV) * i / 4);
  const xLabels = near.filter((_: any, i: number) => i % 2 === 0);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    let closest = near[0], minDist = Infinity;
    for (const d of near) { const dist = Math.abs(xScale(n(d.strike)) - mx); if (dist < minDist) { minDist = dist; closest = d; } }
    setHovered(minDist < 30 ? closest : null);
  };
  const hovX = hovered ? xScale(n(hovered.strike)) : null;
  const isATMhov = hovered && n(hovered.strike) === atmStrike;
  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)} style={{ cursor: 'crosshair', display: 'block' }}>
        {yTickValues.map((v, i) => (<g key={i}><line x1={PL} y1={yScale(v)} x2={W - PR} y2={yScale(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} /><text x={PL - 3} y={yScale(v) + 3} textAnchor="end" fill="#4B5563" fontSize={8}>{v.toFixed(0)}%</text></g>))}
        <line x1={xScale(atmStrike)} y1={PT} x2={xScale(atmStrike)} y2={H - PB} stroke="rgba(251,191,36,0.25)" strokeWidth={1} strokeDasharray="4,3" />
        <text x={xScale(atmStrike)} y={PT - 2} textAnchor="middle" fill="#FBBF24" fontSize={7}>ATM</text>
        <polyline points={cePoints} fill="none" stroke="#22C55E" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pePoints} fill="none" stroke="#EF4444" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {near.map((d: any, i: number) => (
          <g key={i}>
            {d.ce_iv != null && <circle cx={xScale(n(d.strike))} cy={yScale(n(d.ce_iv))} r={n(d.strike) === atmStrike ? 5 : 3} fill={n(d.strike) === atmStrike ? '#FBBF24' : '#22C55E'} stroke={n(d.strike) === atmStrike ? '#FDE68A' : '#111'} strokeWidth={n(d.strike) === atmStrike ? 2 : 1} />}
            {d.pe_iv != null && <circle cx={xScale(n(d.strike))} cy={yScale(n(d.pe_iv))} r={n(d.strike) === atmStrike ? 5 : 3} fill={n(d.strike) === atmStrike ? '#FBBF24' : '#EF4444'} stroke={n(d.strike) === atmStrike ? '#FDE68A' : '#111'} strokeWidth={n(d.strike) === atmStrike ? 2 : 1} />}
          </g>
        ))}
        {hovered && hovX != null && (
          <>
            <line x1={hovX} y1={PT} x2={hovX} y2={H - PB} stroke={isATMhov ? '#FBBF24' : 'rgba(255,255,255,0.35)'} strokeWidth={1} strokeDasharray="3,2" />
            {hovered.ce_iv != null && <circle cx={hovX} cy={yScale(n(hovered.ce_iv))} r={6} fill="#22C55E" stroke="#fff" strokeWidth={2} />}
            {hovered.pe_iv != null && <circle cx={hovX} cy={yScale(n(hovered.pe_iv))} r={6} fill="#EF4444" stroke="#fff" strokeWidth={2} />}
          </>
        )}
        {xLabels.map((d: any, i: number) => { const isAtm = n(d.strike) === atmStrike; return <text key={i} x={xScale(n(d.strike))} y={H - 4} textAnchor="middle" fill={isAtm ? '#FBBF24' : '#4B5563'} fontSize={isAtm ? 9 : 7.5} fontWeight={isAtm ? 'bold' : 'normal'}>{isAtm ? `★${n(d.strike)}` : n(d.strike)}</text>; })}
        <g transform={`translate(${W - PR - 90}, ${PT})`}>
          <line x1={0} y1={5} x2={14} y2={5} stroke="#22C55E" strokeWidth={2.5} /><circle cx={7} cy={5} r={3} fill="#22C55E" /><text x={18} y={9} fill="#22C55E" fontSize={9}>CE IV</text>
          <line x1={0} y1={18} x2={14} y2={18} stroke="#EF4444" strokeWidth={2.5} /><circle cx={7} cy={18} r={3} fill="#EF4444" /><text x={18} y={22} fill="#EF4444" fontSize={9}>PE IV</text>
        </g>
      </svg>
      {hovered && (
        <div style={{ position: 'absolute', top: Math.max(0, mousePos.y - 160), left: mousePos.x > 300 ? mousePos.x - 220 : mousePos.x + 12, pointerEvents: 'none', zIndex: 100 }}>
          <IVSmileTooltip active={true} payload={[{ dataKey: 'ce_iv', value: hovered.ce_iv }, { dataKey: 'pe_iv', value: hovered.pe_iv }]} label={n(hovered.strike)} atmStrike={atmStrike} spotPrice={spot} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// GREEKS HEATMAP
// ============================================================================

function GreeksHeatmap({ chain, spotPrice }: { chain: ChainRow[]; spotPrice: number }) {
  const atm = chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 300).slice(0, 12);
  if (atm.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const dc = (v: number | null | undefined) => { const val = n(v), abs = Math.abs(val); if (abs > 0.7) return 'bg-blue-700'; if (abs > 0.5) return 'bg-blue-600'; if (abs > 0.3) return 'bg-blue-500/70'; return 'bg-blue-400/40'; };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-gray-500"><th className="py-1 text-right pr-2">Strike</th><th className="py-1 text-center">CE Δ</th><th className="py-1 text-center">CE Γ</th><th className="py-1 text-center">CE Θ</th><th className="py-1 text-center">CE IV</th><th className="py-1 text-center">PE Δ</th><th className="py-1 text-center">PE Γ</th><th className="py-1 text-center">PE Θ</th><th className="py-1 text-center">PE IV</th></tr></thead>
        <tbody>
          {atm.map(r => {
            const isAtm = n(r.strike_price) === Math.round(spotPrice / 50) * 50;
            return (
              <tr key={n(r.strike_price)} className={isAtm ? 'bg-yellow-900/30' : ''}>
                <td className={`py-0.5 pr-2 text-right font-bold ${isAtm ? 'text-yellow-300' : 'text-gray-300'}`}>{n(r.strike_price)}</td>
                <td className={`py-0.5 text-center rounded ${dc(r.ce_greeks?.delta)}`}>{fmt(r.ce_greeks?.delta, 3)}</td>
                <td className="py-0.5 text-center text-purple-300">{r.ce_greeks?.gamma != null ? n(r.ce_greeks.gamma).toFixed(4) : '–'}</td>
                <td className="py-0.5 text-center text-orange-300">{fmt(r.ce_greeks?.theta, 1)}</td>
                <td className="py-0.5 text-center font-bold" style={{ color: ivColor(r.ce_greeks?.iv) }}>{fmt(r.ce_greeks?.iv, 1)}</td>
                <td className={`py-0.5 text-center rounded ${dc(r.pe_greeks?.delta)}`}>{fmt(r.pe_greeks?.delta, 3)}</td>
                <td className="py-0.5 text-center text-purple-300">{r.pe_greeks?.gamma != null ? n(r.pe_greeks.gamma).toFixed(4) : '–'}</td>
                <td className="py-0.5 text-center text-orange-300">{fmt(r.pe_greeks?.theta, 1)}</td>
                <td className="py-0.5 text-center font-bold" style={{ color: ivColor(r.pe_greeks?.iv) }}>{fmt(r.pe_greeks?.iv, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// PCR GAUGE
// ============================================================================

function PCRGauge({ pcr }: { pcr: number }) {
  const clamp = Math.max(0, Math.min(pcr, 2)), pct = (clamp / 2) * 100;
  const color = pcr < 0.8 ? '#EF4444' : pcr > 1.3 ? '#22C55E' : '#FCD34D';
  const label = pcr < 0.7 ? 'Bearish — Call Heavy' : pcr > 1.3 ? 'Bullish — Put Heavy' : 'Neutral';
  return (
    <div className="space-y-3 p-2">
      <div className="flex justify-between text-xs text-gray-500"><span>0</span><span>0.7</span><span>1.0</span><span>1.3</span><span>2+</span></div>
      <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">PCR {pcr.toFixed(2)}</div>
      </div>
      <div className="text-center text-sm font-bold" style={{ color }}>{label}</div>
      <div className="grid grid-cols-3 gap-2 text-xs text-center mt-2">
        <div className="bg-red-900/30 rounded p-2"><div className="text-red-400 font-bold">{'< 0.7'}</div><div className="text-gray-400">Bearish</div></div>
        <div className="bg-yellow-900/30 rounded p-2"><div className="text-yellow-400 font-bold">0.7–1.3</div><div className="text-gray-400">Neutral</div></div>
        <div className="bg-green-900/30 rounded p-2"><div className="text-green-400 font-bold">{'> 1.3'}</div><div className="text-gray-400">Bullish</div></div>
      </div>
    </div>
  );
}

// ============================================================================
// HISTORICAL IV CHART (real DB only — no fake data)
// ============================================================================

function HistoricalIVChart({ currentIV }: { currentIV: number }) {
  const [ivHistory, setIvHistory] = useState<{ hour: string; avg_iv: number }[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    axios.get(`${API_BASE}/api/analytics/iv-history`)
      .then(res => { if (res.data.success && res.data.data.length > 0) { const parsed = res.data.data.map((r: any) => ({ hour: r.hour, avg_iv: n(r.avg_iv, 0) })).filter((d: any) => d.avg_iv > 0).reverse(); setIvHistory(parsed); } })
      .catch(() => {}).finally(() => setHistLoading(false));
  }, [currentIV]);
  if (histLoading) return <div className="flex items-center justify-center h-28 text-gray-600 text-xs">Loading real IV history…</div>;
  if (ivHistory.length < 3) return (
    <div className="flex flex-col items-center justify-center h-28 text-gray-600">
      <div className="text-2xl mb-1">📊</div>
      <div className="text-xs text-center">Real IV history building up — <span className="text-blue-400">{ivHistory.length} hourly points</span><br /><span className="text-gray-500">(needs 3+ to draw chart)</span></div>
      <div className="text-[10px] text-yellow-600 mt-1">Current ATM IV: {fmt(currentIV, 1)}%</div>
    </div>
  );
  const allIVs = ivHistory.map(d => d.avg_iv);
  const maxV = Math.max(...allIVs, currentIV), minV = Math.min(...allIVs, currentIV), range = maxV - minV || 1;
  return (
    <div className="relative" style={{ height: 120 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${ivHistory.length * 10} 120`} preserveAspectRatio="none">
        {ivHistory.map((d, i) => { if (i === ivHistory.length - 1) return null; const next = ivHistory[i + 1]; return <line key={i} x1={i * 10 + 5} y1={100 - ((d.avg_iv - minV) / range) * 90} x2={(i + 1) * 10 + 5} y2={100 - ((next.avg_iv - minV) / range) * 90} stroke="#60A5FA" strokeWidth="1.5" />; })}
        <line x1="0" y1={100 - ((currentIV - minV) / range) * 90} x2={ivHistory.length * 10} y2={100 - ((currentIV - minV) / range) * 90} stroke="#FCD34D" strokeWidth="1" strokeDasharray="4" />
      </svg>
      <div className="absolute top-1 left-2 text-xs text-green-400">✅ Real DB IV ({ivHistory.length}h)</div>
      <div className="absolute top-1 right-2 text-xs text-yellow-400">— Current {fmt(currentIV, 1)}%</div>
    </div>
  );
}


// ============================================================================
// ChartsTab — wrapper
// ============================================================================
export function ChartsTab({ data }: { data: DashData }) {
  const chain       = data.chain;
  const spotPrice   = n(data.spotPrice);
  const atmStrike   = n(data.atmStrike);
  const atmRow      = chain.find(r => Number(r.strike_price) === Number(atmStrike));
  const atmIV       = atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? null;
  const oiDistData  = chain.map(r => ({ strike: n(r.strike_price), ce_oi: n(r.ce_oi), pe_oi: n(r.pe_oi) }));
  const ivSmileData = chain.map(r => ({ strike: n(r.strike_price), ce_iv: r.ce_greeks?.iv ?? null, pe_iv: r.pe_greeks?.iv ?? null }));

  return (
    <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📊 OI Distribution</h3><OIDistributionChart data={oiDistData} atmStrike={atmStrike} /></div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📈 IV Smile</h3><IVSmileChart data={ivSmileData} atmStrike={atmStrike} spotPrice={spotPrice} /></div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">🔥 Greeks Heatmap</h3><GreeksHeatmap chain={chain} spotPrice={spotPrice} /></div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📉 PCR Analysis</h3><PCRGauge pcr={n(data.pcr_oi, 1)} /></div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 col-span-2"><h3 className="text-sm font-semibold text-gray-300 mb-3">📉 Historical IV Trend</h3><HistoricalIVChart currentIV={n(atmIV, 20)} /></div>
    </div>
  );
}


