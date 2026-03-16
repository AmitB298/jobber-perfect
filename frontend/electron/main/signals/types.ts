// src/main/signals/types.ts
// Canonical types shared across all 25 signal engines

export interface OptionTick {
  symbol:        string
  strike:        number
  expiry:        string          // YYYY-MM-DD
  type:          'CE' | 'PE'
  ltp:           number          // last traded price
  bid:           number
  ask:           number
  volume:        number
  oi:            number          // open interest
  iv:            number          // implied volatility (decimal, e.g. 0.18)
  delta:         number
  gamma:         number
  theta:         number
  vega:          number
  timestamp:     number          // ms epoch
  dte:           number          // days to expiry
}

export interface FuturesTick {
  symbol:        string
  ltp:           number
  bid:           number
  ask:           number
  volume:        number
  oi:            number
  timestamp:     number
}

export interface SpotTick {
  index:         'NIFTY' | 'BANKNIFTY'
  ltp:           number
  open:          number
  high:          number
  low:           number
  timestamp:     number
}

export interface MarketSnapshot {
  spot:          SpotTick
  futures:       FuturesTick
  chain:         OptionTick[]
  timestamp:     number
}

// ── Signal outputs ──────────────────────────────────────────────────────────

export interface KyleLambdaResult {
  lambda:        number          // price impact per lot
  lambdaZ:       number          // z-score vs rolling history
  regime:        'low' | 'normal' | 'elevated' | 'extreme'
  r2:            number
}

export interface VPINResult {
  vpin:          number          // 0-1
  vpinPct:       number          // percentile vs history
  regime:        'safe' | 'watch' | 'alert' | 'critical'
  buyVolumeRatio:number
}

export interface GMResult {
  alpha:         number          // P(informed trader)
  spread:        number
  fairSpread:    number
  alphaZ:        number
}

export interface OIVelocityResult {
  strikeSignals: { strike:number; type:'CE'|'PE'; z:number; velocity:number; institutional:boolean }[]
  oiviBull:      number
  oiviBear:      number
  oisNet:        number
  topBull:       { strike:number; z:number } | null
  topBear:       { strike:number; z:number } | null
}

export interface GEXResult {
  gexAtSpot:     number          // ₹ per 1% move
  zeroCross:     number          // S* level
  callWall:      number
  putWall:       number
  regime:        'suppressed' | 'neutral' | 'amplified'
  distToZero:    number
  gexByStrike:   { strike:number; gex:number }[]
}

export interface VannaCharmResult {
  vannaFlow:     number          // ₹ per 1% IV change
  charmFlow:     number          // ₹ per day
  maxPain:       number
  distToMaxPain: number
  charmDir:      'buy' | 'sell' | 'neutral'
  expiryUrgency: number          // 0-1
}

export interface SkewVelocityResult {
  skew25d:       number
  velocity:      number
  velocityZ:     number
  urgency:       'none' | 'moderate' | 'high' | 'extreme'
  direction:     'put_buying' | 'call_buying' | 'straddle' | 'neutral'
}

export interface FIIResult {
  netFutures:    number
  netChange:     number
  optionsDelta:  number
  totalDelta:    number
  regime:        string
  shortSqueeze:  boolean
  keyStrikes:    { strike:number; type:'CE'|'PE'; oi:number }[]
}

export interface BridgeResult {
  bridgeCorr:    number
  target:        number
  betaT:         number
  detected:      boolean
}

export interface NInsiderResult {
  n:             number
  competition:   'monopoly' | 'duopoly' | 'oligopoly' | 'competitive'
  infoRevRate:   number
}

export interface OptionsDeltaFlowResult {
  deltaFlow:     number
  deltaFlowZ:    number
  leadMinutes:   number
  direction:     'bullish' | 'bearish' | 'neutral'
}

export interface SGXCrossAssetResult {
  sgxGap:        number
  sgxSignal:     number
  inrSignal:     number
  crudeSignal:   number
  usSignal:      number
  composite:     number
}

export interface AmihudResult {
  illiq:         number
  kyleLambda:    number
  illiqRank:     number
}

export interface HasbrouckResult {
  isFutures:     number          // 0-1, fraction of price discovery in futures
  isSpot:        number
  basis:         number
}

// ── Composite ───────────────────────────────────────────────────────────────

export interface SignalInput {
  name:       string
  direction:  1 | -1 | 0
  z:          number
  value:      number
}

export interface CompositeResult {
  pBullish:      number
  pBearish:      number
  confidence:    number          // 0-1
  effectiveN:    number
  positionSize:  number          // 0-1
  direction:     'bullish' | 'bearish' | 'neutral'
  hypothesis:    string
  signals:       SignalInput[]
  timeBucket:    string
}

// ── Full state snapshot sent to renderer via IPC ────────────────────────────

export interface AppState {
  connected:     boolean
  marketOpen:    boolean
  timestamp:     number
  spot:          SpotTick | null
  futures:       FuturesTick | null

  // All signal results
  kyle:          KyleLambdaResult | null
  vpin:          VPINResult | null
  gm:            GMResult | null
  oiVelocity:    OIVelocityResult | null
  gex:           GEXResult | null
  vannaCharm:    VannaCharmResult | null
  skewVelocity:  SkewVelocityResult | null
  fii:           FIIResult | null
  bridge:        BridgeResult | null
  nInsider:      NInsiderResult | null
  deltaFlow:     OptionsDeltaFlowResult | null
  sgxCross:      SGXCrossAssetResult | null
  amihud:        AmihudResult | null
  hasbrouck:     HasbrouckResult | null

  // Composite
  composite:     CompositeResult | null

  // Options chain for UI
  chain:         OptionTick[]

  // History (last 200 composite scores for chart)
  compositeHistory: { ts:number; p:number; direction:string }[]
}

// ── Backtest types ───────────────────────────────────────────────────────────

export interface BacktestConfig {
  startDate:     string          // YYYY-MM-DD
  endDate:       string
  signalThreshold: number        // min composite confidence to trigger
  riskPerTrade:  number          // fraction of capital
  stopLossPct:   number
  targetPct:     number
}

export interface BacktestTrade {
  date:          string
  direction:     'bullish' | 'bearish'
  confidence:    number
  entryPrice:    number
  exitPrice:     number
  pnl:           number
  pnlPct:        number
  outcome:       'win' | 'loss'
  signalsActive: string[]
  holdingMinutes:number
}

export interface BacktestResult {
  trades:        BacktestTrade[]
  totalTrades:   number
  winRate:       number
  avgWin:        number
  avgLoss:       number
  profitFactor:  number
  maxDrawdown:   number
  sharpeRatio:   number
  signalAccuracy: Record<string, { correct:number; total:number; accuracy:number }>
  equityCurve:   { date:string; equity:number }[]
}
