// signals/oi-velocity.ts
// OI Velocity & Institutional Detection Signal Engine

import { OptionTick, OIVelocityResult } from './types'

// ── Config ───────────────────────────────────────────────────────────────────
const WINDOW_SIZE     = 20   // bars for rolling stats
const INST_Z_THRESH   = 2.5  // z-score threshold for institutional flag
const VELOCITY_WINDOW = 5    // bars for velocity calculation

// ── Local types ───────────────────────────────────────────────────────────────
interface OIEntry {
  oi:        number
  timestamp: number
}

interface StrikeState {
  history:         OIEntry[]
  velocityHistory: number[]
}

function getRollingStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 }
  const mean     = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
  return { mean, std: Math.max(Math.sqrt(variance), 1e-9) }
}

// ── Class — matches: this.oiVel = new OIVelocityEngine()
//                    this.oiVel.update(chain, timestamp) ────────────────────
export class OIVelocityEngine {
  private strikeMap = new Map<number, StrikeState>()

  update(chain: OptionTick[], timestamp: number): OIVelocityResult {
    const strikeSignals: OIVelocityResult['strikeSignals'] = []
    let oiviBull = 0
    let oiviBear = 0

    for (const row of chain) {
      const strike = row.strike
      const side   = row.type        // 'CE' | 'PE'
      const oi     = row.oi
      const key    = strike * 10 + (side === 'CE' ? 1 : 0)

      if (!this.strikeMap.has(key)) {
        this.strikeMap.set(key, { history: [], velocityHistory: [] })
      }
      const state = this.strikeMap.get(key)!

      state.history.push({ oi, timestamp })
      if (state.history.length > WINDOW_SIZE) state.history.shift()

      if (state.history.length < 2) continue

      // Velocity = OI change per minute
      const recent   = state.history.slice(-VELOCITY_WINDOW)
      const dt       = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 60000 || 1
      const velocity = (recent[recent.length - 1].oi - recent[0].oi) / dt

      state.velocityHistory.push(velocity)
      if (state.velocityHistory.length > WINDOW_SIZE) state.velocityHistory.shift()

      const { mean, std } = getRollingStats(state.velocityHistory)
      const z             = (velocity - mean) / std
      const institutional = Math.abs(z) >= INST_Z_THRESH

      if (institutional || Math.abs(z) > 1.5) {
        strikeSignals.push({ strike, type: side, z, velocity, institutional })
      }

      if (side === 'CE' && z > 0) oiviBull += z
      if (side === 'PE' && z > 0) oiviBear += z
    }

    // Normalise by number of strikes
    const n      = Math.max(chain.length, 1)
    oiviBull    /= n
    oiviBear    /= n
    const oisNet = oiviBull - oiviBear

    const bullStrikes = strikeSignals.filter(s => s.type === 'CE' && s.z > 0).sort((a, b) => b.z - a.z)
    const bearStrikes = strikeSignals.filter(s => s.type === 'PE' && s.z > 0).sort((a, b) => b.z - a.z)

    return {
      oisNet,
      oiviBull,
      oiviBear,
      topBull: bullStrikes[0] ? { strike: bullStrikes[0].strike, z: bullStrikes[0].z } : null,
      topBear: bearStrikes[0] ? { strike: bearStrikes[0].strike, z: bearStrikes[0].z } : null,
      strikeSignals: strikeSignals.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
    }
  }

  reset() {
    this.strikeMap.clear()
  }
}