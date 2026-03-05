import { useState } from 'react';
const Analytics: React.FC<{ [key: string]: any }> = ({ oiData = [], ivData = [], pcrData = [], atmStrike = 0, loading = false }) => {
  const [tab, setTab] = useState('oi');
  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Loading...</div>;
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex gap-2 mb-4">
        {[['oi','📊 OI'],['iv','📈 IV Smile'],['pcr','📉 PCR'],['greeks','🔥 Greeks']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${tab === id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{label}</button>
        ))}
      </div>
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 min-h-96">
        {tab === 'oi' && ((oiData as any[]).length === 0 ? <div className="text-gray-500 text-center py-16">No OI data</div> :
          <div className="space-y-1 overflow-y-auto max-h-96">
            {(oiData as any[]).map((row: any, i: number) => {
              const s = row.strike ?? row.strike_price;
              const ce = Number(row.ce_oi ?? 0); const pe = Number(row.pe_oi ?? 0);
              const max = Math.max(...(oiData as any[]).map((r: any) => Math.max(Number(r.ce_oi??0), Number(r.pe_oi??0))), 1);
              return <div key={i} className={`flex items-center gap-2 text-xs ${s === atmStrike ? 'bg-blue-900/30 rounded' : ''}`}>
                <span className="w-14 text-right text-green-400">{(ce/1000).toFixed(0)}K</span>
                <div className="flex-1 flex gap-1 items-center">
                  <div className="bg-green-600/60 h-3 rounded-sm" style={{width:`${ce/max*45}%`}}/>
                  <span className={`w-14 text-center font-bold text-xs ${s===atmStrike?'text-yellow-400':'text-white'}`}>{s}</span>
                  <div className="bg-red-600/60 h-3 rounded-sm" style={{width:`${pe/max*45}%`}}/>
                </div>
                <span className="w-14 text-left text-red-400">{(pe/1000).toFixed(0)}K</span>
              </div>;
            })}
          </div>
        )}
        {tab === 'iv' && ((ivData as any[]).length === 0 ? <div className="text-gray-500 text-center py-16">No IV data</div> :
          <div className="space-y-1 overflow-y-auto max-h-96">
            {(ivData as any[]).map((r: any, i: number) => (
              <div key={i} className="flex gap-4 text-xs">
                <span className="w-16 text-white">{r.strike??r.strike_price}</span>
                <span className="text-green-400">CE: {Number(r.ce_iv??0).toFixed(1)}%</span>
                <span className="text-red-400">PE: {Number(r.pe_iv??0).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'pcr' && ((pcrData as any[]).length === 0 ? <div className="text-gray-500 text-center py-16">No PCR data</div> :
          <div className="space-y-1 overflow-y-auto max-h-96">
            {(pcrData as any[]).map((r: any, i: number) => (
              <div key={i} className="flex gap-4 text-xs">
                <span className="text-gray-400 w-20">{r.time}</span>
                <span className="text-blue-400">OI: {Number(r.pcr_oi??0).toFixed(2)}</span>
                <span className="text-purple-400">Vol: {Number(r.pcr_volume??0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'greeks' && <div className="text-gray-500 text-center py-16">Deploy GreeksHeatmap.tsx to enable</div>}
      </div>
    </div>
  );
};
export default Analytics;

