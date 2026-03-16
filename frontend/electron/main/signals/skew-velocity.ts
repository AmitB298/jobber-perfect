// src/main/signals/skew-velocity.ts
// IV Skew Velocity — Eq IV.1-IV.7 Vol III
// Rate of change of 25-delta risk reversal = institutional hedging urgency

import type { SkewVelocityResult } from './types'

interface SkewSnapshot {
  ts:           number
  skewWeekly:   number  // put25d_IV - call25d_IV near expiry
  skewMonthly:  number  // put25d_IV - call25d_IV far expiry
}

export class IVSkewVelocityMonitor {
  private history:    SkewSnapshot[] = []
  private velHistory: number[]       = []

  update(
    call25dWeekly:  number,
    put25dWeekly:   number,
    call25dMonthly: number,
    put25dMonthly:  number,
    timestamp:      number
  ): SkewVelocityResult {
    const skewWeekly  = put25dWeekly  - call25dWeekly   // Eq IV.1
    const skewMonthly = put25dMonthly - call25dMonthly

    this.history.push({ ts: timestamp, skewWeekly, skewMonthly })
    if (this.history.length > 1000) this.history.shift()

    // Velocity over last 5 minutes (Eq IV.2)
    const cutoff = timestamp - 5 * 60 * 1000
    const recent = this.history.filter(h => h.ts >= cutoff)

    let velocity   = 0
    let termHorizon = 1.0

    if (recent.length >= 2) {
      const oldest = recent[0]
      const newest = recent[recent.length - 1]
      const dtMin  = Math.max(0.1, (newest.ts - oldest.ts) / 60000)

      const velWeekly  = (newest.skewWeekly  - oldest.skewWeekly)  / dtMin
      const velMonthly = (newest.skewMonthly - oldest.skewMonthly) / dtMin

      velocity    = velWeekly
      termHorizon = Math.abs(velWeekly) > 0.001
        ? velMonthly / velWeekly  // Eq IV.7
        : 1.0
    }

    this.velHistory.push(velocity)
    if (this.velHistory.length > 500) this.velHistory.shift()

    const mu  = this.velHistory.reduce((a, b) => a + b, 0) / this.velHistory.length
    const sig = Math.sqrt(
      this.velHistory.reduce((s, v) => s + (v - mu) ** 2, 0) / this.velHistory.length
    ) + 0.0001
    const velocityZ = (velocity - mu) / sig

    const urgency: SkewVelocityResult['urgency'] =
      Math.abs(velocityZ) > 4.0 ? 'extreme' :
      Math.abs(velocityZ) > 2.5 ? 'high'    :
      Math.abs(velocityZ) > 1.5 ? 'moderate': 'none'

    const direction: SkewVelocityResult['direction'] =
      velocityZ >  2.5 ? 'put_buying'  :
      velocityZ < -2.5 ? 'call_buying' :
      Math.abs(velocityZ) > 2.0 ? 'straddle'  : 'neutral'

    return {
      skew25d:   skewWeekly,
      velocity,
      velocityZ,
      urgency,
      direction,
    }
  }
}
