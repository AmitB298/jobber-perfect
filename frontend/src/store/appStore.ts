import { create } from 'zustand';

// ─── Types (defined inline — no dependency on electron.d.ts) ─────────────────

export interface User {
  id: string;
  email: string;
  name?: string;
  plan?: 'free' | 'pro' | 'enterprise';
  createdAt?: string;
}

export interface AngelProfile {
  clientId: string;
  name: string;
  email?: string;
  mobile?: string;
  exchanges?: string[];
  products?: string[];
  lastLogin?: string;
}

export interface MarketTick {
  symbol: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  oi?: number;
  timestamp?: number;
}

export interface Signal {
  id: string;
  type: 'IV_CRUSH' | 'IV_EXPANSION' | 'DELTA_NEUTRAL' | 'THETA_DECAY' | 'GAMMA_SCALP';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  strategy: string;
  description: string;
  action: string;
  strikes: number[];
  confidence: number;
  expectedProfit: string;
  risk: string;
  timestamp?: string;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppState {
  // Auth state
  user: User | null;
  isAuthenticated: boolean;
  isTrialValid: boolean;
  trialDaysRemaining: number;

  // Angel state
  angelProfile: AngelProfile | null;
  angelConnected: boolean;

  // Market data
  ticks: Map<string, MarketTick>;
  watchlist: string[];

  // Signals
  signals: Signal[];
  signalEngineRunning: boolean;

  // UI state
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  activeView: 'market' | 'signals' | 'analytics' | 'settings';

  // Actions
  setUser: (user: User | null) => void;
  setAngelProfile: (profile: AngelProfile | null) => void;
  setAngelConnected: (connected: boolean) => void;
  updateTick: (tick: MarketTick) => void;
  addSignal: (signal: Signal) => void;
  setWatchlist: (watchlist: string[]) => void;
  setSignalEngineRunning: (running: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveView: (view: 'market' | 'signals' | 'analytics' | 'settings') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  reset: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState = {
  user: null,
  isAuthenticated: false,
  isTrialValid: false,
  trialDaysRemaining: 0,
  angelProfile: null,
  angelConnected: false,
  ticks: new Map<string, MarketTick>(),
  watchlist: [],
  signals: [],
  signalEngineRunning: false,
  sidebarCollapsed: false,
  theme: 'dark' as const,
  activeView: 'market' as const,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: user !== null,
    }),

  setAngelProfile: (profile) =>
    set({ angelProfile: profile }),

  setAngelConnected: (connected) =>
    set({ angelConnected: connected }),

  updateTick: (tick) =>
    set((state) => {
      const newTicks = new Map(state.ticks);
      newTicks.set(tick.symbol, tick);
      return { ticks: newTicks };
    }),

  addSignal: (signal) =>
    set((state) => ({
      signals: [signal, ...state.signals].slice(0, 100), // Keep last 100
    })),

  setWatchlist: (watchlist) =>
    set({ watchlist }),

  setSignalEngineRunning: (running) =>
    set({ signalEngineRunning: running }),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setActiveView: (view) =>
    set({ activeView: view }),

  setTheme: (theme) =>
    set({ theme }),

  reset: () => set(initialState),
}));