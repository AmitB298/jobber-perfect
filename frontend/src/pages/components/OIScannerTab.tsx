/**
 * OIScannerTab.tsx — JOBBER PRO
 * ================================
 * SEBI-SAFE OI Concentration Scanner
 * Pure data display: WHERE is OI building up?
 *
 * FIXES (v2):
 *   1. Duplicate zone cards — deduped by `${strike}-${optionType}` key
 *   2. NET GEX display — now shows in ₹ L Cr (lakh crore) for readability
 *   3. OI VEL / OI Z / SWEEPS show 0 — these fields are live from engine,
 *      no frontend change needed; the 0s are because BigMoneyEngine / OIScannerEngine
 *      aren't wired yet. Once 002_integration_patch.ts is applied, they populate.
 *      Added a PENDING badge when all are 0 so the user knows it's not broken.
 *
 * HOW TO ADD TO Dashboard.tsx:
 * ─────────────────────────────────────────────────────────────────────────
 * import OIScannerTab from './components/OIScannerTab';
 * // Tab type: add 'oiscanner'
 * // Tab button: label '🔭 OI Scanner'
 * // Tab panel: {tab === 'oiscanner' && <OIScannerTab />}
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { wsClient } from '../../services/wsClient';
import StrikeAnalyserTab from './StrikeAnalyserTab';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Greeks {
  delta: number | null; gamma: number | null; theta: number | null;
  vega:  number | null; rho:   number | null; iv:    number | null;
}

interface ChainRow {
  strike_price: number;
  ce_ltp:    number | null; pe_ltp:    number | null;
  ce_oi:     number | null; pe_oi:     number | null;
  ce_volume: number | null; pe_volume: number | null;
  ce_greeks?: Greeks;       pe_greeks?: Greeks;
}

interface OIZone {
  strike:           number;
  expiry:           string;
  optionType:       'CE' | 'PE';
  zoneType:         string;
  zoneStrength:     number;
  oi:               number;
  oiRank:           number;
  oiVelocity:       number;
  oiVelocityZ:      number;
  gexAbs:           number;
  sweepCount:       number;
  ltp:              number;
  iv:               number;
  distanceFromSpot: number;
  distancePct:      number;
}

interface OIScannerSummary {
  expiry:          string;
  spot:            number;
  dte:             number;
  maxPain:         number;
  gammaFlip:       number;
  callWall:        number;
  putWall:         number;
  netGex:          number;
  pcrOi:           number;
  atmIv:           number;
  ivr:             number;
  topCE:           OIZone | null;
  topPE:           OIZone | null;
  zones:           OIZone[];
  activeZoneCount: number;
  sweepCount15m:   number;
  updatedAt:       number;
}

interface FIIRow {
  trade_date:          string;
  fii_long_contracts:  number;
  fii_short_contracts: number;
  fii_net_position:    number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, dec = 0): string =>
  n == null ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: dec });

const fmtK = (n: number | null | undefined): string => {
  if (n == null) return '–';
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(1) + 'L';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

/**
 * FIX 2 — GEX display formatter.
 * Raw GEX from the engine is in ₹ Crore. For NIFTY full-chain,
 * this is legitimately in the lakh-crore range (~10–200 L Cr).
 * Display in L Cr for readability; fall back to K Cr for smaller values.
 */
const fmtGex = (cr: number): string => {
  const abs = Math.abs(cr);
  const sign = cr < 0 ? '-' : '+';
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1)}L Cr`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K Cr`;
  return `${sign}${abs.toFixed(0)} Cr`;
};

function strengthColor(s: number): string {
  if (s >= 75) return '#FF4560';
  if (s >= 55) return '#FF8C00';
  if (s >= 35) return '#FFD700';
  return '#4A9EFF';
}

function strengthLabel(s: number): string {
  if (s >= 75) return 'EXTREME';
  if (s >= 55) return 'HIGH';
  if (s >= 35) return 'NOTABLE';
  return 'LOW';
}

function zoneIcon(type: string): string {
  const m: Record<string, string> = {
    CALL_WALL:         '🧱',
    PUT_WALL:          '🧱',
    SWEEP_CLUSTER:     '🌊',
    OI_VELOCITY_SPIKE: '⚡',
    HIGH_OI_BUILDUP:   '📦',
    GEX_WALL:          '⚙️',
    IV_OI_DIVERGENCE:  '🔀',
  };
  return m[type] ?? '📍';
}

function zoneLabel(type: string): string {
  const m: Record<string, string> = {
    CALL_WALL:         'Call Wall',
    PUT_WALL:          'Put Wall',
    SWEEP_CLUSTER:     'Sweep Cluster',
    OI_VELOCITY_SPIKE: 'OI Velocity Spike',
    HIGH_OI_BUILDUP:   'High OI Buildup',
    GEX_WALL:          'GEX Wall',
    IV_OI_DIVERGENCE:  'IV↔OI Divergence',
  };
  return m[type] ?? type;
}

/**
 * FIX 1 — Deduplicate zones by strike+optionType.
 * The engine can occasionally emit the same strike twice (e.g. multiple
 * expiries collapsing, or a boundary condition in buildZones). This ensures
 * each unique strike/type appears at most once in the rendered card list.
 */
function dedupeZones(zones: OIZone[]): OIZone[] {
  const seen = new Set<string>();
  return zones.filter(z => {
    const key = `${z.strike}-${z.optionType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── STRENGTH METER ───────────────────────────────────────────────────────────

function StrengthMeter({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const color = strengthColor(value);
  const h = size === 'sm' ? 4 : 6;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: size === 'sm' ? 60 : 80, height: h,
        background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden',
      }}>
        <div style={{
          width: `${value}%`, height: '100%', background: color,
          borderRadius: 99, transition: 'width 0.6s ease', boxShadow: `0 0 6px ${color}80`,
        }} />
      </div>
      <span style={{ fontSize: size === 'sm' ? 10 : 11, fontWeight: 700, color, fontFamily: 'monospace' }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

// ─── ZONE CARD ────────────────────────────────────────────────────────────────

/**
 * FIX 3 — OI VEL / OI Z / SWEEPS display.
 * These come directly from the engine's OIConcentrationZone.
 * When the engine isn't wired (integration patches not applied yet),
 * all three are 0. We show a subtle PENDING indicator in that case
 * so it's visually clear the 0 is "not yet wired" not "truly zero".
 */
function ZoneCard({ zone }: { zone: OIZone }) {
  const isCE  = zone.optionType === 'CE';
  const color = isCE ? '#4A9EFF' : '#FF4560';
  const str   = zone.zoneStrength;
  const isHigh = str >= 55;

  // Are live engine fields populated?
  const engineLive = zone.oiVelocity !== 0 || zone.oiVelocityZ !== 0 || zone.sweepCount !== 0;

  return (
    <div style={{
      background:   isHigh
        ? `linear-gradient(135deg, rgba(${isCE ? '74,158,255' : '255,69,96'},0.08) 0%, rgba(0,0,0,0) 60%)`
        : 'rgba(255,255,255,0.03)',
      border:      `1px solid ${isHigh ? color + '40' : 'rgba(255,255,255,0.08)'}`,
      borderLeft:  `3px solid ${color}`,
      borderRadius: 10, padding: '12px 14px',
      position:    'relative', overflow: 'hidden',
    }}>
      {str >= 75 && (
        <div style={{
          position: 'absolute', top: 0, right: 0, width: 60, height: 60,
          background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{zoneIcon(zone.zoneType)}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: 'monospace', lineHeight: 1 }}>
              {fmt(zone.strike)}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
              {zone.optionType} · {zoneLabel(zone.zoneType)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: strengthColor(str),
            background: strengthColor(str) + '18',
            border: `1px solid ${strengthColor(str)}40`,
            borderRadius: 4, padding: '2px 7px', marginBottom: 4,
          }}>
            {strengthLabel(str)}
          </div>
          <StrengthMeter value={str} size="sm" />
        </div>
      </div>

      {/* Data grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 10px' }}>
        {[
          { label: 'OI',      value: fmtK(zone.oi) },
          { label: 'LTP',     value: `₹${fmt(zone.ltp, 1)}` },
          { label: 'IV',      value: `${fmt(zone.iv, 1)}%` },
          {
            label: 'OI Vel.',
            value: engineLive
              ? (zone.oiVelocity > 0 ? `+${fmt(zone.oiVelocity, 0)}` : fmt(zone.oiVelocity, 0))
              : '–',
            color: !engineLive ? 'rgba(255,255,255,0.2)'
              : zone.oiVelocity > 0 ? '#4ADE80'
              : zone.oiVelocity < 0 ? '#F87171'
              : undefined,
          },
          {
            label: 'OI Z',
            value: engineLive ? fmt(zone.oiVelocityZ, 2) : '–',
            color: !engineLive ? 'rgba(255,255,255,0.2)'
              : Math.abs(zone.oiVelocityZ) > 2 ? '#FFD700'
              : undefined,
          },
          // FIX 2 — GEX per-zone shown in proper scale
          { label: 'GEX', value: fmtGex(zone.gexAbs) },
          {
            label: 'Sweeps',
            value: engineLive ? String(zone.sweepCount) : '–',
            color: !engineLive ? 'rgba(255,255,255,0.2)'
              : zone.sweepCount >= 3 ? '#FF4560'
              : undefined,
          },
          { label: 'OI Rank',  value: `#${zone.oiRank}` },
          { label: 'Distance', value: `${zone.distanceFromSpot > 0 ? '+' : ''}${fmt(zone.distanceFromSpot, 0)}` },
        ].map(item => (
          <div key={item.label}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {item.label}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: item.color ?? 'rgba(255,255,255,0.85)', fontFamily: 'monospace' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* PENDING badge — shown when engine not yet wired */}
      {!engineLive && (
        <div style={{
          marginTop: 8,
          fontSize: 9, color: 'rgba(255,180,0,0.6)',
          background: 'rgba(255,180,0,0.06)',
          border: '1px solid rgba(255,180,0,0.15)',
          borderRadius: 4, padding: '3px 7px', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          ⚙ OI Vel / Z / Sweeps pending engine wire
        </div>
      )}
    </div>
  );
}

// ─── STRUCTURE PANEL ─────────────────────────────────────────────────────────

function StructurePanel({ summary }: { summary: OIScannerSummary }) {
  const spot   = summary.spot;
  const levels = [
    { label: 'Put Wall',   value: summary.putWall,              color: '#4A9EFF', note: 'Highest PE GEX' },
    { label: 'Gamma Flip', value: Math.round(summary.gammaFlip), color: '#FFD700', note: 'GEX zero-crossing' },
    { label: 'Spot',       value: Math.round(spot),              color: '#4ADE80', note: 'NIFTY LTP', isCurrent: true },
    { label: 'Max Pain',   value: summary.maxPain,               color: '#A78BFA', note: 'Min OI loss level' },
    { label: 'Call Wall',  value: summary.callWall,              color: '#FF4560', note: 'Highest CE GEX' },
  ].sort((a, b) => a.value - b.value);

  const min = Math.min(...levels.map(l => l.value)) - 50;
  const max = Math.max(...levels.map(l => l.value)) + 50;
  const range = max - min || 1;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
        Market Structure
      </div>
      <div style={{ position: 'relative', height: 60, marginBottom: 16, padding: '0 8px' }}>
        <div style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1 }} />
        {levels.map(l => {
          const pct = ((l.value - min) / range) * 100;
          return (
            <div key={l.label} style={{ position: 'absolute', left: `calc(${pct}% - 1px)`, top: l.isCurrent ? '10%' : '25%', transform: 'translateX(-50%)' }}>
              <div style={{
                width: l.isCurrent ? 10 : 2, height: l.isCurrent ? 10 : 24,
                background: l.color, borderRadius: l.isCurrent ? '50%' : 1,
                boxShadow: `0 0 8px ${l.color}`, margin: '0 auto',
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {levels.map(l => (
          <div key={l.label} style={{
            background: l.isCurrent ? l.color + '15' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${l.color}30`,
            borderRadius: 8, padding: '8px 6px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: l.color, fontFamily: 'monospace' }}>{fmt(l.value)}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{l.label}</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>{l.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── METRIC PILL ─────────────────────────────────────────────────────────────

function MetricPill({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color ?? '#fff', fontFamily: 'monospace', lineHeight: 1.2 }}>{value}</div>
      {note && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{note}</div>}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface OIScannerTabProps {
  chain?: ChainRow[];   // live chain from Dashboard SSE — passed to Strike Analyser
}

// FIX: removed unused `spotPrice` prop — spot is read from summary.spot internally
export default function OIScannerTab({ chain = [] }: OIScannerTabProps) {
  const [summary,     setSummary]     = useState<OIScannerSummary | null>(null);
  const [fiiData,     setFiiData]     = useState<FIIRow[]>([]);
  const [filterType,  setFilterType]  = useState<'ALL' | 'CE' | 'PE'>('ALL');
  const [minStrength, setMinStrength] = useState(30);
  const [loading,     setLoading]     = useState(true);
  const [wsLive,      setWsLive]      = useState(false);
  const [lastUpdate,  setLastUpdate]  = useState<number | null>(null);
  const [activeView,  setActiveView]  = useState<'zones' | 'structure' | 'fii' | 'analyser'>('zones');
  const prevTopCE = useRef<number | null>(null);
  const prevTopPE = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sRes, fRes] = await Promise.allSettled([
        axios.get<{ success: boolean; data: OIScannerSummary }>(
          'http://localhost:3001/api/oi-scanner/summary', { timeout: 5000 }
        ),
        axios.get<{ success: boolean; data: FIIRow[] }>(
          'http://localhost:3001/api/oi-scanner/fii', { timeout: 5000 }
        ),
      ]);
      if (sRes.status === 'fulfilled' && sRes.value.data.success)
        setSummary(sRes.value.data.data);
      if (fRes.status === 'fulfilled' && fRes.value.data.success)
        setFiiData(fRes.value.data.data);
      setLastUpdate(Date.now());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  useEffect(() => {
    const unsub = wsClient.on('ALL', (msg: any) => {
      if (msg.type === 'OI_SCANNER_UPDATE' && msg.payload) {
        setSummary(msg.payload);
        setWsLive(true);
        setLastUpdate(Date.now());
      }
    });
    return unsub;
  }, []);

  // FIX 1 — deduplicate before rendering
  const allZones = summary
    ? dedupeZones(
        summary.zones
          .filter(z => filterType === 'ALL' || z.optionType === filterType)
          .filter(z => z.zoneStrength >= minStrength)
      )
    : [];

  const ceZones = allZones.filter(z => z.optionType === 'CE').slice(0, 5);
  const peZones = allZones.filter(z => z.optionType === 'PE').slice(0, 5);

  const topCEChanged = summary?.topCE?.strike !== prevTopCE.current;
  const topPEChanged = summary?.topPE?.strike !== prevTopPE.current;
  useEffect(() => {
    if (summary) {
      prevTopCE.current = summary.topCE?.strike ?? null;
      prevTopPE.current = summary.topPE?.strike ?? null;
    }
  }, [summary?.topCE?.strike, summary?.topPE?.strike]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>⟳</div>
        <div style={{ fontSize: 13 }}>Loading OI Scanner…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 20px', height: '100%', overflowY: 'auto', fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace", color: '#E8E8E8' }}>
      <style>{`
        @keyframes fadeInUp   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse      { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes flashGreen { 0%,100% { background:transparent; } 40% { background:rgba(74,222,128,0.15); } }
      `}</style>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            🔭 OI Concentration Scanner
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            Where is OI building up? — factual market data display
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {wsLive && (
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4ADE80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 6, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ADE80', animation: 'pulse 1.5s infinite' }} />
              LIVE
            </div>
          )}
          {lastUpdate && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
              {new Date(lastUpdate).toLocaleTimeString('en-IN')}
            </div>
          )}
          <button onClick={fetchData} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 12px', color: 'rgba(255,255,255,0.7)', fontSize: 11, cursor: 'pointer' }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {!summary ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📡</div>
          <div>No OI scanner data yet.</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>Waiting for first 5-minute cycle from OIScannerEngine…</div>
          <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(255,255,255,0.2)' }}>
            Make sure oi-scanner-engine.ts is integrated and onFiveMinute() is wired in websocket-collector.ts
          </div>
        </div>
      ) : (
        <>
          {/* TOP STATS BAR */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
            <MetricPill label="NIFTY Spot" value={`₹${fmt(summary.spot)}`} color="#4ADE80" note="Live" />
            <MetricPill
              label="PCR OI"
              value={summary.pcrOi.toFixed(2)}
              color={summary.pcrOi > 1.2 ? '#4ADE80' : summary.pcrOi < 0.8 ? '#F87171' : '#FFD700'}
              note={summary.pcrOi > 1 ? 'PE heavy' : 'CE heavy'}
            />
            {/* FIX 2 — use fmtGex for Net GEX pill */}
            <MetricPill
              label="Net GEX"
              value={fmtGex(summary.netGex)}
              color={summary.netGex > 0 ? '#4A9EFF' : '#FF4560'}
              note={summary.netGex > 0 ? 'Pinning' : 'Expansion'}
            />
            <MetricPill label="ATM IV" value={`${fmt(summary.atmIv, 1)}%`} color="#A78BFA" />
            <MetricPill
              label="IVR"
              value={`${fmt(summary.ivr, 0)}`}
              color={summary.ivr > 60 ? '#FF4560' : summary.ivr < 30 ? '#4ADE80' : '#FFD700'}
              note="0-100 rank"
            />
            <MetricPill
              label="Active Zones"
              value={String(summary.activeZoneCount)}
              color={summary.activeZoneCount > 5 ? '#FF4560' : '#FFD700'}
              note="OI concentration"
            />
          </div>

          {/* TOP CE / TOP PE HIGHLIGHT */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {/* Top CE */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(74,158,255,0.08) 0%, rgba(0,0,0,0) 100%)',
              border: '1px solid rgba(74,158,255,0.25)', borderRadius: 12, padding: '14px 16px',
              animation: topCEChanged ? 'flashGreen 0.8s ease' : undefined,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(74,158,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                📦 Highest CE OI Concentration
              </div>
              {summary.topCE ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: '#4A9EFF', lineHeight: 1 }}>{fmt(summary.topCE.strike)}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                      OI: {fmtK(summary.topCE.oi)} · IV: {fmt(summary.topCE.iv, 1)}% · LTP: ₹{fmt(summary.topCE.ltp, 1)}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {summary.topCE.distanceFromSpot > 0 ? '+' : ''}{fmt(summary.topCE.distanceFromSpot, 0)} from spot ({fmt(summary.topCE.distancePct, 1)}%)
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#4A9EFF', marginBottom: 4 }}>{zoneLabel(summary.topCE.zoneType)}</div>
                    <StrengthMeter value={summary.topCE.zoneStrength} />
                    {summary.topCE.sweepCount > 0 && (
                      <div style={{ fontSize: 9, color: '#FF4560', marginTop: 4 }}>🌊 {summary.topCE.sweepCount} sweep{summary.topCE.sweepCount > 1 ? 's' : ''}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>No notable CE zone detected</div>
              )}
            </div>

            {/* Top PE */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(255,69,96,0.08) 0%, rgba(0,0,0,0) 100%)',
              border: '1px solid rgba(255,69,96,0.25)', borderRadius: 12, padding: '14px 16px',
              animation: topPEChanged ? 'flashGreen 0.8s ease' : undefined,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,69,96,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                📦 Highest PE OI Concentration
              </div>
              {summary.topPE ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: '#FF4560', lineHeight: 1 }}>{fmt(summary.topPE.strike)}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                      OI: {fmtK(summary.topPE.oi)} · IV: {fmt(summary.topPE.iv, 1)}% · LTP: ₹{fmt(summary.topPE.ltp, 1)}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {summary.topPE.distanceFromSpot > 0 ? '+' : ''}{fmt(summary.topPE.distanceFromSpot, 0)} from spot ({fmt(summary.topPE.distancePct, 1)}%)
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#FF4560', marginBottom: 4 }}>{zoneLabel(summary.topPE.zoneType)}</div>
                    <StrengthMeter value={summary.topPE.zoneStrength} />
                    {summary.topPE.sweepCount > 0 && (
                      <div style={{ fontSize: 9, color: '#FF4560', marginTop: 4 }}>🌊 {summary.topPE.sweepCount} sweep{summary.topPE.sweepCount > 1 ? 's' : ''}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>No notable PE zone detected</div>
              )}
            </div>
          </div>

          {/* VIEW SWITCHER + FILTERS */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {(['zones', 'structure', 'fii', 'analyser'] as const).map(v => (
              <button key={v} onClick={() => setActiveView(v)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                background:  activeView === v ? 'rgba(255,255,255,0.1)' : 'transparent',
                border:      activeView === v ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.06)',
                color:       activeView === v ? '#fff' : 'rgba(255,255,255,0.45)',
                transition:  'all 0.2s',
              }}>
                {v === 'zones' ? '📍 All Zones' : v === 'structure' ? '⚙️ Structure' : v === 'fii' ? '🏦 FII Data' : '📐 Strike Analyser'}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {(['ALL', 'CE', 'PE'] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                  background: filterType === t ? (t === 'CE' ? 'rgba(74,158,255,0.2)' : t === 'PE' ? 'rgba(255,69,96,0.2)' : 'rgba(255,255,255,0.1)') : 'transparent',
                  border: `1px solid ${filterType === t ? (t === 'CE' ? '#4A9EFF' : t === 'PE' ? '#FF4560' : 'rgba(255,255,255,0.3)') : 'rgba(255,255,255,0.1)'}`,
                  color: filterType === t ? '#fff' : 'rgba(255,255,255,0.4)',
                }}>{t}</button>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>MIN</span>
                <input type="range" min={10} max={80} step={5} value={minStrength}
                  onChange={e => setMinStrength(Number(e.target.value))}
                  style={{ width: 70, accentColor: '#4A9EFF', cursor: 'pointer' }} />
                <span style={{ fontSize: 10, color: '#4A9EFF', fontFamily: 'monospace', minWidth: 20 }}>{minStrength}</span>
              </div>
            </div>
          </div>

          {/* ZONES VIEW */}
          {activeView === 'zones' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4A9EFF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4A9EFF' }} />
                  Call Option Zones ({ceZones.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ceZones.length > 0
                    ? ceZones.map((z, i) => (
                        <div key={`${z.strike}-CE-${z.expiry}`} style={{ animation: `fadeInUp 0.3s ease ${i * 0.05}s both` }}>
                          <ZoneCard zone={z} />
                        </div>
                      ))
                    : <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                        No CE zones above strength {minStrength}
                      </div>
                  }
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4560', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4560' }} />
                  Put Option Zones ({peZones.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {peZones.length > 0
                    ? peZones.map((z, i) => (
                        <div key={`${z.strike}-PE-${z.expiry}`} style={{ animation: `fadeInUp 0.3s ease ${i * 0.05}s both` }}>
                          <ZoneCard zone={z} />
                        </div>
                      ))
                    : <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                        No PE zones above strength {minStrength}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* STRUCTURE VIEW */}
          {activeView === 'structure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <StructurePanel summary={summary} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>DTE</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: summary.dte <= 1 ? '#FF4560' : summary.dte <= 3 ? '#FFD700' : '#4ADE80' }}>{summary.dte}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>days to expiry</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Sweeps (15m)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: summary.sweepCount15m >= 5 ? '#FF4560' : '#FFD700' }}>{summary.sweepCount15m}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>sweep events</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Max Pain</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#A78BFA' }}>{fmt(summary.maxPain)}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                    {Math.abs(summary.spot - summary.maxPain) < 100 ? '≈ near spot' : summary.maxPain > summary.spot ? '↑ above spot' : '↓ below spot'}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>GEX Regime</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: summary.netGex > 0 ? '#4A9EFF' : '#FF4560', marginTop: 4 }}>
                    {summary.netGex > 0 ? 'POSITIVE' : 'NEGATIVE'}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                    {summary.netGex > 0 ? 'Dealers hedge = dampens vol' : 'Dealers amplify moves'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FII VIEW */}
          {activeView === 'fii' && (
            <div>
              <div style={{ marginBottom: 12, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                NSE Participant-wise OI data · Scraped daily at 6:15 PM IST from NSE website
              </div>
              {fiiData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.3)' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
                  <div>No FII data yet.</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Deploy 003_fii_scraper.ts and run it after 6:15 PM IST.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      {['Date', 'FII Long', 'FII Short', 'FII Net', 'Change'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'right', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fiiData.map((row, i) => {
                      const prevNet = fiiData[i + 1]?.fii_net_position;
                      const change  = prevNet != null ? row.fii_net_position - prevNet : null;
                      return (
                        <tr key={row.trade_date} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                            {new Date(row.trade_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4ADE80', fontFamily: 'monospace' }}>{fmtK(row.fii_long_contracts)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#F87171', fontFamily: 'monospace' }}>{fmtK(row.fii_short_contracts)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: row.fii_net_position > 0 ? '#4ADE80' : '#F87171', fontFamily: 'monospace' }}>
                            {row.fii_net_position > 0 ? '+' : ''}{fmtK(row.fii_net_position)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: change == null ? 'rgba(255,255,255,0.3)' : change > 0 ? '#4ADE80' : '#F87171' }}>
                            {change == null ? '–' : `${change > 0 ? '+' : ''}${fmtK(change)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* STRIKE ANALYSER VIEW */}
          {activeView === 'analyser' && (
            <StrikeAnalyserTab chain={chain} summary={summary} />
          )}

          {/* FOOTER */}
          <div style={{
            marginTop: 20, padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 8, fontSize: 9, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6,
          }}>
            📊 <strong style={{ color: 'rgba(255,255,255,0.3)' }}>Data Display Only:</strong> This scanner shows OI concentration data from publicly available NSE/BSE market feeds. All numbers are factual market observations. This is not investment advice. No buy/sell signals are generated.
          </div>
        </>
      )}
    </div>
  );
}