// src/main/composite/composite-engine.ts
// Master probability calculator — Eq XII.1-XII.3 Vol III
// Naive Bayes aggregation with independence correction, time-bucket weights

import type { CompositeResult, SignalInput, AppState } from '../signals/types'

// Per-signal empirical accuracy (update after backtesting your own data)
const ACCURACY: Record<string, number> = {
  kyle_lambda:        0.57,
  vpin:               0.60,
  gm_alpha:           0.55,
  oi_velocity:        0.62,
  gex_regime:         0.60,
  vanna_flow:         0.58,
  charm_flow:         0.63,
  iv_skew_velocity:   0.62,
  fii_net:            0.65,
  options_delta_flow: 0.61,
  sgx_lead:           0.58,
  cross_asset:        0.56,
  bridge:             0.60,
  n_insider:          0.57,
  amihud:             0.55,
  hasbrouck:          0.58,
}

// Average pairwise correlation ρ̄ (Eq XII.2 Vol III)
const RHO = 0.35

// Time-bucket weights (Part VIII Vol III)
const TIME_WEIGHTS: Record<string, Record<string, number>> = {
  '0915': { kyle_lambda:0.0, vpin:0.0, gm_alpha:0.3, oi_velocity:0.3,
            gex_regime:0.9, vanna_flow:0.2, charm_flow:0.2,
            iv_skew_velocity:0.7, fii_net:0.9, options_delta_flow:0.0,
            sgx_lead:1.0, cross_asset:0.9, bridge:0.1, n_insider:0.1, amihud:0.3, hasbrouck:0.5 },
  '0930': { kyle_lambda:0.3, vpin:0.3, gm_alpha:0.5, oi_velocity:0.7,
            gex_regime:0.9, vanna_flow:0.5, charm_flow:0.4,
            iv_skew_velocity:0.9, fii_net:0.9, options_delta_flow:0.5,
            sgx_lead:0.7, cross_asset:0.7, bridge:0.4, n_insider:0.4, amihud:0.5, hasbrouck:0.7 },
  '1030': { kyle_lambda:0.8, vpin:0.9, gm_alpha:0.8, oi_velocity:1.0,
            gex_regime:1.0, vanna_flow:1.0, charm_flow:0.7,
            iv_skew_velocity:1.0, fii_net:1.0, options_delta_flow:1.0,
            sgx_lead:0.1, cross_asset:0.5, bridge:0.8, n_insider:0.7, amihud:0.8, hasbrouck:1.0 },
  '1300': { kyle_lambda:0.8, vpin:0.9, gm_alpha:0.8, oi_velocity:0.9,
            gex_regime:1.0, vanna_flow:1.0, charm_flow:1.0,
            iv_skew_velocity:0.8, fii_net:1.0, options_delta_flow:1.0,
            sgx_lead:0.0, cross_asset:0.3, bridge:0.8, n_insider:0.7, amihud:0.8, hasbrouck:1.0 },
  '1430': { kyle_lambda:1.0, vpin:1.0, gm_alpha:0.9, oi_velocity:0.8,
            gex_regime:1.0, vanna_flow:1.0, charm_flow:1.0,
            iv_skew_velocity:1.0, fii_net:1.0, options_delta_flow:1.0,
            sgx_lead:0.0, cross_asset:0.2, bridge:1.0, n_insider:0.9, amihud:0.9, hasbrouck:1.0 },
}

function timeBucket(ts: number): string {
  const d  = new Date(ts)
  const hm = d.getHours() * 100 + d.getMinutes()
  if (hm < 930)  return '0915'
  if (hm < 1030) return '0930'
  if (hm < 1300) return '1030'
  if (hm < 1430) return '1300'
  return '1430'
}

/**
 * Build signal inputs from AppState.
 * Each signal returns direction (+1 bull, -1 bear, 0 neutral) and a z-score.
 */
export function buildSignals(state: AppState): SignalInput[] {
  const signals: SignalInput[] = []

  // Kyle Lambda — Eq II.32 Vol I
  if (state.kyle && state.kyle.lambdaZ !== 0) {
    const { kyle, vpin } = state
    // Lambda high + VPIN high + recent price move → determine direction from OFI sign
    const dir = (state.composite?.direction === 'bullish' ? 1 :
                 state.composite?.direction === 'bearish' ? -1 : 0) as 1 | -1 | 0
    signals.push({ name: 'kyle_lambda', direction: dir, z: kyle.lambdaZ, value: kyle.lambda })
  }

  // VPIN
  if (state.vpin) {
    const dir = state.vpin.buyVolumeRatio > 0.55 ? 1 :
                state.vpin.buyVolumeRatio < 0.45 ? -1 : 0
    signals.push({ name: 'vpin', direction: dir as 1|-1|0, z: (state.vpin.vpinPct - 50) / 20, value: state.vpin.vpin })
  }

  // OI Velocity net (Eq I.7 Vol III)
  if (state.oiVelocity) {
    const net = state.oiVelocity.oisNet
    const dir = net > 2 ? 1 : net < -2 ? -1 : 0
    signals.push({ name: 'oi_velocity', direction: dir as 1|-1|0, z: net / 3, value: net })
  }

  // GEX regime (Eq II.2-II.3 Vol III)
  if (state.gex) {
    const { gex } = state
    // Amplified GEX = moves will be larger → follow trend direction
    // Suppressed GEX = mean reversion → fade moves
    const regimeDir = gex.regime === 'amplified' ? 0 : // no direction from GEX alone
                      gex.regime === 'suppressed' ? 0 : 0
    const z = -gex.gexAtSpot / 1e8  // normalise
    signals.push({ name: 'gex_regime', direction: regimeDir as 1|-1|0, z, value: gex.gexAtSpot })
  }

  // Vanna flow (Eq III.7-III.8 Vol II)
  if (state.vannaCharm) {
    const v = state.vannaCharm.vannaFlow
    const dir = v > 1e7 ? 1 : v < -1e7 ? -1 : 0
    signals.push({ name: 'vanna_flow', direction: dir as 1|-1|0, z: v / 5e7, value: v })
  }

  // Charm flow (Eq III.11 Vol II) — toward max pain
  if (state.vannaCharm) {
    const { vannaCharm } = state
    const dir = vannaCharm.charmDir === 'buy' ? 1 : vannaCharm.charmDir === 'sell' ? -1 : 0
    signals.push({ name: 'charm_flow', direction: dir as 1|-1|0,
      z: Math.abs(vannaCharm.distToMaxPain) > 100 ? vannaCharm.expiryUrgency * 2 : 0,
      value: vannaCharm.charmFlow })
  }

  // IV Skew Velocity (Eq IV.2-IV.4 Vol III)
  if (state.skewVelocity) {
    const { skewVelocity } = state
    const dir = skewVelocity.direction === 'put_buying'  ? -1 :
                skewVelocity.direction === 'call_buying' ?  1 : 0
    signals.push({ name: 'iv_skew_velocity', direction: dir as 1|-1|0,
      z: Math.abs(skewVelocity.velocityZ), value: skewVelocity.velocity })
  }

  // FII net futures (Eq V.1-V.2 Vol III)
  if (state.fii) {
    const { fii } = state
    const net = fii.netFutures
    const dir = net > 20000 ? 1 : net < -20000 ? -1 : 0
    const z   = Math.abs(net) / 30000
    signals.push({ name: 'fii_net', direction: dir as 1|-1|0, z, value: net })
    if (fii.shortSqueeze) {
      signals.push({ name: 'fii_net', direction: 1, z: 3.0, value: net })
    }
  }

  // Options delta flow (Eq IV.13-IV.14 Vol II)
  if (state.deltaFlow) {
    const { deltaFlow } = state
    const dir = deltaFlow.direction === 'bullish' ? 1 :
                deltaFlow.direction === 'bearish' ? -1 : 0
    signals.push({ name: 'options_delta_flow', direction: dir as 1|-1|0,
      z: Math.abs(deltaFlow.deltaFlowZ), value: deltaFlow.deltaFlow })
  }

  // Cross-asset (Eq VII.8 Vol III)
  if (state.sgxCross) {
    const c   = state.sgxCross.composite
    const dir = c > 0.2 ? 1 : c < -0.2 ? -1 : 0
    signals.push({ name: 'cross_asset', direction: dir as 1|-1|0, z: Math.abs(c) * 3, value: c })

    const sgx = state.sgxCross.sgxSignal
    const sdir = sgx > 0.1 ? 1 : sgx < -0.1 ? -1 : 0
    signals.push({ name: 'sgx_lead', direction: sdir as 1|-1|0, z: Math.abs(sgx) * 4, value: sgx })
  }

  // Back bridge (Eq I.38 Vol II)
  if (state.bridge?.detected) {
    const target = state.bridge.target
    const spot   = state.spot?.ltp ?? target
    const dir    = target > spot ? 1 : -1
    signals.push({ name: 'bridge', direction: dir as 1|-1|0, z: Math.abs(state.bridge.bridgeCorr) * 4, value: state.bridge.bridgeCorr })
  }

  // Amihud (Eq VII.10-VII.11 Vol II)
  if (state.amihud) {
    const z   = (state.amihud.illiqRank - 50) / 20
    const dir = 0  // Amihud doesn't give direction, only intensity
    signals.push({ name: 'amihud', direction: dir as 1|-1|0, z, value: state.amihud.illiq })
  }

  // Hasbrouck IS — futures lead
  if (state.hasbrouck) {
    const z   = state.hasbrouck.isFutures > 0.65 ? 2 : 0
    const dir = state.hasbrouck.basis > 0 ? 1 : -1  // positive basis = futures leading up
    signals.push({ name: 'hasbrouck', direction: dir as 1|-1|0, z, value: state.hasbrouck.isFutures })
  }

  return signals.filter(s => s.direction !== 0)
}

/**
 * Compute composite probability — Eq XII.2-XII.3 Vol III
 */
export function computeComposite(signals: SignalInput[], timestamp: number): CompositeResult {
  const bucket = timeBucket(timestamp)
  const tw     = TIME_WEIGHTS[bucket] ?? TIME_WEIGHTS['1030']

  let logOddsSum = 0
  let weightSum  = 0
  const activeSignals: SignalInput[] = []

  for (const sig of signals) {
    const p      = ACCURACY[sig.name] ?? 0.55
    const timeW  = tw[sig.name] ?? 0.5
    const zW     = Math.min(1.0, Math.abs(sig.z) / 3.0)
    const w      = timeW * zW
    if (w < 0.05) continue

    const odds    = p / (1 - p)
    const logOdds = sig.direction * Math.log(odds) * w
    logOddsSum   += logOdds
    weightSum    += w
    activeSignals.push(sig)
  }

  // Independence correction: divide by 1 + ρ̄·(n-1)  (Eq XII.2 Vol III)
  const n           = activeSignals.length
  const correction  = 1 + RHO * Math.max(0, n - 1)
  const logOddsCorr = logOddsSum / correction
  const effectiveN  = n / correction

  // P(bullish) — Eq XII.3 Vol III
  const pBullish = 1 / (1 + Math.exp(-logOddsCorr))
  const pBearish = 1 - pBullish
  const confidence = Math.abs(pBullish - 0.5) * 2

  // Position sizing (Part XII table Vol III)
  const positionSize =
    confidence < 0.10 ? 0    :
    confidence < 0.24 ? 0    :
    confidence < 0.36 ? 0.25 :
    confidence < 0.50 ? 0.50 :
    confidence < 0.64 ? 0.75 : 1.0

  const direction: CompositeResult['direction'] =
    pBullish > 0.58 ? 'bullish' :
    pBearish > 0.58 ? 'bearish' : 'neutral'

  const bullCount = activeSignals.filter(s => s.direction === 1).length
  const bearCount = activeSignals.filter(s => s.direction === -1).length
  const pct       = (confidence * 50 + 50).toFixed(0)

  const hypothesis = confidence < 0.10
    ? 'Insufficient signal convergence — no trade'
    : `${direction.toUpperCase()} — ${pct}% confidence | ${bullCount}↑ ${bearCount}↓ signals (${effectiveN.toFixed(1)} eff. independent) | Size: ${(positionSize * 100).toFixed(0)}% of max`

  return { pBullish, pBearish, confidence, effectiveN, positionSize, direction, hypothesis, signals: activeSignals, timeBucket: bucket }
}
