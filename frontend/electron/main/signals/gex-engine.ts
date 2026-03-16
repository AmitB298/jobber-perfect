// src/main/signals/gex-engine.ts
// Gamma Exposure — Eq II.1-II.8 Vol III
// Dealer GEX profile, zero-cross level, regime detection

import { bsGamma } from './bs-math'
import type { GEXResult, OptionTick } from './types'

const RISK_FREE = 0.065
const LOT_SIZE  = 75

export class GEXEngine {
  private gexHistory: number[] = []

  compute(chain: OptionTick[], spot: number): GEXResult {
    // Evaluate GEX(S) on a ±1000pt grid around current spot
    const step  = 25
    const range = 1000
    const spotGrid: number[] = []
    const gexGrid:  number[] = []

    for (let S = spot - range; S <= spot + range; S += step) {
      spotGrid.push(S)
      let gex = 0
      for (const opt of chain) {
        const T = opt.dte / 252
        if (T <= 0 || opt.iv <= 0) continue
        const g = bsGamma({ S, K: opt.strike, T, r: RISK_FREE, sigma: opt.iv, type: opt.type })
        // Dealers SHORT options: PE contributes positive GEX (they're short puts = long when market falls)
        // CE contributes negative GEX (they're short calls = short when market rises)
        // Net GEX < 0 = dealers net short gamma = amplifies moves (Eq II.7 Vol III)
        const sign = opt.type === 'PE' ? 1 : -1
        gex += sign * opt.oi * g * S * 0.01 * LOT_SIZE
      }
      gexGrid.push(gex)
    }

    // GEX at current spot
    const spotIdx  = Math.min(Math.round(range / step), gexGrid.length - 1)
    const gexAtSpot = gexGrid[spotIdx] ?? 0

    // Zero-cross: where GEX changes sign (Eq II.4-II.5)
    let zeroCross = spot
    for (let i = 0; i < gexGrid.length - 1; i++) {
      if (gexGrid[i] * gexGrid[i + 1] <= 0 && Math.abs(gexGrid[i]) + Math.abs(gexGrid[i+1]) > 0) {
        const frac = Math.abs(gexGrid[i]) / (Math.abs(gexGrid[i]) + Math.abs(gexGrid[i + 1]))
        zeroCross  = spotGrid[i] + frac * step
        break
      }
    }

    // Call wall: strike with max gamma contribution from calls
    const callContribs = chain
      .filter(o => o.type === 'CE')
      .map(o => {
        const T = o.dte / 252
        const g = T > 0 ? bsGamma({ S: spot, K: o.strike, T, r: RISK_FREE, sigma: o.iv, type: 'CE' }) : 0
        return { strike: o.strike, contrib: o.oi * g * spot * 0.01 * LOT_SIZE }
      })
      .sort((a, b) => b.contrib - a.contrib)

    const putContribs = chain
      .filter(o => o.type === 'PE')
      .map(o => {
        const T = o.dte / 252
        const g = T > 0 ? bsGamma({ S: spot, K: o.strike, T, r: RISK_FREE, sigma: o.iv, type: 'PE' }) : 0
        return { strike: o.strike, contrib: o.oi * g * spot * 0.01 * LOT_SIZE }
      })
      .sort((a, b) => b.contrib - a.contrib)

    const callWall = callContribs[0]?.strike ?? spot
    const putWall  = putContribs[0]?.strike  ?? spot

    // GEX by strike for UI heatmap
    const strikeSet = [...new Set(chain.map(o => o.strike))].sort((a, b) => a - b)
    const gexByStrike = strikeSet.map(strike => {
      let gex = 0
      for (const opt of chain.filter(o => o.strike === strike)) {
        const T = opt.dte / 252
        if (T <= 0 || opt.iv <= 0) continue
        const g = bsGamma({ S: spot, K: strike, T, r: RISK_FREE, sigma: opt.iv, type: opt.type })
        gex += (opt.type === 'PE' ? 1 : -1) * opt.oi * g * spot * 0.01 * LOT_SIZE
      }
      return { strike, gex }
    })

    const distToZero = spot - zeroCross
    const regime: GEXResult['regime'] =
      gexAtSpot > 5e7   ? 'suppressed' :
      gexAtSpot < -5e7  ? 'amplified'  : 'neutral'

    return { gexAtSpot, zeroCross, callWall, putWall, regime, distToZero, gexByStrike }
  }
}
