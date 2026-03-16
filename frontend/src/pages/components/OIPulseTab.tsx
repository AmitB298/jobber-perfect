/**
 * OIPulseTab.tsx — JOBBER PRO
 * ================================
 * OI Activity Intelligence — Long/Short Buildup & Unwinding
 * Tab name: "⚡ OI Pulse"
 *
 * HOW TO ADD TO Dashboard.tsx:
 * ─────────────────────────────────────────────────
 * // 1. Import at top of Dashboard.tsx:
 * import OIPulseTab from './components/OIPulseTab';
 *
 * // 2. Add to the Tab type in dashboard/types.ts:
 * type Tab = ... | 'oipulse';
 *
 * // 3. Add tab button in tab bar:
 * <button onClick={() => setActiveTab('oipulse')}
 *   className={activeTab === 'oipulse' ? 'tab-active' : 'tab'}>
 *   ⚡ OI Pulse
 * </button>
 *
 * // 4. Add tab panel in content switch:
 * {activeTab === 'oipulse' && <OIPulseTab />}
 *
 * BACKEND: Add to api-server.ts:
 *   import { registerOIPulseRoutes } from './oi-pulse-routes';
 *   registerOIPulseRoutes(app, db);
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const API = 'http://localhost:3001';
const REFRESH_MS = 20_000;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type ActivityType = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'SHORT_UNWINDING' | 'NEUTRAL';
type TrapType = 'BULL_TRAP' | 'BEAR_TRAP';
type ViewMode = 'activity' | 'summary' | 'velocity' | 'traps' | 'pcr';

interface ActivityRow {
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  ltp: number;
  prevClose: number;
  priceChangePct: number;
  oi: number;
  oiChange: number;
  oiChangePct: number;
  volume: number;
  iv: number;
  activity: ActivityType;
  signalScore: number;
  distanceFromSpot: number;
}

interface ActivityCounts {
  LONG_BUILDUP: number;
  SHORT_BUILDUP: number;
  LONG_UNWINDING: number;
  SHORT_UNWINDING: number;
  NEUTRAL: number;
}

interface ActivityResponse {
  success: boolean;
  spot: number;
  data: ActivityRow[];
  counts: ActivityCounts;
  total: number;
}

interface SummaryData {
  spot: number;
  pcrOi: number;
  atmIv: number;
  ivr: number;
  netGex: number;
  maxPain: number;
  callWall: number;
  putWall: number;
  ce: { oiAdded: number; oiShed: number; netOiChange: number; volume: number; pressure: string };
  pe: { oiAdded: number; oiShed: number; netOiChange: number; volume: number; pressure: string };
  totalNetOiChange: number;
  marketBias: string;
  updatedAt: number;
}

interface VelocityRow {
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  ltp: number;
  prevClose: number;
  oi: number;
  oiChange: number;
  oiChangePct: number;
  volume: number;
  iv: number;
  distanceFromSpot: number;
}

interface TrapRow {
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  ltp: number;
  prevClose: number;
  priceChangePct: number;
  oiChangePct: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;
  trapType: TrapType;
  distanceFromSpot: number;
}

interface PCRStrikeRow {
  strike: number;
  expiry: string;
  ceOI: number;
  peOI: number;
  ceOIChg: number;
  peOIChg: number;
  ceLtp: number;
  peLtp: number;
  ceIv: number;
  peIv: number;
  pcr: number;
  dominant: 'CE' | 'PE' | 'BALANCED';
  distanceFromSpot: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, dec = 0): string =>
  n == null ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: dec });

const fmtK = (n: number | null | undefined): string => {
  if (n == null) return '–';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return sign + (abs / 1e7).toFixed(1) + 'Cr';
  if (abs >= 1e5) return sign + (abs / 1e5).toFixed(1) + 'L';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return String(n);
};

const fmtPct = (n: number, dec = 1): string =>
  `${n > 0 ? '+' : ''}${n.toFixed(dec)}%`;

// ─── ACTIVITY CONFIG ──────────────────────────────────────────────────────────

const ACTIVITY_CONFIG: Record<ActivityType, {
  label: string; icon: string; color: string; bg: string;
  priceDir: string; oiDir: string; desc: string;
}> = {
  LONG_BUILDUP: {
    label: 'Long Buildup',    icon: '🟢', color: '#4ADE80', bg: 'rgba(74,222,128,0.08)',
    priceDir: 'Price ↑',      oiDir: 'OI ↑',
    desc: 'Fresh longs — bullish conviction',
  },
  SHORT_BUILDUP: {
    label: 'Short Buildup',   icon: '🔴', color: '#F87171', bg: 'rgba(248,113,113,0.08)',
    priceDir: 'Price ↓',      oiDir: 'OI ↑',
    desc: 'Fresh shorts — bearish conviction',
  },
  LONG_UNWINDING: {
    label: 'Long Unwinding',  icon: '🟡', color: '#FCD34D', bg: 'rgba(252,211,77,0.08)',
    priceDir: 'Price ↓',      oiDir: 'OI ↓',
    desc: 'Longs exiting — bearish momentum weakening',
  },
  SHORT_UNWINDING: {
    label: 'Short Unwinding', icon: '🔵', color: '#60A5FA', bg: 'rgba(96,165,250,0.08)',
    priceDir: 'Price ↑',      oiDir: 'OI ↓',
    desc: 'Shorts covering — bullish momentum weakening',
  },
  NEUTRAL: {
    label: 'Neutral',         icon: '⚪', color: 'rgba(255,255,255,0.3)', bg: 'transparent',
    priceDir: '–',            oiDir: '–',
    desc: 'No clear activity',
  },
};

const BIAS_CONFIG: Record<string, { color: string; icon: string; desc: string }> = {
  BULLISH:  { color: '#4ADE80', icon: '📈', desc: 'PE building + CE unwinding' },
  BEARISH:  { color: '#F87171', icon: '📉', desc: 'CE building + PE unwinding' },
  SIDEWAYS: { color: '#FFD700', icon: '↔️', desc: 'Both CE & PE building = range' },
  BREAKOUT: { color: '#A78BFA', icon: '💥', desc: 'Both CE & PE unwinding = move' },
  NEUTRAL:  { color: '#94A3B8', icon: '⚖️', desc: 'Mixed signals' },
};

// ─── SCORE BADGE ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? '#FF4560' : score >= 45 ? '#FF8C00' : score >= 25 ? '#FFD700' : '#4A9EFF';
  const label = score >= 70 ? 'STRONG' : score >= 45 ? 'MEDIUM' : 'WEAK';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color,
        background: color + '18', border: `1px solid ${color}40`,
        borderRadius: 4, padding: '2px 6px',
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 50, height: 4, background: 'rgba(255,255,255,0.08)',
          borderRadius: 99, overflow: 'hidden',
        }}>
          <div style={{
            width: `${score}%`, height: '100%',
            background: color, borderRadius: 99,
            boxShadow: `0 0 4px ${color}80`,
            transition: 'width 0.5s ease',
          }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{score}</span>
      </div>
    </div>
  );
}

// ─── ACTIVITY CARD ────────────────────────────────────────────────────────────

function ActivityCard({ row }: { row: ActivityRow }) {
  const cfg   = ACTIVITY_CONFIG[row.activity];
  const isCE  = row.optionType === 'CE';
  const typeColor = isCE ? '#4A9EFF' : '#FF4560';

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.color}25`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: 10,
      padding: '11px 13px',
      display: 'flex', flexDirection: 'column', gap: 8,
      animation: 'fadeSlide 0.25s ease both',
    }}>
      {/* Row 1: Strike + activity + score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13 }}>{cfg.icon}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: typeColor, fontFamily: 'monospace', lineHeight: 1 }}>
                {fmt(row.strike)}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: typeColor + '20', color: typeColor, border: `1px solid ${typeColor}40`,
              }}>{row.optionType}</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: cfg.color, marginTop: 2 }}>
              {cfg.label}
            </div>
          </div>
        </div>
        <ScoreBadge score={row.signalScore} />
      </div>

      {/* Row 2: Price & OI changes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 8px' }}>
        {[
          { label: 'LTP',       value: `₹${fmt(row.ltp, 1)}` },
          { label: 'Prev',      value: `₹${fmt(row.prevClose, 1)}` },
          { label: 'Price Δ',   value: fmtPct(row.priceChangePct), color: row.priceChangePct > 0 ? '#4ADE80' : '#F87171' },
          { label: 'IV',        value: `${fmt(row.iv, 1)}%`,       color: '#A78BFA' },
          { label: 'OI',        value: fmtK(row.oi) },
          { label: 'OI Chg',    value: `${row.oiChange > 0 ? '+' : ''}${fmtK(row.oiChange)}`, color: row.oiChange > 0 ? '#4ADE80' : '#F87171' },
          { label: 'OI Δ%',     value: fmtPct(row.oiChangePct),    color: row.oiChangePct > 0 ? '#4ADE80' : '#F87171' },
          { label: 'Volume',    value: fmtK(row.volume) },
        ].map(item => (
          <div key={item.label}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: item.color ?? 'rgba(255,255,255,0.8)', fontFamily: 'monospace' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Row 3: Desc + distance */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>{cfg.desc}</div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          {row.distanceFromSpot > 0 ? '+' : ''}{fmt(row.distanceFromSpot)} from spot
        </div>
      </div>
    </div>
  );
}

// ─── SUMMARY PANEL ────────────────────────────────────────────────────────────

function SummaryPanel({ data }: { data: SummaryData }) {
  const bias = BIAS_CONFIG[data.marketBias] ?? BIAS_CONFIG.NEUTRAL;

  const ceBarPct = data.ce.oiAdded + data.pe.oiAdded > 0
    ? (data.ce.oiAdded / (data.ce.oiAdded + data.pe.oiAdded)) * 100
    : 50;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Market Bias Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${bias.color}10, rgba(0,0,0,0))`,
        border: `1px solid ${bias.color}30`,
        borderRadius: 14, padding: '16px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            Market Activity Bias
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: bias.color, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{bias.icon}</span>
            {data.marketBias}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{bias.desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>NIFTY Spot</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#4ADE80', fontFamily: 'monospace' }}>₹{fmt(data.spot)}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Max Pain: {fmt(data.maxPain)}</div>
        </div>
      </div>

      {/* CE vs PE OI Flow */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          OI Flow — CE vs PE
        </div>

        {/* Visual bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
            <span>CE OI Added: {fmtK(data.ce.oiAdded)}</span>
            <span>PE OI Added: {fmtK(data.pe.oiAdded)}</span>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${ceBarPct}%`, background: '#4A9EFF', transition: 'width 0.8s ease' }} />
            <div style={{ flex: 1, background: '#FF4560' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
            <span style={{ color: '#4A9EFF' }}>CE {ceBarPct.toFixed(0)}%</span>
            <span style={{ color: '#FF4560' }}>PE {(100 - ceBarPct).toFixed(0)}%</span>
          </div>
        </div>

        {/* CE / PE cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'CALL (CE)', d: data.ce, color: '#4A9EFF' },
            { label: 'PUT (PE)',  d: data.pe, color: '#FF4560' },
          ].map(({ label, d, color }) => (
            <div key={label} style={{ background: color + '08', border: `1px solid ${color}20`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color, marginBottom: 8 }}>{label}</div>
              {[
                { k: 'OI Added',   v: fmtK(d.oiAdded),    c: '#4ADE80' },
                { k: 'OI Shed',    v: fmtK(d.oiShed),     c: '#F87171' },
                { k: 'Net Change', v: `${d.netOiChange > 0 ? '+' : ''}${fmtK(d.netOiChange)}`, c: d.netOiChange >= 0 ? '#4ADE80' : '#F87171' },
                { k: 'Volume',     v: fmtK(d.volume),     c: undefined },
                { k: 'Pressure',   v: d.pressure,         c: d.pressure === 'BUILDING' ? '#4ADE80' : '#F87171' },
              ].map(item => (
                <div key={item.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>{item.k}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: item.c ?? 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>{item.v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Market structure pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'PCR OI',    value: data.pcrOi.toFixed(2), color: data.pcrOi > 1.2 ? '#4ADE80' : data.pcrOi < 0.8 ? '#F87171' : '#FFD700', note: data.pcrOi > 1 ? 'PE heavy' : 'CE heavy' },
          { label: 'ATM IV',    value: `${fmt(data.atmIv, 1)}%`, color: '#A78BFA' },
          { label: 'IVR',       value: String(fmt(data.ivr, 0)), color: data.ivr > 60 ? '#FF4560' : data.ivr < 30 ? '#4ADE80' : '#FFD700', note: '0–100' },
          { label: 'Call Wall', value: fmt(data.callWall), color: '#FF4560' },
          { label: 'Put Wall',  value: fmt(data.putWall),  color: '#4A9EFF' },
        ].map(p => (
          <div key={p.label} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${p.color}20`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: p.color, fontFamily: 'monospace', lineHeight: 1.2 }}>{p.value}</div>
            {p.note && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>{p.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── VELOCITY TABLE ───────────────────────────────────────────────────────────

// FIX 2: removed unused `spot` param
function VelocityTable({ rows }: { rows: VelocityRow[] }) {
  if (!rows.length) return <EmptyState icon="⚡" text="No velocity data" />;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Strike', 'Type', 'LTP', 'OI', 'OI Chg', 'OI Δ%', 'Volume', 'IV', 'Distance'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isCE = r.optionType === 'CE';
            const typeColor = isCE ? '#4A9EFF' : '#FF4560';
            const oiColor = r.oiChange > 0 ? '#4ADE80' : '#F87171';
            return (
              <tr key={`${r.strike}-${r.optionType}-${i}`} style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
              }}>
                <td style={{ padding: '8px 10px', fontWeight: 800, color: typeColor, fontFamily: 'monospace' }}>{fmt(r.strike)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: typeColor + '20', color: typeColor }}>{r.optionType}</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.8)' }}>₹{fmt(r.ltp, 1)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)' }}>{fmtK(r.oi)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: oiColor, fontWeight: 700 }}>
                  {r.oiChange > 0 ? '+' : ''}{fmtK(r.oiChange)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: oiColor }}>
                  {fmtPct(r.oiChangePct)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.6)' }}>{fmtK(r.volume)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#A78BFA' }}>{fmt(r.iv, 1)}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
                  {r.distanceFromSpot > 0 ? '+' : ''}{fmt(r.distanceFromSpot)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── TRAP CARD ────────────────────────────────────────────────────────────────

function TrapCard({ row }: { row: TrapRow }) {
  const isBull = row.trapType === 'BULL_TRAP';
  const color  = isBull ? '#FCD34D' : '#C084FC';
  const isCE   = row.optionType === 'CE';
  const typeColor = isCE ? '#4A9EFF' : '#FF4560';

  return (
    <div style={{
      background: color + '06',
      border: `1px solid ${color}30`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{isBull ? '⚠️' : '🪤'}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: typeColor, fontFamily: 'monospace' }}>
              {fmt(row.strike)} <span style={{ fontSize: 10 }}>{row.optionType}</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color }}>
              {isBull ? 'BULL TRAP' : 'BEAR TRAP'} — {isBull ? 'Price ↑ but OI ↓' : 'Price ↓ but OI ↓'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
          {row.distanceFromSpot > 0 ? '+' : ''}{fmt(row.distanceFromSpot)} pts
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 8px' }}>
        {[
          { label: 'Price Δ',  value: fmtPct(row.priceChangePct), color: row.priceChangePct > 0 ? '#4ADE80' : '#F87171' },
          { label: 'OI Δ%',    value: fmtPct(row.oiChangePct),   color: '#F87171' },
          { label: 'OI Shed',  value: fmtK(Math.abs(row.oiChange)), color: '#F87171' },
          { label: 'Volume',   value: fmtK(row.volume) },
        ].map(item => (
          <div key={item.label}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{item.label}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: item.color ?? 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
        {isBull
          ? 'Price rose but short-covering, not fresh buying — move may lack conviction'
          : 'Price fell but long-covering, not fresh selling — downside may be exhausted'}
      </div>
    </div>
  );
}

// ─── PCR TABLE ────────────────────────────────────────────────────────────────

function PCRTable({ rows }: { rows: PCRStrikeRow[] }) {
  if (!rows.length) return <EmptyState icon="📊" text="No PCR data available" />;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Strike', 'CE OI', 'PE OI', 'PCR', 'CE OI Chg', 'PE OI Chg', 'CE LTP', 'PE LTP', 'Dominant', 'Distance'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pcrColor = r.pcr > 1.2 ? '#4ADE80' : r.pcr < 0.8 ? '#F87171' : '#FFD700';
            const domColor = r.dominant === 'PE' ? '#4ADE80' : r.dominant === 'CE' ? '#F87171' : '#FFD700';
            const isAtm = Math.abs(r.distanceFromSpot) < 100;
            return (
              <tr key={`${r.strike}-${i}`} style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: isAtm ? 'rgba(74,222,128,0.04)' : i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
              }}>
                <td style={{ padding: '8px 10px', fontWeight: isAtm ? 900 : 700, color: isAtm ? '#4ADE80' : 'rgba(255,255,255,0.8)', fontFamily: 'monospace' }}>
                  {fmt(r.strike)}{isAtm ? ' ★' : ''}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#4A9EFF', fontFamily: 'monospace' }}>{fmtK(r.ceOI)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#FF4560', fontFamily: 'monospace' }}>{fmtK(r.peOI)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: pcrColor, fontFamily: 'monospace' }}>{r.pcr.toFixed(2)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.ceOIChg >= 0 ? '#4ADE80' : '#F87171', fontFamily: 'monospace' }}>
                  {r.ceOIChg > 0 ? '+' : ''}{fmtK(r.ceOIChg)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.peOIChg >= 0 ? '#4ADE80' : '#F87171', fontFamily: 'monospace' }}>
                  {r.peOIChg > 0 ? '+' : ''}{fmtK(r.peOIChg)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#4A9EFF', fontFamily: 'monospace' }}>₹{fmt(r.ceLtp, 1)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#FF4560', fontFamily: 'monospace' }}>₹{fmt(r.peLtp, 1)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: domColor + '20', color: domColor }}>{r.dominant}</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}>
                  {r.distanceFromSpot > 0 ? '+' : ''}{fmt(r.distanceFromSpot)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'rgba(255,255,255,0.25)' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{text}</div>
      <div style={{ fontSize: 10, marginTop: 6 }}>Make sure options_data table is populated with oi_change values</div>
    </div>
  );
}

// ─── ACTIVITY FILTER BAR ──────────────────────────────────────────────────────

function ActivityFilterBar({
  typeFilter, setTypeFilter,
  optFilter, setOptFilter,
}: {
  typeFilter: ActivityType | 'ALL';
  setTypeFilter: (v: ActivityType | 'ALL') => void;
  optFilter: 'CE' | 'PE' | 'ALL';
  setOptFilter: (v: 'CE' | 'PE' | 'ALL') => void;
}) {
  const types: (ActivityType | 'ALL')[] = ['ALL', 'LONG_BUILDUP', 'SHORT_BUILDUP', 'LONG_UNWINDING', 'SHORT_UNWINDING'];
  const typeLabels: Record<string, string> = {
    ALL: 'All',
    LONG_BUILDUP: '🟢 LB',
    SHORT_BUILDUP: '🔴 SB',
    LONG_UNWINDING: '🟡 LU',
    SHORT_UNWINDING: '🔵 SU',
  };
  const typeColors: Record<string, string> = {
    ALL: 'rgba(255,255,255,0.5)',
    LONG_BUILDUP: '#4ADE80',
    SHORT_BUILDUP: '#F87171',
    LONG_UNWINDING: '#FCD34D',
    SHORT_UNWINDING: '#60A5FA',
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {types.map(t => {
        const active = typeFilter === t;
        const color = typeColors[t];
        return (
          <button key={t} onClick={() => setTypeFilter(t)} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600,
            background: active ? color + '20' : 'transparent',
            border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
            color: active ? color : 'rgba(255,255,255,0.4)',
            transition: 'all 0.15s',
          }}>{typeLabels[t]}</button>
        );
      })}

      <div style={{ marginLeft: 8, display: 'flex', gap: 4 }}>
        {(['ALL', 'CE', 'PE'] as const).map(o => (
          <button key={o} onClick={() => setOptFilter(o)} style={{
            padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
            background: optFilter === o ? (o === 'CE' ? 'rgba(74,158,255,0.2)' : o === 'PE' ? 'rgba(255,69,96,0.2)' : 'rgba(255,255,255,0.1)') : 'transparent',
            border: `1px solid ${optFilter === o ? (o === 'CE' ? '#4A9EFF' : o === 'PE' ? '#FF4560' : 'rgba(255,255,255,0.3)') : 'rgba(255,255,255,0.1)'}`,
            color: optFilter === o ? '#fff' : 'rgba(255,255,255,0.4)',
          }}>{o}</button>
        ))}
      </div>
    </div>
  );
}

// ─── COUNTS BAR ──────────────────────────────────────────────────────────────

// FIX 3: removed unused `total` variable entirely — counts used directly
function CountsBar({ counts }: { counts: ActivityCounts }) {
  const items = [
    { key: 'LONG_BUILDUP',    label: '🟢 Long Buildup',    count: counts.LONG_BUILDUP,    color: '#4ADE80' },
    { key: 'SHORT_BUILDUP',   label: '🔴 Short Buildup',   count: counts.SHORT_BUILDUP,   color: '#F87171' },
    { key: 'LONG_UNWINDING',  label: '🟡 Long Unwinding',  count: counts.LONG_UNWINDING,  color: '#FCD34D' },
    { key: 'SHORT_UNWINDING', label: '🔵 Short Unwinding', count: counts.SHORT_UNWINDING, color: '#60A5FA' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
      {items.map(item => (
        <div key={item.key} style={{
          background: item.color + '10',
          border: `1px solid ${item.color}25`,
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{item.label}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: item.color, fontFamily: 'monospace' }}>{item.count}</div>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function OIPulseTab() {
  const [view, setView]               = useState<ViewMode>('activity');
  const [typeFilter, setTypeFilter]   = useState<ActivityType | 'ALL'>('ALL');
  const [optFilter, setOptFilter]     = useState<'CE' | 'PE' | 'ALL'>('ALL');

  // Data state
  const [activityData, setActivityData] = useState<ActivityRow[]>([]);
  const [counts, setCounts]             = useState<ActivityCounts>({ LONG_BUILDUP: 0, SHORT_BUILDUP: 0, LONG_UNWINDING: 0, SHORT_UNWINDING: 0, NEUTRAL: 0 });
  const [summaryData, setSummaryData]   = useState<SummaryData | null>(null);
  const [velocityRows, setVelocityRows] = useState<VelocityRow[]>([]);
  const [trapRows, setTrapRows]         = useState<TrapRow[]>([]);
  const [pcrRows, setPcrRows]           = useState<PCRStrikeRow[]>([]);
  const [spot, setSpot]                 = useState(0);
  const [loading, setLoading]           = useState(true);
  const [lastUpdate, setLastUpdate]     = useState<number | null>(null);
  const [error, setError]               = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      const params: Record<string, string> = { minScore: '15', limit: '60' };
      if (typeFilter !== 'ALL') params.type = typeFilter;
      if (optFilter  !== 'ALL') params.opt  = optFilter;
      const res = await axios.get<ActivityResponse>(`${API}/api/oi-pulse/activity`, { params, timeout: 6000 });
      if (res.data.success) {
        setActivityData(res.data.data);
        setCounts(res.data.counts);
        setSpot(res.data.spot);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [typeFilter, optFilter]);

  const fetchAll = useCallback(async () => {
    try {
      const [sumRes, velRes, trapRes, pcrRes] = await Promise.allSettled([
        axios.get(`${API}/api/oi-pulse/summary`, { timeout: 6000 }),
        axios.get(`${API}/api/oi-pulse/velocity`, { params: { limit: 30 }, timeout: 6000 }),
        axios.get(`${API}/api/oi-pulse/traps`, { timeout: 6000 }),
        axios.get(`${API}/api/oi-pulse/pcr-strikes`, { timeout: 6000 }),
      ]);
      if (sumRes.status  === 'fulfilled' && sumRes.value.data.success)  setSummaryData(sumRes.value.data.data);
      if (velRes.status  === 'fulfilled' && velRes.value.data.success)  setVelocityRows(velRes.value.data.data);
      if (trapRes.status === 'fulfilled' && trapRes.value.data.success) setTrapRows(trapRes.value.data.data);
      if (pcrRes.status  === 'fulfilled' && pcrRes.value.data.success)  setPcrRows(pcrRes.value.data.data);
      setLastUpdate(Date.now());
      setError(null);
    } catch {}
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  // Auto-refresh
  useEffect(() => {
    const t = setInterval(() => { fetchAll(); fetchActivity(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchAll, fetchActivity]);

  const VIEWS: { id: ViewMode; label: string }[] = [
    { id: 'activity', label: '⚡ Activity' },
    { id: 'summary',  label: '🧭 Summary' },
    { id: 'velocity', label: '🚀 Velocity' },
    { id: 'traps',    label: '🪤 Traps' },
    { id: 'pcr',      label: '📊 PCR Map' },
  ];

  // Legend
  const legend = [
    { color: '#4ADE80', label: 'Long Buildup',    def: 'Price↑ OI↑' },
    { color: '#F87171', label: 'Short Buildup',   def: 'Price↓ OI↑' },
    { color: '#FCD34D', label: 'Long Unwinding',  def: 'Price↓ OI↓' },
    { color: '#60A5FA', label: 'Short Unwinding', def: 'Price↑ OI↓' },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: 'rgba(255,255,255,0.4)' }}>
        <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>⟳</div>
        <div style={{ fontSize: 13 }}>Loading OI Pulse…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px 20px',
      height: '100%',
      overflowY: 'auto',
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      color: '#E8E8E8',
    }}>
      <style>{`
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚡ OI Pulse
            {spot > 0 && (
              <span style={{ fontSize: 13, fontWeight: 600, color: '#4ADE80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 6, padding: '2px 8px' }}>
                ₹{fmt(spot)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
            Activity Intelligence · Long/Short Buildup & Unwinding · Traps · PCR Map
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdate && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
              {new Date(lastUpdate).toLocaleTimeString('en-IN')}
            </div>
          )}
          <button onClick={() => { fetchAll(); fetchActivity(); }} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '5px 11px', color: 'rgba(255,255,255,0.6)',
            fontSize: 11, cursor: 'pointer',
          }}>↺ Refresh</button>
        </div>
      </div>

      {/* ── LEGEND ── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {legend.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{l.label}</span>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>({l.def})</span>
          </div>
        ))}
      </div>

      {/* ── COUNTS BAR ── */}
      <CountsBar counts={counts} />

      {/* ── VIEW TABS ── */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 10 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
            background: view === v.id ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: view === v.id ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.05)',
            color: view === v.id ? '#fff' : 'rgba(255,255,255,0.4)',
            transition: 'all 0.15s',
          }}>{v.label}</button>
        ))}
      </div>

      {/* ── ERROR ── */}
      {error && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#F87171' }}>
          ⚠️ {error} — backend may be starting up, data will load shortly
        </div>
      )}

      {/* ── ACTIVITY VIEW ── */}
      {view === 'activity' && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <ActivityFilterBar
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              optFilter={optFilter}   setOptFilter={setOptFilter}
            />
          </div>
          {activityData.length === 0
            ? <EmptyState icon="⚡" text="No activity signals above threshold" />
            : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {activityData.map((row, i) => (
                  <div key={`${row.strike}-${row.optionType}-${i}`} style={{ animation: `fadeSlide 0.2s ease ${i * 0.03}s both` }}>
                    <ActivityCard row={row} />
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* ── SUMMARY VIEW ── */}
      {view === 'summary' && (
        summaryData
          ? <SummaryPanel data={summaryData} />
          : <EmptyState icon="🧭" text="No summary data yet" />
      )}

      {/* ── VELOCITY VIEW ── */}
      {view === 'velocity' && (
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>
            Top strikes by absolute OI change — biggest movers this session
          </div>
          {/* FIX 4: removed spot={spot} prop */}
          <VelocityTable rows={velocityRows} />
        </div>
      )}

      {/* ── TRAPS VIEW ── */}
      {view === 'traps' && (
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>
            Strikes where price moved significantly but OI disagrees — potential false moves
          </div>
          {trapRows.length === 0
            ? <EmptyState icon="🪤" text="No traps detected — all price moves have OI confirmation" />
            : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {trapRows.map((r, i) => (
                  <div key={`${r.strike}-${r.optionType}-${i}`} style={{ animation: `fadeSlide 0.2s ease ${i * 0.04}s both` }}>
                    <TrapCard row={r} />
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* ── PCR MAP VIEW ── */}
      {view === 'pcr' && (
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>
            Per-strike PCR · CE vs PE OI · Dominant side — ★ = near ATM
          </div>
          <PCRTable rows={pcrRows} />
        </div>
      )}

      {/* ── FOOTER ── */}
      <div style={{ marginTop: 20, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, fontSize: 9, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
        📊 <strong style={{ color: 'rgba(255,255,255,0.3)' }}>Activity Classification:</strong> Long Buildup (Price↑ + OI↑) · Short Buildup (Price↓ + OI↑) · Long Unwinding (Price↓ + OI↓) · Short Unwinding (Price↑ + OI↓). Signal Score = composite of price magnitude, OI change magnitude, and volume/OI ratio. Trap detection flags strikes with significant price moves but falling OI. All data from live NSE options_data feed. Not investment advice.
      </div>
    </div>
  );
}