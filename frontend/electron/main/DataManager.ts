export interface TickData {
  symbol: string;
  timestamp: number;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
  bidQty?: number;
  askQty?: number;
  bidPrice?: number;
  askPrice?: number;
}

export interface OptionChainData {
  symbol: string;
  expiry: string;
  strike: number;
  callLtp: number;
  putLtp: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  callIv: number;
  putIv: number;
  timestamp: number;
}

export interface SignalData {
  id: string;
  symbol: string;
  type: string;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  reason: string;
  timestamp: number;
  metadata?: any;
}

export class DataManager {
  private static instance: DataManager;
  private readonly MAX_TICKS_PER_SYMBOL = 500;
  private readonly MAX_SIGNALS = 1000;
  private readonly MAX_CACHE_DAYS = 7;
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private cleanupTimer: NodeJS.Timeout | null = null;

  // symbol → TickData[] (oldest first, newest last)
  private ticks: Map<string, TickData[]> = new Map();
  // "symbol|expiry|strike" → Map<timestamp, OptionChainData>
  private optionChain: Map<string, Map<number, OptionChainData>> = new Map();
  private signals: SignalData[] = [];
  private watchlist: Map<string, { addedAt: number; notes?: string }> = new Map();
  private settings: Map<string, any> = new Map();

  private constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager();
    }
    return DataManager.instance;
  }


  /**
   * Insert tick data (batch insert for performance)
   */
  insertTickData(ticks: TickData[]): void {
    for (const tick of ticks) {
      if (!this.ticks.has(tick.symbol)) {
        this.ticks.set(tick.symbol, []);
      }
      const arr = this.ticks.get(tick.symbol)!;
      arr.push(tick);
      // Keep only the latest MAX_TICKS_PER_SYMBOL
      if (arr.length > this.MAX_TICKS_PER_SYMBOL) {
        arr.splice(0, arr.length - this.MAX_TICKS_PER_SYMBOL);
      }
    }
  }

  /**
   * Get tick data for symbol
   */
  getTickData(symbol: string, limit: number = 100): TickData[] {
    const arr = this.ticks.get(symbol) ?? [];
    return arr.slice(-limit).reverse(); // newest first, matches original ORDER BY timestamp DESC
  }

  /**
   * Get tick data for time range
   */
  getTickDataRange(
    symbol: string,
    startTime: number,
    endTime: number
  ): TickData[] {
    const arr = this.ticks.get(symbol) ?? [];
    return arr.filter(t => t.timestamp >= startTime && t.timestamp <= endTime);
  }

  /**
   * Insert option chain data
   */
  insertOptionChain(data: OptionChainData[]): void {
    for (const item of data) {
      const key = `${item.symbol}|${item.expiry}|${item.strike}`;
      if (!this.optionChain.has(key)) {
        this.optionChain.set(key, new Map());
      }
      this.optionChain.get(key)!.set(item.timestamp, item);
    }
  }

  /**
   * Get latest option chain
   */
  getLatestOptionChain(symbol: string, expiry: string): OptionChainData[] {
    const results: OptionChainData[] = [];

    for (const [key, tsMap] of this.optionChain) {
      if (!key.startsWith(`${symbol}|${expiry}|`)) continue;
      let latest: OptionChainData | null = null;
      for (const item of tsMap.values()) {
        if (!latest || item.timestamp > latest.timestamp) latest = item;
      }
      if (latest) results.push(latest);
    }

    return results.sort((a, b) => a.strike - b.strike); // matches original ORDER BY strike ASC
  }

  /**
   * Insert signal
   */
  insertSignal(signal: SignalData): void {
    const idx = this.signals.findIndex(s => s.id === signal.id);
    if (idx !== -1) {
      this.signals[idx] = signal;
    } else {
      this.signals.push(signal);
    }
    // Cap total signals
    if (this.signals.length > this.MAX_SIGNALS) {
      this.signals.splice(0, this.signals.length - this.MAX_SIGNALS);
    }
  }

  /**
   * Get signals
   */
  getSignals(symbol?: string, limit: number = 100): SignalData[] {
    let result = symbol
      ? this.signals.filter(s => s.symbol === symbol)
      : [...this.signals];
    result.sort((a, b) => b.timestamp - a.timestamp); // matches original ORDER BY timestamp DESC
    return result.slice(0, limit);
  }

  /**
   * Watchlist operations
   */
  addToWatchlist(symbol: string, notes?: string): void {
    this.watchlist.set(symbol, { addedAt: Date.now(), notes });
  }

  removeFromWatchlist(symbol: string): void {
    this.watchlist.delete(symbol);
  }

  getWatchlist(): string[] {
    return [...this.watchlist.entries()]
      .sort((a, b) => b[1].addedAt - a[1].addedAt) // matches original ORDER BY added_at DESC
      .map(([sym]) => sym);
  }

  /**
   * Settings operations
   */
  setSetting(key: string, value: any): void {
    this.settings.set(key, value);
  }

  getSetting(key: string): any {
    return this.settings.get(key) ?? null;
  }

  /**
   * Cleanup old data (keep last MAX_CACHE_DAYS)
   */
  private cleanup(): void {
    const cutoffTime = Date.now() - (this.MAX_CACHE_DAYS * 24 * 60 * 60 * 1000);

    for (const [symbol, arr] of this.ticks) {
      const filtered = arr.filter(t => t.timestamp >= cutoffTime);
      if (filtered.length === 0) this.ticks.delete(symbol);
      else this.ticks.set(symbol, filtered);
    }

    for (const [key, tsMap] of this.optionChain) {
      for (const ts of tsMap.keys()) {
        if (ts < cutoffTime) tsMap.delete(ts);
      }
      if (tsMap.size === 0) this.optionChain.delete(key);
    }

    this.signals = this.signals.filter(s => s.timestamp >= cutoffTime);
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Get database statistics
   */
  getStats(): any {
    const tickCount = [...this.ticks.values()].reduce((n, arr) => n + arr.length, 0);
    const optionCount = [...this.optionChain.values()].reduce((n, m) => n + m.size, 0);

    return {
      ticks: tickCount,
      options: optionCount,
      signals: this.signals.length,
      watchlist: this.watchlist.size
    };
  }
}