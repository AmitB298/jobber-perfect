// frontend/src/store/appStore.ts
import { create } from 'zustand';
import { User, AngelProfile, MarketTick, Signal } from '../types/electron';

// ============================================================================
// DOMAIN TYPES  (local to store — mirrored from backend api-server responses)
// ============================================================================

export interface ChainRow {
  strike_price: number;
  ce_ltp: number | null;
  pe_ltp: number | null;
  ce_volume: number | null;
  pe_volume: number | null;
  ce_oi: number | null;
  pe_oi: number | null;
  ce_greeks?: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    rho: number | null;
    iv: number | null;
  };
  pe_greeks?: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    rho: number | null;
    iv: number | null;
  };
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

export interface ChainData {
  spotPrice: number;
  spotChange: number;
  spotChangePercent: number;
  atmStrike: number;
  pcr_oi: number;
  pcr_volume: number;
  maxPain: number;
  totalTicks: number;
  chain: ChainRow[];
  expiryDate: string;
  latestDataAt?: string;
  marketStatus?: MarketStatus;
  vix?: number | null;
  timestamp?: string;   // server-side ISO send time — used to calculate push latency
  source?: string;      // 'live_push' | 'rest_poll' — set by api-server
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
  alert: {
    level: 'WARNING' | 'CRITICAL' | 'RECOVERED';
    message: string;
    timestamp: string;
  } | null;
}

export interface SpoofAlert {
  id: string;
  token: string;
  symbol: string;
  state: 'CLEAR' | 'WATCH' | 'ALERT' | 'CRITICAL';
  phase: 'PATCH_I' | 'PATCH_II' | 'CLOSE_WATCH' | 'NORMAL';
  severity: string;
  type: string;
  strike: number;
  optionType: 'CE' | 'PE';
  ensemble: number;
  confidence: number;
  action: string;
  description: string;
  explanation: string;
  ltp: number;
  detectedAt: number;
  timestamp: string;
}

// ============================================================================
// STATE INTERFACE
// ============================================================================

interface AppState {
  // ── Auth ──────────────────────────────────────────────────────────────────
  user: User | null;
  isAuthenticated: boolean;
  isTrialValid: boolean;
  trialDaysRemaining: number;

  // ── Angel One ─────────────────────────────────────────────────────────────
  angelProfile: AngelProfile | null;
  angelConnected: boolean;

  // ── Market Ticks (raw, keyed by token symbol) ─────────────────────────────
  ticks: Map<string, MarketTick>;

  // ── Options Chain (processed — from SSE / api-server) ─────────────────────
  chain: ChainData | null;

  // ── Previous OI snapshot for OI-change % calculation ──────────────────────
  // Key format: "ce_<strike>" | "pe_<strike>", Value: OI from previous push
  // ✅ ADDED: was prevChainRef (local useRef in Dashboard) — now lives in store
  prevOI: Map<string, number>;

  // ── Push latency (ms) — calculated from chain.timestamp ───────────────────
  // ✅ ADDED: was setPushLatencyMs (local useState in Dashboard) — now in store
  pushLatencyMs: number | null;

  // ── Market Status ─────────────────────────────────────────────────────────
  marketStatus: MarketStatus | null;

  // ── Network ───────────────────────────────────────────────────────────────
  netStatus: NetStatus | null;

  // ── Spoofing ──────────────────────────────────────────────────────────────
  spoofAlerts: SpoofAlert[];

  // ── Signals ───────────────────────────────────────────────────────────────
  signals: Signal[];
  // ✅ ADDED: full /api/analytics/signals response — was local useState in Dashboard
  signalData: any | null;
  signalEngineRunning: boolean;

  // ── Watchlist ─────────────────────────────────────────────────────────────
  watchlist: string[];

  // ── UI ────────────────────────────────────────────────────────────────────
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  activeView: 'market' | 'signals' | 'analytics' | 'settings';

  // ── Actions ───────────────────────────────────────────────────────────────

  // Auth
  setUser: (user: User | null) => void;
  setTrialStatus: (isValid: boolean, daysRemaining: number) => void;

  // Angel One
  setAngelProfile: (profile: AngelProfile | null) => void;
  setAngelConnected: (connected: boolean) => void;

  // Ticks
  updateTick: (tick: MarketTick) => void;

  // Chain — upgraded: snapshots prevOI + calculates latency on every push
  setChain: (chain: ChainData) => void;

  // Market status
  setMarketStatus: (status: MarketStatus) => void;

  // Network
  setNetStatus: (status: NetStatus) => void;

  // Spoofing
  addSpoofAlert: (alert: SpoofAlert) => void;
  clearSpoofAlerts: () => void;

  // Signals
  addSignal: (signal: Signal) => void;
  setSignals: (signals: Signal[]) => void;
  setSignalData: (data: any) => void;   // ✅ ADDED
  setSignalEngineRunning: (running: boolean) => void;

  // Watchlist
  setWatchlist: (watchlist: string[]) => void;

  // UI
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveView: (view: 'market' | 'signals' | 'analytics' | 'settings') => void;
  setTheme: (theme: 'dark' | 'light') => void;

  // Reset
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  user: null,
  isAuthenticated: false,
  isTrialValid: false,
  trialDaysRemaining: 0,
  angelProfile: null,
  angelConnected: false,
  ticks: new Map<string, MarketTick>(),
  chain: null,
  prevOI: new Map<string, number>(),   // ✅ ADDED
  pushLatencyMs: null,                 // ✅ ADDED
  marketStatus: null,
  netStatus: null,
  spoofAlerts: [] as SpoofAlert[],
  signals: [] as Signal[],
  signalData: null,                    // ✅ ADDED
  signalEngineRunning: false,
  watchlist: [] as string[],
  sidebarCollapsed: false,
  theme: 'dark' as const,
  activeView: 'market' as const,
};

// ============================================================================
// STORE
// ============================================================================

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  // ── Auth ──────────────────────────────────────────────────────────────────

  setUser: (user) =>
    set({
      user,
      isAuthenticated: user !== null,
    }),

  setTrialStatus: (isValid, daysRemaining) =>
    set({ isTrialValid: isValid, trialDaysRemaining: daysRemaining }),

  // ── Angel One ─────────────────────────────────────────────────────────────

  setAngelProfile: (profile) =>
    set({ angelProfile: profile }),

  setAngelConnected: (connected) =>
    set({ angelConnected: connected }),

  // ── Ticks ─────────────────────────────────────────────────────────────────

  updateTick: (tick) =>
    set((state) => {
      const newTicks = new Map(state.ticks);
      newTicks.set(tick.symbol, tick);
      return { ticks: newTicks };
    }),

  // ── Chain ─────────────────────────────────────────────────────────────────
  // ✅ UPGRADED from the original single-line setChain.
  // Now does three things atomically in one set() call:
  //   1. Snapshots current OI into prevOI before overwriting chain
  //      → Dashboard reads prevOI from store instead of prevChainRef
  //   2. Calculates push latency when source === 'live_push'
  //      → requires api-server to send timestamp + source fields (FIX 1)
  //   3. Keeps marketStatus in sync (unchanged from original behaviour)

  setChain: (incoming) =>
    set((state) => {
      // Snapshot current OI for OI-change % calculation
      const prevOI = new Map<string, number>();
      if (state.chain?.chain) {
        for (const row of state.chain.chain) {
          const s = Number(row.strike_price);
          if (row.ce_oi != null) prevOI.set(`ce_${s}`, Number(row.ce_oi));
          if (row.pe_oi != null) prevOI.set(`pe_${s}`, Number(row.pe_oi));
        }
      }

      // Push latency — only trusted when source is 'live_push' and value is sane
      let pushLatencyMs: number | null = state.pushLatencyMs;
      if (incoming.timestamp && incoming.source === 'live_push') {
        const latency = Date.now() - new Date(incoming.timestamp).getTime();
        if (latency >= 0 && latency < 10_000) pushLatencyMs = latency;
      }

      return {
        chain:        incoming,
        prevOI,
        pushLatencyMs,
        marketStatus: incoming.marketStatus ?? state.marketStatus,
      };
    }),

  // ── Market Status ─────────────────────────────────────────────────────────

  setMarketStatus: (status) =>
    set({ marketStatus: status }),

  // ── Network ───────────────────────────────────────────────────────────────

  setNetStatus: (status) =>
    set({ netStatus: status }),

  // ── Spoofing ──────────────────────────────────────────────────────────────

  addSpoofAlert: (alert) =>
    set((state) => ({
      // Keep most recent 200 alerts; deduplicate by id
      spoofAlerts: [
        alert,
        ...state.spoofAlerts.filter((a) => a.id !== alert.id),
      ].slice(0, 200),
    })),

  clearSpoofAlerts: () =>
    set({ spoofAlerts: [] }),

  // ── Signals ───────────────────────────────────────────────────────────────

  addSignal: (signal) =>
    set((state) => ({
      signals: [signal, ...state.signals].slice(0, 100),
    })),

  setSignals: (signals) =>
    set({ signals }),

  // ✅ ADDED: stores the full /api/analytics/signals response object
  // Replaces the local useState(signalData) in Dashboard.tsx
  setSignalData: (data) =>
    set({ signalData: data }),

  setSignalEngineRunning: (running) =>
    set({ signalEngineRunning: running }),

  // ── Watchlist ─────────────────────────────────────────────────────────────

  setWatchlist: (watchlist) =>
    set({ watchlist }),

  // ── UI ────────────────────────────────────────────────────────────────────

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setActiveView: (view) =>
    set({ activeView: view }),

  setTheme: (theme) =>
    set({ theme }),

  // ── Reset ─────────────────────────────────────────────────────────────────
  // ✅ UPGRADED: also resets prevOI (new Map, not the initialState reference)

  reset: () =>
    set({ ...initialState, ticks: new Map(), prevOI: new Map() }),
}));

// ============================================================================
// CONVENIENCE SELECTORS
// ── Import these in components to avoid re-renders on unrelated state changes
// ============================================================================

// — unchanged from original —
export const selectUser          = (s: AppState) => s.user;
export const selectIsAuth        = (s: AppState) => s.isAuthenticated;
export const selectAngelStatus   = (s: AppState) => ({ connected: s.angelConnected, profile: s.angelProfile });
export const selectChain         = (s: AppState) => s.chain;
export const selectSpotPrice     = (s: AppState) => s.chain?.spotPrice ?? 0;
export const selectAtmStrike     = (s: AppState) => s.chain?.atmStrike ?? 0;
export const selectPcr           = (s: AppState) => s.chain?.pcr_oi ?? 1;
export const selectMaxPain       = (s: AppState) => s.chain?.maxPain ?? 0;
export const selectMarketStatus  = (s: AppState) => s.marketStatus;
export const selectNetStatus     = (s: AppState) => s.netStatus;
export const selectSignals       = (s: AppState) => s.signals;
export const selectSpoofAlerts   = (s: AppState) => s.spoofAlerts;
export const selectTicks         = (s: AppState) => s.ticks;

// ✅ ADDED — new selectors used by Dashboard and other components
export const selectChainRows     = (s: AppState) => s.chain?.chain ?? [];
export const selectExpiryDate    = (s: AppState) => s.chain?.expiryDate ?? '';
export const selectSpotChange    = (s: AppState) => ({
  change:        s.chain?.spotChange        ?? 0,
  changePercent: s.chain?.spotChangePercent ?? 0,
});
export const selectPrevOI        = (s: AppState) => s.prevOI;
export const selectPushLatency   = (s: AppState) => s.pushLatencyMs;
export const selectSignalData    = (s: AppState) => s.signalData;