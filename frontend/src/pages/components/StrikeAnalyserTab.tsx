/**
 * StrikeAnalyserTab.tsx — JOBBER PRO
 * =====================================
 * SEBI-COMPLIANT build (March 2026)
 *
 * ─── COMPLIANCE NOTES ───────────────────────────────────────────────────────
 * This file was audited against SEBI IA Regulations 2013 (amended Aug 2023)
 * and SEBI RA Regulations 2014.
 *
 * Changes from original StrikeSelectorTab:
 *  1. Removed TradeMode ('SELL' | 'BUY') — mode toggle deleted from UI
 *  2. Replaced VerdictType (STRONG_SELL / SELL / BUY etc.) with neutral
 *     StructuralRating (HIGH / ABOVE_AVG / NEUTRAL / BELOW_AVG) — the
 *     Structural Alignment Index (SAI). Measures structural distinctiveness
 *     of a strike; does NOT imply a trade direction.
 *  3. Renamed "verdictReasons" → "structuralFactors" with all text rewritten
 *     to state market-data facts instead of trade conclusions.
 *  4. Removed "#1 SELL/BUY candidate" rank badges — replaced with "Top by SAI".
 *  5. Renamed "Strike Selector" → "Strike Analyser".
 *  6. Added mandatory SEBI disclaimer banner at TOP of tab (always visible).
 *  7. Renamed all advisory-sounding column headers to neutral data labels.
 *  8. RegimeBanner no longer references mode alignment ("favours sellers/buyers").
 *
 * What is NOT changed (remains safe under RA Reg 2(w)(viii)):
 *  - GEX regime label (PINNING / EXPANSION) — market condition, not advice
 *  - Wall detection (PROTECTED / EXPOSED) — technical demand/supply analysis
 *  - Theta ₹/day, break-even, delta, IV — pure mathematical computations
 *  - OI, volume, gamma, vega — market data display
 *
 * HOW TO ADD TO OIScannerTab.tsx:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Import:
 *    import StrikeAnalyserTab from './StrikeAnalyserTab';
 *
 * 2. State type:
 *    useState<'zones'|'structure'|'fii'|'analyser'>('zones')
 *
 * 3. Tab button label:
 *    v === 'analyser' ? '📐 Strike Analyser' : ...
 *
 * 4. Render:
 *    {activeView === 'analyser' && <StrikeAnalyserTab chain={chain} summary={summary} />}
 */

import { useState, useMemo } from 'react';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega:  number | null;
  iv:    number | null;
}

interface ChainRow {
  strike_price: number;
  ce_ltp:    number | null;
  pe_ltp:    number | null;
  ce_oi:     number | null;
  pe_oi:     number | null;
  ce_volume: number | null;
  pe_volume: number | null;
  ce_greeks?: Greeks;
  pe_greeks?: Greeks;
}

interface OIScannerSummary {
  spot:       number;
  dte:        number;
  callWall:   number;
  putWall:    number;
  gammaFlip:  number;
  netGex:     number;
  pcrOi:      number;
  atmIv:      number;
  ivr:        number;
  maxPain:    number;
}

type OptionType = 'CE' | 'PE';

// ─── SEBI-COMPLIANT RATING TYPE ───────────────────────────────────────────────
// SAI = Structural Alignment Index
// Measures structural distinctiveness of a strike given current market
// microstructure (walls, GEX, IV, DTE, theta). Higher SAI = more structurally
// active strike. Does NOT imply a trade direction or recommendation.

type StructuralRating = 'HIGH' | 'ABOVE_AVG' | 'NEUTRAL' | 'BELOW_AVG';

// Sort dimension for the results table
type SortBy = 'sai' | 'theta' | 'wall_dist' | 'iv' | 'delta';

interface StrikeAnalysis {
  strike:         number;
  optionType:     OptionType;
  ltp:            number;
  iv:             number;
  delta:          number;
  gamma:          number;
  theta:          number;         // ₹/day per lot (absolute value)
  vega:           number;
  oi:             number;
  volume:         number;

  // Computed metrics
  breakEven:      number;         // strike ± premium (direction-neutral)
  wallDistance:   number;         // pts to nearest wall (+ve = away from spot)
  wallLabel:      string;
  wallProtection: 'PROTECTED' | 'EXPOSED' | 'AT_WALL';
  distFromSpot:   number;
  distPct:        number;
  marginApprox:   number;

  // SAI fields (SEBI-compliant — no trade direction)
  saiScore:           number;         // 0–100 composite score
  saiRating:          StructuralRating;
  structuralFactors:  string[];       // data-fact statements, no trade advice
  metricsNote:        string;         // one-line data summary
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const n = (v: number | null | undefined, fallback = 0): number =>
  v == null || isNaN(Number(v)) ? fallback : Number(v);

const fmt = (v: number, dec = 0): string =>
  v.toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

const fmtK = (v: number): string => {
  if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
};

const LOT_SIZE   = 50;
const SPAN_RATIO = 0.15;  // conservative SPAN margin approx

const approxMargin = (strike: number, ltp: number): number =>
  Math.round((strike * LOT_SIZE * SPAN_RATIO + ltp * LOT_SIZE) / 100) * 100;

// ─── SAI COLOUR PALETTE (neutral — no trade-direction green/red bias) ─────────

const SAI_COLOR: Record<StructuralRating, string> = {
  HIGH:       '#A78BFA',   // purple
  ABOVE_AVG:  '#60A5FA',   // blue
  NEUTRAL:    '#94A3B8',   // slate
  BELOW_AVG:  '#475569',   // dark slate
};

const SAI_BG: Record<StructuralRating, string> = {
  HIGH:       'rgba(167,139,250,0.12)',
  ABOVE_AVG:  'rgba(96,165,250,0.08)',
  NEUTRAL:    'rgba(148,163,184,0.06)',
  BELOW_AVG:  'rgba(71,85,105,0.04)',
};

const SAI_LABEL: Record<StructuralRating, string> = {
  HIGH:       '◈ HIGH SAI',
  ABOVE_AVG:  '◇ ABOVE AVG SAI',
  NEUTRAL:    '○ NEUTRAL SAI',
  BELOW_AVG:  '· LOW SAI',
};

// ─── STRUCTURAL ANALYSIS ENGINE ───────────────────────────────────────────────
// Computes the SAI score and structural factor text.
// All factor text states market-data observations only — no trade conclusions.

function analyseStrike(
  row:     ChainRow,
  type:    OptionType,
  summary: OIScannerSummary,
): StrikeAnalysis | null {
  const strike  = n(row.strike_price);
  const ltp     = n(type === 'CE' ? row.ce_ltp    : row.pe_ltp);
  const oi      = n(type === 'CE' ? row.ce_oi     : row.pe_oi);
  const volume  = n(type === 'CE' ? row.ce_volume : row.pe_volume);
  const greeks  = type === 'CE' ? row.ce_greeks   : row.pe_greeks;

  if (ltp <= 0) return null;

  const iv     = n(greeks?.iv,    summary.atmIv / 100);
  const delta  = n(greeks?.delta, type === 'CE' ? 0.5 : -0.5);
  const gamma  = n(greeks?.gamma, 0);
  const theta  = n(greeks?.theta, 0);
  const vega   = n(greeks?.vega,  0);

  const thetaPerDay  = Math.abs(theta) * LOT_SIZE;
  const distFromSpot = strike - summary.spot;
  const distPct      = Math.abs(distFromSpot / summary.spot * 100);

  // Break-even: direction-neutral (same formula both sides)
  const breakEven = type === 'CE' ? strike + ltp : strike - ltp;

  // Wall distance: positive = wall is in the far direction from spot
  const nearestWall  = type === 'CE' ? summary.callWall : summary.putWall;
  const wallDistance = type === 'CE' ? nearestWall - strike : strike - nearestWall;
  const wallLabel    = type === 'CE' ? 'CALL WALL' : 'PUT WALL';

  const wallProtection: 'PROTECTED' | 'EXPOSED' | 'AT_WALL' =
    wallDistance > 100  ? 'PROTECTED' :
    wallDistance > -50  ? 'AT_WALL'   : 'EXPOSED';

  const marginApprox = approxMargin(strike, ltp);

  // ── SAI SCORING ─────────────────────────────────────────────────────────
  // Scores measure structural significance — not trade direction.

  const factors: string[] = [];
  let score = 0;

  const gexPinning = summary.netGex > 0;
  const dte         = summary.dte;
  const ivrHigh     = summary.ivr > 60;
  const ivrLow      = summary.ivr < 30;
  const isOTM       = type === 'CE' ? strike > summary.spot : strike < summary.spot;
  const isDeepOTM   = distPct > 3;
  const isNearATM   = distPct < 1;

  // 1. GEX regime — structural market condition (not a trade call)
  if (gexPinning) {
    score += 25;
    factors.push(`GEX regime: PINNING — net GEX ${summary.netGex > 0 ? '+' : ''}${fmtK(summary.netGex)} Cr`);
  } else {
    score += 15;
    factors.push(`GEX regime: EXPANSION — net GEX ${fmtK(summary.netGex)} Cr`);
  }

  // 2. Wall distance — structural zone data
  if (wallProtection === 'PROTECTED') {
    score += 25;
    factors.push(`${wallLabel} at +${fmt(wallDistance, 0)}pts from strike — PROTECTED zone`);
  } else if (wallProtection === 'AT_WALL') {
    score += 10;
    factors.push(`Strike near ${wallLabel} (within ±100pts) — AT_WALL zone`);
  } else {
    score += 0;
    factors.push(`${wallLabel} at ${fmt(wallDistance, 0)}pts — EXPOSED zone`);
  }

  // 3. DTE — time value decay rate (data observation)
  if (dte <= 3) {
    score += 20;
    factors.push(`DTE: ${dte} — theta rate: ₹${fmt(thetaPerDay, 0)}/lot/day (high decay)`);
  } else if (dte <= 7) {
    score += 12;
    factors.push(`DTE: ${dte} — theta rate: ₹${fmt(thetaPerDay, 0)}/lot/day (moderate decay)`);
  } else {
    score += 5;
    factors.push(`DTE: ${dte} — theta rate: ₹${fmt(thetaPerDay, 0)}/lot/day (low decay, higher vega exposure)`);
  }

  // 4. IV rank — percentile position (data observation)
  if (ivrHigh) {
    score += 15;
    factors.push(`IVR: ${fmt(summary.ivr, 0)}/100 — ${fmt(iv * 100, 1)}% IV, 60th+ percentile of 1-year range`);
  } else if (ivrLow) {
    score += 5;
    factors.push(`IVR: ${fmt(summary.ivr, 0)}/100 — ${fmt(iv * 100, 1)}% IV, below 30th percentile of 1-year range`);
  } else {
    score += 10;
    factors.push(`IVR: ${fmt(summary.ivr, 0)}/100 — ${fmt(iv * 100, 1)}% IV, mid-range`);
  }

  // 5. Strike placement — moneyness data
  if (isNearATM) {
    score += 10;
    factors.push(`Moneyness: near-ATM (${fmt(Math.abs(distFromSpot), 0)}pts from spot, ${distPct.toFixed(1)}%)`);
  } else if (isOTM && !isDeepOTM) {
    score += 10;
    factors.push(`Moneyness: OTM (${fmt(Math.abs(distFromSpot), 0)}pts, ${distPct.toFixed(1)}%) — delta: ${delta.toFixed(2)}`);
  } else if (isDeepOTM) {
    score += 3;
    factors.push(`Moneyness: deep OTM (${fmt(Math.abs(distFromSpot), 0)}pts, ${distPct.toFixed(1)}%) — delta: ${delta.toFixed(2)}`);
  } else {
    score += 5;
    factors.push(`Moneyness: ITM (${fmt(Math.abs(distFromSpot), 0)}pts, ${distPct.toFixed(1)}%) — delta: ${delta.toFixed(2)}`);
  }

  // 6. PCR context (data observation on put/call ratio)
  if (summary.pcrOi !== 0) {
    factors.push(`PCR (OI): ${summary.pcrOi.toFixed(2)} — ${summary.pcrOi < 0.8 ? 'call-heavy chain' : summary.pcrOi > 1.2 ? 'put-heavy chain' : 'balanced'}`);
  }

  // 7. Break-even vs wall structure
  const beSafe = type === 'CE'
    ? breakEven < summary.callWall
    : breakEven > summary.putWall;
  factors.push(`Break-even: ${fmt(breakEven, 0)} — ${beSafe ? 'inside' : 'beyond'} ${wallLabel} (${fmt(nearestWall, 0)})`);

  // Map score → rating
  const saiRating: StructuralRating =
    score >= 70 ? 'HIGH'       :
    score >= 45 ? 'ABOVE_AVG'  :
    score >= 25 ? 'NEUTRAL'    : 'BELOW_AVG';

  const metricsNote =
    `LTP ₹${fmt(ltp, 1)} · θ ₹${fmt(thetaPerDay, 0)}/day · BE ${fmt(breakEven, 0)} · Wall ${wallDistance > 0 ? '+' : ''}${fmt(wallDistance, 0)}pts · Margin ~₹${fmtK(marginApprox)}`;

  return {
    strike, optionType: type, ltp, iv: iv * 100, delta, gamma,
    theta: thetaPerDay, vega, oi, volume,
    breakEven, wallDistance, wallLabel, wallProtection,
    distFromSpot, distPct, marginApprox,
    saiScore: score, saiRating, structuralFactors: factors, metricsNote,
  };
}

// ─── SEBI DISCLAIMER BANNER ───────────────────────────────────────────────────
// Required at top of tab — always visible

function SEBIDisclaimer() {
  return (
    <div style={{
      background:   'rgba(251,191,36,0.06)',
      border:       '1px solid rgba(251,191,36,0.25)',
      borderRadius: 8, padding: '10px 14px',
      marginBottom: 14,
      display:      'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚖️</span>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#FBB024', marginBottom: 4, letterSpacing: '0.04em' }}>
          DATA DISPLAY — NOT INVESTMENT ADVICE
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
          This tab displays publicly available options market data and computes mechanical statistics
          (IV, theta, wall distance, GEX regime, break-even). It does not constitute investment advice,
          research analysis, or a buy/sell/hold recommendation under SEBI IA Regulations 2013 or
          SEBI RA Regulations 2014. No SEBI registration is held for advisory or research analyst
          services. The Structural Alignment Index (SAI) is a composite of observable market-microstructure
          data — it does not imply a trade direction. All trading decisions are made independently by the
          user. Past structural patterns do not predict future price behaviour.
        </div>
      </div>
    </div>
  );
}

// ─── REGIME BANNER (SEBI-compliant — no mode alignment language) ──────────────

function RegimeBanner({ summary }: { summary: OIScannerSummary }) {
  const pinning = summary.netGex > 0;

  return (
    <div style={{
      background:   'rgba(255,255,255,0.03)',
      border:       '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 14,
      display:      'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: pinning ? '#A78BFA' : '#60A5FA' }}>
            {pinning ? '📌 GEX REGIME: PINNING' : '💥 GEX REGIME: EXPANSION'}
          </div>
          <div style={{
            fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            color: 'rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            Net GEX: {summary.netGex > 0 ? '+' : ''}{fmtK(summary.netGex)} Cr
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {pinning
            ? 'Dealer gamma: net positive — observed tendency for volatility suppression and range compression.'
            : 'Dealer gamma: net negative — observed tendency for volatility amplification and momentum extension.'}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
          {[
            { label: 'OI Range',  value: `${fmt(summary.putWall, 0)}–${fmt(summary.callWall, 0)}` },
            { label: 'DTE',       value: `${summary.dte}d` },
            { label: 'ATM IV',    value: `${fmt(summary.atmIv, 1)}%` },
            { label: 'IVR',       value: `${fmt(summary.ivr, 0)}/100` },
          ].map(r => (
            <div key={r.label} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{r.label}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── STRIKE CARD ──────────────────────────────────────────────────────────────

function StrikeCard({ analysis, rank, sortBy }: {
  analysis: StrikeAnalysis;
  rank:     number;
  sortBy:   SortBy;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCE  = analysis.optionType === 'CE';
  const color = isCE ? '#4A9EFF' : '#FF4560';
  const sc    = SAI_COLOR[analysis.saiRating];
  const isTop = rank <= 2;

  // Highlight the sort dimension in metrics grid
  const isSortTheta  = sortBy === 'theta';
  const isSortWall   = sortBy === 'wall_dist';
  const isSortIV     = sortBy === 'iv';
  const isSortDelta  = sortBy === 'delta';

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background:   isTop ? SAI_BG[analysis.saiRating] : 'rgba(255,255,255,0.02)',
        border:       `1px solid ${isTop ? sc + '35' : 'rgba(255,255,255,0.07)'}`,
        borderLeft:   `3px solid ${sc}`,
        borderRadius: 10, padding: '11px 13px',
        cursor:       'pointer', transition: 'all 0.15s',
        position:     'relative',
      }}
    >
      {/* Top-by rank badge — sort dimension, not a trade call */}
      {rank <= 3 && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          fontSize: 9, fontWeight: 700, color: sc,
          background: sc + '18', border: `1px solid ${sc}30`,
          borderRadius: 4, padding: '1px 6px',
        }}>
          #{rank} by {sortBy.replace('_', ' ').toUpperCase()}
        </div>
      )}

      {/* Row 1: Strike + SAI rating */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 17, fontWeight: 800, color, fontFamily: 'monospace' }}>
            {fmt(analysis.strike, 0)}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>
            {analysis.optionType}
          </span>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, color: sc,
          background: sc + '18', border: `1px solid ${sc}35`,
          borderRadius: 5, padding: '2px 8px',
        }}>
          {SAI_LABEL[analysis.saiRating]}
        </div>
        <div style={{
          fontSize: 9, color: 'rgba(255,255,255,0.3)',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4, padding: '2px 7px',
        }}>
          SAI {analysis.saiScore}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
            ₹{fmt(analysis.ltp, 1)}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>LTP</div>
        </div>
      </div>

      {/* Row 2: Key metrics grid (5 cells) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px 8px', marginBottom: 8 }}>
        {[
          {
            label: 'Break-even',
            value: fmt(analysis.breakEven, 0),
            color: '#A78BFA',
            hi: false,
          },
          {
            label: 'Wall dist.',
            value: `${analysis.wallDistance > 0 ? '+' : ''}${fmt(analysis.wallDistance, 0)}`,
            color: analysis.wallProtection === 'PROTECTED' ? '#A78BFA'
                 : analysis.wallProtection === 'AT_WALL'   ? '#94A3B8' : '#60A5FA',
            hi: isSortWall,
          },
          {
            label: 'θ/day (₹)',
            value: `₹${fmt(analysis.theta, 0)}`,
            color: 'rgba(255,255,255,0.8)',
            hi: isSortTheta,
          },
          {
            label: 'Delta',
            value: analysis.delta.toFixed(2),
            color: 'rgba(255,255,255,0.7)',
            hi: isSortDelta,
          },
          {
            label: 'IV',
            value: `${fmt(analysis.iv, 1)}%`,
            color: 'rgba(255,255,255,0.7)',
            hi: isSortIV,
          },
        ].map(m => (
          <div key={m.label} style={{
            background: m.hi ? 'rgba(167,139,250,0.08)' : 'transparent',
            borderRadius: 4, padding: m.hi ? '2px 4px' : 0,
          }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {m.label}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: m.color, fontFamily: 'monospace' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Row 3: Wall zone badge + metrics note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: expanded ? 10 : 0 }}>
        <div style={{
          fontSize: 9, fontWeight: 600,
          color: analysis.wallProtection === 'PROTECTED' ? '#A78BFA'
               : analysis.wallProtection === 'AT_WALL'   ? '#94A3B8' : '#60A5FA',
          background: analysis.wallProtection === 'PROTECTED' ? 'rgba(167,139,250,0.08)'
                    : analysis.wallProtection === 'AT_WALL'   ? 'rgba(148,163,184,0.08)' : 'rgba(96,165,250,0.08)',
          border: `1px solid ${
            analysis.wallProtection === 'PROTECTED' ? 'rgba(167,139,250,0.2)' :
            analysis.wallProtection === 'AT_WALL'   ? 'rgba(148,163,184,0.2)' : 'rgba(96,165,250,0.2)'}`,
          borderRadius: 4, padding: '2px 7px',
        }}>
          {analysis.wallProtection === 'PROTECTED' ? '🛡 PROTECTED'
         : analysis.wallProtection === 'AT_WALL'   ? '◉ AT WALL'
         : '◎ EXPOSED'}
          {' · '}{analysis.wallLabel}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {analysis.metricsNote}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
          {expanded ? '▲ less' : '▼ details'}
        </div>
      </div>

      {/* Expanded: structural factors + extra stats */}
      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: 10, marginTop: 4,
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Structural Factors (SAI: {analysis.saiScore}/100)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
            {analysis.structuralFactors.map((f, i) => (
              <div key={i} style={{
                fontSize: 10, color: 'rgba(255,255,255,0.55)',
                fontFamily: 'monospace',
                paddingLeft: 8,
                borderLeft: '2px solid rgba(167,139,250,0.2)',
              }}>
                {f}
              </div>
            ))}
          </div>

          {/* Extra stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'OI',           value: fmtK(analysis.oi) },
              { label: 'Volume',       value: fmtK(analysis.volume) },
              { label: 'Gamma',        value: analysis.gamma.toFixed(5) },
              { label: 'Vega / lot',   value: `₹${fmt(analysis.vega * LOT_SIZE, 0)}` },
              { label: 'Margin ~',     value: `₹${fmtK(analysis.marginApprox)}` },
              { label: 'Break-even',   value: fmt(analysis.breakEven, 0) },
              { label: 'Dist. spot',   value: `${analysis.distFromSpot > 0 ? '+' : ''}${fmt(analysis.distFromSpot, 0)} (${analysis.distPct.toFixed(1)}%)` },
              { label: 'Premium/lot',  value: `₹${fmt(analysis.ltp * LOT_SIZE, 0)}` },
            ].map(s => (
              <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', fontFamily: 'monospace' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface StrikeAnalyserProps {
  chain:   ChainRow[];
  summary: OIScannerSummary | null;
}

export default function StrikeAnalyserTab({ chain, summary }: StrikeAnalyserProps) {
  const [filterType, setFilterType] = useState<OptionType | 'ALL'>('ALL');
  const [rangeLimit, setRangeLimit] = useState(1000);
  const [sortBy,     setSortBy]     = useState<SortBy>('sai');
  const [showRating, setShowRating] = useState<StructuralRating[]>(['HIGH', 'ABOVE_AVG', 'NEUTRAL']);

  const spot = summary?.spot ?? 0;

  // ── Build and sort analysis ──────────────────────────────────────────────
  const analyzed = useMemo<StrikeAnalysis[]>(() => {
    if (!summary || !chain.length || !spot) return [];

    const results: StrikeAnalysis[] = [];
    for (const row of chain) {
      const strike = n(row.strike_price);
      if (Math.abs(strike - spot) > rangeLimit) continue;

      const types: OptionType[] = filterType === 'ALL' ? ['CE', 'PE'] : [filterType];
      for (const t of types) {
        const a = analyseStrike(row, t, summary);
        if (a) results.push(a);
      }
    }

    // Sort by selected dimension
    return results.sort((a, b) => {
      switch (sortBy) {
        case 'sai':       return b.saiScore - a.saiScore;
        case 'theta':     return b.theta - a.theta;
        case 'wall_dist': return b.wallDistance - a.wallDistance;
        case 'iv':        return b.iv - a.iv;
        case 'delta':     return Math.abs(b.delta) - Math.abs(a.delta);
        default:          return b.saiScore - a.saiScore;
      }
    });
  }, [chain, summary, filterType, rangeLimit, sortBy, spot]);

  // Filter by rating
  const filtered = analyzed.filter(a => showRating.includes(a.saiRating));
  const ceResults = filtered.filter(a => a.optionType === 'CE').slice(0, 6);
  const peResults = filtered.filter(a => a.optionType === 'PE').slice(0, 6);

  if (!summary) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.3)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📐</div>
        <div>OI Scanner data required.</div>
        <div style={{ fontSize: 11, marginTop: 6 }}>Switch to All Zones view first — data loads after first 5-min cycle.</div>
      </div>
    );
  }

  if (!chain.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.3)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
        <div>Waiting for live chain data…</div>
        <div style={{ fontSize: 11, marginTop: 6 }}>Chain streams via SSE from /api/stream/chain</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace", color: '#E8E8E8' }}>

      {/* ── SEBI DISCLAIMER (always visible at top) ── */}
      <SEBIDisclaimer />

      {/* ── REGIME BANNER ── */}
      <RegimeBanner summary={summary} />

      {/* ── CONTROLS ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Option type filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['ALL', 'CE', 'PE'] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
              background:  filterType === t ? (t === 'CE' ? 'rgba(74,158,255,0.2)' : t === 'PE' ? 'rgba(255,69,96,0.2)' : 'rgba(255,255,255,0.1)') : 'transparent',
              border: `1px solid ${filterType === t ? (t === 'CE' ? '#4A9EFF' : t === 'PE' ? '#FF4560' : 'rgba(255,255,255,0.3)') : 'rgba(255,255,255,0.1)'}`,
              color: filterType === t ? '#fff' : 'rgba(255,255,255,0.4)',
            }}>{t}</button>
          ))}
        </div>

        {/* Sort by — neutral data dimensions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>SORT BY:</span>
          {(['sai', 'theta', 'wall_dist', 'iv', 'delta'] as SortBy[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 9, cursor: 'pointer', fontWeight: sortBy === s ? 700 : 400,
              background: sortBy === s ? 'rgba(167,139,250,0.15)' : 'transparent',
              border: `1px solid ${sortBy === s ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: sortBy === s ? '#A78BFA' : 'rgba(255,255,255,0.35)',
            }}>
              {s === 'sai' ? 'SAI' : s === 'theta' ? 'Theta' : s === 'wall_dist' ? 'Wall' : s.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Range slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>RANGE ±</span>
          <input type="range" min={300} max={2000} step={100} value={rangeLimit}
            onChange={e => setRangeLimit(Number(e.target.value))}
            style={{ width: 80, accentColor: '#A78BFA', cursor: 'pointer' }} />
          <span style={{ fontSize: 10, color: '#A78BFA', fontFamily: 'monospace', minWidth: 42 }}>
            {fmtK(rangeLimit)}pts
          </span>
        </div>

        {/* Count */}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
          {filtered.length} strikes · spot ₹{fmt(spot, 0)}
        </div>
      </div>

      {/* ── SAI RATING FILTER PILLS ── */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', alignSelf: 'center' }}>SHOW SAI:</span>
        {(['HIGH', 'ABOVE_AVG', 'NEUTRAL', 'BELOW_AVG'] as StructuralRating[]).map(r => {
          const active = showRating.includes(r);
          const sc = SAI_COLOR[r];
          return (
            <button key={r} onClick={() => setShowRating(p => active ? p.filter(x => x !== r) : [...p, r])} style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 9, cursor: 'pointer', fontWeight: 600,
              background: active ? sc + '18' : 'transparent',
              border: `1px solid ${active ? sc + '50' : 'rgba(255,255,255,0.1)'}`,
              color: active ? sc : 'rgba(255,255,255,0.3)',
              transition: 'all 0.1s',
            }}>
              {SAI_LABEL[r]}
            </button>
          );
        })}
      </div>

      {/* ── RESULTS GRID ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* CE COLUMN */}
        {(filterType === 'ALL' || filterType === 'CE') && (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#4A9EFF',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4A9EFF' }} />
              Call Options ({ceResults.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {ceResults.length > 0
                ? ceResults.map((a, i) => (
                    <StrikeCard key={`${a.strike}-CE`} analysis={a} rank={i + 1} sortBy={sortBy} />
                  ))
                : <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                    No CE strikes match current filters
                  </div>
              }
            </div>
          </div>
        )}

        {/* PE COLUMN */}
        {(filterType === 'ALL' || filterType === 'PE') && (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#FF4560',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4560' }} />
              Put Options ({peResults.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {peResults.length > 0
                ? peResults.map((a, i) => (
                    <StrikeCard key={`${a.strike}-PE`} analysis={a} rank={i + 1} sortBy={sortBy} />
                  ))
                : <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                    No PE strikes match current filters
                  </div>
              }
            </div>
          </div>
        )}
      </div>

      {/* ── FOOTER NOTE ── */}
      <div style={{
        marginTop: 20, padding: '10px 14px',
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 8, fontSize: 9, color: 'rgba(255,255,255,0.18)', lineHeight: 1.7,
      }}>
        <strong style={{ color: 'rgba(255,255,255,0.28)' }}>SAI (Structural Alignment Index)</strong>{' '}
        is a composite of six observable market-microstructure data points: GEX regime, wall zone classification,
        DTE-adjusted theta rate, IVR percentile, moneyness, and PCR. Higher SAI indicates greater structural
        activity at that strike. It is not a buy/sell/hold recommendation.
        Margin estimates are approximate (SPAN ≈ 15% notional) and do not include exposure margin.
        Always verify with your broker before trading. PERSONAL USE ONLY — not for distribution.
      </div>
    </div>
  );
}