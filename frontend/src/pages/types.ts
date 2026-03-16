// ============================================================================
// src/pages/types.ts
// Shared types for all dashboard tab components
// ============================================================================

// ── Greeks ──────────────────────────────────────────────────────────────────
export interface Greeks {
  delta:    number | null;
  gamma:    number | null;
  theta:    number | null;
  vega:     number | null;
  iv:       number | null;
}

// ── Options Chain ────────────────────────────────────────────────────────────
export interface ChainRow {
  strike_price: number | string;
  ce_ltp:       number | null;
  pe_ltp:       number | null;
  ce_oi:        number | null;
  pe_oi:        number | null;
  ce_volume:    number | null;
  pe_volume:    number | null;
  ce_greeks?:   Greeks;
  pe_greeks?:   Greeks;
}

// ── Dashboard payload ────────────────────────────────────────────────────────
export interface DashData {
  spotPrice:    number;
  atmStrike:    number;
  expiryDate:   string | null;
  pcr_oi:       number;
  maxPain:      number;
  chain:        ChainRow[];
  // optional extras
  ivAnalysis?:  any;
  expectedMove?: any;
}

// ── Signals ──────────────────────────────────────────────────────────────────
export interface Signal {
  id:             string;
  type:           string;
  strategy:       string;
  description:    string;
  action:         string;
  priority:       'HIGH' | 'MEDIUM' | 'LOW';
  confidence:     number;
  strikes:        number[];
  expectedProfit: string;
  risk:           string;
}

export interface IVAnalysis {
  status:          'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  signal:          string;
  currentIV:       number;
  ivRank:          number;
  ivPercentile:    number;
  historicalRange?: { min: number; mean: number; max: number };
}

export interface ExpectedMove {
  toExpiry:   number;
  daily:      number;
  weekly:     number;
  upperRange: number;
  lowerRange: number;
}

export interface SignalData {
  signals:       Signal[];
  ivAnalysis?:   IVAnalysis;
  expectedMove?: ExpectedMove;
  spotPrice?:    number;
  currentIV?:    number;
  daysToExpiry?: number;
}

// ── Network ──────────────────────────────────────────────────────────────────
export type NetQuality = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'OFFLINE';

export interface NetStatus {
  quality:              NetQuality;
  downloadMbps:         number | null;
  latencyMs:            number | null;
  jitterMs:             number | null;
  packetLoss:           number;
  consecutiveFailures:  number;
  lastChecked:          string | number;
}

// ── Strategy Builder ─────────────────────────────────────────────────────────
export interface StratLeg {
  id:       number;
  action:   'BUY' | 'SELL';
  type:     'CE' | 'PE';
  strike:   number;
  premium:  number;
  qty:      number;
}