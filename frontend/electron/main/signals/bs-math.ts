// src/main/signals/bs-math.ts
// Black-Scholes core — used by GEX, Vanna, Charm, Gamma engines

const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** Standard normal PDF */
export function phi(x: number): number {
  return Math.exp(-x * x / 2) / SQRT_2PI
}

/** Standard normal CDF — Hart (1968) rational approx, error < 1.5e-7 */
export function Phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const p = 1 - phi(x) * t * (
    0.319381530 + t * (
      -0.356563782 + t * (
        1.781477937 + t * (
          -1.821255978 + 1.330274429 * t
        )
      )
    )
  )
  return x >= 0 ? p : 1 - p
}

export interface BSParams {
  S: number      // spot
  K: number      // strike
  T: number      // time to expiry in years
  r: number      // risk-free rate
  sigma: number  // implied vol
  type: 'CE' | 'PE'
}

export function d1d2(p: BSParams): { d1: number; d2: number } {
  const { S, K, T, r, sigma } = p
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { d1: 0, d2: 0 }
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
  return { d1, d2: d1 - sigma * Math.sqrt(T) }
}

export function bsDelta(p: BSParams): number {
  const { d1 } = d1d2(p)
  return p.type === 'CE' ? Phi(d1) : Phi(d1) - 1
}

export function bsGamma(p: BSParams): number {
  const { S, T, sigma } = p
  if (T <= 0 || sigma <= 0) return 0
  const { d1 } = d1d2(p)
  return phi(d1) / (S * sigma * Math.sqrt(T))
}

export function bsTheta(p: BSParams): number {
  const { S, K, T, r, sigma, type } = p
  if (T <= 0) return 0
  const { d1, d2 } = d1d2(p)
  const term1 = -(S * phi(d1) * sigma) / (2 * Math.sqrt(T))
  if (type === 'CE') {
    return (term1 - r * K * Math.exp(-r * T) * Phi(d2)) / 365
  } else {
    return (term1 + r * K * Math.exp(-r * T) * Phi(-d2)) / 365
  }
}

export function bsVega(p: BSParams): number {
  const { S, T } = p
  if (T <= 0) return 0
  const { d1 } = d1d2(p)
  return S * phi(d1) * Math.sqrt(T) / 100  // per 1% vol move
}

/** Vanna = dDelta/dSigma (Eq III.4-III.5 Vol II) */
export function bsVanna(p: BSParams): number {
  const { sigma } = p
  if (sigma <= 0) return 0
  const { d1, d2 } = d1d2(p)
  const base = -phi(d1) * d2 / sigma
  return p.type === 'CE' ? base : -base
}

/** Charm = dDelta/dt (Eq III.9 Vol II) */
export function bsCharm(p: BSParams): number {
  const { r, T, sigma, type } = p
  if (T <= 0 || sigma <= 0) return 0
  const { d1, d2 } = d1d2(p)
  const base = -phi(d1) * (2 * r * T - d2 * sigma * Math.sqrt(T)) / (2 * T * sigma * Math.sqrt(T))
  return type === 'CE' ? base : -base
}

/** Implied vol via Newton-Raphson (max 50 iterations) */
export function impliedVol(
  marketPrice: number,
  p: Omit<BSParams, 'sigma'>,
  initSigma = 0.2
): number {
  let sigma = initSigma
  for (let i = 0; i < 50; i++) {
    const params: BSParams = { ...p, sigma }
    const { d1, d2 } = d1d2(params)
    const price = p.type === 'CE'
      ? p.S * Phi(d1) - p.K * Math.exp(-p.r * p.T) * Phi(d2)
      : p.K * Math.exp(-p.r * p.T) * Phi(-d2) - p.S * Phi(-d1)
    const vega = p.S * phi(d1) * Math.sqrt(p.T)
    if (Math.abs(vega) < 1e-10) break
    const diff = price - marketPrice
    sigma -= diff / vega
    sigma = Math.max(0.001, Math.min(5.0, sigma))
    if (Math.abs(diff) < 0.0001) break
  }
  return sigma
}
