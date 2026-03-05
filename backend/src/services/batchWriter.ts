// backend/src/services/batchWriter.ts
import { Pool } from 'pg';

// Import your existing pool from backend/src/database/db.ts
import pool from '../database/db';

interface TickRecord {
  symbol: string;
  token: string;
  ltp: number;
  oi: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: Date;
}

class BatchWriter {
  private queue: TickRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly FLUSH_MS = 500;
  private readonly MAX_BATCH = 500;
  private readonly MAX_QUEUE = 10000;
  private isFlusing = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.FLUSH_MS);
    console.log('✅ BatchWriter started — flushes every 500ms');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush(); // Final flush on stop
  }

  enqueue(tick: TickRecord): void {
    this.queue.push(tick);
    if (this.queue.length > this.MAX_QUEUE) {
      this.queue.splice(0, 1000); // Drop oldest 1000 if overloaded
      console.warn('BatchWriter: dropped 1000 old ticks (queue overflow)');
    }
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isFlusing) return;
    this.isFlusing = true;

    const batch = this.queue.splice(0, this.MAX_BATCH);

    try {
      // Build bulk INSERT — much faster than row-by-row
      const values = batch.map((_, i) => {
        const base = i * 10;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`;
      }).join(',');

      const params = batch.flatMap(t => [
        t.symbol, t.token, t.ltp, t.oi, t.volume,
        t.open, t.high, t.low, t.close, t.timestamp
      ]);

      await pool.query(`
        INSERT INTO nifty_premium_tracking.options_data
          (symbol, token, ltp, oi, volume, open, high, low, close, timestamp)
        VALUES ${values}
        ON CONFLICT (token, timestamp) DO UPDATE SET
          ltp = EXCLUDED.ltp, oi = EXCLUDED.oi, volume = EXCLUDED.volume
      `, params);

    } catch (err) {
      console.error('BatchWriter flush error:', err);
    } finally {
      this.isFlusing = false;
    }
  }

  getQueueSize(): number { return this.queue.length; }
}

export const batchWriter = new BatchWriter();