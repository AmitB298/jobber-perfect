// src/main/signals/vpin.ts
// VPIN — Volume-Synchronized Probability of Informed Trading
// Easley, Lopez de Prado, O'Hara (2012) — Eq IV.1-IV.6 Vol I

import type { VPINResult } from './types'

interface Bucket {
  buyVol:  number
  sellVol: number
  total:   number
}

export class VPINEstimator {
  private buckets:      Bucket[] = []
  private currentBucket: Bucket = { buyVol: 0, sellVol: 0, total: 0 }
  private priceHistory: number[] = []
  private vpinHistory:  number[] = []

  private readonly bucketSize: number  // total volume per bucket
  private readonly nBuckets:   number  // rolling window of buckets

  constructor(bucketSize = 5000, nBuckets = 50) {
    this.bucketSize = bucketSize
    this.nBuckets   = nBuckets
  }

  /**
   * Feed one trade tick
   * price: trade price, volume: lots, prevPrice: previous tick price
   * Uses BVC (Bulk Volume Classification) — Eq IV.2 Vol I
   */
  update(price: number, volume: number, prevPrice: number): VPINResult {
    // Maintain rolling price history for σ_Δp
    this.priceHistory.push(price)
    if (this.priceHistory.length > 200) this.priceHistory.shift()

    const sigDp = this.stdDiff(this.priceHistory)

    // BVC: buy fraction = Φ((price - prevPrice) / σ_Δp)
    const z        = sigDp > 0 ? (price - prevPrice) / sigDp : 0
    const buyFrac  = this.phiApprox(z)
    const buyVol   = volume * buyFrac
    const sellVol  = volume * (1 - buyFrac)

    this.currentBucket.buyVol  += buyVol
    this.currentBucket.sellVol += sellVol
    this.currentBucket.total   += volume

    // Check if bucket is full
    if (this.currentBucket.total >= this.bucketSize) {
      this.buckets.push({ ...this.currentBucket })
      if (this.buckets.length > this.nBuckets) this.buckets.shift()
      this.currentBucket = { buyVol: 0, sellVol: 0, total: 0 }
    }

    if (this.buckets.length < 2) {
      return { vpin: 0, vpinPct: 0, regime: 'safe', buyVolumeRatio: 0.5 }
    }

    // VPIN = (1/(n·V_B)) · Σ|V_buy - V_sell|  (Eq IV.6 Vol I)
    const n    = this.buckets.length
    const vpin = this.buckets.reduce((s, b) =>
      s + Math.abs(b.buyVol - b.sellVol), 0) / (n * this.bucketSize)

    // Track for percentile
    this.vpinHistory.push(vpin)
    if (this.vpinHistory.length > 2000) this.vpinHistory.shift()

    const vpinPct  = this.percentile(vpin, this.vpinHistory)
    const buyVolumeRatio = this.currentBucket.total > 0
      ? this.currentBucket.buyVol / this.currentBucket.total : 0.5

    const regime: VPINResult['regime'] =
      vpinPct > 90 ? 'critical' :
      vpinPct > 75 ? 'alert'    :
      vpinPct > 50 ? 'watch'    : 'safe'

    return { vpin, vpinPct, regime, buyVolumeRatio }
  }

  /** Φ(z) rational approximation — Hart (1968), error < 1.5e-7 */
  private phiApprox(z: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(z))
    const phi_z = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
    const p = 1 - phi_z * t * (0.319381530 + t * (-0.356563782 + t * (
      1.781477937 + t * (-1.821255978 + 1.330274429 * t))))
    return z >= 0 ? p : 1 - p
  }

  private stdDiff(arr: number[]): number {
    if (arr.length < 2) return 1
    const diffs = arr.slice(1).map((v, i) => v - arr[i])
    const mu  = diffs.reduce((a, b) => a + b, 0) / diffs.length
    return Math.sqrt(diffs.reduce((s, v) => s + (v - mu) ** 2, 0) / diffs.length) + 1e-10
  }

  private percentile(val: number, arr: number[]): number {
    if (arr.length === 0) return 50
    const sorted = [...arr].sort((a, b) => a - b)
    const idx    = sorted.findIndex(v => v >= val)
    return idx < 0 ? 100 : (idx / sorted.length) * 100
  }

  reset(): void {
    this.buckets      = []
    this.currentBucket= { buyVol: 0, sellVol: 0, total: 0 }
    this.priceHistory = []
    this.vpinHistory  = []
  }
}
