// ============================================================================
// tabs/SpoofingTab.tsx — Live Spoofing Detection
// ============================================================================
import { useState, useEffect, useRef } from 'react';
import { n, fmt } from '../shared/helpers';

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

export function SpoofAlertCard({ a, onDismiss }: { a: LiveSpoofAlert; onDismiss: () => void }) {
  const age  = Math.round((Date.now() - a.detectedAt) / 1000);
  const col  = STATE_COLOR[a.state];
  const top4 = Object.entries(a.scores).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const isJSPhase = a.phase === 'PATCH_I' || a.phase === 'PATCH_II' || a.phase === 'CLOSE_WATCH';
  const phaseColor = a.phase === 'PATCH_I' ? '#4ade80' : a.phase === 'PATCH_II' ? '#f87171' : '#fbbf24';
  return (
    <div style={{ border: `1px solid ${col}44`, background: STATE_BG[a.state], borderRadius: '8px', padding: '12px 14px', marginBottom: '8px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '18px' }}>{STATE_EMOJI[a.state]}</span>
          <span style={{ color: col, fontWeight: 700, fontSize: '13px' }}>{a.state}</span>
          <span style={{ background: '#111827', color: '#fbbf24', fontWeight: 700, borderRadius: '4px', padding: '1px 7px', fontSize: '13px', fontFamily: 'monospace' }}>{a.strike} {a.optionType}</span>
          <span style={{ color: '#6b7280', fontSize: '11px' }}>{TYPE_LABEL[a.type] ?? a.type}</span>
          {isJSPhase && <span style={{ background: `${phaseColor}22`, border: `1px solid ${phaseColor}66`, color: phaseColor, fontSize: '10px', borderRadius: '3px', padding: '0 5px', fontWeight: 700 }}>{a.phase}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ color: '#4b5563', fontSize: '11px' }}>{age}s ago</span>
          <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '18px', padding: '0', lineHeight: 1, fontWeight: 400 }}>×</button>
        </div>
      </div>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ color: '#9ca3af', fontSize: '11px' }}>Ensemble score</span>
          <span style={{ color: col, fontWeight: 700, fontFamily: 'monospace', fontSize: '12px' }}>{a.ensemble.toFixed(1)} / 100</span>
        </div>
        <div style={{ height: '4px', background: '#1f2937', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(a.ensemble, 100)}%`, height: '100%', background: col, borderRadius: '2px', transition: 'width .3s ease' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px 12px', marginBottom: '8px', fontSize: '11px' }}>
        {[
          ['LTP', `₹${a.ltp.toFixed(2)}`, '#f1f5f9'],
          ['Bid', `₹${a.bidPrice.toFixed(2)}`, '#4ade80'],
          ['Ask', `₹${a.askPrice.toFixed(2)}`, '#f87171'],
          ['BidQty', a.bidQty.toLocaleString(), '#4ade80'],
          ['AskQty', a.askQty.toLocaleString(), '#f87171'],
          ['Ratio', a.bidAskRatio.toFixed(2), a.bidAskRatio > 3 ? '#f87171' : a.bidAskRatio < 0.33 ? '#4ade80' : '#9ca3af'],
        ].map(([label, val, color]) => (
          <div key={label}><span style={{ color: '#6b7280' }}>{label} </span><span style={{ color: color as string, fontFamily: 'monospace' }}>{val}</span></div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '8px', background: 'rgba(0,0,0,.25)', borderRadius: '5px', padding: '7px 9px', fontSize: '10px' }}>
        {[
          ['VPIN',    a.fv.VPIN.toFixed(3),    '#e2e8f0'],
          ['OBI-L1',  a.fv.OBI_L1.toFixed(3),  a.fv.OBI_L1 > 0.3 ? '#4ade80' : a.fv.OBI_L1 < -0.3 ? '#f87171' : '#e2e8f0'],
          ['TBQ/TSQ', a.fv.TBQ_TSQ.toFixed(2), '#e2e8f0'],
          ['Spread%', `${a.spreadPct.toFixed(2)}%`, '#e2e8f0'],
          ['JS Pat',  `${(a.js.pattern_prob * 100).toFixed(0)}%`, '#c084fc'],
          ['Δ proxy', a.js.delta_proxy.toFixed(1), a.js.delta_proxy > 2 ? '#4ade80' : a.js.delta_proxy < -2 ? '#f87171' : '#9ca3af'],
          ['P1-Buy',  a.js.patch1_buy_proxy.toFixed(2),  a.js.patch1_buy_proxy  > 0.5 ? '#f87171' : '#9ca3af'],
          ['P2-Sell', a.js.patch2_sell_proxy.toFixed(2), a.js.patch2_sell_proxy > 0.5 ? '#f87171' : '#9ca3af'],
        ].map(([label, val, color]) => (
          <div key={label}><span style={{ color: '#4b5563' }}>{label} </span><span style={{ color: color as string }}>{val}</span></div>
        ))}
      </div>
      {top4.length > 0 && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {top4.map(([k, v]) => <span key={k} style={{ background: '#111827', color: '#94a3b8', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{k}={v}</span>)}
        </div>
      )}
      <div style={{ background: `${col}1A`, border: `1px solid ${col}33`, borderRadius: '4px', padding: '6px 9px', fontSize: '11px', color: col, lineHeight: 1.5 }}>
        <strong>→ {a.explanation || a.action}</strong>
        {a.state === 'CRITICAL' && a.js.patch1_buy_proxy > 0.5 && <div style={{ marginTop: '3px', color: '#f87171' }}>⛔ JS PATCH I: Engineered rally. Do NOT buy calls.</div>}
        {a.state === 'CRITICAL' && a.js.patch2_sell_proxy > 0.5 && <div style={{ marginTop: '3px', color: '#f87171' }}>⛔ JS PATCH II: Dump phase. Exit longs immediately.</div>}
        {a.state === 'CRITICAL' && a.phase === 'CLOSE_WATCH' && <div style={{ marginTop: '3px', color: '#fbbf24' }}>⛔ MARKING THE CLOSE: Settlement manipulation possible.</div>}
      </div>
    </div>
  );
}

export function SpoofingTab() {
  const [alerts,    setAlerts]    = useState<LiveSpoofAlert[]>([]);
  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'live' | 'disconnected'>('connecting');
  const [totalRx,   setTotalRx]   = useState(0);
  const [filter,    setFilter]    = useState<'ALL' | SpoofState>('ALL');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const wsRef  = useRef<WebSocket | null>(null);
  const retRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const WS_URL = `ws://localhost:${8765}`;
    function connect() {
      setWsStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => { setWsStatus('live'); };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data as string);
          if (d.type === 'connected') return;
          const state = d.state as SpoofState;
          if (!state || state === 'CLEAR') return;
          setTotalRx(n => n + 1);
          const alert: LiveSpoofAlert = {
            id: `${d.token ?? d.symbol ?? '?'}_${d.detectedAt ?? Date.now()}`,
            token: d.token ?? `${d.strike}_${d.optionType}`, symbol: d.symbol ?? `NIFTY${d.strike}${d.optionType}`,
            state, phase: (d.phase ?? 'NORMAL') as SpoofPhase, severity: d.severity ?? 'LOW', type: d.type ?? 'UNKNOWN',
            strike: d.strike ?? 0, optionType: d.optionType ?? 'CE', ensemble: d.ensemble ?? 0, confidence: d.confidence ?? 0,
            action: d.action ?? '', description: d.description ?? '', explanation: d.explanation ?? d.action ?? '',
            ltp: d.ltp ?? 0, bidPrice: d.bidPrice ?? 0, askPrice: d.askPrice ?? 0,
            bidQty: d.bidQty ?? 0, askQty: d.askQty ?? 0, oi: d.oi ?? 0, oiChange: d.oiChange ?? 0,
            ltpChange: d.ltpChange ?? 0, bidAskRatio: d.bidAskRatio ?? 1, spreadPct: d.spreadPct ?? 0,
            detectedAt: d.detectedAt ?? Date.now(), timestamp: d.timestamp ?? new Date().toISOString(),
            fv: { VPIN: d.fv?.VPIN ?? 0, OBI_L1: d.fv?.OBI_L1 ?? 0, TBQ_TSQ: d.fv?.TBQ_TSQ ?? 1, PostDist: d.fv?.PostDist ?? 0, spread_pct: d.fv?.spread_pct ?? 0, oi_change: d.fv?.oi_change ?? 0, ltp_change: d.fv?.ltp_change ?? 0 },
            js: { pattern_prob: d.js?.pattern_prob ?? 0, delta_proxy: d.js?.delta_proxy ?? 0, patch1_buy_proxy: d.js?.patch1_buy_proxy ?? 0, patch2_sell_proxy: d.js?.patch2_sell_proxy ?? 0, ltp_aggression_frac: d.js?.ltp_aggression_frac ?? 0, oi_buildup_p1: d.js?.oi_buildup_p1 ?? 0 },
            scores: d.scores ?? {},
          };
          setAlerts(prev => [alert, ...prev].slice(0, 100));
        } catch (_) {}
      };
      ws.onerror  = () => { setWsStatus('disconnected'); };
      ws.onclose  = () => { setWsStatus('disconnected'); retRef.current = setTimeout(connect, 5000); };
    }
    connect();
    return () => { wsRef.current?.close(); if (retRef.current) clearTimeout(retRef.current); };
  }, []);

  const visible = alerts.filter(a => !dismissed.has(a.id) && (filter === 'ALL' || a.state === filter));
  const counts = useMemo(() => alerts.reduce((acc, a) => { if (!dismissed.has(a.id)) acc[a.state] = (acc[a.state] ?? 0) + 1; return acc; }, {} as Record<string, number>), [alerts, dismissed]);
  const dismiss = useCallback((id: string) => { setDismissed(prev => new Set([...prev, id])); }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#030712' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1f2937', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>🚨 Spoofing Detection</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: wsStatus === 'live' ? 'rgba(5,46,22,.8)' : wsStatus === 'connecting' ? 'rgba(30,27,75,.8)' : 'rgba(69,10,10,.8)', border: `1px solid ${wsStatus === 'live' ? '#16a34a' : wsStatus === 'connecting' ? '#4f46e5' : '#dc2626'}`, color: wsStatus === 'live' ? '#4ade80' : wsStatus === 'connecting' ? '#818cf8' : '#f87171', fontSize: '11px', fontWeight: 700, padding: '1px 8px', borderRadius: '4px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block', boxShadow: wsStatus === 'live' ? '0 0 4px currentColor' : 'none' }} />
            {wsStatus === 'live' ? 'LIVE' : wsStatus === 'connecting' ? 'CONNECTING' : 'DISCONNECTED'}
          </span>
          <span style={{ color: '#374151', fontSize: '10px' }}>ws://localhost:8765</span>
          {totalRx > 0 && <span style={{ color: '#374151', fontSize: '10px' }}>Rx: {totalRx.toLocaleString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {(['ALL', 'CRITICAL', 'ALERT', 'WATCH'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? (f === 'ALL' ? '#1d4ed8' : `${STATE_COLOR[f as SpoofState]}22`) : 'transparent', border: `1px solid ${filter === f ? (f === 'ALL' ? '#3b82f6' : STATE_COLOR[f as SpoofState]) : '#374151'}`, color: f === 'ALL' ? '#93c5fd' : STATE_COLOR[f as SpoofState], borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontSize: '11px' }}>
              {f !== 'ALL' && `${STATE_EMOJI[f as SpoofState]} `}{f}{counts[f] ? ` (${counts[f]})` : ''}
            </button>
          ))}
          {dismissed.size > 0 && <button onClick={() => setDismissed(new Set())} style={{ background: 'transparent', border: '1px solid #374151', color: '#6b7280', borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontSize: '11px' }}>↺ Restore {dismissed.size}</button>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', padding: '10px 16px', borderBottom: '1px solid #111827', flexShrink: 0 }}>
        {(['CRITICAL', 'ALERT', 'WATCH', 'CLEAR'] as SpoofState[]).map(s => (
          <div key={s} onClick={() => setFilter(s)} style={{ background: STATE_BG[s], border: `1px solid ${STATE_COLOR[s]}33`, borderRadius: '6px', padding: '8px', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: '17px' }}>{STATE_EMOJI[s]}</div>
            <div style={{ color: STATE_COLOR[s], fontWeight: 700, fontSize: '22px', fontFamily: 'monospace' }}>{counts[s] ?? 0}</div>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '0.05em' }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {wsStatus === 'connecting' && <div style={{ textAlign: 'center', paddingTop: '60px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>↻</div><div style={{ fontSize: '14px', color: '#818cf8', marginBottom: '6px' }}>Connecting to detection engine...</div><div style={{ fontSize: '11px', color: '#374151' }}>ws://localhost:8765 — is websocket-collector.ts running?</div></div>}
        {wsStatus === 'disconnected' && <div style={{ textAlign: 'center', paddingTop: '60px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>🔌</div><div style={{ fontSize: '14px', color: '#f87171', marginBottom: '6px' }}>Disconnected — retrying in 5s</div><div style={{ fontSize: '11px', color: '#374151' }}>Check that websocket-collector.ts is running and port 8765 is not blocked</div></div>}
        {wsStatus === 'live' && visible.length === 0 && <div style={{ textAlign: 'center', paddingTop: '50px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div><div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '6px' }}>{filter !== 'ALL' ? `No ${filter} alerts — try "ALL" filter` : 'Scanning for spoofing patterns...'}</div></div>}
        {visible.map(a => <SpoofAlertCard key={a.id} a={a} onDismiss={() => dismiss(a.id)} />)}
      </div>
      <div style={{ borderTop: '1px solid #111827', padding: '6px 16px', background: '#0a0f1a', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '18px', fontSize: '10px', color: '#374151', flexWrap: 'wrap' }}>
          <span>✅ CLEAR — trade normally</span><span>👁 WATCH — reduce size 30%</span><span>⚠️ ALERT — no new positions in alert direction</span><span>🚨 CRITICAL — exit or hedge immediately</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================
