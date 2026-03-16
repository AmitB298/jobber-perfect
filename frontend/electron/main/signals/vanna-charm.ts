// src/main/signals/vanna-charm.ts
// Vanna (dDelta/dSigma) and Charm (dDelta/dt) aggregate market flows
// Eq III.1-III.13 Vol II, Part III Vol III

import { bsVanna, bsCharm } from './bs-math'
import type { VannaCharmResult, OptionTick } from './types'

const RISK_FREE = 0.065
const LOT_SIZE  = 75

export class VannaCharmEngine {
  compute(chain: OptionTick[], spot: number): VannaCharmResult {
    let totalVanna = 0
    let totalCharm = 0

    for (const opt of chain) {
      const T = opt.dte / 252
      if (T <= 0 || opt.iv <= 0) continue

      const params = { S: spot, K: opt.strike, T, r: RISK_FREE, sigma: opt.iv, type: opt.type }

      // Dealers SHORT options → negative sign (Eq III.6, III.10 Vol II)
      const v = bsVanna(params)
      const c = bsCharm(params)
      totalVanna -= opt.oi * v * LOT_SIZE
      totalCharm -= opt.oi * c * LOT_SIZE
    }

    // Vanna flow: ₹ per 1% IV change (Eq III.7-III.8 Vol II)
    const vannaFlow = totalVanna * spot * 0.01

    // Charm flow per day (Eq III.11 Vol II)
    const charmFlow = totalCharm * spot * (1 / 252)

    // Max pain: strike minimising total buyer payout (Eq — Part III Vol III)
    const strikes = [...new Set(chain.map(o => o.strike))].sort((a, b) => a - b)
    let maxPain   = spot
    let minPayout = Infinity

    for (const S of strikes) {
      let payout = 0
      for (const opt of chain) {
        if (opt.type === 'CE') payout += opt.oi * Math.max(0, S - opt.strike)
        else                   payout += opt.oi * Math.max(0, opt.strike - S)
      }
      if (payout < minPayout) { minPayout = payout; maxPain = S }
    }

    const distToMaxPain = spot - maxPain

    // Expiry urgency: rises to 1 as DTE → 0
    const minDTE       = Math.min(...chain.map(o => o.dte).filter(d => d >= 0), 30)
    const expiryUrgency = Math.max(0, Math.min(1, 1 - minDTE / 5))

    const charmDir: VannaCharmResult['charmDir'] =
      charmFlow > 1e6  ? 'buy'  :
      charmFlow < -1e6 ? 'sell' : 'neutral'

    return { vannaFlow, charmFlow, maxPain, distToMaxPain, charmDir, expiryUrgency }
  }
}
