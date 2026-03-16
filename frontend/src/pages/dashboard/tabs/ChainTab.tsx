// ============================================================================
// tabs/ChainTab.tsx — Options Chain
// ============================================================================
import { useRef } from 'react';
import { DashData } from '../../types';
import { n, fmt, fmtK, ivColor } from '../shared/helpers';

interface Props {
  data: DashData;
  prevChainRef: React.MutableRefObject<Map<string, number>>;
}

export function ChainTab({ data, prevChainRef }: Props) {
  const atmRef    = useRef<HTMLTableRowElement>(null);
  const chain     = data.chain;
  const spotPrice = n(data.spotPrice);
  const atmStrike = n(data.atmStrike);
  const maxCeOI   = Math.max(...chain.map(r => n(r.ce_oi)), 1);
  const maxPeOI   = Math.max(...chain.map(r => n(r.pe_oi)), 1);
  const totalCeOI = chain.reduce((s, r) => s + n(r.ce_oi), 0);
  const totalPeOI = chain.reduce((s, r) => s + n(r.pe_oi), 0);
  const dte = data.expiryDate
    ? Math.max(1, Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / 86400000))
    : 7;
  const chgColor = (c: number) =>
    c > 5 ? 'text-green-400' : c > 0 ? 'text-green-700' : c < -5 ? 'text-red-400' : c < 0 ? 'text-red-700' : 'text-gray-600';

  return (
    <div className="h-full flex flex-col">
      {/* Sub-header */}
      <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex items-center gap-4 text-xs flex-wrap flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">CE OI:</span><span className="text-green-400 font-bold">{fmtK(totalCeOI)}</span>
          <div className="w-20 h-2 bg-gray-700 rounded overflow-hidden"><div className="h-full bg-green-600 rounded" style={{ width: `${totalCeOI / (totalCeOI + totalPeOI + 1) * 100}%` }} /></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">PE OI:</span><span className="text-red-400 font-bold">{fmtK(totalPeOI)}</span>
          <div className="w-20 h-2 bg-gray-700 rounded overflow-hidden"><div className="h-full bg-red-600 rounded" style={{ width: `${totalPeOI / (totalCeOI + totalPeOI + 1) * 100}%` }} /></div>
        </div>
        <div><span className="text-gray-500">PCR: </span><span className={`font-bold ${n(data.pcr_oi) > 1.2 ? 'text-green-400' : n(data.pcr_oi) < 0.8 ? 'text-red-400' : 'text-yellow-400'}`}>{fmt(data.pcr_oi, 2)}</span></div>
        <div className="ml-auto text-gray-600">DTE: <span className="text-white font-bold">{dte}d</span> | Expiry: {data.expiryDate ? new Date(data.expiryDate).toLocaleDateString('en-IN') : '–'}</div>
      </div>

      {/* Chain Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-900 shadow">
            <tr>
              <th className="py-2 px-1 text-green-500 text-right">OI Chg%</th>
              <th className="py-2 px-1 text-green-500 text-right">OI</th>
              <th className="py-2 px-1 text-green-500 text-right">Vol</th>
              <th className="py-2 px-1 text-green-500 text-right">IV%</th>
              <th className="py-2 px-1 text-green-500 text-right">Δ</th>
              <th className="py-2 px-1 text-green-500 text-right">Θ</th>
              <th className="py-2 px-2 text-green-400 text-right font-bold">CE LTP</th>
              <th className="py-2 px-3 text-yellow-400 text-center font-bold bg-gray-800">STRIKE</th>
              <th className="py-2 px-2 text-red-400 text-left font-bold">PE LTP</th>
              <th className="py-2 px-1 text-red-500 text-left">Θ</th>
              <th className="py-2 px-1 text-red-500 text-left">Δ</th>
              <th className="py-2 px-1 text-red-500 text-left">IV%</th>
              <th className="py-2 px-1 text-red-500 text-left">Vol</th>
              <th className="py-2 px-1 text-red-500 text-left">OI</th>
              <th className="py-2 px-1 text-red-500 text-left">OI Chg%</th>
            </tr>
          </thead>
          <tbody>
            {chain.map((row, idx) => {
              const strike    = Number(row.strike_price), isATM = strike === Number(atmStrike);
              const isITMce   = strike < spotPrice, isITMpe = strike > spotPrice;
              const rowBg     = isATM ? 'bg-yellow-950/50' : isITMce ? 'bg-green-950/10' : isITMpe ? 'bg-red-950/10' : '';
              const ceOI      = n(row.ce_oi), peOI = n(row.pe_oi);
              const prevCeOI  = prevChainRef.current.get(`ce_${strike}`) ?? ceOI;
              const prevPeOI  = prevChainRef.current.get(`pe_${strike}`) ?? peOI;
              const ceChg     = prevCeOI > 0 ? ((ceOI - prevCeOI) / prevCeOI) * 100 : 0;
              const peChg     = prevPeOI > 0 ? ((peOI - prevPeOI) / prevPeOI) * 100 : 0;
              const nextStrike = idx < chain.length - 1 ? Number(chain[idx + 1]?.strike_price) : null;
              const isSpotHere = nextStrike != null && spotPrice >= strike && spotPrice < nextStrike;
              return (
                <>
                  <tr key={`row-${strike}`} ref={isATM ? atmRef : undefined}
                    className={`border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors ${rowBg}`}>
                    <td className={`py-1.5 px-1 text-right ${chgColor(ceChg)}`}>{ceChg !== 0 ? (ceChg > 0 ? '+' : '') + ceChg.toFixed(1) + '%' : '–'}</td>
                    <td className="py-1.5 px-1 text-right relative">
                      <div className="absolute inset-0 bg-green-600/10" style={{ width: `${(ceOI / maxCeOI) * 100}%` }} />
                      <span className={isITMce ? 'text-green-300 font-medium' : 'text-gray-500'}>{fmtK(ceOI)}</span>
                    </td>
                    <td className={`py-1.5 px-1 text-right ${isITMce ? 'text-green-400/70' : 'text-gray-600'}`}>{fmtK(row.ce_volume)}</td>
                    <td className="py-1.5 px-1 text-right font-mono" style={{ color: ivColor(row.ce_greeks?.iv) }}>{row.ce_greeks?.iv != null ? fmt(row.ce_greeks.iv, 1) : '–'}</td>
                    <td className={`py-1.5 px-1 text-right font-mono ${isITMce ? 'text-green-300' : 'text-gray-500'}`}>{row.ce_greeks?.delta != null ? fmt(row.ce_greeks.delta, 3) : '–'}</td>
                    <td className="py-1.5 px-1 text-right font-mono text-orange-400/80">{row.ce_greeks?.theta != null ? fmt(row.ce_greeks.theta, 1) : '–'}</td>
                    <td className={`py-1.5 px-2 text-right font-bold text-sm ${isITMce ? 'text-green-300' : 'text-green-700'}`}>{row.ce_ltp != null ? fmt(row.ce_ltp, 2) : '–'}</td>
                    <td className={`py-1.5 px-3 text-center font-bold bg-gray-800/60 ${isATM ? 'text-yellow-300 text-sm' : 'text-gray-200'}`}>{isATM && <span className="text-yellow-500 mr-1 text-xs">►</span>}{strike}</td>
                    <td className={`py-1.5 px-2 text-left font-bold text-sm ${isITMpe ? 'text-red-300' : 'text-red-700'}`}>{row.pe_ltp != null ? fmt(row.pe_ltp, 2) : '–'}</td>
                    <td className="py-1.5 px-1 text-left font-mono text-orange-400/80">{row.pe_greeks?.theta != null ? fmt(row.pe_greeks.theta, 1) : '–'}</td>
                    <td className={`py-1.5 px-1 text-left font-mono ${isITMpe ? 'text-red-300' : 'text-gray-500'}`}>{row.pe_greeks?.delta != null ? fmt(row.pe_greeks.delta, 3) : '–'}</td>
                    <td className="py-1.5 px-1 text-left font-mono" style={{ color: ivColor(row.pe_greeks?.iv) }}>{row.pe_greeks?.iv != null ? fmt(row.pe_greeks.iv, 1) : '–'}</td>
                    <td className={`py-1.5 px-1 text-left ${isITMpe ? 'text-red-400/70' : 'text-gray-600'}`}>{fmtK(row.pe_volume)}</td>
                    <td className="py-1.5 px-1 text-left relative">
                      <div className="absolute inset-0 bg-red-600/10" style={{ width: `${(peOI / maxPeOI) * 100}%` }} />
                      <span className={isITMpe ? 'text-red-300 font-medium' : 'text-gray-500'}>{fmtK(peOI)}</span>
                    </td>
                    <td className={`py-1.5 px-1 text-left ${chgColor(peChg)}`}>{peChg !== 0 ? (peChg > 0 ? '+' : '') + peChg.toFixed(1) + '%' : '–'}</td>
                  </tr>
                  {isSpotHere && (
                    <tr key={`spot-${strike}`}>
                      <td colSpan={15} className="p-0 h-0">
                        <div className="relative" style={{ height: 0 }}>
                          <div className="absolute left-0 right-0 border-t-2 border-yellow-400/80" style={{ top: 0 }} />
                          <span className="absolute bg-yellow-500 text-black text-xs font-bold px-2 rounded" style={{ top: -9, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>▶ {fmt(spotPrice, 2)}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}