// src/main/signals/fii-analyzer.ts
// FII Participant Data Analyzer — Eq V.1-V.6, Part V Vol III

import type { FIIResult, OptionTick } from './types'

const LOT_SIZE = 75

export class FIIAnalyzer {
  private prevNetFutures: number   = 0
  private netFutHistory:  number[] = []

  update(data: {
    fiiLongFutures:   number
    fiiShortFutures:  number
    fiiOptionsChain?: { strike: number; type: 'CE' | 'PE'; fiiOI: number; delta: number }[]
  }): FIIResult {

    const netFutures   = data.fiiLongFutures - data.fiiShortFutures  // Eq V.1
    const netChange    = netFutures - this.prevNetFutures              // Eq V.2
    this.prevNetFutures = netFutures

    this.netFutHistory.push(netFutures)
    if (this.netFutHistory.length > 252) this.netFutHistory.shift()

    // Options delta (Eq V.5)
    let optionsDelta = 0
    const fiiOptions = data.fiiOptionsChain ?? []
    for (const opt of fiiOptions) {
      const sign    = opt.type === 'CE' ? 1 : -1
      optionsDelta += sign * opt.fiiOI * Math.abs(opt.delta)
    }

    // Total FII delta (Eq V.6)
    const totalDelta = netFutures * LOT_SIZE + optionsDelta * LOT_SIZE

    // Regime
    const regime = classifyRegime(netFutures, netChange)

    // Short squeeze: large net short AND actively covering (Eq V.3, Part V Vol III)
    const shortSqueezeRisk = netFutures < -50000 && netChange > 3000

    // Key strikes: sorted by FII OI
    const keyStrikes = [...fiiOptions]
      .sort((a, b) => b.fiiOI - a.fiiOI)
      .slice(0, 8)
      .map(o => ({ strike: o.strike, type: o.type as 'CE' | 'PE', oi: o.fiiOI }))

    return {
      netFutures, netChange, optionsDelta, totalDelta,
      regime, shortSqueeze: shortSqueezeRisk, keyStrikes,
    }
  }
}

function classifyRegime(net: number, change: number): string {
  if (net > 50000  && change > 0)  return 'Strongly Bullish — Accumulating'
  if (net > 50000  && change < 0)  return 'Distribution — Unwinding Longs'
  if (net > 20000  && change > 0)  return 'Mildly Bullish — Building'
  if (net > 0      && change < 0)  return 'Mildly Bearish — Reducing'
  if (net < -50000 && change < 0)  return 'Strongly Bearish — Adding Shorts'
  if (net < -50000 && change > 0)  return 'Short Squeeze Setup — Covering ⚡'
  if (net < -20000 && change < 0)  return 'Mildly Bearish — Shorting'
  if (net < 0      && change > 0)  return 'Short Covering — Reducing Shorts'
  return 'Neutral'
}
