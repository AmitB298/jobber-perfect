// ============================================================
// IntelligenceTab.tsx
// ADD THIS FILE TO: frontend/src/pages/components/IntelligenceTab.tsx
//  (or wherever your other tab components live)
//
// Then in Dashboard.tsx:
//   1. import IntelligenceTab from './components/IntelligenceTab'
//   2. Add 'intelligence' to your tabs array
//   3. Render <IntelligenceTab /> in the tab switch
// ============================================================

import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface IntelState {
  connected:    boolean
  marketOpen:   boolean
  spot?:        { ltp: number }
  futures?:     { ltp: number; bid: number; ask: number }
  kyle?:        { lambda: number; lambdaZ: number; regime: string; r2: number }
  vpin?:        { vpin: number; vpinPct: number; regime: string; buyVolumeRatio: number }
  gm?:          { alpha: number; spread: number; alphaZ: number }
  gex?:         { gexAtSpot: number; zeroCross: number; callWall: number; putWall: number; regime: string; distToZero: number; gexByStrike: {strike:number;gex:number}[] }
  vannaCharm?:  { vannaFlow: number; charmFlow: number; maxPain: number; distToMaxPain: number; charmDir: string; expiryUrgency: number }
  oiVelocity?:  { oisNet: number; oiviBull: number; oiviBear: number; topBull: {strike:number;z:number}|null; topBear: {strike:number;z:number}|null; strikeSignals: {strike:number;type:string;z:number;velocity:number;institutional:boolean}[] }
  skewVelocity?:{ skew25d: number; velocity: number; velocityZ: number; urgency: string; direction: string }
  fii?:         { netFutures: number; netChange: number; optionsDelta: number; totalDelta: number; regime: string; shortSqueeze: boolean }
  bridge?:      { bridgeCorr: number; target: number; betaT: number; detected: boolean }
  nInsider?:    { n: number; competition: string; infoRevRate: number }
  deltaFlow?:   { deltaFlow: number; deltaFlowZ: number; leadMinutes: number; direction: string }
  sgxCross?:    { sgxGap: number; sgxSignal: number; inrSignal: number; crudeSignal: number; usSignal: number; composite: number }
  hasbrouck?:   { isFutures: number; isSpot: number; basis: number }
  composite?:   { pBullish: number; pBearish: number; confidence: number; direction: string; positionSize: number; effectiveN: number; hypothesis: string; timeBucket: string }
  compositeHistory: { ts: number; p: number; direction: string }[]
}

interface IntelAlert {
  confidence: number
  direction:  string
  hypothesis: string
  spot:       number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt  = (v: number|undefined, d=2) => v != null ? v.toFixed(d) : '–'
const fmtK = (v: number|undefined) => v == null ? '–' : Math.abs(v) >= 1e7 ? (v/1e7).toFixed(1)+'Cr' : Math.abs(v) >= 1e5 ? (v/1e5).toFixed(1)+'L' : v.toFixed(0)
const fmtPct = (v: number|undefined) => v != null ? (v*100).toFixed(1)+'%' : '–'

const regimeColor: Record<string, string> = {
  extreme:    'text-red-400 bg-red-950/40',
  elevated:   'text-orange-400 bg-orange-950/40',
  normal:     'text-yellow-400 bg-yellow-950/40',
  low:        'text-gray-400 bg-gray-900',
  critical:   'text-red-400 bg-red-950/40',
  alert:      'text-orange-400 bg-orange-950/40',
  watch:      'text-yellow-400 bg-yellow-950/40',
  safe:       'text-green-400 bg-green-950/40',
  amplified:  'text-red-400 bg-red-950/40',
  neutral:    'text-gray-400 bg-gray-900',
  suppressed: 'text-blue-400 bg-blue-950/40',
  extreme_2:  'text-red-400',
  high:       'text-orange-400',
  moderate:   'text-yellow-400',
  none:       'text-gray-500',
}

const Badge = ({ label, cls }: { label: string; cls?: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wide ${cls ?? 'text-gray-400 bg-gray-900'}`}>
    {label}
  </span>
)

const SignalCard = ({ title, children, alert }: { title: string; children: React.ReactNode; alert?: boolean }) => (
  <div className={`rounded-xl border p-3 ${alert ? 'border-orange-500/50 bg-orange-950/10' : 'border-gray-800 bg-gray-900/60'}`}>
    <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{title}</div>
    {children}
  </div>
)

const Row = ({ label, value, dim }: { label: string; value: React.ReactNode; dim?: boolean }) => (
  <div className="flex justify-between items-center py-0.5">
    <span className={`text-xs ${dim ? 'text-gray-600' : 'text-gray-400'}`}>{label}</span>
    <span className="text-xs font-mono font-semibold text-white">{value}</span>
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceTab() {
  const [state,  setState]  = useState<IntelState | null>(null)
  const [alerts, setAlerts] = useState<IntelAlert[]>([])
  const [fiiLong, setFiiLong]   = useState('')
  const [fiiShort, setFiiShort] = useState('')
  const [sgxVal, setSgxVal]     = useState('')
  const [usdInr, setUsdInr]     = useState('')
  const [crude,  setCrude]      = useState('')

  useEffect(() => {
    // Subscribe to live intelligence updates
    const unsubState = (window as any)?.electron?.onIntelUpdate((s: IntelState) => {
      setState(s)
    })
    const unsubAlert = (window as any)?.electron?.onIntelAlert((a: IntelAlert) => {
      setAlerts(prev => [a, ...prev].slice(0, 20))
    })
    // Fetch initial state
    ;(window as any)?.electron?.intelGetState?.().then((s: IntelState) => {
      if (s) setState(s)
    }).catch(() => {})

    return () => { unsubState?.(); unsubAlert?.() }
  }, [])

  const submitFII = () => {
    ;(window as any)?.electron?.intelUpdateFII({
      longFutures:  parseFloat(fiiLong)  || 0,
      shortFutures: parseFloat(fiiShort) || 0,
    }).catch(console.error)
  }

  const submitCrossAsset = () => {
    ;(window as any)?.electron?.intelUpdateCrossAsset({
      sgxPrice:   sgxVal  ? parseFloat(sgxVal)  : undefined,
      usdInr:     usdInr  ? parseFloat(usdInr)  : undefined,
      crude:      crude   ? parseFloat(crude)   : undefined,
    }).catch(console.error)
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">🧠</div>
          <div className="text-sm">Waiting for intelligence engine…</div>
          <div className="text-xs text-gray-600 mt-1">Start Angel One WebSocket to begin</div>
        </div>
      </div>
    )
  }

  const c  = state.composite
  const pct = c ? Math.round(c.confidence * 100) : 0
  const isBull = c?.direction === 'bullish'
  const isBear = c?.direction === 'bearish'
  const isHigh = pct >= 68

  // Composite history for chart
  const chartData = state.compositeHistory.map(h => ({
    t:   new Date(h.ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
    p:   Math.round(h.p * 100),
    dir: h.direction,
  }))

  // GEX heatmap data
  const gexData = (state.gex?.gexByStrike ?? [])
    .filter((_, i) => i % 2 === 0)  // thin out for display
    .map(d => ({ strike: d.strike, gex: d.gex / 1e6, positive: d.gex >= 0 }))

  // OI velocity table — show institutional strikes only
  const instStrikes = (state.oiVelocity?.strikeSignals ?? [])
    .filter(s => s.institutional || Math.abs(s.z) > 2)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 10)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950 text-white">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-200">🧠 Intelligence Engine</span>
          <Badge label={state.marketOpen ? 'LIVE' : 'CLOSED'} cls={state.marketOpen ? 'text-green-400 bg-green-950/40' : 'text-gray-500 bg-gray-900'} />
          {isHigh && <Badge label="⚡ HIGH CONVICTION" cls="text-yellow-300 bg-yellow-900/40 animate-pulse" />}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>NIFTY {fmt(state.spot?.ltp, 2)}</span>
          <span>FUT {fmt(state.futures?.ltp, 2)}</span>
          <span>{c?.timeBucket ?? '–'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* ── ROW 1: Composite score (full width) ── */}
        <div className={`rounded-xl border p-5 ${isHigh
          ? isBull ? 'border-green-500/50 bg-green-950/10' : 'border-red-500/50 bg-red-950/10'
          : 'border-gray-700 bg-gray-900/60'}`}>
          <div className="flex items-center gap-6">
            {/* Big number */}
            <div className="text-center min-w-[100px]">
              <div className={`text-6xl font-bold tabular-nums ${isBull ? 'text-green-400' : isBear ? 'text-red-400' : 'text-gray-400'}`}>
                {pct}<span className="text-3xl">%</span>
              </div>
              <div className={`text-sm font-semibold mt-1 capitalize ${isBull ? 'text-green-400' : isBear ? 'text-red-400' : 'text-gray-400'}`}>
                {c?.direction ?? 'neutral'}
              </div>
            </div>

            {/* Details */}
            <div className="flex-1 space-y-1.5">
              <div className="text-xs text-gray-400 leading-relaxed">{c?.hypothesis ?? 'Waiting for signals…'}</div>
              <div className="flex gap-3 flex-wrap">
                <span className="text-xs text-gray-500">Size: <span className="text-white font-bold">{c ? (c.positionSize * 100).toFixed(0) + '%' : '–'}</span></span>
                <span className="text-xs text-gray-500">Eff.signals: <span className="text-white font-bold">{c ? c.effectiveN.toFixed(1) : '–'}</span></span>
                <span className="text-xs text-gray-500">P(Bull): <span className="text-green-400 font-bold">{fmtPct(c?.pBullish)}</span></span>
                <span className="text-xs text-gray-500">P(Bear): <span className="text-red-400 font-bold">{fmtPct(c?.pBearish)}</span></span>
              </div>
              {/* Confidence bar */}
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden w-full mt-1">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isBull ? 'bg-green-500' : isBear ? 'bg-red-500' : 'bg-gray-500'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="text-xs text-gray-600">Alert threshold: 68% — Position size activates at 36%</div>
            </div>
          </div>
        </div>

        {/* ── ROW 2: Alerts (if any) ── */}
        {alerts.length > 0 && (
          <div className="space-y-1.5">
            {alerts.slice(0, 3).map((a, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 flex items-center justify-between text-xs ${a.direction === 'bullish' ? 'border-green-500/40 bg-green-950/20' : 'border-red-500/40 bg-red-950/20'}`}>
                <span className="font-bold">{a.direction === 'bullish' ? '⬆' : '⬇'} {a.direction.toUpperCase()} ALERT — {Math.round(a.confidence * 100)}% confidence @ {a.spot.toFixed(0)}</span>
                <span className="text-gray-400 truncate max-w-xs ml-3">{a.hypothesis}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── ROW 3: Composite history chart + GEX heatmap ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Composite history */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Composite Score History</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#6B7280', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis domain={[30, 70]} tick={{ fill: '#6B7280', fontSize: 9 }} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 10 }}
                  formatter={(v: any) => [`${v}%`, 'Confidence']}
                />
                <ReferenceLine y={68} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.5} />
                <ReferenceLine y={32} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1.5} />
                <ReferenceLine y={50} stroke="#374151" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="p" stroke="#60A5FA" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* GEX heatmap */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
              GEX by Strike (₹Mn) — Zero-Cross: {fmt(state.gex?.zeroCross, 0)}
            </div>
            {gexData.length > 0 ? (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={gexData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="strike" tick={{ fill: '#6B7280', fontSize: 8 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 8 }} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 10 }}
                    formatter={(v: any) => [`₹${v.toFixed(1)}Mn`, 'GEX']}
                  />
                  <ReferenceLine y={0} stroke="#6B7280" strokeWidth={1} />
                  <Bar dataKey="gex">
                    {gexData.map((d, i) => (
                      <Cell key={i} fill={d.positive ? '#16A34A' : '#DC2626'} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-600 text-xs">Waiting for options chain data…</div>
            )}
          </div>
        </div>

        {/* ── ROW 4: Signal grid (12 cards) ── */}
        <div className="grid grid-cols-4 gap-2">

          <SignalCard title="Kyle λ (Price Impact)">
            <div className={`text-lg font-bold font-mono ${state.kyle?.regime === 'extreme' ? 'text-red-400' : state.kyle?.regime === 'elevated' ? 'text-orange-400' : 'text-white'}`}>
              {fmt(state.kyle?.lambda, 4)}
            </div>
            <Row label="Z-Score" value={fmt(state.kyle?.lambdaZ, 2)} />
            <Row label="R²" value={fmt(state.kyle?.r2, 3)} />
            {state.kyle && <Badge label={state.kyle.regime} cls={regimeColor[state.kyle.regime] ?? ''} />}
          </SignalCard>

          <SignalCard title="VPIN" alert={state.vpin?.regime === 'critical' || state.vpin?.regime === 'alert'}>
            <div className={`text-lg font-bold font-mono ${state.vpin?.regime === 'critical' ? 'text-red-400' : state.vpin?.regime === 'alert' ? 'text-orange-400' : 'text-white'}`}>
              {fmtPct(state.vpin?.vpin)}
            </div>
            {/* VPIN bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden my-1.5">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${state.vpin?.vpinPct ?? 0}%` }} />
            </div>
            <Row label="Pct rank" value={fmt(state.vpin?.vpinPct, 0) + 'th'} />
            <Row label="Buy frac" value={fmtPct(state.vpin?.buyVolumeRatio)} />
            {state.vpin && <Badge label={state.vpin.regime} cls={regimeColor[state.vpin.regime] ?? ''} />}
          </SignalCard>

          <SignalCard title="GM Alpha">
            <div className="text-lg font-bold font-mono text-white">{fmtPct(state.gm?.alpha)}</div>
            <Row label="Spread" value={fmt(state.gm?.spread, 2)} />
            <Row label="α Z-score" value={fmt(state.gm?.alphaZ, 2)} />
            <div className="text-xs text-gray-600 mt-1">P(informed trader)</div>
          </SignalCard>

          <SignalCard title="GEX" alert={state.gex?.regime === 'amplified'}>
            <div className={`text-lg font-bold font-mono ${state.gex?.regime === 'amplified' ? 'text-red-400' : state.gex?.regime === 'suppressed' ? 'text-blue-400' : 'text-white'}`}>
              {fmtK(state.gex?.gexAtSpot)}
            </div>
            <Row label="Zero-cross" value={fmt(state.gex?.zeroCross, 0)} />
            <Row label="Call wall" value={fmt(state.gex?.callWall, 0)} />
            <Row label="Put wall" value={fmt(state.gex?.putWall, 0)} />
            {state.gex && <Badge label={state.gex.regime} cls={regimeColor[state.gex.regime] ?? ''} />}
          </SignalCard>

          <SignalCard title="Vanna Flow">
            <div className={`text-base font-bold font-mono ${(state.vannaCharm?.vannaFlow ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtK(state.vannaCharm?.vannaFlow)}/1%IV
            </div>
            <Row label="Charm flow" value={fmtK(state.vannaCharm?.charmFlow) + '/day'} />
            <Row label="Charm dir" value={<Badge label={state.vannaCharm?.charmDir ?? '–'} />} />
          </SignalCard>

          <SignalCard title="Max Pain + Expiry">
            <div className="text-lg font-bold font-mono text-yellow-400">{fmt(state.vannaCharm?.maxPain, 0)}</div>
            <Row label="Dist to max pain" value={fmt(state.vannaCharm?.distToMaxPain, 0)} />
            {/* Expiry urgency bar */}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-gray-500">Urgency</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-orange-500 transition-all"
                  style={{ width: `${(state.vannaCharm?.expiryUrgency ?? 0) * 100}%` }} />
              </div>
              <span className="text-xs font-mono text-orange-400">{fmtPct(state.vannaCharm?.expiryUrgency)}</span>
            </div>
          </SignalCard>

          <SignalCard title="OI Velocity" alert={(state.oiVelocity?.topBull?.z ?? 0) > 3 || (state.oiVelocity?.topBear?.z ?? 0) > 3}>
            <Row label="Net OIVI" value={<span className={(state.oiVelocity?.oisNet ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}>{fmt(state.oiVelocity?.oisNet, 2)}</span>} />
            <Row label="Top CE strike" value={state.oiVelocity?.topBull ? `${state.oiVelocity.topBull.strike} (z${state.oiVelocity.topBull.z.toFixed(1)})` : '–'} />
            <Row label="Top PE strike" value={state.oiVelocity?.topBear ? `${state.oiVelocity.topBear.strike} (z${state.oiVelocity.topBear.z.toFixed(1)})` : '–'} />
          </SignalCard>

          <SignalCard title="IV Skew Velocity" alert={state.skewVelocity?.urgency === 'high' || state.skewVelocity?.urgency === 'extreme'}>
            <div className={`text-base font-bold font-mono ${Math.abs(state.skewVelocity?.velocityZ ?? 0) > 2.5 ? 'text-orange-400' : 'text-white'}`}>
              Skew: {fmt(state.skewVelocity?.skew25d, 3)}
            </div>
            <Row label="Velocity Z" value={fmt(state.skewVelocity?.velocityZ, 2)} />
            {state.skewVelocity && <Badge label={state.skewVelocity.direction.replace('_',' ')} cls={state.skewVelocity.urgency === 'none' ? 'text-gray-500 bg-gray-900' : 'text-orange-400 bg-orange-950/40'} />}
          </SignalCard>

          <SignalCard title="FII Futures" alert={!!state.fii?.shortSqueeze}>
            <div className={`text-base font-bold font-mono ${(state.fii?.netFutures ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtK(state.fii?.netFutures)}
            </div>
            {state.fii?.shortSqueeze && <Badge label="⚡ SHORT SQUEEZE" cls="text-yellow-300 bg-yellow-900/50 animate-pulse" />}
            <Row label="Net change" value={fmtK(state.fii?.netChange)} />
            <div className="text-xs text-gray-500 mt-1 truncate">{state.fii?.regime ?? '–'}</div>
          </SignalCard>

          <SignalCard title="Back Bridge">
            <div className={`text-lg font-bold font-mono ${state.bridge?.detected ? 'text-purple-400' : 'text-gray-500'}`}>
              {state.bridge?.detected ? '🎯 DETECTED' : 'Not active'}
            </div>
            {state.bridge?.detected && (
              <>
                <Row label="Target" value={fmt(state.bridge?.target, 0)} />
                <Row label="Corr." value={fmt(state.bridge?.bridgeCorr, 3)} />
              </>
            )}
          </SignalCard>

          <SignalCard title="N-Insider Model">
            <div className="text-lg font-bold font-mono text-white">{state.nInsider?.n ?? '–'} insider{state.nInsider?.n === 1 ? '' : 's'}</div>
            {state.nInsider && <Badge label={state.nInsider.competition} cls="text-blue-400 bg-blue-950/40" />}
            <Row label="Info rev rate" value={fmtPct(state.nInsider?.infoRevRate)} />
          </SignalCard>

          <SignalCard title="Delta Flow (Options→Fut)">
            <div className={`text-base font-bold font-mono ${state.deltaFlow?.direction === 'bullish' ? 'text-green-400' : state.deltaFlow?.direction === 'bearish' ? 'text-red-400' : 'text-gray-400'}`}>
              Z: {fmt(state.deltaFlow?.deltaFlowZ, 2)}
            </div>
            <Row label="Lead time" value={(state.deltaFlow?.leadMinutes ?? 0) + ' min'} />
            {state.deltaFlow && <Badge label={state.deltaFlow.direction} cls={state.deltaFlow.direction === 'bullish' ? 'text-green-400 bg-green-950/40' : state.deltaFlow.direction === 'bearish' ? 'text-red-400 bg-red-950/40' : 'text-gray-400 bg-gray-900'} />}
          </SignalCard>

        </div>

        {/* ── ROW 5: SGX / Cross-asset + Hasbrouck ── */}
        <div className="grid grid-cols-2 gap-3">
          <SignalCard title="SGX + Cross-Asset">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="SGX gap" value={<span className={(state.sgxCross?.sgxGap ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}>{fmt(state.sgxCross?.sgxGap, 2)}%</span>} />
              <Row label="SGX signal" value={fmt(state.sgxCross?.sgxSignal, 2)} />
              <Row label="INR signal" value={fmt(state.sgxCross?.inrSignal, 2)} />
              <Row label="Crude signal" value={fmt(state.sgxCross?.crudeSignal, 2)} />
              <Row label="US signal" value={fmt(state.sgxCross?.usSignal, 2)} />
              <Row label="Composite" value={<span className={(state.sgxCross?.composite ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}>{fmt(state.sgxCross?.composite, 3)}</span>} />
            </div>
          </SignalCard>

          <SignalCard title="Hasbrouck IS — Price Discovery">
            <div className="text-lg font-bold font-mono text-white">{fmtPct(state.hasbrouck?.isFutures)} futures lead</div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden my-2 flex">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${(state.hasbrouck?.isFutures ?? 0.6) * 100}%` }} />
            </div>
            <Row label="Futures IS" value={fmtPct(state.hasbrouck?.isFutures)} />
            <Row label="Spot IS" value={fmtPct(state.hasbrouck?.isSpot)} />
            <Row label="Basis" value={fmt(state.hasbrouck?.basis, 2)} />
          </SignalCard>
        </div>

        {/* ── ROW 6: OI Velocity institutional strikes table ── */}
        {instStrikes.length > 0 && (
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Institutional OI Velocity — Active Strikes</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-1 pr-4">Strike</th>
                  <th className="text-left py-1 pr-4">Type</th>
                  <th className="text-right py-1 pr-4">Velocity (lots/min)</th>
                  <th className="text-right py-1 pr-4">Z-Score</th>
                  <th className="text-right py-1">Institutional</th>
                </tr>
              </thead>
              <tbody>
                {instStrikes.map((s, i) => (
                  <tr key={i} className={`border-b border-gray-800/50 ${s.institutional ? 'bg-orange-950/10' : ''}`}>
                    <td className="py-1 pr-4 font-mono font-bold text-white">{s.strike}</td>
                    <td className="py-1 pr-4">
                      <Badge label={s.type} cls={s.type === 'CE' ? 'text-green-400 bg-green-950/40' : 'text-red-400 bg-red-950/40'} />
                    </td>
                    <td className={`py-1 pr-4 text-right font-mono ${s.velocity > 0 ? 'text-green-400' : 'text-red-400'}`}>{s.velocity.toFixed(1)}</td>
                    <td className={`py-1 pr-4 text-right font-mono ${Math.abs(s.z) > 3 ? 'text-orange-400 font-bold' : 'text-white'}`}>{s.z.toFixed(2)}</td>
                    <td className="py-1 text-right">{s.institutional ? <span className="text-orange-400 font-bold">⚡ YES</span> : <span className="text-gray-600">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── ROW 7: Input panels ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* FII Input */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">FII Futures Data — Paste from NSE EOD</div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <div className="text-xs text-gray-600 mb-1">FII Long contracts</div>
                <input className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. 350000"
                  value={fiiLong} onChange={e => setFiiLong(e.target.value)} />
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-600 mb-1">FII Short contracts</div>
                <input className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. 420000"
                  value={fiiShort} onChange={e => setFiiShort(e.target.value)} />
              </div>
              <button onClick={submitFII}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold">
                Update
              </button>
            </div>
            <div className="text-xs text-gray-600 mt-1">Source: NSE → F&O → Participant OI (daily, by 6PM)</div>
          </div>

          {/* Cross-asset Input */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Cross-Asset Update (Manual)</div>
            <div className="flex gap-2 items-end">
              <div>
                <div className="text-xs text-gray-600 mb-1">SGX NIFTY</div>
                <input className="w-20 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="22100" value={sgxVal} onChange={e => setSgxVal(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">USD/INR</div>
                <input className="w-20 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="83.50" value={usdInr} onChange={e => setUsdInr(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Brent Crude</div>
                <input className="w-20 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="85.00" value={crude} onChange={e => setCrude(e.target.value)} />
              </div>
              <button onClick={submitCrossAsset}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold">
                Update
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
