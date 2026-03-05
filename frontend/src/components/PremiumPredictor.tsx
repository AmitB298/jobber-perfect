/**
 * PremiumPredictor.tsx — Enhanced Premium Prediction UI
 * =====================================================
 * ENHANCEMENTS:
 *   ✅ Prediction timestamp — shows exact time each prediction was generated
 *   ✅ Time-ago display — "2 mins ago", "just now", etc.
 *   ✅ Detailed signal breakdown — expanded reasoning panel per prediction
 *   ✅ Signal bar chart — visual 0–100 bars for all 7 signals
 *   ✅ Why this premium — detailed explanation card
 *   ✅ Market condition summary per pick
 *   ✅ Greeks context panel — how IV/Delta/Theta/Gamma contribute to the pick
 *   ✅ Auto-refresh with next-scan countdown
 *   ✅ Scan history — last 5 scan timestamps logged
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalStrength = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
type OptionSide = 'CE' | 'PE';

interface SignalBreakdown {
  oiScore:        number;
  ivVelocity:     number;
  gexScore:       number;
  maxPainScore:   number;
  gammaDominance: number;
  volumeSurge:    number;
  skewMomentum:   number;
}

interface PredictionResult {
  strike:                number;
  side:                  OptionSide;
  currentPremium:        number;
  score:                 number;
  signal:                SignalStrength;
  iv:                    number;
  delta:                 number;
  gamma:                 number;
  theta:                 number;
  signals:               SignalBreakdown;
  reasons:               string[];
  expectedMoveInPremium: number;
  confidence:            number;
  tradeIdea:             string;
}

interface GEXResult {
  netGEX:         number;
  perStrike:      { strike: number; gex: number }[];
  interpretation: string;
  expectedMove:   number;
  dealerMode:     'LONG_GAMMA' | 'SHORT_GAMMA';
  pinStrike:      number;
}

interface MarketContext {
  spot:           number;
  atm:            number;
  dte:            number;
  atmIV:          number;
  ivVelocity:     number;
  ivEnvironment:  string;
  gexMode:        'LONG_GAMMA' | 'SHORT_GAMMA';
  maxPain:        number;
  maxPainDiff:    number;
  pcr:            number;
  pcrSentiment:   'BULLISH' | 'NEUTRAL' | 'BEARISH';
  scenarios:      string[];
}

interface ScanResult {
  topPicks:      PredictionResult[];
  allStrikes:    PredictionResult[];
  gex:           GEXResult;
  marketContext: MarketContext;
  summary:       string;
  scannedAt:     string; // ISO timestamp — added by this component if API doesn't return it
}

interface ScanHistoryEntry {
  ts:         number;
  topCount:   number;
  spot:       number;
  atmIV:      number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const n = (v: any, fb = 0): number => {
  const p = Number(v);
  return isNaN(p) ? fb : p;
};

const fmt = (v: any, d = 2): string => {
  const num = n(v, NaN);
  return isNaN(num) ? '–' : num.toFixed(d);
};

function timeAgo(isoTs: string | number): string {
  const ms = typeof isoTs === 'string' ? new Date(isoTs).getTime() : isoTs;
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5)  return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(isoTs: string | number): string {
  const date = typeof isoTs === 'string' ? new Date(isoTs) : new Date(isoTs);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Signal config ────────────────────────────────────────────────────────────

const SIGNAL_META: {
  key: keyof SignalBreakdown;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
}[] = [
  { key: 'oiScore',        label: 'OI Interpretation',  shortLabel: 'OI',      icon: '📊', description: 'Open Interest flow: rising OI + rising LTP = long buildup (bullish for premium)' },
  { key: 'ivVelocity',     label: 'IV Velocity',         shortLabel: 'IV Vel',  icon: '📈', description: 'Rate of change of Implied Volatility — accelerating IV boosts all premiums' },
  { key: 'gexScore',       label: 'Gamma Exposure (GEX)',shortLabel: 'GEX',     icon: '⚡', description: 'Dealer gamma position — SHORT gamma means dealers amplify moves (buy options)' },
  { key: 'maxPainScore',   label: 'Max Pain Gravity',    shortLabel: 'Max Pain',icon: '🎯', description: 'Spot vs Max Pain distance — large divergence = likely correction toward max pain' },
  { key: 'gammaDominance', label: 'Gamma Dominance',     shortLabel: 'Gamma',   icon: '🔥', description: 'Gamma P&L vs Theta cost — when Gamma > Theta, buying options is efficient' },
  { key: 'volumeSurge',    label: 'Volume Surge',         shortLabel: 'Volume',  icon: '💥', description: 'Vol/OI ratio spike signals smart money / institutional entry' },
  { key: 'skewMomentum',   label: 'IV Skew Momentum',    shortLabel: 'Skew',    icon: '⚖️', description: 'PE IV vs CE IV skew direction — fear/greed momentum in option pricing' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SignalColor({ score }: { score: number }) {
  const color = score >= 70 ? '#22C55E' : score >= 55 ? '#86EFAC' : score >= 40 ? '#FBBF24' : score >= 25 ? '#F97316' : '#EF4444';
  return <span style={{ color, fontWeight: 700 }}>{score}</span>;
}

function SignalBar({ score, label, icon }: { score: number; label: string; icon: string }) {
  const color = score >= 70 ? '#22C55E' : score >= 55 ? '#86EFAC' : score >= 40 ? '#FBBF24' : score >= 25 ? '#F97316' : '#EF4444';
  return (
    <div className="flex items-center gap-2 text-xs mb-1.5">
      <span className="w-4 text-center flex-shrink-0">{icon}</span>
      <span className="text-gray-500 w-14 flex-shrink-0" style={{ fontSize: 10 }}>{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(score, 100)}%`, background: color }} />
      </div>
      <SignalColor score={score} />
    </div>
  );
}

function ScoreRing({ score, signal }: { score: number; signal: SignalStrength }) {
  const color = signal === 'STRONG_BUY' ? '#22C55E'
    : signal === 'BUY' ? '#86EFAC'
    : signal === 'NEUTRAL' ? '#FBBF24'
    : signal === 'SELL' ? '#F97316'
    : '#EF4444';
  const circumference = 2 * Math.PI * 18;
  const dash = (score / 100) * circumference;
  return (
    <div className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
      <svg viewBox="0 0 44 44" width={44} height={44}>
        <circle cx={22} cy={22} r={18} fill="none" stroke="#1F2937" strokeWidth={4} />
        <circle cx={22} cy={22} r={18} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '22px 22px', transition: 'stroke-dasharray 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black text-xs" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: SignalStrength }) {
  const cfg: Record<SignalStrength, { bg: string; border: string; color: string; emoji: string }> = {
    STRONG_BUY:  { bg: 'rgba(21,128,61,0.25)',  border: '#16a34a', color: '#4ade80', emoji: '🚀' },
    BUY:         { bg: 'rgba(21,128,61,0.15)',  border: '#22c55e', color: '#86efac', emoji: '✅' },
    NEUTRAL:     { bg: 'rgba(161,98,7,0.20)',   border: '#d97706', color: '#fbbf24', emoji: '➡' },
    SELL:        { bg: 'rgba(194,65,12,0.20)',  border: '#ea580c', color: '#fb923c', emoji: '⚠️' },
    STRONG_SELL: { bg: 'rgba(153,27,27,0.25)',  border: '#dc2626', color: '#f87171', emoji: '🔴' },
  };
  const c = cfg[signal];
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color, borderRadius: 4, padding: '1px 7px', fontWeight: 700, fontSize: 11, letterSpacing: '0.03em' }}>
      {c.emoji} {signal.replace('_', ' ')}
    </span>
  );
}

// Expandable prediction card with full WHY reasoning
function PredictionCard({
  pred,
  scannedAt,
  rank,
}: {
  pred:      PredictionResult;
  scannedAt: string;
  rank:      number;
}) {
  const [expanded, setExpanded] = useState(false);

  const sideColor = pred.side === 'CE' ? '#22C55E' : '#EF4444';
  const sideBg    = pred.side === 'CE' ? 'rgba(21,128,61,0.15)' : 'rgba(153,27,27,0.20)';

  const topSignal = Object.entries(pred.signals)
    .sort((a, b) => b[1] - a[1])[0];
  const topMeta = SIGNAL_META.find(m => m.key === topSignal?.[0]);

  return (
    <div style={{
      background: expanded ? '#0d1117' : '#0a0f1a',
      border: `1px solid ${pred.signal === 'STRONG_BUY' ? '#166534' : pred.signal === 'BUY' ? '#14532d' : '#1f2937'}`,
      borderLeft: `3px solid ${pred.signal === 'STRONG_BUY' ? '#22C55E' : pred.signal === 'BUY' ? '#86EFAC' : pred.signal === 'NEUTRAL' ? '#FBBF24' : '#EF4444'}`,
      borderRadius: 8,
      marginBottom: 10,
    }}>

      {/* ── Card Header ── */}
      <div className="flex items-start gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}>

        <ScoreRing score={pred.score} signal={pred.signal} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Rank badge */}
            <span style={{ background: '#1f2937', color: '#6b7280', fontSize: 9, fontWeight: 700,
              borderRadius: 3, padding: '0 5px' }}>#{rank}</span>
            {/* Strike + side */}
            <span style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9', fontFamily: 'monospace' }}>
              {pred.strike}
            </span>
            <span style={{ background: sideBg, border: `1px solid ${sideColor}55`, color: sideColor,
              fontWeight: 700, fontSize: 12, borderRadius: 4, padding: '0 6px' }}>
              {pred.side}
            </span>
            <SignalBadge signal={pred.signal} />
          </div>

          {/* Key metrics row */}
          <div className="flex flex-wrap gap-3 text-xs mb-1.5">
            <span>LTP <span style={{ color: '#f1f5f9', fontWeight: 700, fontFamily: 'monospace' }}>₹{fmt(pred.currentPremium, 1)}</span></span>
            <span>IV <span style={{ color: '#60A5FA', fontWeight: 700 }}>{fmt(pred.iv, 1)}%</span></span>
            <span>Δ <span style={{ color: pred.delta >= 0 ? '#22C55E' : '#EF4444', fontWeight: 700 }}>{fmt(pred.delta, 3)}</span></span>
            <span>Θ <span style={{ color: '#F97316', fontWeight: 700 }}>{fmt(pred.theta, 1)}</span></span>
            <span>Γ <span style={{ color: '#A78BFA', fontWeight: 700 }}>{pred.gamma.toFixed(5)}</span></span>
            <span>Est.5m <span style={{ color: pred.expectedMoveInPremium >= 0 ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
              {pred.expectedMoveInPremium >= 0 ? '+' : ''}₹{fmt(pred.expectedMoveInPremium, 2)}
            </span></span>
            <span>Confidence <span style={{ color: '#FBBF24', fontWeight: 700 }}>{pred.confidence}%</span></span>
          </div>

          {/* Top reason (always visible) */}
          {pred.reasons[0] && (
            <div style={{ color: '#9ca3af', fontSize: 10, background: '#111827',
              borderRadius: 3, padding: '2px 6px', display: 'inline-block' }}>
              {pred.reasons[0]}
            </div>
          )}
        </div>

        {/* Timestamp + expand arrow */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div style={{ fontSize: 9, color: '#4b5563', textAlign: 'right' }}>
            🕐 {formatTime(scannedAt)}
          </div>
          <div style={{ fontSize: 9, color: '#374151', textAlign: 'right' }}>
            {timeAgo(scannedAt)}
          </div>
          <span style={{ color: '#374151', fontSize: 11, marginTop: 2 }}>
            {expanded ? '▲ less' : '▼ details'}
          </span>
        </div>
      </div>

      {/* ── Expanded: WHY THIS PREMIUM ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1f2937', padding: '14px 16px', background: '#080c12' }}>

          {/* Trade idea banner */}
          <div style={{ background: '#0f1f10', border: '1px solid #166534', borderRadius: 6,
            padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#86efac', lineHeight: 1.6 }}>
            💡 <strong>Trade Idea:</strong> {pred.tradeIdea}
          </div>

          {/* WHY section */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
              🧠 Why This Premium Was Selected
            </div>

            {/* Key driver highlight */}
            {topMeta && (
              <div style={{ background: '#111827', border: '1px solid #1d4ed8',
                borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 11 }}>
                <div style={{ color: '#93c5fd', fontWeight: 700, marginBottom: 3 }}>
                  🏆 Primary Driver: {topMeta.icon} {topMeta.label} (Score: {topSignal[1]}/100)
                </div>
                <div style={{ color: '#6b7280', lineHeight: 1.5 }}>{topMeta.description}</div>
              </div>
            )}

            {/* All reasons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {pred.reasons.map((reason, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6,
                  background: '#0d1117', borderRadius: 4, padding: '5px 8px', fontSize: 11,
                  border: '1px solid #111827' }}>
                  <span style={{ color: '#374151', fontSize: 9, marginTop: 2 }}>{i + 1}</span>
                  <span style={{ color: '#cbd5e1', lineHeight: 1.5 }}>{reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 7-signal breakdown */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
              📡 7-Signal Breakdown
            </div>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 12px', border: '1px solid #1f2937' }}>
              {SIGNAL_META.map(meta => (
                <div key={meta.key} title={meta.description}>
                  <SignalBar
                    score={pred.signals[meta.key]}
                    label={meta.shortLabel}
                    icon={meta.icon}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Greeks context */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
              🔬 Greeks Context
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {[
                {
                  label: 'IV %',
                  value: `${fmt(pred.iv, 1)}%`,
                  color: pred.iv > 25 ? '#F97316' : pred.iv > 15 ? '#FBBF24' : '#22C55E',
                  note: pred.iv > 30 ? 'Expensive — sell candidate' : pred.iv < 12 ? 'Cheap — buy candidate' : 'Moderate IV',
                },
                {
                  label: 'Delta Δ',
                  value: fmt(pred.delta, 3),
                  color: pred.delta >= 0 ? '#22C55E' : '#EF4444',
                  note: Math.abs(pred.delta) > 0.7 ? 'Deep ITM — high directional' : Math.abs(pred.delta) > 0.4 ? 'Near ATM — balanced' : 'OTM — leveraged',
                },
                {
                  label: 'Theta Θ',
                  value: `₹${fmt(pred.theta, 2)}/d`,
                  color: pred.theta < 0 ? '#F97316' : '#22C55E',
                  note: pred.theta < -5 ? 'Heavy decay — short DTE' : pred.theta < -2 ? 'Moderate decay' : 'Light decay',
                },
                {
                  label: 'Gamma Γ',
                  value: pred.gamma.toFixed(5),
                  color: '#A78BFA',
                  note: pred.gamma > 0.001 ? 'High gamma — near expiry' : 'Low gamma — stable delta',
                },
              ].map(g => (
                <div key={g.label} style={{ background: '#111827', borderRadius: 6, padding: '8px',
                  border: '1px solid #1f2937', textAlign: 'center' }}>
                  <div style={{ color: '#6b7280', fontSize: 9, marginBottom: 2 }}>{g.label}</div>
                  <div style={{ color: g.color, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{g.value}</div>
                  <div style={{ color: '#374151', fontSize: 9, marginTop: 2, lineHeight: 1.3 }}>{g.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scan timestamp detail */}
          <div style={{ borderTop: '1px solid #111827', paddingTop: 8, display: 'flex',
            justifyContent: 'space-between', fontSize: 10, color: '#374151' }}>
            <span>🕐 Generated at: <span style={{ color: '#4b5563' }}>{formatTime(scannedAt)}</span></span>
            <span>⏱ {timeAgo(scannedAt)}</span>
            <span>Score: <span style={{ color: '#6b7280' }}>{pred.score}/100</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GEX Panel ────────────────────────────────────────────────────────────────

function GEXPanel({ gex }: { gex: GEXResult }) {
  const top10 = gex.perStrike.slice(0, 10);
  const max   = Math.max(...top10.map(r => Math.abs(r.gex)), 1);
  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ background: gex.dealerMode === 'SHORT_GAMMA' ? 'rgba(153,27,27,0.2)' : 'rgba(5,46,22,0.2)',
        border: `1px solid ${gex.dealerMode === 'SHORT_GAMMA' ? '#dc2626' : '#16a34a'}`,
        borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 11,
        color: gex.dealerMode === 'SHORT_GAMMA' ? '#fca5a5' : '#86efac' }}>
        {gex.interpretation}
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        Top GEX strikes
      </div>
      {top10.map(row => {
        const pct  = Math.abs(row.gex) / max * 100;
        const isPos = row.gex > 0;
        return (
          <div key={row.strike} className="flex items-center gap-2 mb-1 text-xs">
            <span style={{ color: '#9ca3af', fontFamily: 'monospace', width: 44, textAlign: 'right' }}>
              {row.strike}
            </span>
            <div style={{ flex: 1, height: 8, background: '#1f2937', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.4s',
                background: isPos ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)' }} />
            </div>
            <span style={{ color: isPos ? '#22C55E' : '#EF4444', fontFamily: 'monospace', width: 56, textAlign: 'right', fontSize: 9 }}>
              {isPos ? '+' : ''}{(row.gex / 1e9).toFixed(2)}Bn
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Context Panel ────────────────────────────────────────────────────────────

function ContextPanel({ ctx, scannedAt }: { ctx: MarketContext; scannedAt: string }) {
  const pcrColor = ctx.pcrSentiment === 'BULLISH' ? '#22C55E' : ctx.pcrSentiment === 'BEARISH' ? '#EF4444' : '#FBBF24';
  const ivColor  = ctx.atmIV > 30 ? '#EF4444' : ctx.atmIV > 20 ? '#F97316' : ctx.atmIV > 12 ? '#FBBF24' : '#22C55E';
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
        {[
          { label: 'Spot', value: `₹${ctx.spot.toFixed(2)}`, color: '#f1f5f9' },
          { label: 'ATM', value: ctx.atm, color: '#FBBF24' },
          { label: 'DTE', value: `${ctx.dte}d`, color: '#60A5FA' },
          { label: 'ATM IV', value: `${ctx.atmIV.toFixed(1)}%`, color: ivColor },
          { label: 'IV Vel', value: `${ctx.ivVelocity > 0 ? '+' : ''}${ctx.ivVelocity.toFixed(3)}/m`, color: ctx.ivVelocity > 0 ? '#22C55E' : '#EF4444' },
          { label: 'Max Pain', value: `₹${ctx.maxPain}`, color: '#A78BFA' },
          { label: 'MP Diff', value: `${ctx.maxPainDiff > 0 ? '+' : ''}${ctx.maxPainDiff.toFixed(0)}`, color: Math.abs(ctx.maxPainDiff) > 100 ? '#F97316' : '#9CA3AF' },
          { label: 'PCR', value: ctx.pcr.toFixed(2), color: pcrColor },
          { label: 'GEX Mode', value: ctx.gexMode === 'SHORT_GAMMA' ? 'SHORT γ' : 'LONG γ', color: ctx.gexMode === 'SHORT_GAMMA' ? '#EF4444' : '#22C55E' },
        ].map(item => (
          <div key={item.label} style={{ background: '#0d1117', borderRadius: 5, padding: '6px 8px',
            border: '1px solid #1f2937', textAlign: 'center' }}>
            <div style={{ color: '#4b5563', fontSize: 9, marginBottom: 2 }}>{item.label}</div>
            <div style={{ color: item.color, fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{String(item.value)}</div>
          </div>
        ))}
      </div>

      {/* IV Environment */}
      <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 5,
        padding: '6px 10px', marginBottom: 10, fontSize: 11 }}>
        <span style={{ color: '#6b7280' }}>IV Environment: </span>
        <span style={{ color: ivColor, fontWeight: 700 }}>{ctx.ivEnvironment}</span>
      </div>

      {/* Scenario cards */}
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: '0.07em', marginBottom: 6, fontWeight: 700 }}>
        Market Scenarios
      </div>
      {ctx.scenarios.map((s, i) => (
        <div key={i} style={{ background: '#0a0f1a', border: '1px solid #1f2937',
          borderLeft: '3px solid #1d4ed8', borderRadius: 5, padding: '6px 10px',
          marginBottom: 6, fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 }}>
          {s}
        </div>
      ))}

      {/* Scan timestamp */}
      <div style={{ borderTop: '1px solid #111827', marginTop: 8, paddingTop: 8,
        fontSize: 10, color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
        <span>Context generated: <span style={{ color: '#4b5563' }}>{formatTime(scannedAt)}</span></span>
        <span>{timeAgo(scannedAt)}</span>
      </div>
    </div>
  );
}

// ─── All Strikes Table ────────────────────────────────────────────────────────

function AllStrikesTable({ results, scannedAt }: { results: PredictionResult[]; scannedAt: string }) {
  const [filterSide, setFilterSide] = useState<'ALL' | 'CE' | 'PE'>('ALL');
  const [minScore, setMinScore]     = useState(0);

  const filtered = results
    .filter(r => filterSide === 'ALL' || r.side === filterSide)
    .filter(r => r.score >= minScore);

  const sigColor = (s: SignalStrength) =>
    s === 'STRONG_BUY' ? '#22C55E' : s === 'BUY' ? '#86EFAC' : s === 'NEUTRAL' ? '#FBBF24' : s === 'SELL' ? '#F97316' : '#EF4444';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-1">
          {(['ALL', 'CE', 'PE'] as const).map(f => (
            <button key={f} onClick={() => setFilterSide(f)}
              style={{ background: filterSide === f ? (f === 'CE' ? '#14532d' : f === 'PE' ? '#7f1d1d' : '#1d4ed8') : 'transparent',
                border: `1px solid ${f === 'CE' ? '#166534' : f === 'PE' ? '#991b1b' : '#1d4ed8'}`,
                color: f === 'CE' ? '#86efac' : f === 'PE' ? '#fca5a5' : '#93c5fd',
                borderRadius: 4, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs ml-auto">
          <span style={{ color: '#6b7280' }}>Min score:</span>
          <input type="range" min={0} max={80} step={5} value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            style={{ width: 80 }} />
          <span style={{ color: '#9ca3af', fontFamily: 'monospace', width: 20 }}>{minScore}</span>
        </div>
        <span style={{ fontSize: 10, color: '#4b5563' }}>
          {filtered.length} strikes · scan {formatTime(scannedAt)}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1f2937' }}>
              {['Score', 'Strike', 'Side', 'Signal', 'LTP', 'IV%', 'Delta', 'Theta', 'Est.5m Move', 'Confidence', 'OI', 'IV Vel', 'GEX', 'Max Pain', 'Gamma', 'Volume', 'Skew'].map(h => (
                <th key={h} style={{ padding: '4px 8px', color: '#4b5563', fontWeight: 700,
                  textAlign: h === 'Strike' || h === 'Side' || h === 'Signal' ? 'left' : 'right',
                  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.strike}-${r.side}`}
                style={{ borderBottom: '1px solid #0d1117', background: i % 2 === 0 ? '#080c12' : '#0a0f1a' }}>
                <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: sigColor(r.signal) }}>{r.score}</span>
                </td>
                <td style={{ padding: '3px 8px', color: '#f1f5f9', fontWeight: 700 }}>{r.strike}</td>
                <td style={{ padding: '3px 8px', color: r.side === 'CE' ? '#22C55E' : '#EF4444', fontWeight: 700 }}>{r.side}</td>
                <td style={{ padding: '3px 8px', color: sigColor(r.signal), fontSize: 10 }}>{r.signal.replace('_', ' ')}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: '#f1f5f9' }}>₹{fmt(r.currentPremium, 1)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: '#60A5FA' }}>{fmt(r.iv, 1)}%</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: r.delta >= 0 ? '#22C55E' : '#EF4444' }}>{fmt(r.delta, 3)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: '#F97316' }}>{fmt(r.theta, 1)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: r.expectedMoveInPremium >= 0 ? '#22C55E' : '#EF4444' }}>
                  {r.expectedMoveInPremium >= 0 ? '+' : ''}₹{fmt(r.expectedMoveInPremium, 2)}
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: '#FBBF24' }}>{r.confidence}%</td>
                {/* Signal sub-scores */}
                {(['oiScore', 'ivVelocity', 'gexScore', 'maxPainScore', 'gammaDominance', 'volumeSurge', 'skewMomentum'] as (keyof SignalBreakdown)[]).map(k => (
                  <td key={k} style={{ padding: '3px 8px', textAlign: 'right' }}>
                    <SignalColor score={r.signals[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Scan History Widget ──────────────────────────────────────────────────────

function ScanHistoryWidget({ history }: { history: ScanHistoryEntry[] }) {
  if (!history.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Recent scans:
      </span>
      {history.slice(-5).reverse().map((h, i) => (
        <div key={h.ts} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 4,
          padding: '2px 7px', fontSize: 9, color: i === 0 ? '#93c5fd' : '#374151',
          fontFamily: 'monospace' }}>
          {formatTime(h.ts)} · {h.topCount} picks · IV {h.atmIV.toFixed(1)}%
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PremiumPredictor() {
  const [scanResult, setScanResult]   = useState<ScanResult | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [autoScan, setAutoScan]       = useState(false);
  const [countdown, setCountdown]     = useState(30);
  const [activeView, setActiveView]   = useState<'top' | 'all' | 'gex' | 'context'>('top');
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [scanCount, setScanCount]     = useState(0);

  const autoRef    = useRef(autoScan);
  const countRef   = useRef(countdown);
  autoRef.current  = autoScan;
  countRef.current = countdown;

  const doScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<{ success: boolean; data: ScanResult }>(
        'http://localhost:3001/api/premium/predictions',
        { timeout: 12000 }
      );
      if (res.data.success) {
        const d = res.data.data;
        // Attach scannedAt if backend doesn't return it
        if (!d.scannedAt) (d as any).scannedAt = new Date().toISOString();
        setScanResult(d);
        setScanCount(c => c + 1);
        // Update scan history
        setScanHistory(prev => [
          ...prev,
          {
            ts:       Date.now(),
            topCount: d.topPicks.length,
            spot:     d.marketContext.spot,
            atmIV:    d.marketContext.atmIV,
          },
        ].slice(-20));
        setCountdown(30);
      } else {
        setError('Scan returned no data');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed — is backend running on port 3001?');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-scan countdown
  useEffect(() => {
    const tick = setInterval(() => {
      if (!autoRef.current) return;
      setCountdown(c => {
        if (c <= 1) { doScan(); return 30; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [doScan]);

  // Live clock for time-ago updates
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceUpdate(n => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const ctx      = scanResult?.marketContext;
  const scannedAt = scanResult?.scannedAt ?? '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      background: '#030712', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header bar ── */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1f2937',
        background: '#0a0f1a', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>
            ⚡ Premium Predictor
          </span>
          {scannedAt && (
            <span style={{ fontSize: 10, color: '#4b5563', background: '#111827',
              border: '1px solid #1f2937', borderRadius: 4, padding: '2px 7px' }}>
              Last scan: <span style={{ color: '#6b7280' }}>{formatTime(scannedAt)}</span>
              <span style={{ color: '#374151', marginLeft: 4 }}>({timeAgo(scannedAt)})</span>
            </span>
          )}
          {scanCount > 0 && (
            <span style={{ fontSize: 10, color: '#374151' }}>#{scanCount} scans</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {autoScan && !loading && (
            <span style={{ fontSize: 10, color: '#1d4ed8', background: '#172554',
              border: '1px solid #1e3a8a', borderRadius: 4, padding: '2px 7px',
              fontFamily: 'monospace' }}>
              ↺ {countdown}s
            </span>
          )}
          <button
            onClick={() => setAutoScan(a => !a)}
            style={{ background: autoScan ? 'rgba(21,128,61,0.2)' : 'rgba(30,30,40,0.6)',
              border: `1px solid ${autoScan ? '#166534' : '#374151'}`,
              color: autoScan ? '#4ade80' : '#6b7280',
              borderRadius: 5, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            {autoScan ? '⏸ Auto On' : '○ Auto Off'}
          </button>
          <button
            onClick={doScan}
            disabled={loading}
            style={{ background: loading ? '#111827' : '#1d4ed8',
              color: loading ? '#6b7280' : '#fff',
              border: 'none', borderRadius: 5, padding: '5px 14px',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12 }}>
            {loading ? '⟳ Scanning…' : '↺ Scan Now'}
          </button>
        </div>
      </div>

      {/* ── Market summary strip ── */}
      {ctx && (
        <div style={{ padding: '6px 16px', background: '#060a0f', borderBottom: '1px solid #111827',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, flexShrink: 0, fontSize: 11 }}>
          <span>₹<strong style={{ color: '#f1f5f9', fontFamily: 'monospace' }}>{ctx.spot.toFixed(2)}</strong></span>
          <span>ATM <strong style={{ color: '#FBBF24' }}>{ctx.atm}</strong></span>
          <span>DTE <strong style={{ color: '#60A5FA' }}>{ctx.dte}d</strong></span>
          <span>IV <strong style={{ color: ctx.atmIV > 25 ? '#EF4444' : ctx.atmIV > 15 ? '#FBBF24' : '#22C55E' }}>{ctx.atmIV.toFixed(1)}%</strong></span>
          <span style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, padding: '1px 6px' }}>
            {ctx.ivEnvironment}
          </span>
          <span>MaxPain <strong style={{ color: '#A78BFA' }}>₹{ctx.maxPain}</strong>
            <span style={{ color: Math.abs(ctx.maxPainDiff) > 100 ? '#F97316' : '#4b5563', marginLeft: 3 }}>
              ({ctx.maxPainDiff > 0 ? '+' : ''}{ctx.maxPainDiff.toFixed(0)}pts)
            </span>
          </span>
          <span>PCR <strong style={{ color: ctx.pcrSentiment === 'BULLISH' ? '#22C55E' : ctx.pcrSentiment === 'BEARISH' ? '#EF4444' : '#FBBF24' }}>
            {ctx.pcr.toFixed(2)}
          </strong></span>
          <span style={{ background: ctx.gexMode === 'SHORT_GAMMA' ? 'rgba(153,27,27,0.3)' : 'rgba(5,46,22,0.3)',
            border: `1px solid ${ctx.gexMode === 'SHORT_GAMMA' ? '#991b1b' : '#166534'}`,
            color: ctx.gexMode === 'SHORT_GAMMA' ? '#fca5a5' : '#86efac',
            borderRadius: 4, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>
            {ctx.gexMode === 'SHORT_GAMMA' ? '⚡ SHORT γ' : '📌 LONG γ'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151' }}>
            🕐 {formatTime(scannedAt)} · {timeAgo(scannedAt)}
          </span>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', background: '#0a0f1a',
        flexShrink: 0, overflowX: 'auto' }}>
        {([
          { id: 'top',     label: `🏆 Top Picks${scanResult ? ` (${scanResult.topPicks.length})` : ''}` },
          { id: 'all',     label: `📋 All Strikes${scanResult ? ` (${scanResult.allStrikes.length})` : ''}` },
          { id: 'gex',     label: '⚡ GEX' },
          { id: 'context', label: '📡 Context' },
        ] as { id: typeof activeView; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setActiveView(t.id)}
            style={{ padding: '8px 14px', fontSize: 11, fontWeight: activeView === t.id ? 700 : 400,
              color: activeView === t.id ? '#93c5fd' : '#6b7280',
              borderBottom: activeView === t.id ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottomWidth: 2, borderBottomStyle: 'solid',
              borderBottomColor: activeView === t.id ? '#3b82f6' : 'transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(153,27,27,0.2)', border: '1px solid #991b1b',
            borderRadius: 6, padding: '10px 14px', marginBottom: 12, color: '#fca5a5', fontSize: 12 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Empty state */}
        {!scanResult && !loading && !error && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>
              Click <strong style={{ color: '#93c5fd' }}>Scan Now</strong> to analyze live NIFTY premiums
            </div>
            <div style={{ fontSize: 11, color: '#374151' }}>
              7-signal engine · OI flow · IV velocity · GEX · Max Pain · Gamma · Volume · Skew
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 30, marginBottom: 10, animation: 'spin 1s linear infinite' }}>⟳</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Scanning all strikes…</div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {scanResult && !loading && (
          <>
            {/* ── TOP PICKS ── */}
            {activeView === 'top' && (
              <div>
                {/* Scan history */}
                <div style={{ marginBottom: 10 }}>
                  <ScanHistoryWidget history={scanHistory} />
                </div>

                {scanResult.topPicks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#4b5563' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
                    <div style={{ fontSize: 12 }}>No picks above threshold (score ≥ 50)</div>
                    <div style={{ fontSize: 10, color: '#374151', marginTop: 4 }}>
                      Try checking All Strikes for lower-scored setups
                    </div>
                  </div>
                ) : (
                  scanResult.topPicks.map((pred, i) => (
                    <PredictionCard
                      key={`${pred.strike}-${pred.side}`}
                      pred={pred}
                      scannedAt={scannedAt}
                      rank={i + 1}
                    />
                  ))
                )}
              </div>
            )}

            {/* ── ALL STRIKES ── */}
            {activeView === 'all' && (
              <AllStrikesTable results={scanResult.allStrikes} scannedAt={scannedAt} />
            )}

            {/* ── GEX ── */}
            {activeView === 'gex' && scanResult.gex && (
              <GEXPanel gex={scanResult.gex} />
            )}

            {/* ── CONTEXT ── */}
            {activeView === 'context' && ctx && (
              <ContextPanel ctx={ctx} scannedAt={scannedAt} />
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px solid #111827', padding: '5px 16px', background: '#060a0f',
        flexShrink: 0, fontSize: 9, color: '#1f2937', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center' }}>
        <span>JOBBER PRO · Premium Predictor · 7-signal engine · Uses your live Angel One OI, IV, Greeks every scan</span>
        {scannedAt && (
          <span style={{ color: '#374151' }}>
            Scan #{scanCount} · {formatTime(scannedAt)}
          </span>
        )}
      </div>
    </div>
  );
}