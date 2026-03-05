// ============================================================================
// types.ts — All shared interfaces for JOBBER PRO Dashboard
// Import this in every tab file instead of redefining locally
// ============================================================================

export interface Greeks {
  delta: number | null; gamma: number | null; theta: number | null;
  vega: number | null;  rho: number | null;   iv: number | null;
}

export interface ChainRow {
  strike_price: number;
  ce_ltp: number | null; pe_ltp: number | null;
  ce_volume: number | null; pe_volume: number | null;
  ce_oi: number | null;    pe_oi: number | null;
  ce_greeks?: Greeks;      pe_greeks?: Greeks;
}

export interface MarketStatus {
  isOpen: boolean;
  session: 'LIVE' | 'PRE_OPEN' | 'POST_MARKET' | 'WEEKEND' | 'HOLIDAY' | 'MUHURAT';
  note: string;
  holidayName?: string;
  nextOpen?: string;
  minsToOpen?: number;
  minsToClose?: number;
  dataAgeMinutes?: number;
}

export interface DashData {
  spotPrice: number; spotChange: number; spotChangePercent: number;
  atmStrike: number; pcr_oi: number; pcr_volume: number;
  maxPain: number;   totalTicks: number;
  chain: ChainRow[]; expiryDate: string;
  latestDataAt?: string;
  marketStatus?: MarketStatus;
  vix?: number | null;
}

export interface SignalData {
  signals: any[]; ivAnalysis: any; expectedMove: any;
  spotPrice: number; atmStrike: number;
  daysToExpiry: number; currentIV: number;
  ivHistorySource?: 'real_db' | 'estimated';
  ivHistoryPoints?: number;
}

export interface StratLeg {
  id: number;
  action: 'BUY' | 'SELL';
  type: 'CE' | 'PE';
  strike: number;
  premium: number;
  qty: number;
}

export interface NetStatus {
  isOnline: boolean;
  quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'OFFLINE';
  downloadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLoss: number;
  lastChecked: string;
  consecutiveFailures: number;
  alert: { level: 'WARNING' | 'CRITICAL' | 'RECOVERED'; message: string; timestamp: string; } | null;
}

export interface NetToast {
  id: number;
  level: 'WARNING' | 'CRITICAL' | 'RECOVERED';
  message: string;
}

export interface LiveSpoofAlert {
  id: string; token: string; symbol: string;
  state: 'CLEAR' | 'WATCH' | 'ALERT' | 'CRITICAL';
  phase: 'PATCH_I' | 'PATCH_II' | 'CLOSE_WATCH' | 'NORMAL';
  severity: string; type: string;
  strike: number; optionType: 'CE' | 'PE';
  ensemble: number; confidence: number;
  action: string; description: string; explanation: string;
  ltp: number; bidPrice: number; askPrice: number;
  bidQty: number; askQty: number; oi: number; oiChange: number;
  ltpChange: number; bidAskRatio: number; spreadPct: number;
  detectedAt: number; timestamp: string;
  fv: { VPIN: number; OBI_L1: number; TBQ_TSQ: number; PostDist: number; spread_pct: number; oi_change: number; ltp_change: number; };
  js: { pattern_prob: number; delta_proxy: number; patch1_buy_proxy: number; patch2_sell_proxy: number; ltp_aggression_frac: number; oi_buildup_p1: number; };
  scores: Record<string, number>;
}

export type Tab = 'chain' | 'charts' | 'signals' | 'analytics' | 'strategy' | 'predictor' | 'data' | 'spoofing' | 'network';
