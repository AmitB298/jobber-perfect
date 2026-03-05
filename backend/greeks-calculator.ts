/**
 * greeks-calculator.ts — FINAL CORRECT VERSION
 * Location: D:\jobber-perfect\backend\greeks-calculator.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * NIFTY EXPIRY RESEARCH — COMPLETE HISTORY
 * ══════════════════════════════════════════════════════════════════════
 *
 * The expiry day for NIFTY has changed multiple times. Here is the
 * VERIFIED history sourced from official NSE circulars + Zerodha +
 * Dhan + SEBI orders:
 *
 *  Era 1 (2000 – Aug 2025):
 *    NIFTY weekly options  → every THURSDAY
 *    NIFTY monthly futures → last THURSDAY of the month
 *
 *  Era 2 (Sep 1, 2025 onwards — CURRENT, effective EOD Aug 28, 2025):
 *    SEBI circular (May 26, 2025) + NSE circular 111/2025 (Jun 25, 2025)
 *    mandated ALL NSE derivatives shift to TUESDAY.
 *
 *    NIFTY 50 weekly options  → every TUESDAY         ← CURRENT RULE
 *    NIFTY 50 monthly options → last TUESDAY of month ← CURRENT RULE
 *    BANKNIFTY monthly        → last TUESDAY of month
 *    (BANKNIFTY weekly was discontinued Nov 2024)
 *
 *    Holiday rule: if Tuesday is a market holiday,
 *                  expiry shifts to PREVIOUS trading day (typically Monday).
 *
 * Sources verified:
 *   - NSE Circular FAOP68747, Jun 25 2025
 *   - NSE Circular FAOP65336 (Jan 2025 — no change to NIFTY that time)
 *   - Zerodha bulletin: "First Nifty weekly contract expires Sep 2, 2025 (Tuesday)"
 *   - Dhan F&O Calendar: "NIFTY Weekly = Tuesday of expiry week"
 *   - Groww: "Nifty Weekly Contracts: Expire on Tuesday"
 *   - Arihant Plus: "September 1, 2025 — Tuesday is the new Thursday for Nifty"
 *
 * TODAY: Feb 22, 2026 (Sunday)
 * NEXT EXPIRY: Tuesday Feb 24, 2026 (2 days away)
 * ══════════════════════════════════════════════════════════════════════
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const RISK_FREE_RATE = 0.065;   // RBI Repo Rate, Feb 2026
const DIVIDEND_YIELD = 0.012;   // NIFTY avg dividend yield
const DAYS_PER_YEAR  = 365;

/** Exported for backward compatibility */
export const NIFTY_CONSTANTS = {
  RISK_FREE_RATE,
  DIVIDEND_YIELD,
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega:  number | null;
  rho:   number | null;
  iv:    number | null;   // PERCENTAGE, e.g. 20.5 means 20.5% annualized IV
}

/** Simple option row — backward compat */
export interface OptionData {
  strike_price: number;
  ce_ltp: number | null;
  pe_ltp: number | null;
}

/**
 * Full option row guaranteed to have:
 *   - strike_price as NUMBER (never string)
 *   - All numeric fields as Numbers (never strings)
 *   - ce_greeks / pe_greeks as undefined when IV cannot be solved
 */
export interface OptionWithGreeks {
  strike_price: number;
  ce_ltp:    number | null;
  pe_ltp:    number | null;
  ce_volume: number | null;
  pe_volume: number | null;
  ce_oi:     number | null;
  pe_oi:     number | null;
  ce_greeks?: Greeks;
  pe_greeks?: Greeks;
}

// ============================================================================
// MATH UTILITIES
// ============================================================================

/** Cumulative Standard Normal CDF — Abramowitz & Stegun, error < 7.5e-8 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Standard Normal PDF */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function _d1(S: number, K: number, T: number, r: number, q: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  return (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

function _d2(d1: number, sigma: number, T: number): number {
  return d1 - sigma * Math.sqrt(T);
}

// ============================================================================
// BLACK-SCHOLES PRICING
// ============================================================================

/**
 * @param sigma  Volatility as decimal (0.20 = 20%)
 */
export function blackScholes(
  S: number, K: number, T: number,
  r: number, q: number, sigma: number,
  type: 'call' | 'put'
): number {
  if (T <= 0) return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (sigma <= 0) return 0;
  const d1 = _d1(S, K, T, r, q, sigma);
  const d2 = _d2(d1, sigma, T);
  if (type === 'call') {
    return Math.max(0, S * Math.exp(-q * T) * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2));
  }
  return Math.max(0, K * Math.exp(-r * T) * normalCDF(-d2) - S * Math.exp(-q * T) * normalCDF(-d1));
}

// ============================================================================
// IMPLIED VOLATILITY — Newton-Raphson + bisection fallback
// ============================================================================

/**
 * Solve for IV given a market price.
 *
 * Phase 1: Newton-Raphson (fast, may diverge near expiry or deep ITM/OTM)
 * Phase 2: Bisection fallback (always converges, ~60 iterations)
 *
 * @returns IV as PERCENTAGE (e.g. 20.5), or null if unsolvable
 */
export function calculateImpliedVolatility(
  marketPrice: number,
  S: number, K: number, T: number,
  r: number, q: number,
  type: 'call' | 'put'
): number | null {
  if (marketPrice <= 0 || T <= 0 || S <= 0 || K <= 0) return null;

  // Market price must be >= intrinsic value (allow 2% tolerance for stale/illiquid prices)
  const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (marketPrice < intrinsic * 0.98) return null;

  // Smart initial guess: ATM ≈ 18%, OTM ≈ 25%
  const moneyness = S / K;
  let sigma = (moneyness > 1.05 || moneyness < 0.95) ? 0.25 : 0.18;

  // ── Phase 1: Newton-Raphson ──────────────────────────────────────────────
  for (let i = 0; i < 100; i++) {
    const price = blackScholes(S, K, T, r, q, sigma, type);
    const d1    = _d1(S, K, T, r, q, sigma);
    const vega  = S * Math.exp(-q * T) * normalPDF(d1) * Math.sqrt(T);  // raw vega

    if (vega < 1e-8) break;   // vega too small → switch to bisection

    const diff = price - marketPrice;
    if (Math.abs(diff) < 0.001) {
      return (sigma > 0.005 && sigma < 5) ? Number((sigma * 100).toFixed(2)) : null;
    }

    sigma -= diff / vega;
    if (sigma < 0.005) sigma = 0.005;
    if (sigma > 5.0)   sigma = 5.0;
  }

  // ── Phase 2: Bisection fallback ──────────────────────────────────────────
  let lo = 0.005, hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid   = (lo + hi) / 2;
    const price = blackScholes(S, K, T, r, q, mid, type);
    if (price < marketPrice) lo = mid; else hi = mid;
    if (hi - lo < 0.0001) {
      const result = (lo + hi) / 2;
      return (result > 0.005 && result < 5) ? Number((result * 100).toFixed(2)) : null;
    }
  }

  return null;
}

// ============================================================================
// GREEKS
// ============================================================================

/**
 * @param sigma  Volatility as DECIMAL (0.20, NOT 20)
 * Returns:
 *   theta → ₹ per day (negative = time decay cost for buyer)
 *   vega  → ₹ per 1% IV change
 *   rho   → ₹ per 1% rate change
 */
export function calculateGreeks(
  S: number, K: number, T: number,
  r: number, q: number, sigma: number,
  type: 'call' | 'put'
): Omit<Greeks, 'iv'> {
  if (T <= 0 || sigma <= 0) {
    return { delta: null, gamma: null, theta: null, vega: null, rho: null };
  }

  const d1   = _d1(S, K, T, r, q, sigma);
  const d2   = _d2(d1, sigma, T);
  const pdf1 = normalPDF(d1);
  const eqT  = Math.exp(-q * T);
  const erT  = Math.exp(-r * T);

  const delta = type === 'call'
    ? eqT * normalCDF(d1)
    : eqT * (normalCDF(d1) - 1);

  const gamma = (eqT * pdf1) / (S * sigma * Math.sqrt(T));

  const vega = S * eqT * pdf1 * Math.sqrt(T) / 100;  // per 1% IV

  const theta = type === 'call'
    ? ((-S * pdf1 * sigma * eqT) / (2 * Math.sqrt(T))
       - r * K * erT * normalCDF(d2)
       + q * S * eqT * normalCDF(d1)) / DAYS_PER_YEAR
    : ((-S * pdf1 * sigma * eqT) / (2 * Math.sqrt(T))
       + r * K * erT * normalCDF(-d2)
       - q * S * eqT * normalCDF(-d1)) / DAYS_PER_YEAR;

  const rho = type === 'call'
    ?  K * T * erT * normalCDF(d2)  / 100
    : -K * T * erT * normalCDF(-d2) / 100;

  return { delta, gamma, theta, vega, rho };
}

// ============================================================================
// EXPIRY CALCULATION — VERIFIED CORRECT AS OF FEB 2026
// ============================================================================

/**
 * Calculate time to expiry in years.
 * Exported for backward compatibility.
 */
export function calculateTimeToExpiry(currentDate: Date, expiryDate: Date): number {
  const ms = DAYS_PER_YEAR * 24 * 60 * 60 * 1000;
  return Math.max((expiryDate.getTime() - currentDate.getTime()) / ms, 0);
}

/**
 * Get next NIFTY 50 expiry date.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  VERIFIED RULE (effective Sep 1, 2025 per NSE circular         │
 * │  FAOP68747 and SEBI circular May 2025):                        │
 * │                                                                 │
 * │  NIFTY 50 weekly  → every TUESDAY, 3:30 PM IST                │
 * │  NIFTY 50 monthly → last TUESDAY of month, 3:30 PM IST        │
 * │                                                                 │
 * │  Holiday rule: if Tuesday is a market holiday,                 │
 * │  expiry moves to PREVIOUS trading day (Monday).                │
 * │                                                                 │
 * │  NOTE: This function returns the NEXT TUESDAY from now.        │
 * │  This is the weekly expiry. For monthly expiry, the last       │
 * │  Tuesday of the month is also used — for short DTE options     │
 * │  like NIFTY 50 weekly, use this function directly.             │
 * │                                                                 │
 * │  The old Thursday rule was retired EOD Aug 28, 2025.           │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Special cases handled:
 *  - If TODAY is Tuesday and market is still open (before 3:30 PM IST)
 *    → returns today as expiry
 *  - If TODAY is Tuesday and 3:30 PM IST has passed
 *    → returns next Tuesday (7 days ahead)
 *  - Any other day → returns the coming Tuesday
 */
export function getNextNiftyExpiry(): Date {
  const now    = new Date();
  const expiry = new Date(now);

  // Tuesday = day 2
  const daysToTuesday = (2 - now.getDay() + 7) % 7;

  if (daysToTuesday === 0) {
    // Today IS Tuesday — check if 3:30 PM IST has passed
    // 3:30 PM IST = UTC+5:30 → 10:00 AM UTC
    const cutoff = new Date(now);
    cutoff.setUTCHours(10, 0, 0, 0);

    if (now > cutoff) {
      // This week's expiry is done → jump to next Tuesday
      expiry.setDate(now.getDate() + 7);
    }
    // else: still before 3:30 PM IST, today is expiry day
  } else {
    expiry.setDate(now.getDate() + daysToTuesday);
  }

  expiry.setHours(15, 30, 0, 0);  // 3:30 PM IST
  return expiry;
}

/**
 * Get last Tuesday of a given month (for monthly expiry calculation).
 * If that Tuesday is a holiday, caller must subtract 1 day (Monday).
 */
export function getMonthlyNiftyExpiry(year: number, month: number): Date {
  // month is 0-indexed (Jan=0)
  const lastDay = new Date(year, month + 1, 0);  // last day of month
  const expiry  = new Date(lastDay);
  // Walk backwards to find last Tuesday (day=2)
  while (expiry.getDay() !== 2) {
    expiry.setDate(expiry.getDate() - 1);
  }
  expiry.setHours(15, 30, 0, 0);
  return expiry;
}

// ============================================================================
// MAIN: CALCULATE ENTIRE CHAIN WITH GREEKS
// ============================================================================

/**
 * Calculate IV + Greeks for every strike in the options chain.
 *
 * Key guarantees:
 *  - strike_price is ALWAYS a number (DB returns strings — we convert)
 *  - All numeric DB fields converted to Number
 *  - ce_greeks/pe_greeks = undefined (not null) when IV unsolvable
 *  - T has a 1-hour floor to prevent div-by-zero on expiry day morning
 */
export function calculateChainGreeks(
  chain: any[],
  spotPrice: number,
  expiryDate: Date
): OptionWithGreeks[] {
  const now = new Date();

  // Minimum T = 1 hour → prevents extreme/infinite Greeks on expiry morning
  const T = Math.max(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR),
    1 / (24 * DAYS_PER_YEAR)
  );

  return chain.map((row): OptionWithGreeks => {
    // DB returns numeric columns as strings — always convert
    const strike = Number(row.strike_price);
    const ceLTP  = row.ce_ltp  != null ? Number(row.ce_ltp)  : null;
    const peLTP  = row.pe_ltp  != null ? Number(row.pe_ltp)  : null;

    let ce_greeks: Greeks | undefined;
    let pe_greeks: Greeks | undefined;

    // ── CE Greeks ─────────────────────────────────────────────────────────
    if (ceLTP != null && ceLTP > 0) {
      // calculateImpliedVolatility returns PERCENTAGE (e.g. 20.5)
      const iv = calculateImpliedVolatility(ceLTP, spotPrice, strike, T, RISK_FREE_RATE, DIVIDEND_YIELD, 'call');
      if (iv != null && iv > 0) {
        // calculateGreeks needs sigma as DECIMAL → divide by 100
        const g = calculateGreeks(spotPrice, strike, T, RISK_FREE_RATE, DIVIDEND_YIELD, iv / 100, 'call');
        ce_greeks = { ...g, iv: Number(iv.toFixed(2)) };
      }
    }

    // ── PE Greeks ─────────────────────────────────────────────────────────
    if (peLTP != null && peLTP > 0) {
      const iv = calculateImpliedVolatility(peLTP, spotPrice, strike, T, RISK_FREE_RATE, DIVIDEND_YIELD, 'put');
      if (iv != null && iv > 0) {
        const g = calculateGreeks(spotPrice, strike, T, RISK_FREE_RATE, DIVIDEND_YIELD, iv / 100, 'put');
        pe_greeks = { ...g, iv: Number(iv.toFixed(2)) };
      }
    }

    return {
      strike_price: strike,     // ← NUMBER guaranteed
      ce_ltp:    ceLTP,
      pe_ltp:    peLTP,
      ce_volume: row.ce_volume != null ? Number(row.ce_volume) : null,
      pe_volume: row.pe_volume != null ? Number(row.pe_volume) : null,
      ce_oi:     row.ce_oi    != null ? Number(row.ce_oi)    : null,
      pe_oi:     row.pe_oi    != null ? Number(row.pe_oi)    : null,
      ce_greeks,
      pe_greeks,
    };
  });
}

// ============================================================================
// ATM IV EXTRACTOR — for real IV history storage in DB
// ============================================================================

/**
 * Extract ATM IV from a calculated chain.
 * Called by api-server.ts every tick to store real IV to iv_history table.
 *
 * Safe: strike_price is guaranteed Number by calculateChainGreeks(),
 * so the equality check is always number === number (never string === number).
 */
export function getATMiv(chain: OptionWithGreeks[], spotPrice: number): number | null {
  const atmStrike = Math.round(spotPrice / 50) * 50;
  const atmRow    = chain.find(r => r.strike_price === atmStrike);
  // Prefer CE IV (more liquid ATM), fall back to PE IV
  return atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? null;
}