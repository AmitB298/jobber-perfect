// src/main/signals/back-bridge-ninsider-deltaflow.ts
// Back (1992) Brownian Bridge Detector — Eq I.38 Vol II
// N-Insider Kyle Model — Eq II.19 Vol II
// Options Delta Flow Monitor — Eq IV.13 Vol II

import type { BridgeResult, NInsiderResult, OptionsDeltaFlowResult, OptionTick } from './types'

// ── Back (1992) Brownian Bridge Detector ──────────────────────────────────

export class BackBridgeDetector {
  private priceHistory: { price: number; ts: number }[] = []
  private sessionStart: number = 0

  setSessionStart(ts: number, openPrice: number): void {
    this.sessionStart = ts
    this.priceHistory = [{ price: openPrice, ts }]
  }

  update(price: number, ts: number): BridgeResult {
    this.priceHistory.push({ price, ts })
    if (this.priceHistory.length > 1000) this.priceHistory.shift()

    if (this.priceHistory.length < 20) {
      return { bridgeCorr: 0, target: price, betaT: 0, detected: false }
    }

    // Estimate target via linear price trend extrapolated to session close (3:30 PM)
    const closeTs   = this.getSessionClose(ts)
    const T_total   = closeTs - this.sessionStart
    const prices    = this.priceHistory.map(h => h.price)
    const times     = this.priceHistory.map(h => (h.ts - this.sessionStart) / T_total)

    // Linear regression: price ~ a + b·t → target = a + b·1.0
    const { slope, intercept } = linearRegression(times, prices)
    const target = intercept + slope * 1.0

    // Bridge correlation: Corr(Δp_t, target - p_t)
    // Under Brownian bridge: price is pulled toward target, so correlation > 0
    const diffs     = prices.slice(1).map((p, i) => p - prices[i])
    const pullToTgt = prices.slice(0, -1).map(p => target - p)

    const bridgeCorr = pearsonCorr(diffs, pullToTgt)

    // Back (1992) beta_T = 1/(λ(T-t)) → trading intensity
    const t_remaining = Math.max(0.01, (closeTs - ts) / T_total)
    const sigma0 = 100   // prior std in NIFTY points
    const sigmaU = 500   // noise flow std in lots
    const lambda = Math.sqrt(sigma0) / (sigmaU * Math.sqrt(1.0))  // Eq I.30 Vol II
    const betaT  = 1 / (lambda * t_remaining)  // Eq I.32 Vol II — blows up at close

    // Detected if bridge correlation > 0.25  (Eq I.38 Vol II threshold)
    const detected = bridgeCorr > 0.25

    return { bridgeCorr, target, betaT, detected }
  }

  private getSessionClose(ts: number): number {
    const d = new Date(ts)
    d.setHours(15, 30, 0, 0)
    return d.getTime()
  }
}

// ── N-Insider Kyle Estimator ──────────────────────────────────────────────

export class NInsiderEstimator {
  private lambdaHistory: number[] = []
  private readonly sigma0 = 100   // prior vol in NIFTY points
  private readonly sigmaU = 500   // noise trader flow std

  /**
   * Given observed Kyle lambda, solve for N (Eq II.19 Vol II)
   * N-insider lambda: λ_N = √(N·Σ₀) / (σ_u·(N+1))
   * Solve: rN² + (2r-1)N + r = 0  where r = λ²·σ_u²/Σ₀
   */
  update(observedLambda: number): NInsiderResult {
    const lambda = Math.abs(observedLambda)
    const r      = (lambda * lambda * this.sigmaU * this.sigmaU) / (this.sigma0 * this.sigma0)

    // Quadratic: rN² + (2r-1)N + r = 0
    const a = r
    const b = 2 * r - 1
    const c = r
    const disc = b * b - 4 * a * c

    let n = 1
    if (disc >= 0 && a !== 0) {
      const n1 = (-b + Math.sqrt(disc)) / (2 * a)
      const n2 = (-b - Math.sqrt(disc)) / (2 * a)
      // Pick positive root
      n = Math.max(1, Math.round(n1 > 0 ? n1 : n2))
    }

    // Clamp to reasonable range
    n = Math.max(1, Math.min(20, n))

    // Info revelation rate = 2N/(N+1)²  (Eq II.30 Vol II)
    const infoRevRate = (2 * n) / ((n + 1) ** 2)

    const competition: NInsiderResult['competition'] =
      n === 1 ? 'monopoly'    :
      n === 2 ? 'duopoly'     :
      n <= 5  ? 'oligopoly'   : 'competitive'

    return { n, competition, infoRevRate }
  }
}

// ── Options Delta Flow Monitor ────────────────────────────────────────────

export class OptionsDeltaFlowMonitor {
  private flowHistory: { ts: number; flow: number }[] = []
  private flowZHistory: number[] = []
  private spotHistory:  { ts: number; spot: number }[] = []

  /**
   * OFI_options = Σ_K [Δ(K)·(call_buy-call_sell) - Δ(K)·(put_buy-put_sell)]
   * Eq IV.13 Vol II
   */
  update(chain: OptionTick[], spot: number, timestamp: number): OptionsDeltaFlowResult {
    // Compute net delta-equivalent flow
    let deltaFlow = 0
    for (const opt of chain) {
      const dir      = opt.type === 'CE' ? 1 : -1
      // Proxy: volume × delta × sign (assume buy-heavy if price > prev close — simplified)
      const buyProxy = opt.volume * Math.abs(opt.delta) * dir
      deltaFlow     += buyProxy
    }

    this.flowHistory.push({ ts: timestamp, flow: deltaFlow })
    if (this.flowHistory.length > 500) this.flowHistory.shift()

    this.spotHistory.push({ ts: timestamp, spot })
    if (this.spotHistory.length > 500) this.spotHistory.shift()

    // Z-score (Eq IV.3 — similar to skew velocity z-score)
    const flows  = this.flowHistory.map(h => h.flow)
    const mu     = flows.reduce((a, b) => a + b, 0) / flows.length
    const sig    = Math.sqrt(flows.reduce((s, v) => s + (v - mu) ** 2, 0) / flows.length) + 1
    const deltaFlowZ = (deltaFlow - mu) / sig

    this.flowZHistory.push(deltaFlowZ)
    if (this.flowZHistory.length > 200) this.flowZHistory.shift()

    // Lead-lag: test τ=1..10 min, find where flow best predicts future spot
    const leadMinutes = this.findLeadMinutes()

    const direction: OptionsDeltaFlowResult['direction'] =
      deltaFlowZ >  1.5 ? 'bullish' :
      deltaFlowZ < -1.5 ? 'bearish' : 'neutral'

    return { deltaFlow, deltaFlowZ, leadMinutes, direction }
  }

  private findLeadMinutes(): number {
    if (this.flowHistory.length < 30 || this.spotHistory.length < 30) return 5

    let bestCorr = 0
    let bestLag  = 5

    for (let lag = 1; lag <= 10; lag++) {
      const lagMs    = lag * 60 * 1000
      const pairs: { flow: number; spotRet: number }[] = []

      for (const fh of this.flowHistory) {
        const futureSpot = this.spotHistory.find(s => s.ts >= fh.ts + lagMs)
        const currSpot   = this.spotHistory.find(s => s.ts >= fh.ts)
        if (futureSpot && currSpot && currSpot.spot > 0) {
          pairs.push({ flow: fh.flow, spotRet: futureSpot.spot - currSpot.spot })
        }
      }

      if (pairs.length < 5) continue
      const corr = pearsonCorr(pairs.map(p => p.flow), pairs.map(p => p.spotRet))
      if (Math.abs(corr) > Math.abs(bestCorr)) { bestCorr = corr; bestLag = lag }
    }

    return bestLag
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────

function pearsonCorr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 3) return 0
  const muX = x.slice(0, n).reduce((a, b) => a + b, 0) / n
  const muY = y.slice(0, n).reduce((a, b) => a + b, 0) / n
  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    num  += (x[i] - muX) * (y[i] - muY)
    denX += (x[i] - muX) ** 2
    denY += (y[i] - muY) ** 2
  }
  const den = Math.sqrt(denX * denY)
  return den > 0 ? num / den : 0
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n   = x.length
  const muX = x.reduce((a, b) => a + b, 0) / n
  const muY = y.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - muX) * (y[i] - muY)
    den += (x[i] - muX) ** 2
  }
  const slope = den > 0 ? num / den : 0
  return { slope, intercept: muY - slope * muX }
}
