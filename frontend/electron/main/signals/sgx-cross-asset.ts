// src/main/signals/sgx-cross-asset.ts
// SGX Lead Model (Eq VI.4-VI.10 Vol III) + Cross-Asset Signals (Eq VII.3-VII.8 Vol III)

import type { SGXCrossAssetResult } from './types'

export class SGXCrossAssetMonitor {
  private nseOpenTime:   number = 0
  private prevNSEClose:  number = 0
  private prevUSDINR:    number = 83.0
  private prevCrude:     number = 85.0
  private betaNiftySPX:  number = 0.6    // rolling beta — update daily from regression
  private sgxPriceAt715: number = 0      // SGX price at 7:15 AM IST for momentum

  setSessionContext(prevClose: number, openTs: number): void {
    this.prevNSEClose  = prevClose
    this.nseOpenTime   = openTs
  }

  setSGXMorningRef(sgxPriceAt715: number): void {
    this.sgxPriceAt715 = sgxPriceAt715
  }

  update(data: {
    sgxPrice?:   number   // SGX NIFTY futures current price
    usdInr?:     number   // USD/INR spot
    crude?:      number   // Brent crude price
    spxFutures?: number   // S&P 500 futures return (fraction, e.g. 0.005)
    timestamp:   number
  }): SGXCrossAssetResult {
    const { timestamp } = data
    const minutesSinceOpen = Math.max(0, (timestamp - this.nseOpenTime) / 60000)

    // ── SGX Gap signal (Eq VI.3, VI.10 Vol III) ──────────────────────────
    const sgxGap = data.sgxPrice && this.prevNSEClose
      ? (data.sgxPrice - this.prevNSEClose) / this.prevNSEClose * 100
      : 0

    const sgxMomentum = data.sgxPrice && this.sgxPriceAt715 && this.sgxPriceAt715 > 0
      ? (data.sgxPrice - this.sgxPriceAt715) / this.sgxPriceAt715 * 100
      : sgxGap

    // Regression betas from Eq VI.10 Vol III: β1=0.45, β2=0.31, β3=0.18
    const sgxRaw = 0.45 * sgxGap + 0.31 * sgxMomentum

    // Exponential decay after NSE open (Eq VI.4 Vol III)
    // Large gaps decay slower (smaller λ_abs)
    const lambdaAbs = Math.abs(sgxGap) > 1.5 ? 0.03 :
                      Math.abs(sgxGap) > 0.8  ? 0.06 :
                      Math.abs(sgxGap) > 0.3  ? 0.12 : 0.25

    const sgxDecayed = sgxRaw * Math.exp(-lambdaAbs * minutesSinceOpen)
    const sgxSignal  = Math.sign(sgxDecayed) * Math.min(1, Math.abs(sgxDecayed) / 0.5)

    // ── USD/INR signal (Eq VII.3 Vol III) ────────────────────────────────
    let inrSignal = 0
    if (data.usdInr) {
      const inrChange = (data.usdInr - this.prevUSDINR) / this.prevUSDINR * 100
      this.prevUSDINR = data.usdInr
      // INR weakening (USD/INR rising) → FII mechanical selling → NIFTY negative
      // Sensitivity depends on FII regime — use 0.7 as default (Part VII Vol III)
      inrSignal = -Math.sign(inrChange) * Math.min(1, Math.abs(inrChange) / 0.5) * 0.7
    }

    // ── Crude oil signal (Eq VII.4 Vol III) ──────────────────────────────
    let crudeSignal = 0
    if (data.crude) {
      const crudeChange = (data.crude - this.prevCrude) / this.prevCrude * 100
      this.prevCrude = data.crude
      // Crude up → NIFTY down (OMC pressure + inflation + FII EM risk-off)
      const crudeRaw  = -Math.sign(crudeChange) * Math.min(1, Math.abs(crudeChange) / 3.0)
      // Decay over session (Eq VII.4)
      crudeSignal = crudeRaw * Math.exp(-0.05 * minutesSinceOpen)
    }

    // ── US Futures signal (Eq VII.6-VII.7 Vol III) ───────────────────────
    let usSignal = 0
    if (data.spxFutures != null) {
      // NIFTY beta to SPX is ~0.6 on average
      const usRaw = this.betaNiftySPX * data.spxFutures * 100
      // Decay very fast — fully absorbed within 45 min (Eq VII.7)
      usSignal = usRaw * Math.exp(-0.1 * minutesSinceOpen)
    }

    // ── Composite cross-asset (Eq VII.8-VII.9 Vol III) ───────────────────
    // Weights: w_INR=0.40, w_crude=0.25, w_US=0.35 at open
    // After 10AM: US weight → 0, INR and crude increase
    const usWeight    = Math.max(0, 0.35 - minutesSinceOpen * 0.01)
    const inrWeight   = Math.min(0.55, 0.40 + minutesSinceOpen * 0.005)
    const crudeWeight = Math.min(0.35, 0.25 + minutesSinceOpen * 0.003)

    const composite = inrWeight * inrSignal + crudeWeight * crudeSignal +
                      usWeight  * usSignal  + 0.3 * sgxDecayed

    return { sgxGap, sgxSignal, inrSignal, crudeSignal, usSignal, composite }
  }

  updateBeta(beta: number): void {
    this.betaNiftySPX = Math.max(0.2, Math.min(1.5, beta))
  }
}
