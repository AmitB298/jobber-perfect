// ============================================================================
// shared/BS.ts — Client-side Black-Scholes engine
// Used by: StrategyBuilderTab (payoff chart, Greeks, PoP)
// ============================================================================

function normCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  if (x < 0) return 1 - normCDF(-x);
  const t = 1 / (1 + 0.2316419 * x);
  const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - 0.3989422804014327 * Math.exp(-0.5 * x * x) * p;
}

function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) * 0.3989422804014327;
}

export interface BSResult {
  callPrice: number;
  putPrice: number;
  callDelta: number;
  putDelta: number;
  gamma: number;
  callTheta: number;
  putTheta: number;
  vega: number;
}

/** Full option greeks via Black-Scholes.
 *  @param S Spot price
 *  @param K Strike price
 *  @param T Time to expiry in years (e.g. 7/365)
 *  @param r Risk-free rate as decimal (e.g. 0.065)
 *  @param sigma IV as decimal (e.g. 0.18)
 */
export function bsGreeks(S: number, K: number, T: number, r: number, sigma: number): BSResult | null {
  if (!isFinite(S) || !isFinite(K) || S <= 0 || K <= 0 || sigma <= 0) return null;

  // At expiry — just intrinsic value
  if (T <= 0) {
    return {
      callPrice:  Math.max(0, S - K),
      putPrice:   Math.max(0, K - S),
      callDelta:  S > K ? 1 : S === K ? 0.5 : 0,
      putDelta:   S < K ? -1 : S === K ? -0.5 : 0,
      gamma: 0, callTheta: 0, putTheta: 0, vega: 0,
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1    = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2    = d1 - sigma * sqrtT;
  const Nd1   = normCDF(d1), Nd2 = normCDF(d2), nd1 = normPDF(d1);
  const KerT  = K * Math.exp(-r * T);

  return {
    callPrice:  Math.max(0, S * Nd1 - KerT * Nd2),
    putPrice:   Math.max(0, KerT * (1 - Nd2) - S * (1 - Nd1)),
    callDelta:  Nd1,
    putDelta:   Nd1 - 1,
    gamma:      nd1 / (S * sigma * sqrtT),
    callTheta:  (-(S * nd1 * sigma) / (2 * sqrtT) - r * KerT * Nd2) / 252,
    putTheta:   (-(S * nd1 * sigma) / (2 * sqrtT) + r * KerT * (1 - Nd2)) / 252,
    vega:       S * nd1 * sqrtT / 100,
  };
}

export interface StratLegForPoP {
  type: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  strike: number;
  premium: number;
  qty: number;
}

/** Monte-Carlo probability of profit for a multi-leg strategy.
 *  Uses log-normal distribution with 400-point trapezoid integration.
 */
export function strategyPoP(
  legs: StratLegForPoP[],
  spot: number,
  dte: number,
  iv: number,
  rate: number
): number | null {
  if (!legs.length) return null;

  const T = dte / 365;
  if (T <= 0) {
    const pl = legs.reduce((s, l) => {
      const intr = l.type === 'CE'
        ? Math.max(0, spot - l.strike)
        : Math.max(0, l.strike - spot);
      return s + (intr - l.premium) * (l.action === 'BUY' ? 1 : -1) * l.qty;
    }, 0);
    return pl > 0 ? 99.9 : 0.1;
  }

  const sigma = iv / 100, r = rate / 100;
  const mu = Math.log(spot) + (r - 0.5 * sigma * sigma) * T;
  const sd = sigma * Math.sqrt(T);

  const N = 400, minZ = -5, maxZ = 5, dz = (maxZ - minZ) / N;
  let prob = 0;
  for (let i = 0; i <= N; i++) {
    const z = minZ + i * dz;
    const price = Math.exp(mu + sd * z);
    const payoff = legs.reduce((s, l) => {
      const intr = l.type === 'CE'
        ? Math.max(0, price - l.strike)
        : Math.max(0, l.strike - price);
      return s + (intr - l.premium) * (l.action === 'BUY' ? 1 : -1) * l.qty;
    }, 0);
    const w = (i === 0 || i === N) ? 0.5 : 1.0;
    if (payoff > 0) prob += normPDF(z) * dz * w;
  }

  const totalW = normCDF(maxZ) - normCDF(minZ);
  return Math.min(99.9, Math.max(0.1, (prob / totalW) * 100));
}

/** Convenience namespace for drop-in compatibility with older BS.greeks / BS.strategyPoP usage */
export const BS = {
  greeks: bsGreeks,
  strategyPoP,
} as const;
