// backend/src/services/inMemoryStore.ts

export interface LiveTick {
  token: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  bidQty: number;
  askQty: number;
  timestamp: number;
}

export interface OptionChainRow {
  strike: number;
  ce_ltp: number | null;
  ce_oi: number | null;
  ce_volume: number | null;
  ce_iv: number | null;
  pe_ltp: number | null;
  pe_oi: number | null;
  pe_volume: number | null;
  pe_iv: number | null;
}

class InMemoryStore {
  // Latest tick per token — Map is O(1) read/write
  private ticks = new Map<string, LiveTick>();
  
  // Option chain per expiry key e.g. "NIFTY_2025-03-06"
  private optionChains = new Map<string, OptionChainRow[]>();
  
  // Spot price per symbol
  private spotPrices = new Map<string, number>();
  
  // PCR per expiry
  private pcrData = new Map<string, { oi: number; volume: number }>();

  // Write tick — called on every Angel One WebSocket message
  setTick(token: string, tick: LiveTick): void {
    this.ticks.set(token, tick);
    // Update spot price if this is an index token
    if (tick.symbol === 'NIFTY' || tick.symbol === 'BANKNIFTY') {
      this.spotPrices.set(tick.symbol, tick.ltp);
    }
  }

  getTick(token: string): LiveTick | null {
    return this.ticks.get(token) ?? null;
  }

  getAllTicks(): Map<string, LiveTick> {
    return this.ticks;
  }

  setOptionChain(key: string, chain: OptionChainRow[]): void {
    this.optionChains.set(key, chain);
  }

  getOptionChain(key: string): OptionChainRow[] | null {
    return this.optionChains.get(key) ?? null;
  }

  getSpotPrice(symbol: string): number | null {
    return this.spotPrices.get(symbol) ?? null;
  }

  setPCR(expiry: string, data: { oi: number; volume: number }): void {
    this.pcrData.set(expiry, data);
  }

  getPCR(expiry: string) {
    return this.pcrData.get(expiry) ?? null;
  }

  getStats() {
    return {
      tickCount: this.ticks.size,
      chainCount: this.optionChains.size,
      ramEstimateKB: Math.round(this.ticks.size * 0.3),
    };
  }

  // Call at market close to free RAM
  clearAll(): void {
    this.ticks.clear();
    this.optionChains.clear();
    console.log('InMemoryStore cleared');
  }
}

// Singleton — ONE instance shared across entire backend process
export const memStore = new InMemoryStore();