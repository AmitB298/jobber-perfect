// src/main/signals/kyle-lambda.ts
// Kyle (1985) Lambda — price impact of informed flow
// Continuous-time extension from Back (1992) for intraday regime

import type { KyleLambdaResult } from './types'

export class KyleLambdaEstimator {
  // Ring buffer sufficient statistics for rolling OLS
  private n    = 0
  private sumX = 0  // OFI
  private sumY = 0  // Δprice
  private sumXX= 0
  private sumXY= 0
  private sumYY= 0

  private lambdaHistory: number[] = []
  private readonly windowSize: number

  constructor(windowSize = 200) {
    this.windowSize = windowSize
  }

  /** Feed one tick: deltaPrice = price change, ofi = net order flow in lots */
  update(deltaPrice: number, ofi: number): KyleLambdaResult {
    // Add to sufficient statistics
    this.n++; this.sumX += ofi; this.sumY += deltaPrice
    this.sumXX += ofi * ofi; this.sumXY += ofi * deltaPrice
    this.sumYY += deltaPrice * deltaPrice

    // Maintain window by subtracting oldest (approximate for speed)
    if (this.n > this.windowSize) {
      const w = this.windowSize
      // Rolling approximation: weight-decay oldest contribution
      this.sumX  *= w / (w + 1)
      this.sumY  *= w / (w + 1)
      this.sumXX *= w / (w + 1)
      this.sumXY *= w / (w + 1)
      this.sumYY *= w / (w + 1)
      this.n = w
    }

    // OLS estimate: λ = Cov(Δp, OFI) / Var(OFI)  (Eq II.32 Vol I)
    const varX = this.sumXX / this.n - (this.sumX / this.n) ** 2
    const covXY = this.sumXY / this.n - (this.sumX / this.n) * (this.sumY / this.n)
    const varY  = this.sumYY / this.n - (this.sumY / this.n) ** 2

    const lambda = varX > 1e-10 ? covXY / varX : 0

    // R² of regression
    const r2 = varX > 1e-10 && varY > 1e-10
      ? (covXY * covXY) / (varX * varY)
      : 0

    // Track history for z-score
    if (lambda !== 0) {
      this.lambdaHistory.push(Math.abs(lambda))
      if (this.lambdaHistory.length > 500) this.lambdaHistory.shift()
    }

    const lambdaZ = this.zScore(Math.abs(lambda), this.lambdaHistory)

    const regime: KyleLambdaResult['regime'] =
      lambdaZ > 3.0 ? 'extreme'  :
      lambdaZ > 2.0 ? 'elevated' :
      lambdaZ > 1.0 ? 'normal'   : 'low'

    return { lambda, lambdaZ, regime, r2: Math.max(0, Math.min(1, r2)) }
  }

  private zScore(val: number, hist: number[]): number {
    if (hist.length < 10) return 0
    const mu  = hist.reduce((a, b) => a + b, 0) / hist.length
    const sig = Math.sqrt(hist.reduce((s, v) => s + (v - mu) ** 2, 0) / hist.length)
    return sig > 0 ? (val - mu) / sig : 0
  }

  reset(): void {
    this.n = this.sumX = this.sumY = this.sumXX = this.sumXY = this.sumYY = 0
    this.lambdaHistory = []
  }
}
