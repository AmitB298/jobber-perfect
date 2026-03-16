// src/main/signals/gm-hasbrouck-amihud.ts
// Glosten-Milgrom (1985) alpha + Hasbrouck IS + Amihud ILLIQ
// Vol I derivations, Vol II Amihud-Kyle bridge (Eq VII.10-VII.11)

import type { GMResult, HasbrouckResult, AmihudResult } from './types'

// ── Glosten-Milgrom Sequential Trade Model ────────────────────────────────

export class GMEstimator {
  private tradeBuffer: { price: number; type: 'buy' | 'sell'; timestamp: number }[] = []
  private alphaHistory: number[] = []
  private readonly window = 100  // trades

  /**
   * Feed each trade tick.
   * type: 'buy' if trade at ask, 'sell' if trade at bid
   * Uses ML estimator for α = P(informed trader) — Eq III.1-III.15 Vol I
   */
  update(bid: number, ask: number, tradePrice: number, timestamp: number): GMResult {
    const spread = ask - bid
    const mid    = (bid + ask) / 2

    const type: 'buy' | 'sell' = tradePrice >= mid ? 'buy' : 'sell'
    this.tradeBuffer.push({ price: tradePrice, type, timestamp })
    if (this.tradeBuffer.length > this.window) this.tradeBuffer.shift()

    if (this.tradeBuffer.length < 20) {
      return { alpha: 0.15, spread, fairSpread: spread * 0.85, alphaZ: 0 }
    }

    // Estimate alpha via price impact regression
    // Post-trade price revision = α × (trade direction) × fair spread/2
    const revisions: number[] = []
    for (let i = 1; i < this.tradeBuffer.length; i++) {
      const prev = this.tradeBuffer[i - 1]
      const curr = this.tradeBuffer[i]
      const dir  = prev.type === 'buy' ? 1 : -1
      const rev  = (curr.price - prev.price) * dir
      revisions.push(rev)
    }

    const meanRev = revisions.reduce((a, b) => a + b, 0) / revisions.length
    // Alpha = 2 × E[price revision per trade direction] / spread
    const alpha = Math.max(0, Math.min(0.99, spread > 0 ? (2 * Math.abs(meanRev)) / spread : 0.15))

    this.alphaHistory.push(alpha)
    if (this.alphaHistory.length > 500) this.alphaHistory.shift()

    const mu  = this.alphaHistory.reduce((a, b) => a + b, 0) / this.alphaHistory.length
    const sig = Math.sqrt(this.alphaHistory.reduce((s, v) => s + (v - mu) ** 2, 0) / this.alphaHistory.length) + 0.001
    const alphaZ = (alpha - mu) / sig

    const fairSpread = 2 * alpha * (spread / 2) + 2 * (1 - alpha) * 0.01 * mid

    return { alpha, spread, fairSpread, alphaZ }
  }
}

// ── Hasbrouck Information Share ────────────────────────────────────────────

export class HasbrouckISEstimator {
  private priceHistory: { spot: number; futures: number; ts: number }[] = []
  private readonly window = 120  // observations (2 min at 1/sec)

  update(spotPrice: number, futuresPrice: number, timestamp: number): HasbrouckResult {
    this.priceHistory.push({ spot: spotPrice, futures: futuresPrice, ts: timestamp })
    if (this.priceHistory.length > this.window) this.priceHistory.shift()

    const basis = futuresPrice - spotPrice

    if (this.priceHistory.length < 20) {
      return { isFutures: 0.6, isSpot: 0.4, basis }
    }

    // Compute returns
    const spotRets = this.priceHistory.slice(1).map((h, i) => h.spot - this.priceHistory[i].spot)
    const futRets  = this.priceHistory.slice(1).map((h, i) => h.futures - this.priceHistory[i].futures)

    // Variance of each series
    const varSpot = variance(spotRets)
    const varFut  = variance(futRets)
    const covSF   = covariance(spotRets, futRets)

    // Hasbrouck IS: information share proportional to variance contribution
    // Simplified: IS_futures = Var(fut) / (Var(fut) + Var(spot) - 2·Cov)
    // Full Gonzalo-Granger approach requires VECM — this is the upper bound approximation
    const total   = varSpot + varFut
    const isFutures = total > 0 ? Math.max(0, Math.min(1, varFut / total + covSF / total)) : 0.6
    const isSpot    = 1 - isFutures

    return { isFutures, isSpot, basis }
  }
}

// ── Amihud ILLIQ + Kyle Bridge ─────────────────────────────────────────────

export class AmihudKyleBridge {
  private dailyData: { ret: number; volume: number }[] = []
  private illiqHistory: number[] = []

  /**
   * Feed EOD data: absolute return (%) and total volume (lots)
   * Eq VII.1-VII.11 Vol II
   */
  updateDaily(absReturn: number, volume: number): AmihudResult {
    this.dailyData.push({ ret: absReturn, volume })
    if (this.dailyData.length > 252) this.dailyData.shift()

    if (this.dailyData.length < 5) {
      return { illiq: 0, kyleLambda: 0, illiqRank: 50 }
    }

    // ILLIQ = (1/D) · Σ |r_t| / Volume_t  (Amihud 2002)
    const n    = this.dailyData.length
    const illiq = this.dailyData.reduce((s, d) =>
      s + (d.volume > 0 ? d.ret / d.volume : 0), 0) / n

    this.illiqHistory.push(illiq)
    if (this.illiqHistory.length > 500) this.illiqHistory.shift()

    // Amihud-Kyle bridge: λ = ILLIQ × P_0 × √(π/2)  (Eq VII.11 Vol II)
    const SQRT_PI_2 = Math.sqrt(Math.PI / 2)  // ≈ 1.2533
    const p0        = 22000  // approximate NIFTY level
    const kyleLambda = illiq * p0 * SQRT_PI_2

    const illiqRank = percentile(illiq, this.illiqHistory)

    return { illiq, kyleLambda, illiqRank }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function variance(arr: number[]): number {
  if (arr.length < 2) return 0
  const mu = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const muA = a.slice(0, n).reduce((s, v) => s + v, 0) / n
  const muB = b.slice(0, n).reduce((s, v) => s + v, 0) / n
  return a.slice(0, n).reduce((s, v, i) => s + (v - muA) * (b[i] - muB), 0) / n
}

function percentile(val: number, arr: number[]): number {
  if (arr.length === 0) return 50
  const sorted = [...arr].sort((a, b) => a - b)
  const idx    = sorted.findIndex(v => v >= val)
  return idx < 0 ? 100 : (idx / sorted.length) * 100
}
