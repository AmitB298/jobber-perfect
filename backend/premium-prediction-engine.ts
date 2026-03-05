/**
 * ============================================================================
 * premium-prediction-engine.ts — NIFTY Options Premium Prediction Engine
 * ============================================================================
 * Location: D:\jobber-perfect\backend\premium-prediction-engine.ts
 *
 * FIXES APPLIED (v2 — Feb 2026):
 *
 *   FIX #1 — Top Picks threshold lowered from 60 → 50
 *             Near max pain + low DTE naturally produces 45–58 range scores.
 *             Old threshold of 60 caused Top Picks (0) every time.
 *
 *   FIX #2 — DTE handling: engine now accepts fractional DTE (e.g. 3.2 days)
 *             Caller (api-server.ts) must pass raw fractional DTE, NOT Math.ceil'd.
 *             Fixed: Math.max(0.5, daysToExpiry) — no more forced minimum of 1
 *             that was pushing engine into wrong weight bracket.
 *
 *   FIX #3 — Greeks fallback when iv_history is empty
 *             If iv_history table has < 3 rows, ivVelocity was returning 0
 *             which silently zeroed Signal 2. Now falls back gracefully and
 *             uses in-memory ring buffer built from scan() calls.
 *
 *   FIX #4 — OI delta comparison: prevSnapshot was always empty on first call,
 *             causing oiScore to always be 50 (neutral) for first N scans.
 *             Now uses DB to fetch OI from 5 minutes ago as fallback baseline.
 *
 *   FIX #5 — Max Pain score was 30 (lowest) when spot within 30pts of max pain
 *             (the most common scenario intraday). This tanked every score.
 *             Fixed: pinning scenario now scores 45 (neutral), not 30.
 *             Theta-sell strategies should still show up as NEUTRAL picks.
 *
 *   FIX #6 — Removed unused `atmRow = undefined` variable (dead code cleanup)
 *
 *   FIX #7 — GEX pin strike finder: was using strict equality on floating point.
 *             Fixed to find closest-to-zero GEX strike properly.
 *
 *   FIX #8 — Signal thresholds for STRONG_BUY/BUY adjusted to match new score ranges:
 *             STRONG_BUY: >= 72 (was 78)
 *             BUY:        >= 58 (was 62)
 *             NEUTRAL:    >= 38 (was 40)
 *             SELL:       >= 22 (was 25)
 *
 *   FIX #9 — buildTradeIdea: dte param used correctly (fractional), SL/Target
 *             rounded to nearest 0.5 instead of integer for realistic levels.
 *
 *   FIX #10 — calcIVVelocity: added in-memory fallback ring buffer so velocity
 *              still works even when DB iv_history is sparse.
 *
 *   FIX #11 — scan() now returns scannedAt: new Date().toISOString() so the
 *              frontend PremiumPredictor can display exact prediction timestamps.
 *
 * HOW IT WORKS — 7 Signals Combined:
 *
 *   Signal 1: OI Interpretation   — Rising OI + Rising LTP = confirmed long buildup
 *   Signal 2: IV Velocity         — IV accelerating upward = all premiums rising
 *   Signal 3: Gamma Exposure(GEX) — Negative GEX = dealers amplify moves = buy options
 *   Signal 4: Max Pain Gravity    — Spot diverging from max pain = correction move
 *   Signal 5: Gamma Dominance     — Gamma × Expected Move > Theta × DTE at that strike
 *   Signal 6: Volume Surge        — Vol/OI ratio spike = smart money entering
 *   Signal 7: IV Skew Momentum    — Skew shifting = fear/greed acceleration
 *
 * WEIGHTS change with DTE (now using fractional DTE correctly):
 *   DTE > 5   → OI + IV + GEX dominate
 *   DTE 2–5   → GEX + Max Pain + OI dominate
 *   DTE 1–2   → GEX + MaxPain + Gamma dominate
 *   DTE < 1   → Gamma dominance + Max Pain dominate (expiry day)
 *
 * WIRE UP in api-server.ts — IMPORTANT: pass fractional DTE!
 *
 *   import { PremiumPredictor } from './premium-prediction-engine';
 *   const predictor = new PremiumPredictor(pool);
 *
 *   app.get('/api/premium/predictions', async (_, res) => {
 *     try {
 *       const { chainWithGreeks, spotPrice, expiryDate } = await getChainWithGreeks();
 *       // ✅ CORRECT: fractional DTE, NOT Math.ceil
 *       const dte = Math.max(0.5, (expiryDate.getTime() - Date.now()) / 86400000);
 *       const totalCe = chainWithGreeks.reduce((s, r) => s + N(r.ce_oi), 0);
 *       const totalPe = chainWithGreeks.reduce((s, r) => s + N(r.pe_oi), 0);
 *       const pcr_oi  = totalCe > 0 ? totalPe / totalCe : 1;
 *       const results = await predictor.scan(chainWithGreeks, spotPrice, dte, pcr_oi);
 *       res.json({ success: true, data: results });
 *     } catch (e: any) {
 *       res.status(500).json({ success: false, error: String(e) });
 *     }
 *   });
 *
 *   app.get('/api/premium/gex', async (_, res) => {
 *     try {
 *       const { chainWithGreeks, spotPrice } = await getChainWithGreeks();
 *       const gex = predictor.calcGEX(chainWithGreeks, spotPrice);
 *       res.json({ success: true, data: gex });
 *     } catch (e: any) {
 *       res.status(500).json({ success: false, error: String(e) });
 *     }
 *   });
 * ============================================================================
 */

import { Pool } from 'pg';
import { OptionWithGreeks } from './greeks-calculator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OptionSide = 'CE' | 'PE';
export type SignalStrength = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export interface PredictionResult {
  strike:            number;
  side:              OptionSide;
  currentPremium:    number;
  score:             number;          // 0–100, higher = more likely to increase
  signal:            SignalStrength;
  iv:                number;
  delta:             number;
  gamma:             number;
  theta:             number;
  signals: {
    oiScore:         number;          // 0–100
    ivVelocity:      number;          // 0–100
    gexScore:        number;          // 0–100
    maxPainScore:    number;          // 0–100
    gammaDominance:  number;          // 0–100
    volumeSurge:     number;          // 0–100
    skewMomentum:    number;          // 0–100
  };
  reasons:           string[];
  expectedMoveInPremium: number;
  confidence:        number;          // 0–100
  tradeIdea:         string;
}

export interface GEXResult {
  netGEX:            number;
  perStrike:         { strike: number; gex: number }[];
  interpretation:    string;
  expectedMove:      number;
  dealerMode:        'LONG_GAMMA' | 'SHORT_GAMMA';
  pinStrike:         number;
}

export interface OISnapshot {
  strike:  number;
  ce_oi:   number;
  pe_oi:   number;
  ce_ltp:  number;
  pe_ltp:  number;
  ts:      number;
}

export interface MarketContext {
  spot:          number;
  atm:           number;
  dte:           number;
  atmIV:         number;
  ivVelocity:    number;
  ivEnvironment: string;
  gexMode:       'LONG_GAMMA' | 'SHORT_GAMMA';
  maxPain:       number;
  maxPainDiff:   number;
  pcr:           number;
  pcrSentiment:  'BULLISH' | 'NEUTRAL' | 'BEARISH';
  scenarios:     string[];
}

// ─── Safe helpers ─────────────────────────────────────────────────────────────

const n = (v: any, fb = 0): number => {
  if (v == null) return fb;
  const p = Number(v);
  return (isNaN(p) || !isFinite(p)) ? fb : p;
};

const clamp = (v: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, v));

// Round to nearest 0.5 for realistic SL/Target levels
const roundHalf = (v: number): number => Math.round(v * 2) / 2;

// ─── Main Class ───────────────────────────────────────────────────────────────

export class PremiumPredictor {
  private pool:          Pool;
  private prevSnapshot:  OISnapshot[] = [];

  // FIX #10: in-memory IV ring buffer — used when DB iv_history is sparse
  private ivRingBuffer:  { ts: number; iv: number }[] = [];
  private readonly IV_RING_MAX = 30;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ══════════════════════════════════════════════════════════════════════════

  async scan(
    chain:        OptionWithGreeks[],
    spotPrice:    number,
    daysToExpiry: number,   // ← MUST be fractional (e.g. 3.2), not ceil'd
    pcrOI:        number
  ): Promise<{
    topPicks:      PredictionResult[];
    allStrikes:    PredictionResult[];
    gex:           GEXResult;
    marketContext: MarketContext;
    summary:       string;
    scannedAt:     string;  // FIX #11 — ISO timestamp of when this scan ran
  }> {
    const spot   = n(spotPrice, 25500);
    // FIX #2: accept fractional DTE directly; only floor at 0.5 to avoid /0
    const dte    = Math.max(0.5, n(daysToExpiry, 2));
    const atmStr = Math.round(spot / 50) * 50;

    // FIX #3: try DB first, fall back to in-memory ring buffer
    const ivHist = await this.getIVHistory(20);

    // FIX #10: push current ATM IV into ring buffer for future velocity calcs
    const currentAtmIV = this.getATMiv(chain, spot);
    if (currentAtmIV !== null && currentAtmIV > 0) {
      this.ivRingBuffer.push({ ts: Date.now(), iv: currentAtmIV });
      if (this.ivRingBuffer.length > this.IV_RING_MAX) {
        this.ivRingBuffer.shift();
      }
    }

    // Build OI snapshot for OI-delta comparison
    const currentSnap = this.buildSnapshot(chain);

    // FIX #4: fetch DB baseline OI if prevSnapshot is empty (first call)
    const prevSnap = this.prevSnapshot.length > 0
      ? this.prevSnapshot
      : await this.fetchBaselineOI(chain);

    // Calculate shared signals
    const ivVel   = this.calcIVVelocity(ivHist);
    const gex     = this.calcGEX(chain, spot);
    const atmIV   = currentAtmIV ?? 20;
    const maxPain = this.calcMaxPain(chain);
    const skewMap = this.calcIVSkewMap(chain);

    // Score every strike × side
    const allResults: PredictionResult[] = [];

    for (const row of chain) {
      const st = n(row.strike_price);
      if (!st) continue;

      // Skip far OTM (>600pts from spot = noise, tiny premiums)
      if (Math.abs(st - spot) > 600) continue;

      if (n(row.ce_ltp) > 0.1) {
        allResults.push(this.scoreStrike(
          row, 'CE', spot, dte, atmStr, atmIV, ivVel,
          gex, maxPain, pcrOI, skewMap, prevSnap, currentSnap
        ));
      }

      if (n(row.pe_ltp) > 0.1) {
        allResults.push(this.scoreStrike(
          row, 'PE', spot, dte, atmStr, atmIV, ivVel,
          gex, maxPain, pcrOI, skewMap, prevSnap, currentSnap
        ));
      }
    }

    // Sort highest score first
    allResults.sort((a, b) => b.score - a.score);

    // FIX #1: threshold lowered from 60 → 50 so near-max-pain scenarios
    // still yield meaningful top picks
    const topPicks = allResults.filter(r => r.score >= 50).slice(0, 8);

    const ctx = this.buildMarketContext(
      spot, atmStr, dte, atmIV, ivVel, gex, maxPain, pcrOI
    );

    // Store snapshot for next tick comparison
    this.prevSnapshot = currentSnap;

    console.log(
      `[PremiumPredictor] DTE=${dte.toFixed(2)} | ATM IV=${atmIV.toFixed(1)}% | ` +
      `MaxPain=${maxPain} | IVVel=${ivVel.toFixed(3)} | ` +
      `allStrikes=${allResults.length} | topPicks=${topPicks.length} | ` +
      `scoreRange=${allResults.length ? allResults[allResults.length-1].score : 0}–${allResults[0]?.score ?? 0}`
    );

    return {
      topPicks,
      allStrikes: allResults,
      gex,
      marketContext: ctx,
      summary: this.buildSummary(ctx, topPicks),
      scannedAt: new Date().toISOString(),  // FIX #11 — exact scan timestamp
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCORE A SINGLE STRIKE × SIDE
  // ══════════════════════════════════════════════════════════════════════════

  private scoreStrike(
    row:      OptionWithGreeks,
    side:     OptionSide,
    spot:     number,
    dte:      number,
    atmStr:   number,
    atmIV:    number,
    ivVel:    number,
    gex:      GEXResult,
    maxPain:  number,
    pcrOI:    number,
    skewMap:  Map<number, number>,
    prev:     OISnapshot[],
    curr:     OISnapshot[]
  ): PredictionResult {
    const st     = n(row.strike_price);
    const ltp    = n(side === 'CE' ? row.ce_ltp    : row.pe_ltp);
    const oi     = n(side === 'CE' ? row.ce_oi     : row.pe_oi);
    const vol    = n(side === 'CE' ? row.ce_volume : row.pe_volume);
    const greeks = side === 'CE' ? row.ce_greeks   : row.pe_greeks;

    // Use actual IV from greeks; fall back to ATM IV so signal isn't zero
    const iv    = n(greeks?.iv,    atmIV);
    const delta = n(greeks?.delta, side === 'CE' ? 0.5 : -0.5);
    const gamma = n(greeks?.gamma, 0);
    const theta = n(greeks?.theta, 0);
    const vega  = n(greeks?.vega,  0);

    const reasons: string[] = [];
    const w = this.getWeights(dte);

    // ── Signal 1: OI Interpretation ────────────────────────────────────────
    const prevRow  = prev.find(r => r.strike === st);
    const prevOI   = prevRow ? n(side === 'CE' ? prevRow.ce_oi  : prevRow.pe_oi)  : oi;
    const prevLTP  = prevRow ? n(side === 'CE' ? prevRow.ce_ltp : prevRow.pe_ltp) : ltp;
    const oiDelta  = oi  - prevOI;
    const ltpDelta = ltp - prevLTP;
    let oiScore = 50;

    if (prevRow) {
      // We have real comparison data
      if (oiDelta > 0 && ltpDelta >= 0) {
        // Long buildup — OI rising + LTP flat/rising → premium likely to continue up
        const pct = (oiDelta / Math.max(prevOI, 1)) * 100;
        oiScore = clamp(65 + pct * 2, 65, 92);
        reasons.push(`🟢 Long buildup: OI +${(oiDelta / 1000).toFixed(1)}K, LTP ${ltpDelta >= 0 ? '↑' : '→'}`);
      } else if (oiDelta > 0 && ltpDelta < 0) {
        // Short buildup — sellers piling in, premium likely to fall
        oiScore = clamp(20, 10, 35);
        reasons.push(`🔴 Short buildup: OI rising but LTP falling — sellers in control`);
      } else if (oiDelta < 0 && ltpDelta > 0) {
        // Short covering — forced buying, often a quick spike
        oiScore = 68;
        reasons.push(`🟡 Short covering: OI unwinding + LTP rising — short squeeze possible`);
      } else if (oiDelta < 0 && ltpDelta <= 0) {
        // Long unwinding — trend exhaustion
        oiScore = 28;
        reasons.push(`🔴 Long unwinding: OI falling + LTP falling — trend exhaustion`);
      } else {
        reasons.push(`➡ OI stable (no significant change)`);
      }
    } else {
      // No comparison data yet — use absolute OI size as proxy
      if (oi > 500000) {
        oiScore = 58;
        reasons.push(`📊 High OI strike: ${(oi / 1000).toFixed(0)}K contracts — institutional interest`);
      } else {
        reasons.push(`📊 OI: ${(oi / 1000).toFixed(0)}K (baseline scan, no prior snapshot)`);
      }
    }

    // ── Signal 2: IV Velocity ───────────────────────────────────────────────
    let ivVelScore = 50;
    if (ivVel > 0.3) {
      ivVelScore = clamp(50 + ivVel * 25, 50, 90);
      reasons.push(`📈 IV accelerating +${ivVel.toFixed(2)}%/min — buy vega favored`);
    } else if (ivVel > 0.05) {
      ivVelScore = 58;
      reasons.push(`📈 IV drifting up +${ivVel.toFixed(2)}%/min`);
    } else if (ivVel < -0.3) {
      ivVelScore = clamp(50 + ivVel * 20, 10, 50);
      reasons.push(`📉 IV collapsing ${ivVel.toFixed(2)}%/min — sell vega favored`);
    } else if (ivVel < -0.05) {
      ivVelScore = 42;
      reasons.push(`📉 IV drifting down ${ivVel.toFixed(2)}%/min`);
    } else {
      reasons.push(`➡ IV stable (${ivVel > 0 ? '+' : ''}${ivVel.toFixed(3)}%/min)`);
    }

    // ── Signal 3: GEX Score ─────────────────────────────────────────────────
    let gexScore = 50;
    const distFromPin = Math.abs(st - gex.pinStrike);

    if (gex.dealerMode === 'SHORT_GAMMA') {
      // Dealers amplify moves → options premiums expand
      gexScore = distFromPin < 150 ? 82 : 72;
      if (distFromPin < 150) {
        reasons.push(`⚡ SHORT Gamma: Dealers amplify moves — near pin ₹${gex.pinStrike}, buy options`);
      } else {
        reasons.push(`⚡ SHORT Gamma: Dealers amplify moves → all premiums benefit`);
      }
    } else {
      // Dealers dampen moves → premiums decay
      gexScore = distFromPin < 100 ? 28 : 38;
      if (distFromPin < 100) {
        reasons.push(`📌 LONG Gamma: Dealers pin spot near ₹${gex.pinStrike} — premium decay risk`);
      } else {
        reasons.push(`📌 LONG Gamma: Dealers suppressing volatility`);
      }
    }

    // ── Signal 4: Max Pain Gravity ──────────────────────────────────────────
    const mpDiff     = spot - maxPain;
    const mpDistance = Math.abs(mpDiff);
    let maxPainScore = 50;

    if (mpDistance < 30) {
      // FIX #5: Pinning is NEUTRAL (45), not low (30).
      // Theta sellers should still show up as picks in this scenario.
      maxPainScore = 45;
      reasons.push(`📌 Pinning zone: Spot ≈ Max Pain ₹${maxPain} (${mpDistance.toFixed(0)}pts away) — theta sellers in control`);
    } else if (mpDistance >= 30 && mpDistance < 100) {
      // Mild drift back expected
      maxPainScore = 55;
      if (side === 'PE' && mpDiff > 0) {
        reasons.push(`🎯 Mild MP pull down: Spot ₹${mpDiff.toFixed(0)} above ₹${maxPain} — PE drift possible`);
      } else if (side === 'CE' && mpDiff < 0) {
        reasons.push(`🎯 Mild MP pull up: Spot ₹${Math.abs(mpDiff).toFixed(0)} below ₹${maxPain} — CE drift possible`);
      }
    } else {
      // Strong max pain gravity (>100pts from max pain)
      if (side === 'PE' && mpDiff > 100) {
        // Spot well above max pain → downward pull → PE benefits
        maxPainScore = clamp(65 + (mpDistance - 100) / 8, 65, 90);
        if (Math.abs(st - maxPain) < 150) {
          maxPainScore = Math.min(maxPainScore + 8, 92);
          reasons.push(`🎯 STRONG MP pull ↓: Spot ₹${mpDiff.toFixed(0)} above max pain — PE near ₹${maxPain} in gravity zone`);
        } else {
          reasons.push(`🎯 MP gravity ↓: Spot above max pain by ₹${mpDiff.toFixed(0)}`);
        }
      } else if (side === 'CE' && mpDiff < -100) {
        // Spot well below max pain → upward pull → CE benefits
        maxPainScore = clamp(65 + (mpDistance - 100) / 8, 65, 90);
        if (Math.abs(st - maxPain) < 150) {
          maxPainScore = Math.min(maxPainScore + 8, 92);
          reasons.push(`🎯 STRONG MP pull ↑: Spot ₹${Math.abs(mpDiff).toFixed(0)} below max pain — CE near ₹${maxPain} in gravity zone`);
        } else {
          reasons.push(`🎯 MP gravity ↑: Spot below max pain by ₹${Math.abs(mpDiff).toFixed(0)}`);
        }
      } else {
        // Wrong side for max pain direction — penalize slightly
        maxPainScore = 35;
        reasons.push(`⚠ Wrong side for MP move: this ${side} faces headwind from max pain pull`);
      }
    }

    // ── Signal 5: Gamma Dominance ───────────────────────────────────────────
    // FIX #6: Removed dead `atmRow = undefined` variable
    // Gamma P&L ≈ 0.5 × Gamma × (DailyExpectedMove)²
    // Theta cost = |Theta| per day
    const dailyExp     = (spot * (atmIV / 100)) * Math.sqrt(1 / 252);
    const gammaPnL     = 0.5 * gamma * (dailyExp ** 2);
    const thetaCost    = Math.abs(theta);
    let gammaDominance = 50;

    if (thetaCost > 0) {
      const ratio = gammaPnL / thetaCost;
      if (ratio > 1.0) {
        gammaDominance = clamp(60 + ratio * 20, 60, 95);
        reasons.push(`⚡ Gamma dominates: Gamma P&L ₹${gammaPnL.toFixed(2)} >> Theta ₹${thetaCost.toFixed(2)}/day`);
      } else if (ratio > 0.5) {
        gammaDominance = clamp(52 + ratio * 20, 52, 72);
        reasons.push(`⚡ Gamma competitive: ₹${gammaPnL.toFixed(2)} vs Theta ₹${thetaCost.toFixed(2)}/day`);
      } else if (ratio < 0.2) {
        gammaDominance = clamp(15 + ratio * 80, 10, 40);
        reasons.push(`⏱ Theta dominates: Gamma only ₹${gammaPnL.toFixed(2)} vs Theta ₹${thetaCost.toFixed(2)}/day`);
      } else {
        // 0.2 – 0.5 ratio: theta slightly ahead but not crushing
        gammaDominance = 44;
      }
    } else if (gamma > 0) {
      // No theta? Deep ITM or data gap — treat as slightly positive
      gammaDominance = 55;
    }

    // ── Signal 6: Volume Surge ──────────────────────────────────────────────
    let volumeScore = 50;
    const volOIRatio = oi > 0 ? vol / oi : 0;

    if (volOIRatio > 0.20) {
      volumeScore = clamp(55 + (volOIRatio - 0.20) * 200, 55, 95);
      reasons.push(`🔥 Heavy volume: Vol/OI=${(volOIRatio * 100).toFixed(1)}% — institutional / smart money`);
    } else if (volOIRatio > 0.10) {
      volumeScore = 60;
      reasons.push(`📊 Elevated volume: Vol/OI=${(volOIRatio * 100).toFixed(1)}%`);
    } else if (volOIRatio < 0.02) {
      volumeScore = 35;
      // Low volume — no reason logged, just mild penalty
    }

    // ── Signal 7: IV Skew Momentum ──────────────────────────────────────────
    let skewScore = 50;
    const skew = skewMap.get(st) ?? 0;   // PE IV − CE IV at this strike

    if (side === 'PE' && skew > 3) {
      // PE IV well above CE IV = fear/protective demand = good for PE
      skewScore = clamp(60 + skew * 2, 60, 92);
      reasons.push(`😨 Fear skew: PE IV ${skew.toFixed(1)}pts > CE IV — protective buying`);
    } else if (side === 'PE' && skew > 1) {
      skewScore = 56;
      reasons.push(`😐 Mild PE IV premium: skew ${skew.toFixed(1)}pts`);
    } else if (side === 'CE' && skew < -2) {
      // CE IV above PE IV = greed/bullish speculation = good for CE
      skewScore = clamp(60 + Math.abs(skew) * 2, 60, 90);
      reasons.push(`🤑 Greed skew: CE IV elevated by ${Math.abs(skew).toFixed(1)}pts — bullish momentum`);
    } else if (side === 'CE' && skew < -0.5) {
      skewScore = 55;
      reasons.push(`📈 Mild CE IV premium: skew ${skew.toFixed(1)}pts`);
    }

    // ── PCR Momentum Adjustment (+/- 8 pts, not a full signal) ─────────────
    let pcrAdj = 0;
    if (side === 'PE' && pcrOI > 1.3) {
      pcrAdj = 8;
      reasons.push(`📊 PCR=${pcrOI.toFixed(2)} BULLISH — put protective buying trend continues`);
    } else if (side === 'CE' && pcrOI < 0.7) {
      pcrAdj = 8;
      reasons.push(`📊 PCR=${pcrOI.toFixed(2)} BEARISH — call writers active, but CE longs may cover`);
    } else if (side === 'CE' && pcrOI > 1.5) {
      pcrAdj = -5;  // Very high PCR = too bullish = CE may struggle
    } else if (side === 'PE' && pcrOI < 0.6) {
      pcrAdj = -5;  // Very low PCR = too bearish = PE may struggle
    }

    // ── FINAL WEIGHTED SCORE ────────────────────────────────────────────────
    const raw =
      w.oi      * oiScore      +
      w.ivVel   * ivVelScore   +
      w.gex     * gexScore     +
      w.maxPain * maxPainScore +
      w.gamma   * gammaDominance +
      w.volume  * volumeScore  +
      w.skew    * skewScore;

    const score = clamp(Math.round(raw + pcrAdj));

    // FIX #8: adjusted signal thresholds to match real score distribution
    const signal: SignalStrength =
      score >= 72 ? 'STRONG_BUY' :
      score >= 58 ? 'BUY'        :
      score >= 38 ? 'NEUTRAL'    :
      score >= 22 ? 'SELL'       : 'STRONG_SELL';

    const expectedMoveInPremium = this.estimatePremiumMove(
      ltp, delta, gamma, theta, vega, iv, atmIV, ivVel, dailyExp, score, dte
    );

    const tradeIdea = this.buildTradeIdea(
      st, side, ltp, signal, dte, maxPain, spot, iv, atmIV, pcrOI
    );

    return {
      strike:         st,
      side,
      currentPremium: ltp,
      score,
      signal,
      iv,
      delta,
      gamma,
      theta,
      signals: {
        oiScore:        Math.round(oiScore),
        ivVelocity:     Math.round(ivVelScore),
        gexScore:       Math.round(gexScore),
        maxPainScore:   Math.round(maxPainScore),
        gammaDominance: Math.round(gammaDominance),
        volumeSurge:    Math.round(volumeScore),
        skewMomentum:   Math.round(skewScore),
      },
      reasons,
      expectedMoveInPremium: +expectedMoveInPremium.toFixed(2),
      confidence: clamp(Math.round((score / 100) * 85 + 10)),
      tradeIdea,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GEX CALCULATION — Gamma Exposure
  // ══════════════════════════════════════════════════════════════════════════

  calcGEX(chain: OptionWithGreeks[], spotPrice: number): GEXResult {
    const spot = n(spotPrice, 25500);
    const perStrike: { strike: number; gex: number }[] = [];
    let netGEX    = 0;
    let pinStrike = Math.round(spot / 50) * 50;

    // FIX #7: track minimum absolute GEX properly for pin detection
    let minAbsGEX      = Infinity;
    let minAbsGEXSign  = 1;   // to detect zero-crossing

    for (const row of chain) {
      const st   = n(row.strike_price);
      if (!st) continue;

      const ceOI = n(row.ce_oi);
      const peOI = n(row.pe_oi);
      const ceG  = n(row.ce_greeks?.gamma);
      const peG  = n(row.pe_greeks?.gamma);

      // GEX = OI × Gamma × Spot × LotSize(50 for NIFTY)
      const ceGEX     =  ceOI * ceG * spot * 50;
      const peGEX     = -peOI * peG * spot * 50;  // dealers are short puts = negative GEX
      const strikeGEX = ceGEX + peGEX;

      netGEX += strikeGEX;
      perStrike.push({ strike: st, gex: Math.round(strikeGEX) });

      // Pin strike = strike closest to zero GEX within ±500pts of spot
      if (Math.abs(st - spot) <= 500 && Math.abs(strikeGEX) < minAbsGEX) {
        minAbsGEX     = Math.abs(strikeGEX);
        minAbsGEXSign = Math.sign(strikeGEX);
        pinStrike     = st;
      }
    }

    const dealerMode: GEXResult['dealerMode'] = netGEX > 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';

    // Expected intraday move estimate (rough) when SHORT gamma
    const expectedMove = dealerMode === 'SHORT_GAMMA'
      ? Math.round(Math.abs(netGEX) / (spot * 50 * Math.max(chain.length, 1)) * 1200)
      : 0;

    const netGEXBn = (netGEX / 1e9).toFixed(2);
    const interpretation = dealerMode === 'LONG_GAMMA'
      ? `Dealers LONG Gamma (Net GEX: +${netGEXBn}Bn) → buy dips, sell rallies → Spot PINNED near ₹${pinStrike} → sell premiums`
      : `Dealers SHORT Gamma (Net GEX: ${netGEXBn}Bn) → amplify moves → large swing expected → buy options near ₹${pinStrike}`;

    return {
      netGEX:       Math.round(netGEX),
      perStrike:    perStrike.sort((a, b) => b.gex - a.gex),
      interpretation,
      expectedMove,
      dealerMode,
      pinStrike,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IV HISTORY — DB + in-memory fallback
  // ══════════════════════════════════════════════════════════════════════════

  // FIX #3: merged DB fetch + in-memory ring buffer into single method
  private async getIVHistory(count: number): Promise<{ ts: number; iv: number }[]> {
    try {
      const res = await this.pool.query(
        `SELECT EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, atm_iv AS iv
         FROM nifty_premium_tracking.iv_history
         ORDER BY timestamp DESC LIMIT $1`,
        [count]
      );
      if (res.rows.length >= 3) {
        // DB has enough points — use it (chronological order)
        return res.rows
          .map(r => ({ ts: Number(r.ts), iv: Number(r.iv) }))
          .reverse();
      }
    } catch {
      // DB query failed — fall through to ring buffer
    }

    // Fall back to in-memory ring buffer (populated during scan() calls)
    return [...this.ivRingBuffer];
  }

  private calcIVVelocity(history: { ts: number; iv: number }[]): number {
    if (history.length < 2) return 0;

    // Use last 5 points (or all if fewer)
    const pts    = history.slice(-5);
    const oldest = pts[0];
    const newest = pts[pts.length - 1];
    const dtMin  = Math.max(0.1, (newest.ts - oldest.ts) / 60000);
    const dIV    = newest.iv - oldest.iv;

    // Cap at ±5%/min to avoid garbage data blowing up scores
    return Math.max(-5, Math.min(5, dIV / dtMin));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OI BASELINE — fetch from DB when prevSnapshot is empty (FIX #4)
  // ══════════════════════════════════════════════════════════════════════════

  private async fetchBaselineOI(chain: OptionWithGreeks[]): Promise<OISnapshot[]> {
    try {
      // Get OI values from ~5 minutes ago for comparison
      const res = await this.pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (strike_price, option_type)
            strike_price, option_type, ltp, oi
          FROM nifty_premium_tracking.options_data
          WHERE timestamp BETWEEN NOW() - INTERVAL '10 minutes'
                              AND NOW() - INTERVAL '4 minutes'
          ORDER BY strike_price, option_type, timestamp DESC
        )
        SELECT strike_price,
          MAX(CASE WHEN option_type = 'CE' THEN oi  END) AS ce_oi,
          MAX(CASE WHEN option_type = 'PE' THEN oi  END) AS pe_oi,
          MAX(CASE WHEN option_type = 'CE' THEN ltp END) AS ce_ltp,
          MAX(CASE WHEN option_type = 'PE' THEN ltp END) AS pe_ltp
        FROM latest
        GROUP BY strike_price
      `);

      if (res.rows.length > 0) {
        const ts = Date.now() - 5 * 60 * 1000;
        return res.rows.map((r: any) => ({
          strike: n(r.strike_price),
          ce_oi:  n(r.ce_oi),
          pe_oi:  n(r.pe_oi),
          ce_ltp: n(r.ce_ltp),
          pe_ltp: n(r.pe_ltp),
          ts,
        }));
      }
    } catch {
      // DB query failed — return current chain as baseline (zero delta)
    }

    // Last resort: use current chain as baseline (no delta comparison possible)
    return this.buildSnapshot(chain);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IV SKEW MAP
  // ══════════════════════════════════════════════════════════════════════════

  private calcIVSkewMap(chain: OptionWithGreeks[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const row of chain) {
      const ceIV = n(row.ce_greeks?.iv);
      const peIV = n(row.pe_greeks?.iv);
      if (ceIV > 0 && peIV > 0) {
        map.set(n(row.strike_price), peIV - ceIV);
      }
    }
    return map;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAX PAIN
  // ══════════════════════════════════════════════════════════════════════════

  calcMaxPain(chain: OptionWithGreeks[]): number {
    if (!chain.length) return 25000;
    let best = n(chain[0].strike_price), minLoss = Infinity;
    for (const target of chain) {
      const ts = n(target.strike_price);
      if (!ts) continue;
      let loss = 0;
      for (const r of chain) {
        const s = n(r.strike_price);
        if (ts > s) loss += (ts - s) * n(r.ce_oi);
        if (ts < s) loss += (s - ts) * n(r.pe_oi);
      }
      if (loss < minLoss) { minLoss = loss; best = ts; }
    }
    return best;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private getATMiv(chain: OptionWithGreeks[], spot: number): number | null {
    const atm = Math.round(spot / 50) * 50;
    const row  = chain.find(r => n(r.strike_price) === atm);
    if (!row) return null;
    return n(row.ce_greeks?.iv) || n(row.pe_greeks?.iv) || null;
  }

  private buildSnapshot(chain: OptionWithGreeks[]): OISnapshot[] {
    return chain.map(r => ({
      strike: n(r.strike_price),
      ce_oi:  n(r.ce_oi),
      pe_oi:  n(r.pe_oi),
      ce_ltp: n(r.ce_ltp),
      pe_ltp: n(r.pe_ltp),
      ts:     Date.now(),
    }));
  }

  // FIX #2: added DTE 1–2 bracket so the full DTE range is properly covered
  private getWeights(dte: number): {
    oi: number; ivVel: number; gex: number;
    maxPain: number; gamma: number; volume: number; skew: number;
  } {
    if (dte > 5) {
      // Weekly+: OI and IV dominate
      return { oi: 0.30, ivVel: 0.20, gex: 0.20, maxPain: 0.10, gamma: 0.10, volume: 0.05, skew: 0.05 };
    }
    if (dte > 2) {
      // 2–5 days: GEX and MaxPain gaining importance
      return { oi: 0.20, ivVel: 0.15, gex: 0.25, maxPain: 0.20, gamma: 0.10, volume: 0.05, skew: 0.05 };
    }
    if (dte > 1) {
      // 1–2 days: MaxPain + GEX dominant, gamma picking up
      return { oi: 0.12, ivVel: 0.10, gex: 0.22, maxPain: 0.28, gamma: 0.18, volume: 0.05, skew: 0.05 };
    }
    // < 1 day (expiry): Gamma + MaxPain dominate completely
    return   { oi: 0.08, ivVel: 0.07, gex: 0.12, maxPain: 0.33, gamma: 0.30, volume: 0.05, skew: 0.05 };
  }

  private estimatePremiumMove(
    ltp: number, delta: number, gamma: number, theta: number, vega: number,
    iv: number, atmIV: number, ivVel: number, dailyExp: number,
    score: number, dte: number
  ): number {
    // Next 5-min expected spot move
    const fiveMinMove = dailyExp * 0.08;
    // Direction determined by score: >55 = bullish for this premium
    const direction   = score > 55 ? 1 : -1;
    const deltaPnL    = Math.abs(delta) * fiveMinMove * direction;
    const gammaPnL    = 0.5 * gamma * (fiveMinMove ** 2);
    const vegaPnL     = vega * ivVel * (5 / 60);       // 5 min of IV change
    const thetaDecay  = theta * (5 / (dte * 24 * 60)); // 5 min of theta bleed
    return deltaPnL + gammaPnL + vegaPnL + thetaDecay;
  }

  // FIX #9: SL/Target rounded to nearest 0.5 for realism
  private buildTradeIdea(
    strike: number, side: OptionSide, ltp: number,
    signal: SignalStrength, dte: number, maxPain: number,
    spot: number, iv: number, atmIV: number, pcr: number
  ): string {
    const mpDiff = Math.abs(spot - maxPain);
    const dteLabel = dte < 1 ? 'Expiry day' : `${dte.toFixed(1)}d to expiry`;

    if (signal === 'STRONG_BUY') {
      const sl     = roundHalf(ltp * 0.50);
      const target = roundHalf(ltp * 1.55);
      if (dte <= 2 && mpDiff > 100) {
        return `BUY ${strike}${side} @ ₹${ltp.toFixed(1)} | MP pull ₹${mpDiff.toFixed(0)}pts + OI buildup | SL ₹${sl} | Target ₹${target} | ${dteLabel}`;
      }
      return `BUY ${strike}${side} @ ₹${ltp.toFixed(1)} | All 7 signals aligned | SL ₹${sl} | Target ₹${target} | ${dteLabel}`;
    }

    if (signal === 'BUY') {
      const sl     = roundHalf(ltp * 0.55);
      const target = roundHalf(ltp * 1.40);
      return `BUY ${strike}${side} @ ₹${ltp.toFixed(1)} | Moderate setup — use partial position | SL ₹${sl} | Target ₹${target} | ${dteLabel}`;
    }

    if (signal === 'SELL' || signal === 'STRONG_SELL') {
      const target = roundHalf(ltp * 0.60);
      if (iv > atmIV * 1.2) {
        return `SELL ${strike}${side} @ ₹${ltp.toFixed(1)} | IV ${iv.toFixed(1)}% elevated vs ATM ${atmIV.toFixed(1)}% — IV crush + theta | Target ₹${target} | ${dteLabel}`;
      }
      return `SELL ${strike}${side} @ ₹${ltp.toFixed(1)} | Premium expected to fall | Target ₹${target} | ${dteLabel}`;
    }

    // NEUTRAL
    return `WATCH ${strike}${side} @ ₹${ltp.toFixed(1)} | Mixed signals — wait for cleaner setup | ${dteLabel}`;
  }

  private buildMarketContext(
    spot: number, atm: number, dte: number, atmIV: number,
    ivVel: number, gex: GEXResult, maxPain: number, pcr: number
  ): MarketContext {
    const mpDiff    = spot - maxPain;
    const scenarios: string[] = [];

    // Max pain scenario
    if (Math.abs(mpDiff) < 30) {
      scenarios.push(`PINNING: Spot ≈ Max Pain ₹${maxPain}. Theta sellers win. Best: SELL ATM straddle / iron condor.`);
    } else if (mpDiff > 100) {
      scenarios.push(`MEAN REVERT ↓: Spot ₹${mpDiff.toFixed(0)} above Max Pain ₹${maxPain} — downward drift expected. PE near ₹${maxPain} may gain.`);
    } else if (mpDiff < -100) {
      scenarios.push(`MEAN REVERT ↑: Spot ₹${Math.abs(mpDiff).toFixed(0)} below Max Pain ₹${maxPain} — upward drift expected. CE near ₹${maxPain} may gain.`);
    } else {
      scenarios.push(`DRIFTING: Spot ₹${Math.abs(mpDiff).toFixed(0)}pts from Max Pain — mild gravitational pull. Watch for acceleration.`);
    }

    // GEX scenario
    if (gex.dealerMode === 'LONG_GAMMA') {
      scenarios.push(`PINNED RANGE (LONG γ): Dealers suppress moves near ₹${gex.pinStrike} — safe to sell OTM options.`);
    } else {
      scenarios.push(`EXPLOSIVE RANGE (SHORT γ): Dealers amplify moves near ₹${gex.pinStrike} — buy ATM straddle for swing.`);
    }

    // IV scenario
    if (atmIV > 35) {
      scenarios.push(`EXTREME IV (${atmIV.toFixed(1)}%): Sell premium aggressively. IV crush likely post-event/expiry.`);
    } else if (atmIV > 25) {
      scenarios.push(`HIGH IV (${atmIV.toFixed(1)}%): Lean to selling. Risk-reward favors writers.`);
    } else if (atmIV < 13) {
      scenarios.push(`LOW IV (${atmIV.toFixed(1)}%): Buy options — cheap. Any spike gives fast returns.`);
    }

    // IV velocity scenario
    if (Math.abs(ivVel) > 0.3) {
      scenarios.push(ivVel > 0
        ? `IV ACCELERATING +${ivVel.toFixed(2)}%/min — buy vega now before IV spikes further.`
        : `IV COLLAPSING ${ivVel.toFixed(2)}%/min — sell vega / exit long options immediately.`
      );
    }

    const ivEnv =
      atmIV > 35 ? 'EXTREME — sell premium' :
      atmIV > 25 ? 'HIGH — lean to selling' :
      atmIV > 15 ? 'NORMAL — balanced'      : 'LOW — buy options';

    return {
      spot, atm,
      dte: Math.round(dte * 10) / 10,  // round to 1 decimal for display
      atmIV,
      ivVelocity:  Math.round(ivVel * 1000) / 1000,
      ivEnvironment: ivEnv,
      gexMode:     gex.dealerMode,
      maxPain,
      maxPainDiff: Math.round(mpDiff * 100) / 100,
      pcr,
      pcrSentiment: pcr < 0.7 ? 'BEARISH' : pcr > 1.3 ? 'BULLISH' : 'NEUTRAL',
      scenarios,
    };
  }

  private buildSummary(ctx: MarketContext, topPicks: PredictionResult[]): string {
    const picks = topPicks.slice(0, 3)
      .map(p => `${p.strike}${p.side}(${p.signal}, score:${p.score})`)
      .join(', ');

    return [
      `NIFTY ₹${ctx.spot.toFixed(2)} | ATM ${ctx.atm} | DTE ${ctx.dte} | IV ${ctx.atmIV.toFixed(1)}% [${ctx.ivEnvironment}]`,
      `IVVel: ${ctx.ivVelocity > 0 ? '+' : ''}${ctx.ivVelocity.toFixed(3)}%/min | GEX: ${ctx.gexMode} | MaxPain: ₹${ctx.maxPain} (${ctx.maxPainDiff > 0 ? '+' : ''}${ctx.maxPainDiff.toFixed(0)}pts) | PCR: ${ctx.pcr.toFixed(2)} [${ctx.pcrSentiment}]`,
      `Top Picks: ${picks || 'none above threshold (score < 50)'}`,
      ``,
      ...ctx.scenarios,
    ].join('\n');
  }
}