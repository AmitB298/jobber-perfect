import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

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
  private db: Database.Database;
  private readonly MAX_CACHE_DAYS = 7;
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'jobber-data.db');

    // Ensure directory exists
    fs.mkdirSync(userDataPath, { recursive: true });

    this.db = new Database(dbPath);
    
    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache

    this.initializeSchema();
    this.startCleanupTimer();
  }

  static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager();
    }
    return DataManager.instance;
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Tick data table with time-series optimization
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tick_data (
        symbol TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        ltp REAL NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume INTEGER NOT NULL,
        oi INTEGER,
        bid_qty INTEGER,
        ask_qty INTEGER,
        bid_price REAL,
        ask_price REAL,
        PRIMARY KEY (symbol, timestamp)
      );
      
      CREATE INDEX IF NOT EXISTS idx_tick_data_symbol 
        ON tick_data(symbol);
      
      CREATE INDEX IF NOT EXISTS idx_tick_data_timestamp 
        ON tick_data(timestamp DESC);
    `);

    // Option chain data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS option_chain (
        symbol TEXT NOT NULL,
        expiry TEXT NOT NULL,
        strike REAL NOT NULL,
        call_ltp REAL NOT NULL,
        put_ltp REAL NOT NULL,
        call_oi INTEGER NOT NULL,
        put_oi INTEGER NOT NULL,
        call_volume INTEGER NOT NULL,
        put_volume INTEGER NOT NULL,
        call_iv REAL NOT NULL,
        put_iv REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (symbol, expiry, strike, timestamp)
      );
      
      CREATE INDEX IF NOT EXISTS idx_option_chain_symbol 
        ON option_chain(symbol, expiry);
      
      CREATE INDEX IF NOT EXISTS idx_option_chain_timestamp 
        ON option_chain(timestamp DESC);
    `);

    // Signal history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        signal TEXT NOT NULL,
        confidence REAL NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_signals_symbol 
        ON signals(symbol);
      
      CREATE INDEX IF NOT EXISTS idx_signals_timestamp 
        ON signals(timestamp DESC);
    `);

    // User watchlist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        symbol TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        notes TEXT
      );
    `);

    // App settings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Insert tick data (batch insert for performance)
   */
  insertTickData(ticks: TickData[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tick_data (
        symbol, timestamp, ltp, open, high, low, close, volume,
        oi, bid_qty, ask_qty, bid_price, ask_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((ticks: TickData[]) => {
      for (const tick of ticks) {
        stmt.run(
          tick.symbol,
          tick.timestamp,
          tick.ltp,
          tick.open,
          tick.high,
          tick.low,
          tick.close,
          tick.volume,
          tick.oi || null,
          tick.bidQty || null,
          tick.askQty || null,
          tick.bidPrice || null,
          tick.askPrice || null
        );
      }
    });

    insertMany(ticks);
  }

  /**
   * Get tick data for symbol
   */
  getTickData(symbol: string, limit: number = 100): TickData[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tick_data
      WHERE symbol = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(symbol, limit) as any[];

    return rows.map(row => ({
      symbol: row.symbol,
      timestamp: row.timestamp,
      ltp: row.ltp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      oi: row.oi,
      bidQty: row.bid_qty,
      askQty: row.ask_qty,
      bidPrice: row.bid_price,
      askPrice: row.ask_price
    }));
  }

  /**
   * Get tick data for time range
   */
  getTickDataRange(
    symbol: string,
    startTime: number,
    endTime: number
  ): TickData[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tick_data
      WHERE symbol = ? AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(symbol, startTime, endTime) as any[];

    return rows.map(row => ({
      symbol: row.symbol,
      timestamp: row.timestamp,
      ltp: row.ltp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      oi: row.oi,
      bidQty: row.bid_qty,
      askQty: row.ask_qty,
      bidPrice: row.bid_price,
      askPrice: row.ask_price
    }));
  }

  /**
   * Insert option chain data
   */
  insertOptionChain(data: OptionChainData[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO option_chain (
        symbol, expiry, strike, call_ltp, put_ltp, call_oi, put_oi,
        call_volume, put_volume, call_iv, put_iv, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((data: OptionChainData[]) => {
      for (const item of data) {
        stmt.run(
          item.symbol,
          item.expiry,
          item.strike,
          item.callLtp,
          item.putLtp,
          item.callOi,
          item.putOi,
          item.callVolume,
          item.putVolume,
          item.callIv,
          item.putIv,
          item.timestamp
        );
      }
    });

    insertMany(data);
  }

  /**
   * Get latest option chain
   */
  getLatestOptionChain(symbol: string, expiry: string): OptionChainData[] {
    const stmt = this.db.prepare(`
      SELECT * FROM option_chain
      WHERE symbol = ? AND expiry = ?
      AND timestamp = (
        SELECT MAX(timestamp) FROM option_chain
        WHERE symbol = ? AND expiry = ?
      )
      ORDER BY strike ASC
    `);

    const rows = stmt.all(symbol, expiry, symbol, expiry) as any[];

    return rows.map(row => ({
      symbol: row.symbol,
      expiry: row.expiry,
      strike: row.strike,
      callLtp: row.call_ltp,
      putLtp: row.put_ltp,
      callOi: row.call_oi,
      putOi: row.put_oi,
      callVolume: row.call_volume,
      putVolume: row.put_volume,
      callIv: row.call_iv,
      putIv: row.put_iv,
      timestamp: row.timestamp
    }));
  }

  /**
   * Insert signal
   */
  insertSignal(signal: SignalData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO signals (
        id, symbol, type, signal, confidence, reason, timestamp, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      signal.id,
      signal.symbol,
      signal.type,
      signal.signal,
      signal.confidence,
      signal.reason,
      signal.timestamp,
      signal.metadata ? JSON.stringify(signal.metadata) : null
    );
  }

  /**
   * Get signals
   */
  getSignals(symbol?: string, limit: number = 100): SignalData[] {
    let query = 'SELECT * FROM signals';
    const params: any[] = [];

    if (symbol) {
      query += ' WHERE symbol = ?';
      params.push(symbol);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      symbol: row.symbol,
      type: row.type,
      signal: row.signal,
      confidence: row.confidence,
      reason: row.reason,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Watchlist operations
   */
  addToWatchlist(symbol: string, notes?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO watchlist (symbol, added_at, notes)
      VALUES (?, ?, ?)
    `);

    stmt.run(symbol, Date.now(), notes || null);
  }

  removeFromWatchlist(symbol: string): void {
    const stmt = this.db.prepare('DELETE FROM watchlist WHERE symbol = ?');
    stmt.run(symbol);
  }

  getWatchlist(): string[] {
    const stmt = this.db.prepare(`
      SELECT symbol FROM watchlist ORDER BY added_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => row.symbol);
  }

  /**
   * Settings operations
   */
  setSetting(key: string, value: any): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(key, JSON.stringify(value), Date.now());
  }

  getSetting(key: string): any {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as any;

    return row ? JSON.parse(row.value) : null;
  }

  /**
   * Cleanup old data (keep last MAX_CACHE_DAYS)
   */
  private cleanup(): void {
    const cutoffTime = Date.now() - (this.MAX_CACHE_DAYS * 24 * 60 * 60 * 1000);

    const deleteOldTicks = this.db.prepare(
      'DELETE FROM tick_data WHERE timestamp < ?'
    );

    const deleteOldOptions = this.db.prepare(
      'DELETE FROM option_chain WHERE timestamp < ?'
    );

    const deleteOldSignals = this.db.prepare(
      'DELETE FROM signals WHERE timestamp < ?'
    );

    this.db.transaction(() => {
      deleteOldTicks.run(cutoffTime);
      deleteOldOptions.run(cutoffTime);
      deleteOldSignals.run(cutoffTime);
    })();

    // Vacuum to reclaim space
    this.db.pragma('optimize');
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
    this.db.close();
  }

  /**
   * Get database statistics
   */
  getStats(): any {
    const tickCount = this.db.prepare('SELECT COUNT(*) as count FROM tick_data').get();
    const optionCount = this.db.prepare('SELECT COUNT(*) as count FROM option_chain').get();
    const signalCount = this.db.prepare('SELECT COUNT(*) as count FROM signals').get();
    const watchlistCount = this.db.prepare('SELECT COUNT(*) as count FROM watchlist').get();

    return {
      ticks: (tickCount as any).count,
      options: (optionCount as any).count,
      signals: (signalCount as any).count,
      watchlist: (watchlistCount as any).count
    };
  }
}
