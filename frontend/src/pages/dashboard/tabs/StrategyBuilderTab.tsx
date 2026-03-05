// ============================================================================
// tabs/StrategyBuilderTab.tsx — Strategy Builder, Payoff Chart, Analysis
// ============================================================================
import { useState, useMemo } from 'react';
import { DashData, SignalData, StratLeg } from '../../types';
import { n, fmt, fmtRs, ivColor } from '../shared/helpers';
import { BS } from '../shared/BS';

function PayoffChart({ legs, spotPrice, dte, iv, rate }: { legs: StratLeg[]; spotPrice: number; dte: number; iv: number; rate: number }) {
  const W = 600, H = 200, PAD = { t: 16, b: 32, l: 48, r: 16 };
  if (!legs.length) return <div className="flex items-center justify-center h-48 text-gray-600 text-sm">Add legs to see payoff chart</div>;
  const MARGIN = 0.30;
  const minP = spotPrice * (1 - MARGIN), maxP = spotPrice * (1 + MARGIN);
  const POINTS = 200, step = (maxP - minP) / POINTS;
  const strikeSet = legs.map(l => l.strike).filter(k => k >= minP && k <= maxP);
  const allPrices = [...new Set([...Array.from({ length: POINTS + 1 }, (_, i) => minP + i * step), ...strikeSet])].sort((a, b) => a - b);
  const payoffs = allPrices.map(price => legs.reduce((sum, leg) => {
    const T = dte / 365, sigma = iv / 100, r = rate / 100;
    let pl: number;
    if (T <= 0) { const intr = leg.type === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price); pl = (intr - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }
    else { const g = BS.greeks(price, leg.strike, T, r, sigma); if (!g) return sum; pl = ((leg.type === 'CE' ? g.callPrice : g.putPrice) - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }
    return sum + pl;
  }, 0));
  const maxPL = Math.max(...payoffs, 1), minPL = Math.min(...payoffs, -1), plRange = maxPL - minPL || 1;
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b;
  const toX = (p: number) => PAD.l + ((p - minP) / (maxP - minP)) * chartW;
  const toY = (pl: number) => PAD.t + (1 - (pl - minPL) / plRange) * chartH;
  const zeroY = toY(0), spotX = toX(spotPrice);
  const pathData = allPrices.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p).toFixed(1)},${toY(payoffs[i]).toFixed(1)}`).join(' ');
  const profitFill = `${pathData} L${toX(allPrices[allPrices.length - 1]).toFixed(1)},${zeroY.toFixed(1)} L${toX(allPrices[0]).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const uniqueStrikes = [...new Set(legs.map(l => l.strike))].filter(s => s >= minP && s <= maxP);
  const yTicks = [minPL, minPL / 2, 0, maxPL / 2, maxPL].map(v => ({ v, y: toY(v) }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
      {yTicks.map(({ v, y }) => (<g key={v}><line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? '0' : '4,4'} /><text x={PAD.l - 4} y={y + 4} textAnchor="end" fill="#6B7280" fontSize="8" fontFamily="monospace">{v >= 0 ? '+' : ''}{v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}</text></g>))}
      <clipPath id="lossMask"><rect x={PAD.l} y={zeroY} width={chartW} height={H - PAD.b - zeroY} /></clipPath>
      <path d={profitFill} fill="rgba(239,68,68,0.12)" clipPath="url(#lossMask)" />
      <clipPath id="profitMask"><rect x={PAD.l} y={PAD.t} width={chartW} height={zeroY - PAD.t} /></clipPath>
      <path d={profitFill} fill="rgba(34,197,94,0.12)" clipPath="url(#profitMask)" />
      <path d={pathData} fill="none" stroke="#F0B429" strokeWidth="2" />
      {uniqueStrikes.map(s => <line key={s} x1={toX(s)} y1={PAD.t} x2={toX(s)} y2={H - PAD.b} stroke="rgba(156,163,175,0.3)" strokeWidth="1" strokeDasharray="3,3" />)}
      <line x1={spotX} y1={PAD.t} x2={spotX} y2={H - PAD.b} stroke="rgba(56,189,248,0.8)" strokeWidth="1.5" strokeDasharray="4,4" />
      <text x={spotX} y={PAD.t - 3} textAnchor="middle" fill="rgba(56,189,248,0.8)" fontSize="8" fontFamily="monospace">SPOT</text>
      {[minP, minP + (maxP - minP) * 0.25, spotPrice, minP + (maxP - minP) * 0.75, maxP].map(p => (<text key={p} x={toX(p)} y={H - 4} textAnchor="middle" fill="#6B7280" fontSize="7.5" fontFamily="monospace">{p >= 1000 ? '₹' + (p / 1000).toFixed(1) + 'K' : '₹' + p.toFixed(0)}</text>))}
    </svg>
  );
}

// ============================================================================
// STRATEGY ANALYSIS ENGINE
// ============================================================================

function analyzeStrategy(legs: StratLeg[], spotPrice: number, dte: number, iv: number, rate: number, pcrOi: number, maxPain: number, ivRank: number) {
  if (!legs.length) return null;
  const T = dte / 365, sigma = iv / 100, r = rate / 100;
  let netDelta = 0, netTheta = 0, netVega = 0, netGamma = 0;
  legs.forEach(leg => {
    const g = BS.greeks(spotPrice, leg.strike, T, r, sigma); if (!g) return;
    const m = (leg.action === 'BUY' ? 1 : -1) * leg.qty;
    netDelta += (leg.type === 'CE' ? g.callDelta : g.putDelta) * m;
    netTheta += (leg.type === 'CE' ? g.callTheta : g.putTheta) * m;
    netVega += g.vega * m; netGamma += g.gamma * m;
  });
  const POINTS = 150, MARGIN = 0.30, minP = spotPrice * (1 - MARGIN), maxP = spotPrice * (1 + MARGIN);
  const prices = Array.from({ length: POINTS + 1 }, (_, i) => minP + i * (maxP - minP) / POINTS);
  const payoffs = prices.map(price => legs.reduce((sum, leg) => { const intr = leg.type === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price); return sum + (intr - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }, 0));
  const maxProfit = Math.max(...payoffs), maxLoss = Math.min(...payoffs);
  const netPremium = legs.reduce((s, l) => s + (l.action === 'BUY' ? -1 : 1) * l.premium * l.qty, 0);
  const pop = BS.strategyPoP(legs, spotPrice, dte, iv, rate) || 0;
  const buyCE = legs.filter(l => l.action === 'BUY' && l.type === 'CE');
  const sellCE = legs.filter(l => l.action === 'SELL' && l.type === 'CE');
  const buyPE = legs.filter(l => l.action === 'BUY' && l.type === 'PE');
  const sellPE = legs.filter(l => l.action === 'SELL' && l.type === 'PE');
  const nl = legs.length;
  let strategyName = 'Custom Strategy';
  if (nl === 1) strategyName = legs[0].action + ' ' + legs[0].type;
  else if (nl === 2) {
    if (buyCE.length === 1 && buyPE.length === 1 && !sellCE.length && !sellPE.length) strategyName = buyCE[0].strike === buyPE[0].strike ? 'Long Straddle' : 'Long Strangle';
    else if (sellCE.length === 1 && sellPE.length === 1 && !buyCE.length && !buyPE.length) strategyName = sellCE[0].strike === sellPE[0].strike ? 'Short Straddle' : 'Short Strangle';
    else if (buyCE.length === 1 && sellCE.length === 1 && !buyPE.length && !sellPE.length) strategyName = buyCE[0].strike < sellCE[0].strike ? 'Bull Call Spread' : 'Bear Call Spread';
    else if (buyPE.length === 1 && sellPE.length === 1 && !buyCE.length && !sellCE.length) strategyName = buyPE[0].strike > sellPE[0].strike ? 'Bear Put Spread' : 'Bull Put Spread';
    else if (buyCE.length === 1 && sellPE.length === 1) strategyName = 'Synthetic Long';
    else if (sellCE.length === 1 && buyPE.length === 1) strategyName = 'Synthetic Short';
  } else if (nl === 3 && legs.some(l => l.qty >= 2)) strategyName = 'Butterfly Spread';
  else if (nl === 4 && buyCE.length === 1 && sellCE.length === 1 && buyPE.length === 1 && sellPE.length === 1) strategyName = 'Iron Condor';
  else if (buyCE.length > 0 && buyPE.length > 0 && sellCE.length > 0 && sellPE.length > 0) strategyName = 'Iron Condor/Butterfly';
  const pcrSentiment = pcrOi > 1.3 ? 'bullish' : pcrOi < 0.7 ? 'bearish' : 'neutral';
  const ivSentiment = ivRank > 70 ? 'elevated (good for selling)' : ivRank < 30 ? 'low (good for buying)' : 'moderate';
  const spotVsMaxPain = spotPrice > maxPain ? `above Max Pain (${maxPain})` : spotPrice < maxPain ? `below Max Pain (${maxPain})` : `at Max Pain (${maxPain})`;
  const deltaBias = Math.abs(netDelta) < 0.1 ? 'market-neutral' : netDelta > 0 ? 'long delta (bullish)' : 'short delta (bearish)';
  const isNetSeller = netPremium > 0, isNetBuyer = netPremium < 0;
  let suitability = '', suitabilityColor = '#6B7280';
  if (isNetSeller && ivRank > 60) { suitability = '✅ Good fit: High IV favors premium sellers'; suitabilityColor = '#22C55E'; }
  else if (isNetSeller && ivRank < 30) { suitability = '⚠️ Caution: Low IV — selling premium is risky'; suitabilityColor = '#F97316'; }
  else if (isNetBuyer && ivRank < 30) { suitability = '✅ Good fit: Low IV favors premium buyers'; suitabilityColor = '#22C55E'; }
  else if (isNetBuyer && ivRank > 70) { suitability = '⚠️ Caution: High IV makes buying expensive'; suitabilityColor = '#F97316'; }
  else { suitability = '🔵 Neutral setup — monitor IV direction'; suitabilityColor = '#60A5FA'; }
  const breakevens: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = payoffs[i - 1], curr = payoffs[i];
    if (Math.abs(prev) + Math.abs(curr) > 1e-4 && ((prev < 0 && curr > 0) || (prev > 0 && curr < 0))) {
      const f = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
      breakevens.push(prices[i - 1] + f * (prices[i] - prices[i - 1]));
    }
  }
  return { strategyName, netDelta, netTheta, netVega, netGamma, maxProfit, maxLoss, netPremium, pop, breakevens, pcrSentiment, ivSentiment, spotVsMaxPain, deltaBias, suitability, suitabilityColor, isNetSeller, isNetBuyer };
}

// ============================================================================
// STRATEGY BUILDER TAB
// ============================================================================

const ATM_STRIKE = (S: number) => Math.round(S / 50) * 50;
let _legCounter = 0;
const nextLegId = () => ++_legCounter;

export function StrategyBuilderTab({ data, signalData }: { data: DashData | null; signalData: SignalData | null }) {
  const spotPrice = n(data?.spotPrice, 22150);
  const atmStrike = n(data?.atmStrike, ATM_STRIKE(spotPrice));
  const chain = data?.chain ?? [];
  const pcrOi = n(data?.pcr_oi, 1);
  const maxPain = n(data?.maxPain, atmStrike);
  const atmRow = chain.find(r => Number(r.strike_price) === Number(atmStrike));
  const atmIV = n(atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? signalData?.currentIV ?? 18, 18);
  const ivRank = n(signalData?.ivAnalysis?.ivRank, 50);
  const dte = data?.expiryDate ? Math.max(1, Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / 86400000)) : n(signalData?.daysToExpiry, 7);

  const [legs, setLegs] = useState<StratLeg[]>([]);
  const [rateVal, setRate] = useState(6.5);
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [activePill, setActivePill] = useState<string>('');

  const effectiveIV = ivOverride !== null ? ivOverride : atmIV;
  const analysis = useMemo(() => analyzeStrategy(legs, spotPrice, dte, effectiveIV, rateVal, pcrOi, maxPain, ivRank), [legs, spotPrice, dte, effectiveIV, rateVal, pcrOi, maxPain, ivRank]);

  const getLivePremium = (strike: number, type: 'CE' | 'PE'): number => {
    const row = chain.find(r => Number(r.strike_price) === strike);
    if (row) { const ltp = type === 'CE' ? n(row.ce_ltp) : n(row.pe_ltp); if (ltp > 0) return ltp; }
    const g = BS.greeks(spotPrice, strike, dte / 365, rateVal / 100, effectiveIV / 100);
    return g ? Math.max(0, parseFloat((type === 'CE' ? g.callPrice : g.putPrice).toFixed(2))) : 0;
  };

  const addLeg = (action: 'BUY' | 'SELL', type: 'CE' | 'PE', strike?: number, _premium?: number, qty = 1) => {
    const K = Math.round((strike ?? spotPrice) / 50) * 50;
    const prem = getLivePremium(K, type);
    setLegs(prev => [...prev, { id: nextLegId(), action, type, strike: K, premium: Math.max(0, parseFloat(prem.toFixed(2))), qty }]);
  };

  const removeLeg = (id: number) => setLegs(prev => prev.filter(l => l.id !== id));

  const updateLeg = (id: number, field: keyof StratLeg, val: any) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === 'strike') { const s = Math.round(parseFloat(val) / 50) * 50; return { ...l, strike: s, premium: getLivePremium(s, l.type) }; }
      if (field === 'type') return { ...l, type: val, premium: getLivePremium(l.strike, val) };
      if (field === 'qty') return { ...l, qty: Math.max(1, parseInt(val) || 1) };
      if (field === 'premium') return { ...l, premium: Math.max(0, parseFloat(val) || 0) };
      return { ...l, [field]: val };
    }));
  };

  const loadPreset = (key: string) => {
    setActivePill(key);
    const S = spotPrice;
    const presets: Record<string, [string, string, number, number][]> = {
      'Long Call':     [['BUY', 'CE', ATM_STRIKE(S), 1]],
      'Long Put':      [['BUY', 'PE', ATM_STRIKE(S), 1]],
      'Short Call':    [['SELL', 'CE', ATM_STRIKE(S), 1]],
      'Short Put':     [['SELL', 'PE', ATM_STRIKE(S), 1]],
      'Bull Call':     [['BUY', 'CE', ATM_STRIKE(S), 1], ['SELL', 'CE', ATM_STRIKE(S) + 500, 1]],
      'Bear Put':      [['BUY', 'PE', ATM_STRIKE(S), 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1]],
      'Straddle':      [['BUY', 'CE', ATM_STRIKE(S), 1], ['BUY', 'PE', ATM_STRIKE(S), 1]],
      'Strangle':      [['BUY', 'CE', ATM_STRIKE(S) + 500, 1], ['BUY', 'PE', ATM_STRIKE(S) - 500, 1]],
      'Iron Condor':   [['BUY', 'PE', ATM_STRIKE(S) - 1000, 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1], ['SELL', 'CE', ATM_STRIKE(S) + 500, 1], ['BUY', 'CE', ATM_STRIKE(S) + 1000, 1]],
      'Butterfly':     [['BUY', 'CE', ATM_STRIKE(S) - 500, 1], ['SELL', 'CE', ATM_STRIKE(S), 2], ['BUY', 'CE', ATM_STRIKE(S) + 500, 1]],
      'Short Straddle': [['SELL', 'CE', ATM_STRIKE(S), 1], ['SELL', 'PE', ATM_STRIKE(S), 1]],
      'Short Strangle': [['SELL', 'CE', ATM_STRIKE(S) + 500, 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1]],
    };
    const presetLegs = presets[key]; if (!presetLegs) return;
    setLegs([]);
    setTimeout(() => { presetLegs.forEach(([action, type, strike, qty]) => addLeg(action as any, type as any, strike as number, undefined, qty as number)); }, 0);
  };

  const PILLS = ['Long Call', 'Long Put', 'Short Call', 'Short Put', 'Bull Call', 'Bear Put', 'Straddle', 'Strangle', 'Short Straddle', 'Short Strangle', 'Iron Condor', 'Butterfly'];
  const typeIcons: Record<string, string> = { 'IV_CRUSH': '🔥', 'IV_EXPANSION': '🚀', 'DELTA_NEUTRAL': '⚖️', 'THETA_DECAY': '⏳', 'GAMMA_SCALP': '🎯' };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Strategy Presets */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        {PILLS.map(p => (<button key={p} onClick={() => loadPreset(p)} className={`text-xs px-3 py-1 rounded-full border transition-all ${activePill === p ? 'bg-yellow-500 border-yellow-500 text-black font-bold' : 'border-gray-700 text-gray-400 hover:border-yellow-600 hover:text-yellow-400'}`}>{p}</button>))}
        <button onClick={() => { setLegs([]); setActivePill(''); }} className="text-xs px-3 py-1 rounded-full border border-red-800/60 text-red-500 hover:bg-red-900/20 ml-auto">Clear All</button>
        <button onClick={() => addLeg('BUY', 'CE', atmStrike)} className="text-xs px-3 py-1 rounded-full border border-yellow-700 text-yellow-400 hover:bg-yellow-900/20">+ Add Leg</button>
      </div>

      <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: '1fr 1fr 340px', gridTemplateRows: '1fr' }}>

        {/* LEFT — Payoff Chart + Legs */}
        <div className="flex flex-col border-r border-gray-800 overflow-hidden">
          <div className="flex gap-3 px-3 py-2 bg-gray-900/50 border-b border-gray-800 flex-shrink-0 items-center">
            <div className="text-xs text-gray-500">Spot: <span className="text-yellow-400 font-bold font-mono">{spotPrice.toFixed(0)}</span></div>
            <div className="text-xs text-gray-500">DTE: <span className="text-blue-400 font-bold">{dte}d</span></div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">IV%:</span>
              <input type="number" value={ivOverride !== null ? ivOverride : atmIV} step="0.5" min="1" max="200" onChange={e => setIvOverride(parseFloat(e.target.value) || atmIV)} className="w-16 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500" />
              {ivOverride !== null && <button onClick={() => setIvOverride(null)} className="text-xs text-gray-600 hover:text-yellow-400">⟳</button>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Rate%:</span>
              <input type="number" value={rateVal} step="0.25" min="0" max="25" onChange={e => setRate(parseFloat(e.target.value) || 6.5)} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs font-mono text-gray-300 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="px-2 py-1 bg-gray-950 flex-shrink-0 border-b border-gray-800">
            <div className="text-xs text-gray-600 mb-1 px-1">Payoff at Expiry</div>
            <PayoffChart legs={legs} spotPrice={spotPrice} dte={dte} iv={effectiveIV} rate={rateVal} />
          </div>
          {analysis && (
            <div className="grid grid-cols-4 gap-px bg-gray-800 flex-shrink-0 text-xs">
              {[
                { label: 'Max Profit', value: analysis.maxProfit > 1e9 ? 'Unlimited' : fmtRs(analysis.maxProfit), color: 'text-green-400' },
                { label: 'Max Loss', value: analysis.maxLoss < -1e9 ? 'Unlimited' : fmtRs(Math.abs(analysis.maxLoss)), color: 'text-red-400' },
                { label: 'PoP', value: (analysis.pop || 0).toFixed(1) + '%', color: 'text-blue-400' },
                { label: 'Net Flow', value: (analysis.netPremium >= 0 ? 'Credit ' : 'Debit ') + fmtRs(Math.abs(analysis.netPremium), 2), color: analysis.netPremium >= 0 ? 'text-green-400' : 'text-purple-400' },
              ].map(m => (<div key={m.label} className="bg-gray-900 px-2 py-1.5 text-center"><div className="text-gray-600 text-[9px] uppercase tracking-wide">{m.label}</div><div className={`font-bold font-mono text-xs mt-0.5 ${m.color}`}>{m.value}</div></div>))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {!legs.length ? (
              <div className="text-center py-10 text-gray-600"><div className="text-3xl mb-2">📋</div><div className="text-xs">Select a strategy or add legs manually</div></div>
            ) : legs.map(leg => {
              const T = dte / 365, sigma = effectiveIV / 100, r = rateVal / 100;
              const g = BS.greeks(spotPrice, leg.strike, T, r, sigma);
              const delta = g ? (leg.type === 'CE' ? g.callDelta : g.putDelta) : null;
              const theta = g ? (leg.type === 'CE' ? g.callTheta : g.putTheta) : null;
              const m = leg.action === 'BUY' ? 1 : -1;
              const intr = leg.type === 'CE' ? Math.max(0, spotPrice - leg.strike) : Math.max(0, leg.strike - spotPrice);
              const plExpiry = (intr - leg.premium) * m * leg.qty;
              return (
                <div key={leg.id} className="mx-3 my-2 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${leg.action === 'BUY' ? 'bg-green-900/60 text-green-400 border border-green-800' : 'bg-red-900/60 text-red-400 border border-red-800'}`}>{leg.action}</span>
                    <div className="flex gap-1">{(['CE', 'PE'] as const).map(t => <button key={t} onClick={() => updateLeg(leg.id, 'type', t)} className={`text-xs px-2 py-0.5 rounded ${leg.type === t ? (t === 'CE' ? 'bg-blue-800 text-blue-300' : 'bg-purple-800 text-purple-300') : 'bg-gray-800 text-gray-500'}`}>{t}</button>)}</div>
                    <div className="flex gap-1 ml-1">{(['BUY', 'SELL'] as const).map(a => <button key={a} onClick={() => setLegs(prev => prev.map(l => l.id === leg.id ? { ...l, action: a } : l))} className={`text-xs px-2 py-0.5 rounded ${leg.action === a ? (a === 'BUY' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400') : 'bg-gray-800 text-gray-500'}`}>{a}</button>)}</div>
                    <div className={`ml-auto font-mono text-xs font-bold ${plExpiry >= 0 ? 'text-green-400' : 'text-red-400'}`}>{plExpiry >= 0 ? '+' : ''}{fmtRs(plExpiry, 2)}</div>
                    <button onClick={() => removeLeg(leg.id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Strike</div>
                      <select value={leg.strike} onChange={e => updateLeg(leg.id, 'strike', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-yellow-400 focus:outline-none focus:border-yellow-600">
                        {chain.length > 0 ? chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 1000).map(r => <option key={n(r.strike_price)} value={n(r.strike_price)}>{n(r.strike_price)}</option>) : Array.from({ length: 21 }, (_, i) => ATM_STRIKE(spotPrice) - 500 + i * 50).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Premium ₹ <span className="text-blue-600">live</span></div>
                      <input type="number" value={leg.premium} min="0" step="0.5" onChange={e => updateLeg(leg.id, 'premium', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Qty (lots)</div>
                      <input type="number" value={leg.qty} min="1" step="1" onChange={e => updateLeg(leg.id, 'qty', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-yellow-600" />
                    </div>
                  </div>
                  {g && (
                    <div className="flex gap-3 mt-2 text-[10px]">
                      {[
                        { n: 'Δ', v: (delta! * m * leg.qty).toFixed(3), c: delta! * m >= 0 ? 'text-green-400' : 'text-red-400' },
                        { n: 'Γ', v: (g.gamma * leg.qty).toFixed(5), c: 'text-purple-400' },
                        { n: 'Θ', v: (theta! * m * leg.qty).toFixed(2), c: theta! * m >= 0 ? 'text-green-400' : 'text-red-400' },
                        { n: 'ν', v: (g.vega * m * leg.qty).toFixed(2), c: 'text-blue-400' },
                        { n: 'IV', v: effectiveIV.toFixed(1) + '%', c: 'text-yellow-400' },
                        { n: 'LTP', v: '₹' + (leg.type === 'CE' ? n(chain.find(r => n(r.strike_price) === leg.strike)?.ce_ltp) : n(chain.find(r => n(r.strike_price) === leg.strike)?.pe_ltp)).toFixed(2), c: 'text-gray-400' },
                      ].map(({ n: name, v, c }) => (<div key={name} className="text-center"><div className="text-gray-600">{name}</div><div className={`font-mono font-bold ${c}`}>{v}</div></div>))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER — Live Options Chain */}
        <div className="flex flex-col border-r border-gray-800 overflow-hidden">
          <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0">
            <div className="flex items-center justify-between text-xs"><span className="text-gray-500 font-bold uppercase tracking-wide">Live Options Chain</span><span className="text-gray-600">Click to add leg</span></div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-900">
                <tr>
                  <th className="py-1.5 px-1 text-green-500 text-right text-[9px]">OI</th>
                  <th className="py-1.5 px-1 text-green-500 text-right text-[9px]">IV%</th>
                  <th className="py-1.5 px-2 text-green-400 text-right text-[10px] font-bold">CE LTP</th>
                  <th className="py-1.5 px-2 text-yellow-400 text-center text-[10px] font-bold bg-gray-800">STRIKE</th>
                  <th className="py-1.5 px-2 text-red-400 text-left text-[10px] font-bold">PE LTP</th>
                  <th className="py-1.5 px-1 text-red-500 text-left text-[9px]">IV%</th>
                  <th className="py-1.5 px-1 text-red-500 text-left text-[9px]">OI</th>
                </tr>
              </thead>
              <tbody>
                {chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 750).map(row => {
                  const strike = Number(row.strike_price);
                  const isATM = strike === Number(atmStrike);
                  const isITMce = strike < spotPrice, isITMpe = strike > spotPrice;
                  const maxCeOI2 = Math.max(...chain.map(r => n(r.ce_oi)), 1);
                  const maxPeOI2 = Math.max(...chain.map(r => n(r.pe_oi)), 1);
                  const ceOIPct = (n(row.ce_oi) / maxCeOI2) * 100, peOIPct = (n(row.pe_oi) / maxPeOI2) * 100;
                  return (
                    <tr key={strike} className={`border-b border-gray-800/30 hover:bg-gray-800/20 ${isATM ? 'bg-yellow-950/30' : isITMce ? 'bg-green-950/10' : isITMpe ? 'bg-red-950/10' : ''}`}>
                      <td className="py-1 px-1 text-right relative"><div className="absolute inset-0 bg-green-700/10 flex justify-end"><div style={{ width: `${ceOIPct}%` }} /></div><span className={isITMce ? 'text-green-400' : 'text-gray-600'}>{fmtK(row.ce_oi)}</span></td>
                      <td className="py-1 px-1 text-right font-mono text-[9px]" style={{ color: ivColor(row.ce_greeks?.iv) }}>{row.ce_greeks?.iv != null ? fmt(row.ce_greeks.iv, 1) : '–'}</td>
                      <td className="py-1 px-2 text-right"><button onClick={() => addLeg('BUY', 'CE', strike)} className={`font-bold font-mono hover:underline ${isITMce ? 'text-green-300' : 'text-green-700'}`}>{row.ce_ltp != null ? fmt(row.ce_ltp, 1) : '–'}</button></td>
                      <td className={`py-1 px-2 text-center font-bold bg-gray-800/50 ${isATM ? 'text-yellow-300' : 'text-gray-300'}`}>{isATM && <span className="text-yellow-500 mr-0.5 text-[9px]">►</span>}{strike}</td>
                      <td className="py-1 px-2 text-left"><button onClick={() => addLeg('BUY', 'PE', strike)} className={`font-bold font-mono hover:underline ${isITMpe ? 'text-red-300' : 'text-red-700'}`}>{row.pe_ltp != null ? fmt(row.pe_ltp, 1) : '–'}</button></td>
                      <td className="py-1 px-1 text-left font-mono text-[9px]" style={{ color: ivColor(row.pe_greeks?.iv) }}>{row.pe_greeks?.iv != null ? fmt(row.pe_greeks.iv, 1) : '–'}</td>
                      <td className="py-1 px-1 text-left relative"><div className="absolute inset-0 bg-red-700/10"><div style={{ width: `${peOIPct}%` }} /></div><span className={isITMpe ? 'text-red-400' : 'text-gray-600'}>{fmtK(row.pe_oi)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!chain.length && <div className="text-center py-10 text-gray-600 text-xs">Connect backend to load live chain</div>}
          </div>
          <div className="border-t border-gray-800 p-3 bg-gray-950 flex-shrink-0">
            <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">OI Distribution — CE(green) vs PE(red)</div>
            <OIDistributionChart data={chain.map(r => ({ strike: n(r.strike_price), ce_oi: n(r.ce_oi), pe_oi: n(r.pe_oi) }))} atmStrike={atmStrike} />
          </div>
        </div>

        {/* RIGHT — Strategy Analysis */}
        <div className="flex flex-col overflow-hidden bg-gray-950">
          <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
            <span className="text-sm font-bold text-gray-200">🧠 Strategy Analysis</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {analysis ? (
              <>
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 px-4 py-3 text-center">
                  <div className="text-[9px] text-yellow-600 uppercase tracking-widest mb-1">Detected Strategy</div>
                  <div className="text-xl font-bold text-yellow-400">{analysis.strategyName}</div>
                  {analysis.breakevens.length > 0 && <div className="text-xs text-gray-500 mt-1">BE: {analysis.breakevens.map(b => <span key={b} className="text-yellow-600 font-mono mx-1">{b.toFixed(0)}</span>)}</div>}
                </div>
                <div className="rounded-lg px-3 py-2 text-xs" style={{ background: analysis.suitabilityColor + '15', borderLeft: `3px solid ${analysis.suitabilityColor}` }}>
                  <span style={{ color: analysis.suitabilityColor }}>{analysis.suitability}</span>
                </div>
                <div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">Portfolio Greeks</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Net Δ Delta', value: analysis.netDelta.toFixed(4), color: analysis.netDelta >= 0 ? '#22C55E' : '#EF4444', desc: 'Market directional exposure' },
                      { label: 'Net Θ Theta', value: '₹' + analysis.netTheta.toFixed(2) + '/day', color: analysis.netTheta >= 0 ? '#22C55E' : '#EF4444', desc: 'Daily time decay P&L' },
                      { label: 'Net ν Vega', value: analysis.netVega.toFixed(2), color: analysis.netVega >= 0 ? '#60A5FA' : '#F97316', desc: 'P&L per 1% IV change' },
                      { label: 'Net Γ Gamma', value: analysis.netGamma.toFixed(5), color: '#A78BFA', desc: 'Delta change per ₹1 move' },
                    ].map(g => (
                      <div key={g.label} className="bg-gray-900 rounded-lg p-2 border border-gray-800">
                        <div className="text-[9px] text-gray-600 mb-0.5">{g.label}</div>
                        <div className="font-mono font-bold text-xs" style={{ color: g.color }}>{g.value}</div>
                        <div className="text-[8px] text-gray-700 mt-0.5">{g.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-blue-500 font-bold mb-1">📊 MARKET CONTEXT</div>
                    <span className="text-gray-400">PCR OI </span><span className={`font-bold ${pcrOi > 1.3 ? 'text-green-400' : pcrOi < 0.7 ? 'text-red-400' : 'text-yellow-400'}`}>{pcrOi.toFixed(2)}</span>
                    <span className="text-gray-500"> → </span><span className={`font-bold ${analysis.pcrSentiment === 'bullish' ? 'text-green-400' : analysis.pcrSentiment === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>{analysis.pcrSentiment}</span><br />
                    <span className="text-gray-400">Spot is </span><span className="text-yellow-300 font-bold">{analysis.spotVsMaxPain}</span>
                  </div>
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-purple-500 font-bold mb-1">⚡ IV ENVIRONMENT</div>
                    <span className="text-gray-400">ATM IV </span><span className="font-bold font-mono" style={{ color: ivColor(effectiveIV) }}>{effectiveIV.toFixed(1)}%</span>
                    <span className="text-gray-500"> | IV Rank </span><span className="font-bold text-blue-400">{ivRank.toFixed(0)}</span>
                    <span className="text-gray-500"> → {analysis.ivSentiment}</span>
                  </div>
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-yellow-500 font-bold mb-1">🎯 STRATEGY BIAS</div>
                    <span className="text-gray-400">This setup is </span><span className="text-white font-bold">{analysis.deltaBias}</span><br />
                    <span className="text-gray-500">{analysis.netTheta < 0 ? '⏳ Theta negative — time hurts. Trade when you expect a move.' : '⏳ Theta positive — time works in your favor. Decay strategy.'}</span>
                  </div>
                  {(isFinite(analysis.maxProfit) || isFinite(analysis.maxLoss)) && (
                    <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                      <div className="text-[9px] text-green-500 font-bold mb-1">💰 RISK / REWARD</div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Max Profit</span><span className="text-green-400 font-bold font-mono">{analysis.maxProfit > 1e9 ? 'Unlimited' : fmtRs(analysis.maxProfit)}</span></div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Max Loss</span><span className="text-red-400 font-bold font-mono">{analysis.maxLoss < -1e9 ? 'Unlimited' : fmtRs(Math.abs(analysis.maxLoss))}</span></div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Prob of Profit</span><span className="text-blue-400 font-bold">{(analysis.pop || 0).toFixed(1)}%</span></div>
                      {isFinite(analysis.maxProfit) && isFinite(analysis.maxLoss) && analysis.maxLoss !== 0 && <div className="flex justify-between"><span className="text-gray-500">R/R Ratio</span><span className="text-yellow-400 font-bold">{(analysis.maxProfit / Math.abs(analysis.maxLoss)).toFixed(2)}x</span></div>}
                      {analysis.breakevens.length > 0 && <div className="mt-2 pt-2 border-t border-gray-800"><span className="text-gray-500">Breakevens: </span>{analysis.breakevens.map(b => <span key={b} className="text-yellow-400 font-mono font-bold mx-1">{b.toFixed(0)}</span>)}</div>}
                    </div>
                  )}
                  <div className="bg-blue-950/30 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs border border-blue-900/40">
                    <div className="text-[9px] text-blue-400 font-bold mb-1">💬 ANALYSIS SUMMARY</div>
                    <div className="text-gray-300 leading-relaxed">
                      {!legs.length ? 'Select a strategy preset or add legs to begin analysis.' :
                        `${analysis.strategyName} with ${dte}d to expiry. ${analysis.netPremium > 0 ? `Net credit ₹${analysis.netPremium.toFixed(2)} — you collect premium upfront.` : `Net debit ₹${Math.abs(analysis.netPremium).toFixed(2)} — you pay premium.`} ${analysis.suitability.slice(3)}. ${pcrOi > 1.2 ? 'PCR suggests bullish bias.' : pcrOi < 0.8 ? 'PCR suggests bearish bias.' : 'Market appears balanced per PCR.'} Max Pain at ${maxPain} could act as gravitational pull near expiry.`}
                    </div>
                  </div>
                </div>
                {signalData?.signals && signalData.signals.length > 0 && (
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">Related Signals</div>
                    <div className="space-y-2">
                      {signalData.signals.slice(0, 3).map(sig => (
                        <div key={sig.id} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-start gap-2">
                          <span className="text-base">{typeIcons[sig.type] || '🎯'}</span>
                          <div className="flex-1"><div className="text-xs font-bold text-white">{sig.strategy}</div><div className="text-[10px] text-gray-500 mt-0.5">{sig.action}</div></div>
                          <div className="text-xs font-bold text-blue-400">{n(sig.confidence)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-600"><div className="text-3xl mb-3">🧮</div><div className="text-sm">Select a strategy or add legs to see analysis</div></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 🚨 SPOOFING TAB — Live Detection Feed
// ============================================================================

type SpoofState = 'CLEAR' | 'WATCH' | 'ALERT' | 'CRITICAL';
type SpoofPhase = 'PATCH_I' | 'PATCH_II' | 'CLOSE_WATCH' | 'NORMAL';

interface LiveSpoofAlert {
  id:           string;
  token:        string;
  symbol:       string;
  state:        SpoofState;
  phase:        SpoofPhase;
  severity:     string;
  type:         string;
  strike:       number;
  optionType:   'CE' | 'PE';
  ensemble:     number;
  confidence:   number;
  action:       string;
  description:  string;
  explanation:  string;
  ltp:          number;
  bidPrice:     number;
  askPrice:     number;
  bidQty:       number;
  askQty:       number;
  oi:           number;
  oiChange:     number;
  ltpChange:    number;
  bidAskRatio:  number;
  spreadPct:    number;
  detectedAt:   number;
  timestamp:    string;
  fv:  { VPIN: number; OBI_L1: number; TBQ_TSQ: number; PostDist: number; spread_pct: number; oi_change: number; ltp_change: number; };
  js:  { pattern_prob: number; delta_proxy: number; patch1_buy_proxy: number; patch2_sell_proxy: number; ltp_aggression_frac: number; oi_buildup_p1: number; };
  scores: Record<string, number>;
}

const STATE_COLOR: Record<SpoofState, string> = {
  CLEAR: '#22c55e', WATCH: '#fbbf24', ALERT: '#f97316', CRITICAL: '#ef4444',
};
const STATE_BG: Record<SpoofState, string> = {
  CLEAR: 'rgba(21,128,61,.12)', WATCH: 'rgba(161,98,7,.15)', ALERT: 'rgba(194,65,12,.2)', CRITICAL: 'rgba(153,27,27,.3)',
};
const STATE_EMOJI: Record<SpoofState, string> = {
  CLEAR: '✅', WATCH: '👁', ALERT: '⚠️', CRITICAL: '🚨',
};
const TYPE_LABEL: Record<string, string> = {
  BID_WALL: 'Bid Wall', ASK_WALL: 'Ask Wall',
  LAYERING_BID: 'Layering (Bid)', LAYERING_ASK: 'Layering (Ask)',
  OI_DIVERGENCE: 'OI Divergence', SPREAD_COMPRESSION: 'Spread Collapse',
  QUOTE_STUFFING: 'Quote Stuffing', MOMENTUM_IGNITION: 'Momentum Ignition',
  ABSORPTION: 'Absorption',
};


