/**
 * TRADING SIGNALS ENGINE - BULLETPROOF VERSION
 *
 * Location: D:\jobber-perfect\backend\signals-engine.ts
 *
 * FIXES vs previous versions:
 * - ALL database values wrapped in n() helper (safe Number conversion)
 * - Defends against: strings, null, undefined, NaN, Infinity
 * - .toFixed() never called on non-numbers
 * - Division-by-zero protected
 * - Every optional chain is null-checked before use
 */

import { OptionWithGreeks } from './greeks-calculator';

// ============================================================================
// SAFE NUMBER HELPER — the root cause of all bugs was missing this
// PostgreSQL returns numeric columns as STRINGS. n() converts safely.
// ============================================================================
function n(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const parsed = Number(v);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

// Safe toFixed — never crashes, always returns a string
function toFixed(v: any, decimals = 2, fallback = '0'): string {
  const num = n(v, NaN);
  if (isNaN(num) || !isFinite(num)) return fallback;
  return num.toFixed(decimals);
}

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface IVAnalysis {
  currentIV: number;
  ivPercentile: number;
  ivRank: number;
  status: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  historicalRange: { min: number; max: number; mean: number };
  signal: 'BUY_PREMIUM' | 'SELL_PREMIUM' | 'NEUTRAL';
}

export interface TradingSignal {
  id: string;
  type: 'DELTA_NEUTRAL' | 'THETA_DECAY' | 'GAMMA_SCALP' | 'IV_CRUSH' | 'IV_EXPANSION';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
  strategy: string;
  description: string;
  strikes: number[];
  action: string;
  expectedProfit: string;
  risk: string;
  timestamp: Date;
}

export interface DeltaNeutralOpportunity {
  callStrike: number;
  putStrike: number;
  callDelta: number;
  putDelta: number;
  netDelta: number;
  ratio: string;
  cost: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: { upper: number; lower: number };
}

export interface ThetaDecayOpportunity {
  strike: number;
  optionType: 'CE' | 'PE';
  premium: number;
  theta: number;
  daysToExpiry: number;
  dailyDecay: number;
  weeklyDecay: number;
  profitPotential: number;
  probabilityITM: number;
}

export interface GammaScalpSetup {
  strike: number;
  currentPrice: number;
  gamma: number;
  delta: number;
  costBasis: number;
  hedgeRatio: number;
  scalpRange: { lower: number; upper: number };
  estimatedProfitPerPoint: number;
}

// ============================================================================
// IV PERCENTILE & RANK
// ============================================================================

export function calculateIVPercentile(
  currentIV: number,
  historicalIVs: number[]
): number {
  if (!historicalIVs || historicalIVs.length === 0) return 50;
  const cur = n(currentIV, 20);
  const daysBelow = historicalIVs.filter(iv => n(iv) < cur).length;
  return (daysBelow / historicalIVs.length) * 100;
}

export function calculateIVRank(
  currentIV: number,
  historicalIVs: number[]
): number {
  if (!historicalIVs || historicalIVs.length === 0) return 50;
  const cur = n(currentIV, 20);
  const nums = historicalIVs.map(v => n(v));
  const minIV = Math.min(...nums);
  const maxIV = Math.max(...nums);
  if (maxIV === minIV) return 50;
  return Math.max(0, Math.min(100, ((cur - minIV) / (maxIV - minIV)) * 100));
}

export function analyzeIV(
  currentIV: number,
  historicalIVs: number[]
): IVAnalysis {
  const cur = n(currentIV, 20);
  const safeHistorical = (historicalIVs || []).map(v => n(v, 20));

  const ivPercentile = calculateIVPercentile(cur, safeHistorical);
  const ivRank = calculateIVRank(cur, safeHistorical);

  const allIVs = [...safeHistorical, cur];
  const minIV = Math.min(...allIVs);
  const maxIV = Math.max(...allIVs);
  const meanIV = safeHistorical.length > 0
    ? safeHistorical.reduce((a, b) => a + b, 0) / safeHistorical.length
    : cur;

  let status: IVAnalysis['status'];
  if (ivRank > 90) status = 'EXTREME';
  else if (ivRank > 75) status = 'HIGH';
  else if (ivRank < 25) status = 'LOW';
  else status = 'NORMAL';

  let signal: IVAnalysis['signal'];
  if (ivRank > 80) signal = 'SELL_PREMIUM';
  else if (ivRank < 20) signal = 'BUY_PREMIUM';
  else signal = 'NEUTRAL';

  return {
    currentIV: cur,
    ivPercentile: Math.round(ivPercentile),
    ivRank: Math.round(ivRank),
    status,
    historicalRange: { min: minIV, max: maxIV, mean: meanIV },
    signal
  };
}

// ============================================================================
// DELTA-NEUTRAL OPPORTUNITIES
// ============================================================================

export function findDeltaNeutralOpportunities(
  chain: OptionWithGreeks[],
  spotPrice: number,
  maxDelta: number = 0.05
): DeltaNeutralOpportunity[] {
  if (!chain || chain.length === 0) return [];

  const spot = n(spotPrice, 25500);
  const opportunities: DeltaNeutralOpportunity[] = [];

  // Unique strikes within ±200 of spot
  const atmStrikes = [...new Set(
    chain
      .filter(opt => Math.abs(n(opt.strike_price) - spot) <= 200)
      .map(opt => n(opt.strike_price))
  )].sort((a, b) => a - b);

  for (const strike of atmStrikes) {
    const callOpt = chain.find(opt => n(opt.strike_price) === strike && opt.ce_greeks?.delta != null);
    const putOpt  = chain.find(opt => n(opt.strike_price) === strike && opt.pe_greeks?.delta != null);

    if (!callOpt?.ce_greeks || !putOpt?.pe_greeks) continue;

    const ceLTP = n(callOpt.ce_ltp);
    const peLTP = n(putOpt.pe_ltp);
    if (ceLTP <= 0 || peLTP <= 0) continue;

    const callDelta = n(callOpt.ce_greeks.delta);
    const putDelta  = n(putOpt.pe_greeks.delta);
    const netDelta  = callDelta + putDelta;

    if (Math.abs(netDelta) <= maxDelta) {
      const totalCost = ceLTP + peLTP;
      opportunities.push({
        callStrike: strike,
        putStrike:  strike,
        callDelta,
        putDelta,
        netDelta,
        ratio: '1:1',
        cost:      totalCost,
        maxProfit: Infinity,
        maxLoss:   totalCost,
        breakevens: {
          upper: strike + totalCost,
          lower: strike - totalCost
        }
      });
    }
  }

  return opportunities;
}

// ============================================================================
// THETA DECAY OPPORTUNITIES
// ============================================================================

export function findThetaDecayOpportunities(
  chain: OptionWithGreeks[],
  spotPrice: number,
  daysToExpiry: number,
  minTheta: number = -10
): ThetaDecayOpportunity[] {
  if (!chain || chain.length === 0) return [];

  const dte = Math.max(1, n(daysToExpiry, 7));
  const opportunities: ThetaDecayOpportunity[] = [];

  for (const option of chain) {
    // --- CE ---
    if (option.ce_greeks?.theta != null && option.ce_ltp != null) {
      const theta   = n(option.ce_greeks.theta);
      const delta   = n(option.ce_greeks.delta);
      const premium = n(option.ce_ltp);

      if (theta < minTheta && Math.abs(delta) < 0.40 && premium > 0) {
        opportunities.push({
          strike:         n(option.strike_price),
          optionType:     'CE',
          premium,
          theta,
          daysToExpiry:   dte,
          dailyDecay:     Math.abs(theta),
          weeklyDecay:    Math.abs(theta) * 5,
          profitPotential: (Math.abs(theta) * dte) / premium * 100,
          probabilityITM: Math.abs(delta) * 100
        });
      }
    }

    // --- PE ---
    if (option.pe_greeks?.theta != null && option.pe_ltp != null) {
      const theta   = n(option.pe_greeks.theta);
      const delta   = n(option.pe_greeks.delta);
      const premium = n(option.pe_ltp);

      if (theta < minTheta && Math.abs(delta) < 0.40 && premium > 0) {
        opportunities.push({
          strike:         n(option.strike_price),
          optionType:     'PE',
          premium,
          theta,
          daysToExpiry:   dte,
          dailyDecay:     Math.abs(theta),
          weeklyDecay:    Math.abs(theta) * 5,
          profitPotential: (Math.abs(theta) * dte) / premium * 100,
          probabilityITM: Math.abs(delta) * 100
        });
      }
    }
  }

  return opportunities.sort((a, b) => a.theta - b.theta).slice(0, 10);
}

// ============================================================================
// GAMMA SCALP SETUPS
// ============================================================================

export function findGammaScalpSetups(
  chain: OptionWithGreeks[],
  spotPrice: number,
  minGamma: number = 0.001
): GammaScalpSetup[] {
  if (!chain || chain.length === 0) return [];

  const spot = n(spotPrice, 25500);
  const setups: GammaScalpSetup[] = [];

  const atmOptions = chain.filter(opt =>
    Math.abs(n(opt.strike_price) - spot) <= 50
  );

  for (const option of atmOptions) {
    if (option.ce_greeks?.gamma != null && option.ce_ltp != null) {
      const gamma   = n(option.ce_greeks.gamma);
      const delta   = n(option.ce_greeks.delta, 0.5);
      const ltp     = n(option.ce_ltp);

      if (gamma > minGamma && ltp > 0) {
        setups.push({
          strike:    n(option.strike_price),
          currentPrice: spot,
          gamma,
          delta,
          costBasis: ltp,
          hedgeRatio: delta,
          scalpRange: {
            lower: spot - 20,
            upper: spot + 20
          },
          estimatedProfitPerPoint: gamma * spot * 0.01
        });
      }
    }
  }

  return setups.sort((a, b) => b.gamma - a.gamma).slice(0, 5);
}

// ============================================================================
// MAIN SIGNAL GENERATION
// ============================================================================

export function generateTradingSignals(
  chain: OptionWithGreeks[],
  spotPrice: number,
  ivAnalysis: IVAnalysis,
  daysToExpiry: number
): TradingSignal[] {
  if (!chain || !ivAnalysis) return [];

  const spot = n(spotPrice, 25500);
  const dte  = Math.max(1, n(daysToExpiry, 7));
  const atmStrike = Math.round(spot / 50) * 50;
  const signals: TradingSignal[] = [];

  const rank = n(ivAnalysis.ivRank, 50);

  // ── 1. IV CRUSH — High IV → Sell Premium ──────────────────────────────────
  if (rank > 80) {
    signals.push({
      id:             `iv_crush_${Date.now()}`,
      type:           'IV_CRUSH',
      priority:       'HIGH',
      confidence:     Math.min(Math.round(rank), 100),
      strategy:       'Iron Condor / Credit Spreads',
      description:    `IV Rank ${Math.round(rank)}% — Extremely high. IV crush expected after event.`,
      strikes:        [atmStrike],
      action:         'SELL premium — Iron Condor, Credit Spreads, Short Strangles',
      expectedProfit: `${toFixed((rank - 50) / 5, 1)}% of premium collected`,
      risk:           'Directional risk if market makes sharp move',
      timestamp:      new Date()
    });
  }

  // ── 2. IV EXPANSION — Low IV → Buy Options ────────────────────────────────
  if (rank < 20) {
    signals.push({
      id:             `iv_expansion_${Date.now()}`,
      type:           'IV_EXPANSION',
      priority:       'HIGH',
      confidence:     Math.min(Math.round(100 - rank), 100),
      strategy:       'Long Straddle / Calendar Spreads',
      description:    `IV Rank ${Math.round(rank)}% — Extremely low. Volatility expansion expected.`,
      strikes:        [atmStrike],
      action:         'BUY options before event — Straddles, Calendars, Long Puts/Calls',
      expectedProfit: 'Vega gains on IV expansion (5–15%)',
      risk:           'Premium decay if IV stays depressed',
      timestamp:      new Date()
    });
  }

  // ── 3. DELTA NEUTRAL ──────────────────────────────────────────────────────
  try {
    const deltaNeutral = findDeltaNeutralOpportunities(chain, spot);
    if (deltaNeutral.length > 0) {
      const best = deltaNeutral[0];
      const maxLoss = n(best.maxLoss);
      signals.push({
        id:             `delta_neutral_${Date.now()}`,
        type:           'DELTA_NEUTRAL',
        priority:       'MEDIUM',
        confidence:     75,
        strategy:       'Delta-Neutral Straddle',
        description:    `Delta-neutral setup at ${best.callStrike}. Net delta: ${toFixed(best.netDelta, 3)}`,
        strikes:        [best.callStrike],
        action:         `Buy 1 ATM Call + 1 ATM Put at strike ${best.callStrike}`,
        expectedProfit: 'Profit from gamma scalping or large directional moves',
        risk:           `Max loss ₹${toFixed(maxLoss, 2)} if expires exactly at ATM`,
        timestamp:      new Date()
      });
    }
  } catch (e) {
    console.error('Delta neutral signal error:', e);
  }

  // ── 4. THETA DECAY — within 7 days of expiry ─────────────────────────────
  if (dte <= 7) {
    try {
      const thetaOpps = findThetaDecayOpportunities(chain, spot, dte);
      if (thetaOpps.length > 0) {
        const best = thetaOpps[0];
        signals.push({
          id:             `theta_decay_${Date.now()}`,
          type:           'THETA_DECAY',
          priority:       'MEDIUM',
          confidence:     70,
          strategy:       'Short OTM Options (Theta Collection)',
          description:    `Theta ₹${toFixed(Math.abs(best.theta), 2)}/day at ${best.strike} ${best.optionType}`,
          strikes:        [best.strike],
          action:         `SELL ${best.strike} ${best.optionType} @ ₹${toFixed(best.premium, 2)}`,
          expectedProfit: `${toFixed(best.profitPotential, 1)}% over ${dte} days`,
          risk:           `${toFixed(best.probabilityITM, 1)}% probability of being ITM at expiry`,
          timestamp:      new Date()
        });
      }
    } catch (e) {
      console.error('Theta decay signal error:', e);
    }
  }

  // ── 5. GAMMA SCALP ────────────────────────────────────────────────────────
  try {
    const gammaSetups = findGammaScalpSetups(chain, spot);
    if (gammaSetups.length > 0) {
      const best = gammaSetups[0];
      signals.push({
        id:             `gamma_scalp_${Date.now()}`,
        type:           'GAMMA_SCALP',
        priority:       'LOW',
        confidence:     65,
        strategy:       'ATM Gamma Scalping',
        description:    `High gamma (${toFixed(best.gamma, 4)}) at ATM ${best.strike} — scalp setup active`,
        strikes:        [best.strike],
        action:         'Buy ATM option, hedge with futures, scalp delta on every ±20pt move',
        expectedProfit: `₹${toFixed(best.estimatedProfitPerPoint, 2)} estimated profit per point`,
        risk:           'Requires active monitoring, fast execution, and hedge discipline',
        timestamp:      new Date()
      });
    }
  } catch (e) {
    console.error('Gamma scalp signal error:', e);
  }

  // Sort: HIGH → MEDIUM → LOW
  const priorityOrder: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return signals.sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));
}

// ============================================================================
// EXPECTED MOVE CALCULATION
// ============================================================================

export function calculateExpectedMove(
  chain: OptionWithGreeks[],
  spotPrice: number,
  daysToExpiry: number
): {
  daily: number;
  weekly: number;
  toExpiry: number;
  upperRange: number;
  lowerRange: number;
  probability: number;
} {
  const spot = n(spotPrice, 25500);
  const dte  = Math.max(1, n(daysToExpiry, 7));
  const atmStrike = Math.round(spot / 50) * 50;

  const atmCallRow = chain.find(opt => n(opt.strike_price) === atmStrike);
  const atmPutRow  = chain.find(opt => n(opt.strike_price) === atmStrike);

  const atmCall = n(atmCallRow?.ce_ltp, 0);
  const atmPut  = n(atmPutRow?.pe_ltp, 0);

  const straddlePrice = atmCall + atmPut;
  // Expected move = Straddle × 0.85 (market standard approximation)
  const expectedMoveToExpiry = straddlePrice * 0.85;

  const dailyMove  = dte > 0 ? expectedMoveToExpiry / Math.sqrt(dte) : 0;
  const weeklyMove = dailyMove * Math.sqrt(5);

  return {
    daily:      dailyMove,
    weekly:     weeklyMove,
    toExpiry:   expectedMoveToExpiry,
    upperRange: spot + expectedMoveToExpiry,
    lowerRange: spot - expectedMoveToExpiry,
    probability: 68
  };
}
