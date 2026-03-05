const MarketWatch: React.FC<{ [key: string]: any }> = ({ spotPrice = 0, atmStrike = 0, pcr_oi = 0, pcr_volume = 0, maxPain = 0, expiryDate = '', chain = [], loading = false }) => {
  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400"><div className="animate-pulse">Loading...</div></div>;
  const fmt = (v: any, d = 2) => v != null ? Number(v).toFixed(d) : '-';
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-5 gap-3 mb-4">
        {[
          { label: 'NIFTY', value: `₹${fmt(spotPrice)}`, color: 'text-white' },
          { label: 'ATM', value: String(atmStrike), color: 'text-yellow-400' },
          { label: 'PCR OI', value: fmt(pcr_oi), color: Number(pcr_oi) > 1 ? 'text-green-400' : 'text-red-400' },
          { label: 'PCR Vol', value: fmt(pcr_volume), color: 'text-blue-400' },
          { label: 'Max Pain', value: String(maxPain), color: 'text-orange-400' },
        ].map(c => (
          <div key={c.label} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <div className="text-gray-400 text-xs mb-1">{c.label}</div>
            <div className={`font-bold text-lg ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 flex justify-between">
          <span className="text-white font-semibold">Options Chain</span>
          {expiryDate && <span className="text-gray-400 text-sm">Expiry: {expiryDate}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-900"><tr className="text-gray-400">
              <th className="px-2 py-2 text-right">CE IV</th><th className="px-2 py-2 text-right">CE OI</th>
              <th className="px-2 py-2 text-right">CE LTP</th><th className="px-2 py-2 text-center font-bold text-white">STRIKE</th>
              <th className="px-2 py-2 text-left">PE LTP</th><th className="px-2 py-2 text-left">PE OI</th><th className="px-2 py-2 text-left">PE IV</th>
            </tr></thead>
            <tbody>
              {(chain as any[]).map((row: any) => {
                const isATM = row.strike_price === atmStrike;
                return (
                  <tr key={row.strike_price} className={`border-b border-gray-700/50 ${isATM ? 'bg-blue-900/30' : 'hover:bg-gray-750'}`}>
                    <td className="px-2 py-1.5 text-right text-green-400">{fmt(row.ce_greeks?.iv ?? row.ce_iv, 1)}%</td>
                    <td className="px-2 py-1.5 text-right">{row.ce_oi != null ? (Number(row.ce_oi)/1000).toFixed(0)+'K' : '-'}</td>
                    <td className="px-2 py-1.5 text-right text-white font-medium">{fmt(row.ce_ltp)}</td>
                    <td className={`px-2 py-1.5 text-center font-bold ${isATM ? 'text-yellow-400' : 'text-white'}`}>{row.strike_price}{isATM && <span className="ml-1 text-[10px] text-yellow-500">ATM</span>}</td>
                    <td className="px-2 py-1.5 text-left text-white font-medium">{fmt(row.pe_ltp)}</td>
                    <td className="px-2 py-1.5 text-left">{row.pe_oi != null ? (Number(row.pe_oi)/1000).toFixed(0)+'K' : '-'}</td>
                    <td className="px-2 py-1.5 text-left text-red-400">{fmt(row.pe_greeks?.iv ?? row.pe_iv, 1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default MarketWatch;

