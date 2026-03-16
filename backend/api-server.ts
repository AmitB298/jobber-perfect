/**
 * api-server.ts — JOBBER PRO — 35 ENDPOINTS
 *
 * ════ FIX R — spotChange showing 0.00 (FIXED) ════════════════════════════════
 *   ROOT CAUSE: prevSpot used OFFSET 1 from market_data (the tick just before
 *   current). Since ticks arrive every 500ms, prevSpot ≈ spotPrice → change = 0.
 *   FIX: daily_close table stores official NSE close per day. refreshCache()
 *   reads yesterday's close_price. Auto-saved at 3:31 PM IST daily.
 *   FALLBACK: daily_close → last tick before today midnight IST → 0 (show –)
 *
 * ════ FIX Q — Wrong LTP (weekly vs monthly expiry) ═══════════════════════════
 *   FIX: AND expiry_date = $3 added to both chain queries.
 *
 * ════ FIX S — OI Scanner routes registered (v7.5) ═══════════════════════════
 *   Added: import { registerOIScannerRoutes } from './oi-scanner-routes'
 *   Added: registerOIScannerRoutes(app, pool) before httpServer.listen
 *
 * ════ FIX 1 — buildGreeksPayload: timestamp + source fields ══════════════════
 *   Added: timestamp (ISO) so frontend can calculate push latency
 *   Added: source: 'live_push' so frontend knows this is a real push vs REST
 *
 * ════ FIX 2 — prevClose guard: never fall back to spotPrice ══════════════════
 *   BEFORE: prevClose = spotPrice → spotChange = 0 always (misleading)
 *   AFTER:  prevClose = 0 → spotChange = 0, spotChangePercent = 0
 *           UI shows – instead of 0.00% when baseline is genuinely unknown
 * ════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import ExcelJS from 'exceljs';
import * as net from 'net';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { calculateChainGreeks, getNextNiftyExpiry, getATMiv } from './greeks-calculator';
import {
  generateTradingSignals, analyzeIV, calculateExpectedMove,
  findDeltaNeutralOpportunities, findThetaDecayOpportunities, findGammaScalpSetups
} from './signals-engine';
import { PremiumPredictor } from './premium-prediction-engine';
import { registerOIScannerRoutes } from './oi-scanner-routes';
import { registerOIPulseRoutes } from './oi-pulse-routes';

const app  = express();
const port = 3001;

// ============================================================================
// DATABASE
// ============================================================================
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'jobber_pro',
  user: 'postgres', password: process.env.DB_PASSWORD || 'postgres',
  max: 10, min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => console.error('⚠️  Pool idle error (non-fatal):', err.message));

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nifty_premium_tracking.iv_history (
        id BIGSERIAL PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atm_strike INTEGER NOT NULL, spot_price NUMERIC(10,2) NOT NULL,
        atm_iv NUMERIC(8,4) NOT NULL, days_to_exp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_iv_history_ts ON nifty_premium_tracking.iv_history(timestamp DESC);

      CREATE TABLE IF NOT EXISTS nifty_premium_tracking.option_snapshots (
        id          BIGSERIAL PRIMARY KEY,
        label       TEXT          NOT NULL DEFAULT '',
        captured_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        spot_price  NUMERIC(12,2) NOT NULL,
        atm_strike  INTEGER       NOT NULL,
        atm_iv      NUMERIC(8,4),
        pcr_oi      NUMERIC(8,4)  NOT NULL DEFAULT 1.0,
        days_to_expiry INTEGER    NOT NULL DEFAULT 0,
        expiry_date DATE,
        row_count   INTEGER       NOT NULL DEFAULT 0,
        tags        TEXT[]        NOT NULL DEFAULT '{}',
        notes       TEXT          NOT NULL DEFAULT '',
        chain_json  JSONB         NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_ts   ON nifty_premium_tracking.option_snapshots(captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_snapshots_tags ON nifty_premium_tracking.option_snapshots USING GIN(tags);

      CREATE TABLE IF NOT EXISTS nifty_premium_tracking.daily_close (
        symbol      TEXT          NOT NULL,
        trade_date  DATE          NOT NULL,
        close_price NUMERIC(10,2) NOT NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (symbol, trade_date)
      );
    `);
    console.log('✅ iv_history + option_snapshots + daily_close tables ready');
  } catch (e) {
    console.error('❌ DB init error (non-fatal):', String(e).slice(0, 100));
  }
}

pool.connect((err, client, release) => {
  if (err) { console.error('❌ Database error:', err.stack); process.exit(1); }
  console.log('✅ Database connected: jobber_pro'); release(); initDB();
});

const predictor = new PremiumPredictor(pool);

// ============================================================================
// ★ DAILY CLOSE AUTO-SAVER — saves NIFTY close at 3:31 PM IST every day
// ============================================================================
async function saveDailyClose(): Promise<void> {
  try {
    const spotRes = await pool.query(
      `SELECT ltp FROM nifty_premium_tracking.market_data
       WHERE symbol='NIFTY' ORDER BY timestamp DESC LIMIT 1`
    );
    const closePrice = Number(spotRes.rows[0]?.ltp);
    if (!closePrice || closePrice < 10000) {
      console.warn('⚠️  saveDailyClose: no valid price, skipping'); return;
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await pool.query(
      `INSERT INTO nifty_premium_tracking.daily_close (symbol, trade_date, close_price)
       VALUES ('NIFTY', $1, $2)
       ON CONFLICT (symbol, trade_date) DO UPDATE SET close_price = EXCLUDED.close_price`,
      [today, closePrice]
    );
    console.log(`✅ Daily close saved: NIFTY ₹${closePrice} on ${today}`);
  } catch (e: any) { console.error('❌ saveDailyClose error:', e.message); }
}

let dailyCloseSavedToday = '';
setInterval(() => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const todayStr = ist.toISOString().split('T')[0];
  if (h === 15 && m === 31 && dailyCloseSavedToday !== todayStr) {
    dailyCloseSavedToday = todayStr;
    saveDailyClose();
  }
}, 60_000);

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true }));
app.use(express.json());
app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });

// ============================================================================
// NSE MARKET STATUS
// ============================================================================
const NSE_HOLIDAYS_2025: string[] = [
  '2025-01-26','2025-02-26','2025-03-14','2025-03-31','2025-04-10',
  '2025-04-14','2025-04-18','2025-05-01','2025-08-15','2025-08-27',
  '2025-10-02','2025-10-20','2025-10-21','2025-11-05','2025-12-25',
];
const NSE_HOLIDAYS_2026: string[] = [
  '2026-01-26','2026-02-18','2026-03-03','2026-03-20','2026-04-03',
  '2026-04-14','2026-04-30','2026-05-01','2026-08-15','2026-09-16',
  '2026-10-02','2026-10-09','2026-10-29','2026-10-30','2026-11-24','2026-12-25',
];
const ALL_NSE_HOLIDAYS = new Set([...NSE_HOLIDAYS_2025, ...NSE_HOLIDAYS_2026]);
const MUHURAT_TRADING_DATES: string[] = ['2025-10-20', '2026-10-29'];

function getISTDateString(ist: Date): string {
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function getNextOpenDay(ist: Date): string {
  const next = new Date(ist.getTime() + 24 * 60 * 60 * 1000);
  for (let i = 0; i < 7; i++) {
    const dateStr = getISTDateString(next);
    const day = next.getUTCDay();
    if (day >= 1 && day <= 5 && !ALL_NSE_HOLIDAYS.has(dateStr)) {
      const days = Math.round((next.getTime() - ist.getTime()) / (24 * 60 * 60 * 1000));
      const dayName = next.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
      return days === 1 ? `Tomorrow (${dayName})` : `${dayName} (+${days} days)`;
    }
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return 'Next trading day';
}

interface MarketStatus {
  isOpen: boolean;
  session: 'LIVE' | 'PRE_OPEN' | 'POST_MARKET' | 'WEEKEND' | 'HOLIDAY' | 'MUHURAT';
  note: string; holidayName?: string; nextOpen?: string;
  minsToOpen?: number; minsToClose?: number; dataAgeMinutes?: number;
}

function getMarketStatus(latestDataAt?: Date | null): MarketStatus {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay(), h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const timeMin = h * 60 + m;
  const PRE_OPEN_START = 9 * 60, MARKET_OPEN = 9 * 60 + 15, MARKET_CLOSE = 15 * 60 + 30;
  const MUHURAT_START = 18 * 60, MUHURAT_END = 19 * 60;
  const isWeekend = day === 0 || day === 6;
  const dateStr = getISTDateString(ist);
  const isHoliday = ALL_NSE_HOLIDAYS.has(dateStr);
  const isMuhuratDay = MUHURAT_TRADING_DATES.includes(dateStr);
  let dataAgeMinutes: number | undefined;
  if (latestDataAt) dataAgeMinutes = Math.round((now.getTime() - latestDataAt.getTime()) / 60000);
  const nextOpen = getNextOpenDay(ist);
  if (isWeekend) {
    const dayName = day === 0 ? 'Sunday' : 'Saturday';
    return { isOpen: false, session: 'WEEKEND', note: `${dayName} — NSE is closed`, nextOpen, dataAgeMinutes };
  }
  if (isHoliday) {
    if (isMuhuratDay && timeMin >= MUHURAT_START && timeMin < MUHURAT_END)
      return { isOpen: true, session: 'MUHURAT', note: `✨ Muhurat Trading — Diwali special session (ends 7:00 PM IST)`, minsToClose: MUHURAT_END - timeMin, dataAgeMinutes };
    const holidayMap: Record<string, string> = {
      '2026-01-26':'Republic Day','2026-02-18':'Mahashivratri','2026-03-03':'Holi',
      '2026-03-20':'Id-Ul-Fitr (Ramzan Eid)','2026-04-03':'Good Friday',
      '2026-04-14':'Dr. Baba Saheb Ambedkar Jayanti','2026-04-30':'Ram Navami',
      '2026-05-01':'Maharashtra Day','2026-08-15':'Independence Day',
      '2026-09-16':'Ganesh Chaturthi','2026-10-02':'Mahatma Gandhi Jayanti',
      '2026-10-09':'Dussehra','2026-10-29':'Diwali Laxmi Pujan',
      '2026-10-30':'Diwali Balipratipada','2026-11-24':'Guru Nanak Jayanti','2026-12-25':'Christmas',
      '2025-01-26':'Republic Day','2025-02-26':'Mahashivratri','2025-03-14':'Holi',
      '2025-03-31':'Id-Ul-Fitr (Ramzan Eid)','2025-04-10':'Ram Navami',
      '2025-04-14':'Dr. Baba Saheb Ambedkar Jayanti','2025-04-18':'Good Friday',
      '2025-05-01':'Maharashtra Day','2025-08-15':'Independence Day',
      '2025-08-27':'Ganesh Chaturthi','2025-10-02':'Mahatma Gandhi Jayanti / Dussehra',
      '2025-10-20':'Diwali Laxmi Pujan','2025-10-21':'Diwali Balipratipada',
      '2025-11-05':'Guru Nanak Jayanti','2025-12-25':'Christmas',
    };
    const holidayName = holidayMap[dateStr] || 'Public Holiday';
    return { isOpen: false, session: 'HOLIDAY', note: `NSE Holiday — ${holidayName}`, holidayName, nextOpen, dataAgeMinutes };
  }
  if (timeMin >= PRE_OPEN_START && timeMin < MARKET_OPEN)
    return { isOpen: false, session: 'PRE_OPEN', note: `Pre-open session — Market opens at 9:15 AM IST`, minsToOpen: MARKET_OPEN - timeMin, dataAgeMinutes };
  if (timeMin >= MARKET_OPEN && timeMin <= MARKET_CLOSE)
    return { isOpen: true, session: 'LIVE', note: `Live market data — NSE open until 3:30 PM IST`, minsToClose: MARKET_CLOSE - timeMin, dataAgeMinutes };
  return { isOpen: false, session: 'POST_MARKET', note: `Market closed for today — next session opens at 9:15 AM IST`, nextOpen: 'Tomorrow (9:15 AM)', dataAgeMinutes };
}

// ============================================================================
// HELPERS
// ============================================================================
const N = (v: any, fb = 0): number => { const p = Number(v); return (isNaN(p) || !isFinite(p)) ? fb : p; };
const fmtK = (v: any): string => { const n = N(v, 0); if (n >= 1e7) return (n / 1e7).toFixed(1) + 'Cr'; if (n >= 1e5) return (n / 1e5).toFixed(1) + 'L'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toFixed(0); };
const ivClr = (iv: number): string => iv < 12 ? '22C55E' : iv < 18 ? '84CC16' : iv < 25 ? 'FBBF24' : iv < 35 ? 'F97316' : 'EF4444';
const ivBg  = (iv: number): string => iv < 12 ? '082808' : iv < 18 ? '143A14' : iv < 25 ? '383008' : iv < 35 ? '382808' : '380808';

function calcMaxPain(chain: any[], fallback = 25000): number {
  if (!chain.length) return fallback;
  let best = N(chain[0]?.strike_price, fallback), min = Infinity;
  for (const t of chain) { const ts = N(t.strike_price); let loss = 0; for (const r of chain) { const s = N(r.strike_price); if (ts > s) loss += (ts - s) * N(r.ce_oi); if (ts < s) loss += (s - ts) * N(r.pe_oi); } if (loss < min) { min = loss; best = ts; } }
  return best || fallback;
}

async function storeIVHistory(chain: any[], spotPrice: number, atmStrike: number, expiryDate: Date) {
  try {
    const iv = getATMiv(chain, spotPrice); if (iv == null || iv <= 0) return;
    const dte = Math.max(1, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000));
    await pool.query(`INSERT INTO nifty_premium_tracking.iv_history(atm_strike,spot_price,atm_iv,days_to_exp) VALUES($1,$2,$3,$4)`, [atmStrike, spotPrice, iv, dte]);
  } catch (_) {}
}

async function getRealIVHistory(): Promise<number[]> {
  try {
    const res = await pool.query(`SELECT atm_iv FROM nifty_premium_tracking.iv_history WHERE timestamp>NOW()-INTERVAL '365 days' ORDER BY timestamp DESC LIMIT 500`);
    if (res.rows.length < 10) return [];
    return res.rows.map((r: any) => Number(r.atm_iv)).filter((v: number) => v > 0 && v < 100);
  } catch (_) { return []; }
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================
interface ChainCache {
  spotPrice: number; spotChange: number; spotChangePercent: number;
  atmStrike: number; chainWithGreeks: any[]; expiryDate: Date;
  pcr_oi: number; pcr_volume: number; maxPain: number; totalTicks: number;
  latestDataAt: Date | null; refreshedAt: Date; dataAgeMs: number;
  marketStatus: MarketStatus;
}

let cache: ChainCache | null = null;
let cacheRefreshing = false;
const SSE_CLIENTS = new Set<express.Response>();

// ============================================================================
// FIX Q — EXPIRY-FILTERED CHAIN QUERIES
// ============================================================================
const FAST_CHAIN_QUERY = `
  WITH latest AS (
    SELECT DISTINCT ON (strike_price, option_type)
      strike_price, option_type, ltp::NUMERIC(10,2) AS ltp, volume, oi
    FROM nifty_premium_tracking.options_data
    WHERE timestamp > NOW() - INTERVAL '5 minutes'
      AND strike_price BETWEEN $1 AND $2
      AND expiry_date = $3
    ORDER BY strike_price, option_type, timestamp DESC
  )
  SELECT strike_price,
    MAX(CASE WHEN option_type='CE' THEN ltp    END) as ce_ltp,
    MAX(CASE WHEN option_type='PE' THEN ltp    END) as pe_ltp,
    MAX(CASE WHEN option_type='CE' THEN volume END) as ce_volume,
    MAX(CASE WHEN option_type='PE' THEN volume END) as pe_volume,
    MAX(CASE WHEN option_type='CE' THEN oi     END) as ce_oi,
    MAX(CASE WHEN option_type='PE' THEN oi     END) as pe_oi
  FROM latest GROUP BY strike_price ORDER BY strike_price
`;

const FALLBACK_CHAIN_QUERY = `
  WITH latest AS (
    SELECT DISTINCT ON (strike_price, option_type)
      strike_price, option_type, ltp::NUMERIC(10,2) AS ltp, volume, oi
    FROM nifty_premium_tracking.options_data
    WHERE strike_price BETWEEN $1 AND $2
      AND expiry_date = $3
    ORDER BY strike_price, option_type, timestamp DESC
  )
  SELECT strike_price,
    MAX(CASE WHEN option_type='CE' THEN ltp    END) as ce_ltp,
    MAX(CASE WHEN option_type='PE' THEN ltp    END) as pe_ltp,
    MAX(CASE WHEN option_type='CE' THEN volume END) as ce_volume,
    MAX(CASE WHEN option_type='PE' THEN volume END) as pe_volume,
    MAX(CASE WHEN option_type='CE' THEN oi     END) as ce_oi,
    MAX(CASE WHEN option_type='PE' THEN oi     END) as pe_oi
  FROM latest GROUP BY strike_price ORDER BY strike_price
`;

// ============================================================================
// ★ FIX R + FIX 2 — refreshCache with correct prevClose guard
// ============================================================================
async function refreshCache(): Promise<void> {
  if (cacheRefreshing) return;
  cacheRefreshing = true;
  try {
    const [spotRes, ticksRes, latestTsRes, prevCloseRes] = await Promise.all([
      pool.query(`SELECT ltp as spot_price, timestamp FROM nifty_premium_tracking.market_data WHERE symbol='NIFTY' ORDER BY timestamp DESC LIMIT 1`),
      pool.query(`SELECT COUNT(*) as total_ticks FROM nifty_premium_tracking.options_data`),
      pool.query(`SELECT MAX(timestamp) as latest_ts FROM nifty_premium_tracking.options_data`),
      // FIX R: fetch official previous close from daily_close table
      pool.query(
        `SELECT close_price as prev_close
         FROM nifty_premium_tracking.daily_close
         WHERE symbol = 'NIFTY'
           AND trade_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
         ORDER BY trade_date DESC LIMIT 1`
      ),
    ]);

    const spotPrice    = Number(spotRes.rows[0]?.spot_price) || 25500;
    const atmStrike    = Math.round(spotPrice / 50) * 50;
    const latestDataAt = latestTsRes.rows[0]?.latest_ts ? new Date(latestTsRes.rows[0].latest_ts) : null;
    const dataAgeMs    = latestDataAt ? Date.now() - latestDataAt.getTime() : 999999;

    // ✅ FIX 2: 3-level fallback — NEVER use spotPrice as baseline.
    // If prevClose is unknown, keep it 0 and show 0 change rather than
    // the old bug where prevClose = spotPrice → change = 0 every tick.
    let prevClose = Number(prevCloseRes.rows[0]?.prev_close) || 0;
    if (prevClose <= 0) {
      try {
        // Fallback 2: last market_data tick from a previous calendar day in IST
        const fbRes = await pool.query(
          `SELECT ltp as prev_close
           FROM nifty_premium_tracking.market_data
           WHERE symbol = 'NIFTY'
             AND timestamp < (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
           ORDER BY timestamp DESC LIMIT 1`
        );
        // ✅ FIX 2: stay at 0 if still nothing found — do NOT fall back to spotPrice
        prevClose = Number(fbRes.rows[0]?.prev_close) || 0;
      } catch (_) {
        prevClose = 0; // ✅ FIX 2: 0, not spotPrice
      }
    }

    // FIX Q: expiry filter
    const expiryDate    = getNextNiftyExpiry();
    const expiryDateStr = expiryDate.toISOString().split('T')[0];

    let optsRows: any[] = [];
    const atmOffset = 600;
    try {
      const fast = await pool.query(FAST_CHAIN_QUERY, [atmStrike - atmOffset, atmStrike + atmOffset, expiryDateStr]);
      optsRows = fast.rows;
      if (optsRows.length === 0) {
        const fb = await pool.query(FALLBACK_CHAIN_QUERY, [atmStrike - atmOffset, atmStrike + atmOffset, expiryDateStr]);
        optsRows = fb.rows;
      }
    } catch (_) {
      const fb = await pool.query(FALLBACK_CHAIN_QUERY, [atmStrike - atmOffset, atmStrike + atmOffset, expiryDateStr]);
      optsRows = fb.rows;
    }

    const totalCeOI = optsRows.reduce((s, r) => s + N(r.ce_oi), 0);
    const totalPeOI = optsRows.reduce((s, r) => s + N(r.pe_oi), 0);
    const pcr_oi    = totalCeOI > 0 ? totalPeOI / totalCeOI : 1;

    let pcr_volume = cache?.pcr_volume ?? 1;
    pool.query(`SELECT COALESCE(SUM(CASE WHEN option_type='PE' THEN volume ELSE 0 END)::NUMERIC/NULLIF(SUM(CASE WHEN option_type='CE' THEN volume ELSE 0 END),0),0) as v FROM nifty_premium_tracking.options_data WHERE timestamp > NOW() - INTERVAL '5 minutes'`)
      .then(r => { pcr_volume = Number(r.rows[0]?.v) || 1; }).catch(() => {});

    const chainWithGreeks = calculateChainGreeks(optsRows, spotPrice, expiryDate, latestDataAt ?? undefined);
    const maxPain         = calcMaxPain(chainWithGreeks, atmStrike);

    // ✅ FIX 2: guard — only calculate change when prevClose is a real value
    const spotChange        = prevClose > 0 ? spotPrice - prevClose : 0;
    const spotChangePercent = prevClose > 0 ? (spotChange / prevClose) * 100 : 0;
    const marketStatus      = getMarketStatus(latestDataAt);

    const newCache: ChainCache = {
      spotPrice, spotChange, spotChangePercent,
      atmStrike, chainWithGreeks, expiryDate,
      pcr_oi, pcr_volume, maxPain,
      totalTicks: Number(ticksRes.rows[0]?.total_ticks) || 0,
      latestDataAt, refreshedAt: new Date(), dataAgeMs, marketStatus,
    };

    const changed = !cache
      || cache.spotPrice !== newCache.spotPrice
      || cache.chainWithGreeks.length !== newCache.chainWithGreeks.length
      || (cache.chainWithGreeks[0]?.ce_ltp !== newCache.chainWithGreeks[0]?.ce_ltp);

    cache = newCache;

    if (changed) {
      if (SSE_CLIENTS.size > 0) {
        const payload = buildGreeksPayload();
        const msg = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of SSE_CLIENTS) {
          try { client.write(msg); } catch (_) { SSE_CLIENTS.delete(client); }
        }
      }
      wsEmitter.broadcastChain(buildGreeksPayload());
    }
  } catch (e: any) {
    if (!cache) console.error('❌ [CACHE] Initial load failed:', e.message);
  } finally {
    cacheRefreshing = false;
  }
}

setInterval(refreshCache, 500);
refreshCache();

// ✅ FIX 1: buildGreeksPayload now includes timestamp + source
// timestamp — ISO string of server send time, used by frontend to compute push latency
// source    — 'live_push' so frontend can distinguish SSE from REST fallback poll
function buildGreeksPayload() {
  if (!cache) return null;
  return {
    spotPrice:          cache.spotPrice,
    spotChange:         cache.spotChange,
    spotChangePercent:  cache.spotChangePercent,
    atmStrike:          cache.atmStrike,
    chainWithGreeks:    cache.chainWithGreeks,
    chain:              cache.chainWithGreeks,
    expiryDate:         cache.expiryDate.toISOString(),
    pcr_oi:             cache.pcr_oi,
    pcr_volume:         cache.pcr_volume,
    maxPain:            cache.maxPain,
    totalTicks:         cache.totalTicks,
    latestDataAt:       cache.latestDataAt,
    refreshedAt:        cache.refreshedAt.toISOString(),
    dataAgeMs:          cache.dataAgeMs,
    marketStatus:       cache.marketStatus,
    // ✅ FIX 1A: server-side send time — lets frontend measure end-to-end push latency
    timestamp:          new Date().toISOString(),
    // ✅ FIX 1B: source tag — frontend uses this to distinguish live push vs REST poll
    source:             'live_push' as const,
  };
}

async function waitForCache(ms = 3000): Promise<ChainCache> {
  const deadline = Date.now() + ms;
  while (!cache && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  if (!cache) throw new Error('Cache not ready — DB may be empty or unreachable');
  return cache;
}

// ============================================================================
// ⚡ IN-MEMORY TICK STORE
// ============================================================================
interface LiveTick {
  token: string; symbol: string; ltp: number; oi: number; volume: number;
  timestamp: number; [key: string]: any;
}

class InMemoryTickStore {
  private ticks = new Map<string, LiveTick>();
  private readonly MAX = 5000;
  set(token: string, tick: LiveTick): void {
    this.ticks.set(token, tick);
    if (this.ticks.size > this.MAX) this.ticks.delete(this.ticks.keys().next().value!);
  }
  get(token: string): LiveTick | null { return this.ticks.get(token) ?? null; }
  getStats() { return { tickCount: this.ticks.size, estimatedRAMkb: Math.round(this.ticks.size * 0.3) }; }
}
const tickStore = new InMemoryTickStore();

// ============================================================================
// ⚡ BATCH WRITER
// ============================================================================
interface TickRecord {
  symbol: string; token: string; ltp: number; oi: number; volume: number;
  open: number; high: number; low: number; close: number; timestamp: Date;
  [key: string]: any;
}

class BatchWriter {
  private queue: TickRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly FLUSH_MS  = 500;
  private readonly MAX_BATCH = 500;
  private readonly MAX_QUEUE = 10_000;
  private isFlushing = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.FLUSH_MS);
    console.log('✅ BatchWriter started — flushing every 500ms');
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.flush(); }
  enqueue(tick: TickRecord): void {
    this.queue.push(tick);
    if (this.queue.length > this.MAX_QUEUE) { this.queue.splice(0, 1000); console.warn('⚠️  BatchWriter: dropped 1000 old ticks (queue overflow)'); }
  }
  private async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isFlushing) return;
    this.isFlushing = true;
    const batch = this.queue.splice(0, this.MAX_BATCH);
    try {
      const placeholders = batch.map((_, i) => { const b = i * 10; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`; }).join(',');
      const params = batch.flatMap(t => [t.symbol, t.token, t.ltp, t.oi, t.volume, t.open, t.high, t.low, t.close, t.timestamp]);
      await pool.query(`INSERT INTO nifty_premium_tracking.options_data (symbol,token,ltp,oi,volume,open,high,low,close,timestamp) VALUES ${placeholders} ON CONFLICT (token,timestamp) DO UPDATE SET ltp=EXCLUDED.ltp,oi=EXCLUDED.oi,volume=EXCLUDED.volume`, params);
    } catch (e: any) { console.error('❌ BatchWriter flush error:', e.message); }
    finally { this.isFlushing = false; }
  }
  getQueueSize(): number { return this.queue.length; }
}
const batchWriter = new BatchWriter();

// ============================================================================
// ⚡ WEBSOCKET EMITTER
// ============================================================================
interface WsClient { ws: WebSocket; subs: Set<string>; }

class WsEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WsClient>();

  attach(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      const id = Math.random().toString(36).slice(2, 10);
      this.clients.set(id, { ws, subs: new Set(['ALL']) });
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()); const client = this.clients.get(id); if (!client) return;
          if (msg.action === 'subscribe')   msg.keys?.forEach((k: string) => client.subs.add(k));
          if (msg.action === 'unsubscribe') msg.keys?.forEach((k: string) => client.subs.delete(k));
        } catch (_) {}
      });
      ws.on('close', () => { this.clients.delete(id); console.log(`WS client disconnected: ${id} | remaining: ${this.clients.size}`); });
      ws.on('error', () => this.clients.delete(id));
      // ✅ FIX 1: send initial payload with timestamp+source on connection
      if (cache) { try { ws.send(JSON.stringify({ type: 'chain', data: buildGreeksPayload(), ts: Date.now() })); } catch (_) {} }
      console.log(`WS client connected: ${id} | total: ${this.clients.size}`);
    });
    console.log('✅ WsEmitter attached on ws://localhost:' + port + '/ws');
  }

  broadcastChain(payload: any): void {
    if (!payload || this.clients.size === 0) return;
    this._send('chain', JSON.stringify({ type: 'chain', data: payload, ts: Date.now() }));
  }
  broadcastTick(token: string, tick: LiveTick): void {
    if (this.clients.size === 0) return;
    this._send(`tick:${token}`, JSON.stringify({ type: 'tick', token, data: tick, ts: Date.now() }));
  }
  broadcastSpot(symbol: string, ltp: number): void {
    if (this.clients.size === 0) return;
    this._send('spot', JSON.stringify({ type: 'spot', symbol, ltp, ts: Date.now() }));
  }
  private _send(key: string, msg: string): void {
    this.clients.forEach(({ ws, subs }) => {
      if ((subs.has(key) || subs.has('ALL')) && ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch (_) {} }
    });
  }
  clientCount(): number { return this.clients.size; }
}
const wsEmitter = new WsEmitter();

// ============================================================================
// ⚡ TICK INGEST ENDPOINTS
// ============================================================================
app.post('/api/tick/ingest', (req, res) => {
  try {
    const tick: LiveTick = req.body;
    if (!tick?.token) return res.status(400).json({ error: 'token required' });
    if (tick.symbol?.includes('NIFTY') && Math.random() < 0.01) console.log(`🔍 RAW LTP: ${tick.symbol} | ltp=${tick.ltp} | type=${typeof tick.ltp} | token=${tick.token}`);
    tickStore.set(tick.token, { ...tick, timestamp: Date.now() });
    wsEmitter.broadcastTick(tick.token, tick);
    if (tick.symbol === 'NIFTY' || tick.symbol === 'BANKNIFTY') wsEmitter.broadcastSpot(tick.symbol, tick.ltp);
    batchWriter.enqueue({
      symbol: tick.symbol || '', token: tick.token,
      ltp: Number(tick.ltp) || 0, oi: Number(tick.oi) || 0, volume: Number(tick.volume) || 0,
      open: Number(tick.open) || 0, high: Number(tick.high) || 0, low: Number(tick.low) || 0,
      close: Number(tick.close) || 0, timestamp: new Date(tick.exchange_timestamp || Date.now()),
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tick/:token', (req, res) => {
  const tick = tickStore.get(req.params.token);
  if (!tick) return res.status(404).json({ error: 'Token not found in cache' });
  res.json({ source: 'memory', data: tick });
});

app.get('/api/system/stats', (_, res) => {
  res.json({
    tickStore: tickStore.getStats(), wsClients: wsEmitter.clientCount(),
    dbQueue: batchWriter.getQueueSize(),
    cacheAge: cache ? Date.now() - cache.refreshedAt.getTime() : null,
    uptime: Math.round(process.uptime()),
  });
});

// ============================================================================
// 🌐 NETWORK SPEED MONITOR
// ============================================================================
interface NetStatus {
  isOnline: boolean; quality: 'EXCELLENT'|'GOOD'|'FAIR'|'POOR'|'OFFLINE';
  downloadMbps: number|null; latencyMs: number|null; jitterMs: number|null;
  packetLoss: number; lastChecked: string; consecutiveFailures: number;
  alert: { level:'WARNING'|'CRITICAL'|'RECOVERED'; message:string; timestamp:string; } | null;
}

let netState: NetStatus = {
  isOnline: true, quality: 'GOOD', downloadMbps: null,
  latencyMs: null, jitterMs: null, packetLoss: 0,
  lastChecked: new Date().toISOString(), consecutiveFailures: 0, alert: null,
};

const netSseClients = new Set<express.Response>();
const PING_TARGETS = [{ host:'8.8.8.8', port:53 }, { host:'1.1.1.1', port:53 }, { host:'8.8.4.4', port:53 }];

function measureTCPLatency(host: string, port: number, timeoutMs = 3000): Promise<number|null> {
  return new Promise(resolve => {
    const start = Date.now(), socket = new net.Socket(); let resolved = false;
    const done = (r: number|null) => { if (!resolved) { resolved = true; socket.destroy(); resolve(r); } };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(Date.now() - start));
    socket.on('timeout', () => done(null));
    socket.on('error', () => done(null));
    socket.connect(port, host);
  });
}

function measureDownloadSpeed(timeoutMs = 8000): Promise<number|null> {
  return new Promise(resolve => {
    const url = 'http://www.gstatic.com/generate_204';
    const start = Date.now(); let bytes = 0, settled = false;
    const done = (mbps: number|null) => { if (!settled) { settled = true; resolve(mbps); } };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        res.on('end', () => { clearTimeout(timer); const elapsed = (Date.now() - start) / 1000; done(elapsed > 0 && bytes > 0 ? (bytes * 8) / elapsed / 1_000_000 : 0.1); });
        res.on('error', () => { clearTimeout(timer); done(null); });
      });
      req.on('error', () => { clearTimeout(timer); done(null); });
    } catch { clearTimeout(timer); done(null); }
  });
}

function calculateJitter(latencies: number[]): number {
  if (latencies.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < latencies.length; i++) total += Math.abs(latencies[i] - latencies[i - 1]);
  return Math.round(total / (latencies.length - 1));
}

function gradeNetQuality(isOnline: boolean, latency: number|null, _dl: number|null, packetLoss: number): NetStatus['quality'] {
  if (!isOnline || packetLoss >= 100) return 'OFFLINE';
  if (packetLoss >= 50) return 'POOR';
  const lat = latency ?? 9999;
  if (lat < 30 && packetLoss === 0) return 'EXCELLENT';
  if (lat < 80 && packetLoss < 5)   return 'GOOD';
  if (lat < 150 && packetLoss < 20) return 'FAIR';
  return 'POOR';
}

let prevNetQuality: NetStatus['quality'] = 'GOOD';
function generateNetAlert(newQuality: NetStatus['quality']): NetStatus['alert'] {
  const prev = prevNetQuality; prevNetQuality = newQuality;
  if (newQuality === 'OFFLINE' && prev !== 'OFFLINE') return { level:'CRITICAL', message:'🔴 INTERNET LOST — Angel One WebSocket will disconnect!', timestamp: new Date().toISOString() };
  if (newQuality === 'POOR' && !['POOR','OFFLINE'].includes(prev)) return { level:'WARNING', message:'⚠️ POOR CONNECTION — High latency. Data feed may lag.', timestamp: new Date().toISOString() };
  if (['EXCELLENT','GOOD'].includes(newQuality) && ['POOR','OFFLINE'].includes(prev)) return { level:'RECOVERED', message:'✅ CONNECTION RESTORED — Network quality back to normal.', timestamp: new Date().toISOString() };
  return null;
}

function broadcastNetSSE(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of netSseClients) { try { client.write(payload); } catch { netSseClients.delete(client); } }
}

let isNetPolling = false;
async function runNetworkCheck() {
  if (isNetPolling) return; isNetPolling = true;
  try {
    const results = await Promise.all(PING_TARGETS.map(t => measureTCPLatency(t.host, t.port, 2000)));
    const successful = results.filter((r): r is number => r !== null);
    const lossPercent = Math.round(((PING_TARGETS.length - successful.length) / PING_TARGETS.length) * 100);
    const isOnline = successful.length > 0;
    const avgLatency = isOnline ? Math.round(successful.reduce((a, b) => a + b, 0) / successful.length) : null;
    const jitter = isOnline ? calculateJitter(successful) : null;
    const shouldTestSpeed = Date.now() % 15000 < 5000;
    let downloadMbps = netState.downloadMbps;
    if (shouldTestSpeed && isOnline) downloadMbps = await measureDownloadSpeed(6000);
    const quality = gradeNetQuality(isOnline, avgLatency, downloadMbps, lossPercent);
    const alert = generateNetAlert(quality);
    netState = { isOnline, quality, downloadMbps, latencyMs: avgLatency, jitterMs: jitter, packetLoss: lossPercent, lastChecked: new Date().toISOString(), consecutiveFailures: isOnline ? 0 : netState.consecutiveFailures + 1, alert };
    if (alert) broadcastNetSSE({ type: 'network_alert', ...netState });
  } catch {
    netState = { ...netState, isOnline: false, quality: 'OFFLINE', consecutiveFailures: netState.consecutiveFailures + 1, lastChecked: new Date().toISOString(), alert: { level: 'CRITICAL', message: '🔴 Network check failed.', timestamp: new Date().toISOString() } };
  } finally { isNetPolling = false; }
}

app.get('/api/network/status', (_, res) => { res.json({ success: true, data: netState }); });

app.get('/api/network/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive'); res.setHeader('Access-Control-Allow-Origin', '*'); res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'network_status', ...netState })}\n\n`);
  netSseClients.add(res); req.on('close', () => netSseClients.delete(res));
});

app.post('/api/network/speedtest', async (_, res) => {
  try {
    const [pingResults, downloadMbps] = await Promise.all([
      Promise.all(PING_TARGETS.map(t => measureTCPLatency(t.host, t.port, 2000))), measureDownloadSpeed(10000),
    ]);
    const successful = pingResults.filter((r): r is number => r !== null);
    const lossPercent = Math.round(((PING_TARGETS.length - successful.length) / PING_TARGETS.length) * 100);
    const isOnline = successful.length > 0;
    const avgLatency = isOnline ? Math.round(successful.reduce((a, b) => a + b, 0) / successful.length) : null;
    const jitter = calculateJitter(successful);
    const quality = gradeNetQuality(isOnline, avgLatency, downloadMbps, lossPercent);
    netState = { ...netState, isOnline, quality, downloadMbps, latencyMs: avgLatency, jitterMs: jitter, packetLoss: lossPercent, lastChecked: new Date().toISOString() };
    res.json({ success: true, data: netState });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

// ============================================================================
// ── CORE ENDPOINTS 1–11
// ============================================================================

app.get('/api/spot/nifty', async (_, res) => {
  try { const c = await waitForCache(); res.json({ success: true, data: { symbol: 'NIFTY', ltp: c.spotPrice, timestamp: c.latestDataAt } }); }
  catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/options/chain', async (_, res) => {
  try {
    const c = await waitForCache();
    res.json({ success: true, data: { spotPrice: c.spotPrice, atmStrike: c.atmStrike, pcr_oi: c.pcr_oi, pcr_volume: c.pcr_volume, maxPain: c.maxPain, totalTicks: c.totalTicks, chain: c.chainWithGreeks, latestDataAt: c.latestDataAt, marketStatus: c.marketStatus } });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/options/greeks', async (_, res) => {
  try {
    const c = await waitForCache();
    setImmediate(() => storeIVHistory(c.chainWithGreeks, c.spotPrice, c.atmStrike, c.expiryDate));
    // ✅ FIX 1: REST endpoint also returns timestamp + source (source = 'rest_poll')
    res.json({ success: true, data: {
      spotPrice: c.spotPrice, spotChange: c.spotChange, spotChangePercent: c.spotChangePercent,
      atmStrike: c.atmStrike, pcr_oi: c.pcr_oi, pcr_volume: c.pcr_volume,
      maxPain: c.maxPain, totalTicks: c.totalTicks, chain: c.chainWithGreeks,
      expiryDate: c.expiryDate.toISOString(), latestDataAt: c.latestDataAt,
      marketStatus: c.marketStatus, refreshedAt: c.refreshedAt.toISOString(),
      dataAgeMs: c.dataAgeMs,
      timestamp: new Date().toISOString(),  // ✅ FIX 1
      source: 'rest_poll' as const,         // ✅ FIX 1: different source tag for REST
    }});
  } catch (e) { console.error('Greeks error:', e); res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/analytics/pcr', async (_, res) => {
  try {
    const c = await waitForCache();
    const totalCE = c.chainWithGreeks.reduce((s, r) => s + N(r.ce_oi), 0);
    const totalPE = c.chainWithGreeks.reduce((s, r) => s + N(r.pe_oi), 0);
    res.json({ success: true, data: { pcr_oi: c.pcr_oi, pcr_volume: c.pcr_volume, total_ce_oi: totalCE, total_pe_oi: totalPE } });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/analytics/max-pain', async (_, res) => {
  try { const c = await waitForCache(); res.json({ success: true, data: { maxPain: c.maxPain, spotPrice: c.spotPrice, atmStrike: c.atmStrike } }); }
  catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/options/:symbol/history', async (req, res) => {
  try { const r = await pool.query(`SELECT trading_symbol,ltp,timestamp FROM nifty_premium_tracking.options_data WHERE trading_symbol LIKE $1 ORDER BY timestamp DESC LIMIT 100`, [`%${req.params.symbol}%`]); res.json({ success: true, data: r.rows }); }
  catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/stats', async (_, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*) as total_ticks,COUNT(DISTINCT strike_price) as unique_strikes,MIN(timestamp) as oldest_data,MAX(timestamp) as newest_data FROM nifty_premium_tracking.options_data`);
    let ivRows = 0;
    try { const iv = await pool.query(`SELECT COUNT(*) as c FROM nifty_premium_tracking.iv_history`); ivRows = Number(iv.rows[0]?.c) || 0; } catch (_) {}
    res.json({ success: true, data: { ...r.rows[0], iv_history_rows: ivRows, network: netState } });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/stream/live', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive'); res.setHeader('Access-Control-Allow-Origin', '*');
  if (cache) res.write(`data: ${JSON.stringify({ spotPrice: cache.spotPrice, timestamp: cache.latestDataAt, dataAgeMs: cache.dataAgeMs })}\n\n`);
  SSE_CLIENTS.add(res);
  const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 30_000);
  req.on('close', () => { clearInterval(ka); SSE_CLIENTS.delete(res); });
});

app.get('/api/stream/chain', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive'); res.setHeader('Access-Control-Allow-Origin', '*');
  // ✅ FIX 1: initial payload now includes timestamp + source
  if (cache) res.write(`data: ${JSON.stringify(buildGreeksPayload())}\n\n`);
  SSE_CLIENTS.add(res);
  const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 30_000);
  req.on('close', () => { clearInterval(ka); SSE_CLIENTS.delete(res); });
});

app.get('/api/analytics/signals', async (_, res) => {
  try {
    const c = await waitForCache();
    const dte = Math.max(1, Math.ceil((c.expiryDate.getTime() - Date.now()) / 86400000));
    const realHistory = await getRealIVHistory();
    const currentIV = getATMiv(c.chainWithGreeks, c.spotPrice) ?? 20;
    const historicalIVs = realHistory.length >= 10 ? realHistory : Array.from({ length: 52 }, (_, i) => Math.max(8, Math.min(60, currentIV + Math.sin((i / 52) * Math.PI * 2) * 3 + (Math.random() - 0.5) * 4)));
    const ivAnalysis = analyzeIV(currentIV, historicalIVs);
    const signals = generateTradingSignals(c.chainWithGreeks, c.spotPrice, ivAnalysis, dte);
    const expectedMove = calculateExpectedMove(c.chainWithGreeks, c.spotPrice, dte);
    res.json({ success: true, data: { signals, ivAnalysis, expectedMove: { ...expectedMove, straddlePrice: expectedMove.toExpiry / 0.85 }, spotPrice: c.spotPrice, atmStrike: c.atmStrike, daysToExpiry: dte, currentIV, ivHistorySource: realHistory.length >= 10 ? 'real_db' : 'estimated', ivHistoryPoints: realHistory.length } });
  } catch (e) { console.error('Signals error:', e); res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/analytics/iv-history', async (_, res) => {
  try { const r = await pool.query(`SELECT DATE_TRUNC('hour',timestamp) as hour,AVG(atm_iv) as avg_iv,MIN(atm_iv) as min_iv,MAX(atm_iv) as max_iv,AVG(spot_price) as spot_price FROM nifty_premium_tracking.iv_history WHERE timestamp>NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY 1 DESC LIMIT 720`); res.json({ success: true, data: r.rows }); }
  catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/analytics/opportunities', async (_, res) => {
  try {
    const c = await waitForCache();
    const dte = Math.max(1, Math.ceil((c.expiryDate.getTime() - Date.now()) / 86400000));
    res.json({ success: true, data: { deltaNeutral: findDeltaNeutralOpportunities(c.chainWithGreeks, c.spotPrice), thetaDecay: findThetaDecayOpportunities(c.chainWithGreeks, c.spotPrice, dte), gammaScalp: findGammaScalpSetups(c.chainWithGreeks, c.spotPrice), spotPrice: c.spotPrice, daysToExpiry: dte } });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// ============================================================================
// ── EXCEL WORKBOOK BUILDER
// ============================================================================
async function buildExcelWorkbook(chain:any[],spotPrice:number,expiryDate:Date,label:string):Promise<Buffer|ExcelJS.Buffer>{
  const wb=new ExcelJS.Workbook();
  wb.creator='JOBBER PRO';wb.company='NIFTY Options Analytics';wb.created=wb.modified=new Date();
  const atm=Math.round(spotPrice/50)*50,dte=Math.max(1,Math.ceil((expiryDate.getTime()-Date.now())/86400000));
  const atmRow=chain.find(r=>N(r.strike_price)===atm);
  const atmIV=N(atmRow?.ce_greeks?.iv??atmRow?.pe_greeks?.iv,20);
  const totalCeOI=chain.reduce((s,r)=>s+N(r.ce_oi),0),totalPeOI=chain.reduce((s,r)=>s+N(r.pe_oi),0);
  const pcr=totalCeOI>0?totalPeOI/totalCeOI:1,straddle=N(atmRow?.ce_ltp)+N(atmRow?.pe_ltp),expMove=straddle*0.85;
  const mpStrike=calcMaxPain(chain, atm),nowIST=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  const fill=(c:string)=>({type:'pattern' as const,pattern:'solid' as const,fgColor:{argb:c}});
  const aln=(h:ExcelJS.Alignment['horizontal']='center')=>({horizontal:h,vertical:'middle' as const});
  const med=(c='FBBF24')=>({style:'medium' as const,color:{argb:c}});
  const thin=(c='3A3A5A')=>({style:'thin' as const,color:{argb:c}});

  // SHEET 1: DASHBOARD
  const ws1=wb.addWorksheet('Dashboard'); ws1.properties.tabColor={argb:'6366F1'};
  ws1.views=[{showGridLines:false}];
  ws1.mergeCells('A1:L1');
  Object.assign(ws1.getCell('A1'),{value:'⚡  JOBBER PRO  ·  NIFTY Options Analytics  ·  Angel One Live Data',fill:fill('0F0F2A'),font:{name:'Arial',bold:true,size:18,color:{argb:'FBBF24'}},alignment:aln()});
  ws1.getRow(1).height=44;
  ws1.mergeCells('A2:L2');
  Object.assign(ws1.getCell('A2'),{value:`${label||'Live Export'}  |  ${nowIST} IST  |  Expiry: ${expiryDate.toDateString()}  |  DTE: ${dte} days`,fill:fill('0D0D22'),font:{name:'Arial',size:9,italic:true,color:{argb:'6B7280'}},alignment:aln()});
  ws1.getRow(2).height=16;
  const pcrCol=pcr<0.7?'FC8181':pcr>1.3?'4ADE80':'FBBF24';
  const metrics:[string,string,string,string][]=[['NIFTY SPOT',`₹${N(spotPrice).toFixed(2)}`,'60A5FA','A'],['ATM STRIKE',`${atm}`,'FBBF24','C'],['ATM IV',`${N(atmIV).toFixed(2)}%`,ivClr(atmIV),'E'],['PCR (OI)',`${pcr.toFixed(3)}`,pcrCol,'G'],['MAX PAIN',`${mpStrike}`,'C084FC','I'],['DTE',`${dte} days`,'FB923C','K']];
  for(const[lbl,val,col,c] of metrics){
    const lc=ws1.getCell(`${c}4`);lc.value=lbl;lc.fill=fill('111128');lc.font={name:'Arial',size:8,color:{argb:'6B7280'}};lc.alignment=aln();lc.border={top:thin(col),left:thin(col),right:thin(col)};
    const vc=ws1.getCell(`${c}5`);vc.value=val;vc.fill=fill('111128');vc.font={name:'Arial',bold:true,size:18,color:{argb:col}};vc.alignment=aln();vc.border={left:thin(col),right:thin(col)};
    const bc=ws1.getCell(`${c}6`);bc.fill=fill('111128');bc.border={bottom:thin(col),left:thin(col),right:thin(col)};
  }
  ws1.getRow(4).height=18;ws1.getRow(5).height=34;ws1.getRow(6).height=8;
  const sentiment=pcr<0.7?'🔴 BEARISH — Heavy Call Writing':pcr>1.3?'🟢 BULLISH — Heavy Put Writing':'🟡 NEUTRAL — Balanced Market';
  ws1.mergeCells('A8:L8');
  Object.assign(ws1.getCell('A8'),{value:`Sentiment: ${sentiment}  |  PCR=${pcr.toFixed(3)}  |  Max Pain=${mpStrike}  |  Expected Move ±₹${expMove.toFixed(0)}  |  Range ₹${(spotPrice-expMove).toFixed(0)}–₹${(spotPrice+expMove).toFixed(0)}  |  Straddle ₹${straddle.toFixed(0)}`,fill:fill('111128'),font:{name:'Arial',bold:true,size:11,color:{argb:pcrCol}},alignment:aln()});
  ws1.getRow(8).height=26;
  const topCE=[...chain].sort((a,b)=>N(b.ce_oi)-N(a.ce_oi)).slice(0,5);
  const topPE=[...chain].sort((a,b)=>N(b.pe_oi)-N(a.pe_oi)).slice(0,5);
  ws1.mergeCells('A10:E10');Object.assign(ws1.getCell('A10'),{value:'TOP 5 CE OI — RESISTANCE',fill:fill('1A3A1A'),font:{name:'Arial',bold:true,size:10,color:{argb:'4ADE80'}},alignment:aln()});
  ws1.mergeCells('G10:K10');Object.assign(ws1.getCell('G10'),{value:'TOP 5 PE OI — SUPPORT',fill:fill('3A1A1A'),font:{name:'Arial',bold:true,size:10,color:{argb:'FC8181'}},alignment:aln()});
  for(let i=0;i<5;i++){
    const r=11+i,bg=i%2===0?'111128':'0D0D1E';ws1.getRow(r).height=18;
    const ce=topCE[i],pe=topPE[i];
    if(ce){[[N(ce.strike_price),'FBBF24'],[fmtK(ce.ce_oi),'4ADE80'],[`IV ${N(ce.ce_greeks?.iv).toFixed(1)}%`,ivClr(N(ce.ce_greeks?.iv))],[`Δ ${N(ce.ce_greeks?.delta).toFixed(3)}`,'6B7280'],[`₹${N(ce.ce_ltp).toFixed(1)}`,'4ADE80']].forEach(([v,c],ci)=>{const cell=ws1.getCell(r,ci+1);cell.value=v as any;cell.fill=fill(bg);cell.font={name:'Arial',size:9,bold:ci===0,color:{argb:c as string}};cell.alignment=aln(ci===0?'center':'right');});}
    if(pe){[[N(pe.strike_price),'FBBF24'],[fmtK(pe.pe_oi),'FC8181'],[`IV ${N(pe.pe_greeks?.iv).toFixed(1)}%`,ivClr(N(pe.pe_greeks?.iv))],[`Δ ${N(pe.pe_greeks?.delta).toFixed(3)}`,'6B7280'],[`₹${N(pe.pe_ltp).toFixed(1)}`,'FC8181']].forEach(([v,c],ci)=>{const cell=ws1.getCell(r,ci+7);cell.value=v as any;cell.fill=fill(bg);cell.font={name:'Arial',size:9,bold:ci===0,color:{argb:c as string}};cell.alignment=aln(ci===0?'center':'right');});}
  }
  [9,11,9,9,10,2,9,11,9,9,10,9].forEach((w,i)=>ws1.getColumn(i+1).width=w);

  // SHEET 2: OPTIONS CHAIN
  const ws2=wb.addWorksheet('Options Chain'); ws2.properties.tabColor={argb:'10B981'};
  ws2.views=[{showGridLines:false,state:'frozen',xSplit:0,ySplit:3}];
  ws2.mergeCells('A1:I1');Object.assign(ws2.getCell('A1'),{value:'◄──────── CALLS ────────►',fill:fill('0A2A14'),font:{name:'Arial',bold:true,size:10,color:{argb:'4ADE80'}},alignment:aln()});
  ws2.getCell('J1').fill=fill('1A1A3E');
  ws2.mergeCells('K1:S1');Object.assign(ws2.getCell('K1'),{value:'◄──────── PUTS ─────────►',fill:fill('2A0A0A'),font:{name:'Arial',bold:true,size:10,color:{argb:'FC8181'}},alignment:aln()});
  ws2.getRow(1).height=20;
  ws2.mergeCells('A2:S2');Object.assign(ws2.getCell('A2'),{value:`Angel One  |  ₹${N(spotPrice).toFixed(2)}  |  ATM:${atm}  |  PCR:${pcr.toFixed(3)}  |  IV:${N(atmIV).toFixed(2)}%  |  DTE:${dte}d  |  ${nowIST} IST`,fill:fill('1A1A3E'),font:{name:'Arial',size:8,italic:true,color:{argb:'6B7280'}},alignment:aln()});
  ws2.getRow(2).height=14;
  ['OI Chg%','CE OI','CE Vol','CE IV%','CE Δ','CE Γ','CE Θ','CE Vega','CE LTP','STRIKE','PE LTP','PE Vega','PE Θ','PE Γ','PE Δ','PE IV%','PE Vol','PE OI','OI Chg%'].forEach((h,ci)=>{
    const c=ws2.getCell(3,ci+1);c.value=h;c.fill=fill(ci<9?'1A3A1A':ci===9?'1A1A3E':'3A1A1A');c.font={name:'Arial',bold:true,size:9,color:{argb:ci<9?'4ADE80':ci===9?'FBBF24':'FC8181'}};c.alignment=aln();c.border={bottom:{style:'medium',color:{argb:'FBBF24'}}};
  });
  ws2.getRow(3).height=22;
  const maxCeOI=Math.max(...chain.map(r=>N(r.ce_oi)),1),maxPeOI=Math.max(...chain.map(r=>N(r.pe_oi)),1);
  chain.forEach((row,ri)=>{
    const er=ri+4,strike=N(row.strike_price),isATM=strike===atm,itmCE=strike<spotPrice,itmPE=strike>spotPrice;
    const bg=isATM?'2D2800':itmCE?'0A1A0A':itmPE?'1A0A0A':ri%2===0?'111128':'0D0D1E';
    ws2.getRow(er).height=17;
    const ceIV=N(row.ce_greeks?.iv),peIV=N(row.pe_greeks?.iv);
    const wr=(col:number,val:any,color:string,fmt?:string,bgO?:string)=>{const c=ws2.getCell(er,col);c.value=val||'';c.fill=fill(bgO||bg);c.font={name:'Arial',size:9,color:{argb:color}};c.alignment=aln(col<=9?'right':'left');if(fmt)c.numFmt=fmt;};
    wr(1,'','6B7280');
    wr(2,N(row.ce_oi)||'',itmCE?'4ADE80':'2D5A3D','#,##0');
    wr(3,N(row.ce_volume)||'',itmCE?'4ADE80':'2D4A3D','#,##0');
    wr(4,ceIV>0?ceIV:'',ivClr(ceIV),'0.00"%"',ivBg(ceIV));
    wr(5,N(row.ce_greeks?.delta)||'',itmCE?'4ADE80':'2D5A3D','0.000');
    wr(6,N(row.ce_greeks?.gamma)||'','2DD4BF','0.000000');
    wr(7,N(row.ce_greeks?.theta)||'','FB923C','0.00');
    wr(8,N(row.ce_greeks?.vega)||'','60A5FA','0.00');
    wr(9,N(row.ce_ltp)||'',itmCE?'4ADE80':'2D8A3D','₹#,##0.00');
    const sc=ws2.getCell(er,10);sc.value=strike;sc.fill=fill(isATM?'2D2800':'1A1A3E');sc.font={name:'Arial',bold:true,size:isATM?11:9,color:{argb:isATM?'FBBF24':'F1F5F9'}};sc.alignment=aln();
    if(isATM)sc.border={top:med(),bottom:med(),left:med(),right:med()};
    wr(11,N(row.pe_ltp)||'',itmPE?'FC8181':'8A2D2D','₹#,##0.00');
    wr(12,N(row.pe_greeks?.vega)||'','60A5FA','0.00');
    wr(13,N(row.pe_greeks?.theta)||'','FB923C','0.00');
    wr(14,N(row.pe_greeks?.gamma)||'','2DD4BF','0.000000');
    wr(15,N(row.pe_greeks?.delta)||'',itmPE?'FC8181':'5A2D2D','0.000');
    wr(16,peIV>0?peIV:'',ivClr(peIV),'0.00"%"',ivBg(peIV));
    wr(17,N(row.pe_volume)||'',itmPE?'FC8181':'4A2D2D','#,##0');
    wr(18,N(row.pe_oi)||'',itmPE?'FC8181':'5A2D3D','#,##0');
    wr(19,'','6B7280');
  });
  const tr2=chain.length+4;ws2.getRow(tr2).height=20;
  const scf=(col:number,val:any,fmt?:string)=>{const c=ws2.getCell(tr2,col);c.value=val;c.fill=fill('1A1A3E');c.font={name:'Arial',bold:true,size:9,color:{argb:'FBBF24'}};if(fmt)c.numFmt=fmt;};
  scf(1,'TOTALS →');scf(2,{formula:`=SUM(B4:B${tr2-1})`},'#,##0');scf(18,{formula:`=SUM(R4:R${tr2-1})`},'#,##0');scf(10,{formula:`=R${tr2}/B${tr2}`},'0.000" PCR"');
  ws2.autoFilter={from:{row:3,column:1},to:{row:3,column:19}};
  [7,11,9,7,7,8,7,7,9,9,9,7,7,8,7,7,9,11,7].forEach((w,i)=>ws2.getColumn(i+1).width=w);

  // SHEET 3: IV ANALYSIS
  const ws3=wb.addWorksheet('IV Analysis'); ws3.properties.tabColor={argb:'F59E0B'};
  ws3.views=[{showGridLines:false}];
  ws3.mergeCells('A1:I1');Object.assign(ws3.getCell('A1'),{value:'IV SMILE  ·  Implied Volatility Analysis  ·  Angel One Live Data',fill:fill('1A1400'),font:{name:'Arial',bold:true,size:13,color:{argb:'FBBF24'}},alignment:aln()});
  ws3.getRow(1).height=30;
  const ivMets:[string,string,string][]=[['ATM IV',`${N(atmIV).toFixed(2)}%`,ivClr(atmIV)],['IV Environment',atmIV<15?'LOW — Buy Vol':atmIV<25?'NORMAL':atmIV<35?'HIGH — Sell Vol':'EXTREME',ivClr(atmIV)],['Exp Move 1σ',`±₹${expMove.toFixed(0)}`,'60A5FA'],['ATM Straddle',`₹${straddle.toFixed(0)}`,'F1F5F9'],['Straddle/Spot',`${(straddle/spotPrice*100).toFixed(2)}%`,'2DD4BF'],['Strategy',atmIV<15?'Buy Straddle':atmIV>30?'Sell Straddle':'Directional',atmIV<15?'4ADE80':atmIV>30?'FC8181':'FBBF24']];
  ivMets.forEach(([lbl,val,col],i)=>{const r1=3+i*2,r2=r1+1;Object.assign(ws3.getCell(r1,10),{value:lbl,fill:fill('111128'),font:{name:'Arial',size:8,color:{argb:'6B7280'}}});ws3.getRow(r1).height=14;Object.assign(ws3.getCell(r2,10),{value:val,fill:fill('111128'),font:{name:'Arial',bold:true,size:13,color:{argb:col}}});ws3.getRow(r2).height=22;});
  ['Strike','CE LTP','CE IV%','PE LTP','PE IV%','IV Skew','Moneyness%','CE Δ','PE Δ'].forEach((h,ci)=>{const c=ws3.getCell(3,ci+1);c.value=h;c.fill=fill('1A1A3E');c.font={name:'Arial',bold:true,size:9,color:{argb:'F1F5F9'}};c.alignment=aln();c.border={bottom:{style:'medium',color:{argb:'FBBF24'}}};});
  ws3.getRow(3).height=20;
  chain.forEach((row,ri)=>{
    const er=ri+4,strike=N(row.strike_price),isATM=strike===atm,ceIV=N(row.ce_greeks?.iv),peIV=N(row.pe_greeks?.iv),bg=isATM?'2D2800':ri%2===0?'111128':'0D0D1E';
    ws3.getRow(er).height=16;
    [[strike,isATM?'FBBF24':'F1F5F9','center',undefined,bg],[N(row.ce_ltp)||'','4ADE80','right','₹#,##0.00',bg],[ceIV>0?ceIV:'',ivClr(ceIV),'right','0.00"%"',ivBg(ceIV)],[N(row.pe_ltp)||'','FC8181','right','₹#,##0.00',bg],[peIV>0?peIV:'',ivClr(peIV),'right','0.00"%"',ivBg(peIV)],[(peIV-ceIV)||'',peIV<ceIV?'4ADE80':'FC8181','right','+0.00;-0.00',bg],[(strike/spotPrice-1)*100,'F1F5F9','right','+0.00"%";-0.00"%"',bg],[N(row.ce_greeks?.delta)||'','4ADE80','right','0.000',bg],[N(row.pe_greeks?.delta)||'','FC8181','right','0.000',bg]].forEach(([v,col,ha,fmt,bg2]:any,ci)=>{const c=ws3.getCell(er,ci+1);c.value=v;c.fill=fill(bg2);c.font={name:'Arial',size:9,bold:isATM,color:{argb:col}};c.alignment={horizontal:ha,vertical:'middle'};if(fmt)c.numFmt=fmt;});
  });
  ws3.getColumn(1).width=9;for(let i=2;i<=10;i++)ws3.getColumn(i).width=11;

  // SHEET 4: OI PROFILE
  const ws4=wb.addWorksheet('OI Profile'); ws4.properties.tabColor={argb:'EC4899'};
  ws4.views=[{showGridLines:false}];
  ws4.mergeCells('A1:J1');Object.assign(ws4.getCell('A1'),{value:'OPEN INTEREST PROFILE  ·  Support & Resistance  ·  Angel One Live OI',fill:fill('1A0A14'),font:{name:'Arial',bold:true,size:13,color:{argb:'EC4899'}},alignment:aln()});
  ws4.getRow(1).height=30;ws4.getRow(2).height=8;
  ['Strike','CE OI','PE OI','OI Ratio','Net OI','Dominant','CE %','PE %','Level','Signal'].forEach((h,ci)=>{const c=ws4.getCell(3,ci+1);c.value=h;c.fill=fill('1A1A3E');c.font={name:'Arial',bold:true,size:9,color:{argb:'F1F5F9'}};c.alignment=aln();c.border={bottom:{style:'medium',color:{argb:'FBBF24'}}};});
  ws4.getRow(3).height=22;
  const top5CE=new Set([...chain].sort((a,b)=>N(b.ce_oi)-N(a.ce_oi)).slice(0,5).map(r=>N(r.strike_price)));
  const top5PE=new Set([...chain].sort((a,b)=>N(b.pe_oi)-N(a.pe_oi)).slice(0,5).map(r=>N(r.strike_price)));
  chain.forEach((row,ri)=>{
    const er=ri+4,strike=N(row.strike_price),isATM=strike===atm,ceOI=N(row.ce_oi),peOI=N(row.pe_oi);
    const ratio=ceOI>0?peOI/ceOI:0,netOI=peOI-ceOI,dom=ceOI>peOI?'CALL':'PUT';
    const isTopCE=top5CE.has(strike),isTopPE=top5PE.has(strike);
    const level=isATM?'ATM':isTopCE?'KEY RESIST':isTopPE?'KEY SUPPORT':'';
    const signal=isATM?'Critical zone':isTopCE?'↑ Resistance':isTopPE?'↓ Support':'';
    const bg=isATM?'2D2800':ri%2===0?'111128':'0D0D1E';ws4.getRow(er).height=18;
    [[strike,isATM?'FBBF24':'F1F5F9','center',undefined],[ceOI,'4ADE80','right','#,##0'],[peOI,'FC8181','right','#,##0'],[ratio,ratio<0.8?'4ADE80':ratio>1.2?'FC8181':'FBBF24','right','0.000'],[netOI,netOI<0?'4ADE80':'FC8181','right','+#,##0;-#,##0'],[dom,dom==='CALL'?'4ADE80':'FC8181','center',undefined],[ceOI/maxCeOI,'4ADE80','right','0.0%'],[peOI/maxPeOI,'FC8181','right','0.0%'],[level,isATM?'FB923C':isTopCE||isTopPE?'FBBF24':'6B7280','center',undefined],[signal,'F1F5F9','left',undefined]].forEach(([v,col,ha,fmt]:any,ci)=>{const c=ws4.getCell(er,ci+1);c.value=v;c.fill=fill(bg);c.font={name:'Arial',size:9,bold:isATM||!!level,color:{argb:col}};c.alignment={horizontal:ha,vertical:'middle'};if(fmt)c.numFmt=fmt;});
    if(isATM)for(let c2=1;c2<=10;c2++){const s={style:'thin' as const,color:{argb:'FBBF24'}};ws4.getCell(er,c2).border={top:s,bottom:s,left:s,right:s};}
  });
  const tr4=chain.length+4;
  [['TOTAL','F1F5F9'],[{formula:`=SUM(B4:B${tr4-1})`},'4ADE80',,'#,##0'],[{formula:`=SUM(C4:C${tr4-1})`},'FC8181',,'#,##0'],[{formula:`=C${tr4}/B${tr4}`},'FBBF24',,'0.000'],[{formula:`=C${tr4}-B${tr4}`},'F1F5F9',,'#,##0']].forEach(([v,col,,fmt]:any,ci)=>{const c=ws4.getCell(tr4,ci+1);c.value=v;c.fill=fill('1A1A3E');c.font={name:'Arial',bold:true,size:9,color:{argb:col}};if(fmt)c.numFmt=fmt;});
  ws4.autoFilter={from:{row:3,column:1},to:{row:3,column:10}};
  [9,12,12,9,13,10,10,10,13,18].forEach((w,i)=>ws4.getColumn(i+1).width=w);

  // SHEET 5: RAW DATA
  const ws5=wb.addWorksheet('Raw Data'); ws5.properties.tabColor={argb:'6B7280'};
  const rawH=['timestamp','spot_price','expiry_date','strike_price','ce_ltp','ce_oi','ce_volume','ce_iv','ce_delta','ce_gamma','ce_theta','ce_vega','pe_ltp','pe_oi','pe_volume','pe_iv','pe_delta','pe_gamma','pe_theta','pe_vega','atm_flag','itm_ce','itm_pe','moneyness_pct','straddle','exp_move_1s'];
  rawH.forEach((h,ci)=>{const c=ws5.getCell(1,ci+1);c.value=h;c.fill=fill('1A1A3E');c.font={name:'Courier New',bold:true,size:8,color:{argb:'F1F5F9'}};});
  const ts3=new Date().toISOString(),exp3=expiryDate.toISOString().split('T')[0];
  chain.forEach((row,ri)=>{const strike=N(row.strike_price),strd=N(row.ce_ltp)+N(row.pe_ltp);ws5.addRow([ts3,spotPrice,exp3,strike,N(row.ce_ltp),N(row.ce_oi),N(row.ce_volume),N(row.ce_greeks?.iv),N(row.ce_greeks?.delta),N(row.ce_greeks?.gamma),N(row.ce_greeks?.theta),N(row.ce_greeks?.vega),N(row.pe_ltp),N(row.pe_oi),N(row.pe_volume),N(row.pe_greeks?.iv),N(row.pe_greeks?.delta),N(row.pe_greeks?.gamma),N(row.pe_greeks?.theta),N(row.pe_greeks?.vega),strike===atm?1:0,strike<spotPrice?1:0,strike>spotPrice?1:0,+((strike/spotPrice-1)*100).toFixed(4),strd,+(strd*0.85).toFixed(2)]);for(let c2=1;c2<=rawH.length;c2++)ws5.getCell(ri+2,c2).font={name:'Courier New',size:8};});
  ws5.autoFilter={from:{row:1,column:1},to:{row:1,column:rawH.length}};
  rawH.forEach((_,i)=>ws5.getColumn(i+1).width=14);

  return wb.xlsx.writeBuffer();
}

// ============================================================================
// ── EXCEL + SNAPSHOT ENDPOINTS (12–22)
// ============================================================================
let autoTimer:ReturnType<typeof setInterval>|null=null,autoRunning=false,autoMins=0;

app.get('/api/excel/export', async(req,res)=>{
  try{
    const c=await waitForCache();
    if(!c.chainWithGreeks.length) return res.status(503).json({error:'No data in DB yet — start Angel One data feed first'});
    const label=String(req.query.label||'');
    const buffer=await buildExcelWorkbook(c.chainWithGreeks,c.spotPrice,c.expiryDate,label);
    if(req.query.saveSnapshot==='true'){
      const atm=Math.round(c.spotPrice/50)*50,atmIV=getATMiv(c.chainWithGreeks,c.spotPrice);
      const totalCe=c.chainWithGreeks.reduce((s,r)=>s+N(r.ce_oi),0),totalPe=c.chainWithGreeks.reduce((s,r)=>s+N(r.pe_oi),0);
      const pcr=totalCe>0?totalPe/totalCe:1,dte=Math.max(0,Math.ceil((c.expiryDate.getTime()-Date.now())/86400000));
      const tags=req.query.tags?String(req.query.tags).split(','):[];
      const snap=await pool.query<{id:number}>(`INSERT INTO nifty_premium_tracking.option_snapshots(label,spot_price,atm_strike,atm_iv,pcr_oi,days_to_expiry,expiry_date,row_count,tags,notes,chain_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[label||`Export ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}`,c.spotPrice,atm,atmIV,pcr,dte,c.expiryDate.toISOString().split('T')[0],c.chainWithGreeks.length,tags,String(req.query.notes||''),JSON.stringify(c.chainWithGreeks)]);
      res.setHeader('X-Snapshot-Id',String(snap.rows[0].id));
    }
    const dateStr=new Date().toISOString().split('T')[0],timeStr=new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}).replace(/:/g,'-').slice(0,8);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="NIFTY_Options_${N(c.spotPrice).toFixed(0)}_${dateStr}_${timeStr}.xlsx"`);
    res.end(buffer);
  }catch(e:any){console.error('Excel export error:',e);res.status(500).json({error:'Export failed',message:e.message});}
});

app.post('/api/excel/snapshot/save', async(req,res)=>{
  try{
    const c=await waitForCache();
    if(!c.chainWithGreeks.length) return res.status(503).json({error:'No data in DB yet'});
    const{label,tags,notes}=req.body;
    const atmIV=getATMiv(c.chainWithGreeks,c.spotPrice),totalCe=c.chainWithGreeks.reduce((s,r)=>s+N(r.ce_oi),0),totalPe=c.chainWithGreeks.reduce((s,r)=>s+N(r.pe_oi),0);
    const pcr=totalCe>0?totalPe/totalCe:1,dte=Math.max(0,Math.ceil((c.expiryDate.getTime()-Date.now())/86400000));
    const nowIST=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
    const finalLabel=label||`Snapshot ${nowIST} IST`,finalTags=Array.isArray(tags)?tags:(tags?[tags]:[]);
    const r=await pool.query<{id:number}>(`INSERT INTO nifty_premium_tracking.option_snapshots(label,spot_price,atm_strike,atm_iv,pcr_oi,days_to_expiry,expiry_date,row_count,tags,notes,chain_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[finalLabel,c.spotPrice,c.atmStrike,atmIV,pcr,dte,c.expiryDate.toISOString().split('T')[0],c.chainWithGreeks.length,finalTags,notes||'',JSON.stringify(c.chainWithGreeks)]);
    const id=r.rows[0].id;console.log(`💾 Snapshot #${id}: "${finalLabel}" | ₹${c.spotPrice} | ${c.chainWithGreeks.length} strikes`);
    res.json({success:true,id,label:finalLabel,spotPrice:c.spotPrice,savedAt:new Date().toISOString(),message:`Snapshot #${id} saved`});
  }catch(e:any){res.status(500).json({error:'Save failed',message:e.message});}
});

app.get('/api/excel/snapshot/list', async(req,res)=>{
  try{
    const conds:string[]=[],params:any[]=[];
    if(req.query.search){params.push(`%${req.query.search}%`);conds.push(`label ILIKE $${params.length}`);}
    if(req.query.tags){params.push(String(req.query.tags).split(','));conds.push(`tags && $${params.length}`);}
    if(req.query.from){params.push(req.query.from);conds.push(`captured_at >= $${params.length}::TIMESTAMPTZ`);}
    if(req.query.to){params.push(req.query.to);conds.push(`captured_at <= $${params.length}::TIMESTAMPTZ`);}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:'';
    const limit=Math.min(Number(req.query.limit)||50,200),offset=Number(req.query.offset)||0;
    const[data,count]=await Promise.all([pool.query(`SELECT id,label,captured_at,spot_price,atm_strike,atm_iv,pcr_oi,days_to_expiry,expiry_date,row_count,tags,notes FROM nifty_premium_tracking.option_snapshots ${where} ORDER BY captured_at DESC LIMIT ${limit} OFFSET ${offset}`,params),pool.query(`SELECT COUNT(*) as total FROM nifty_premium_tracking.option_snapshots ${where}`,params)]);
    res.json({success:true,data:data.rows,total:Number(count.rows[0].total)});
  }catch(e:any){res.status(500).json({error:'List failed',message:e.message});}
});

app.get('/api/excel/snapshot/latest', async(_,res)=>{
  try{const r=await pool.query(`SELECT * FROM nifty_premium_tracking.option_snapshots ORDER BY captured_at DESC LIMIT 1`);if(!r.rows.length)return res.status(200).json({success:true,data:null,message:'No snapshots yet'});const row=r.rows[0];res.json({success:true,data:{...row,chain:row.chain_json}});}catch(e:any){res.status(500).json({error:'Load failed',message:e.message});}
});

app.get('/api/excel/snapshot/compare', async(req,res)=>{
  try{
    const id1=Number(req.query.id1),id2=Number(req.query.id2);
    if(isNaN(id1)||isNaN(id2))return res.status(400).json({error:'id1 and id2 required'});
    const[r1,r2]=await Promise.all([pool.query(`SELECT * FROM nifty_premium_tracking.option_snapshots WHERE id=$1`,[id1]),pool.query(`SELECT * FROM nifty_premium_tracking.option_snapshots WHERE id=$1`,[id2])]);
    if(!r1.rows.length||!r2.rows.length)return res.status(404).json({error:'One or both snapshots not found'});
    const s1=r1.rows[0],s2=r2.rows[0],c1:any[]=s1.chain_json,c2:any[]=s2.chain_json;
    const oiChanges=c1.map((r:any)=>{const m=c2.find((x:any)=>N(x.strike_price)===N(r.strike_price));if(!m)return null;const ceOI1=N(r.ce_oi),ceOI2=N(m.ce_oi),peOI1=N(r.pe_oi),peOI2=N(m.pe_oi);return{strike:N(r.strike_price),ce_oi_before:ceOI1,ce_oi_after:ceOI2,ce_oi_delta:ceOI2-ceOI1,ce_oi_pct:ceOI1>0?((ceOI2-ceOI1)/ceOI1)*100:0,pe_oi_before:peOI1,pe_oi_after:peOI2,pe_oi_delta:peOI2-peOI1,pe_oi_pct:peOI1>0?((peOI2-peOI1)/peOI1)*100:0};}).filter(Boolean).sort((a:any,b:any)=>Math.abs(b.ce_oi_delta)-Math.abs(a.ce_oi_delta));
    const elapsed=Math.round((new Date(s2.captured_at).getTime()-new Date(s1.captured_at).getTime())/60000);
    res.json({success:true,data:{before:{id:s1.id,label:s1.label,captured_at:s1.captured_at,spot:N(s1.spot_price),pcr:N(s1.pcr_oi),atm_iv:s1.atm_iv},after:{id:s2.id,label:s2.label,captured_at:s2.captured_at,spot:N(s2.spot_price),pcr:N(s2.pcr_oi),atm_iv:s2.atm_iv},summary:{elapsed_minutes:elapsed,spot_change:N(s2.spot_price)-N(s1.spot_price),pcr_change:N(s2.pcr_oi)-N(s1.pcr_oi),atm_iv_change:(s2.atm_iv??0)-(s1.atm_iv??0)},oi_changes:oiChanges,biggest_ce_build:oiChanges.filter((c:any)=>c.ce_oi_delta>0).slice(0,5),biggest_pe_build:oiChanges.filter((c:any)=>c.pe_oi_delta>0).slice(0,5),biggest_ce_unwind:oiChanges.filter((c:any)=>c.ce_oi_delta<0).slice(0,5),biggest_pe_unwind:oiChanges.filter((c:any)=>c.pe_oi_delta<0).slice(0,5)}});
  }catch(e:any){res.status(500).json({error:'Compare failed',message:e.message});}
});

app.get('/api/excel/snapshot/:id/export', async(req,res)=>{
  try{const id=Number(req.params.id);if(isNaN(id))return res.status(400).json({error:"Invalid ID"});const r=await pool.query(`SELECT * FROM nifty_premium_tracking.option_snapshots WHERE id=$1`,[id]);if(!r.rows.length)return res.status(404).json({error:`Snapshot #${id} not found`});const row=r.rows[0];const expiryDate=row.expiry_date?new Date(row.expiry_date):new Date(Date.now()+7*86400000);const buffer=await buildExcelWorkbook(row.chain_json,N(row.spot_price),expiryDate,row.label||`Snapshot #${id}`);res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",`attachment; filename="Snapshot_${id}_${String(row.captured_at).split("T")[0]}.xlsx"`);res.end(buffer);}catch(e:any){res.status(500).json({error:"Export failed",message:e.message});}
});

app.get('/api/excel/snapshot/:id', async(req,res)=>{
  try{const id=Number(req.params.id);if(isNaN(id))return res.status(400).json({error:'Invalid ID'});const r=await pool.query(`SELECT * FROM nifty_premium_tracking.option_snapshots WHERE id=$1`,[id]);if(!r.rows.length)return res.status(404).json({error:`Snapshot #${id} not found`});const row=r.rows[0];res.json({success:true,data:{...row,chain:row.chain_json}});}catch(e:any){res.status(500).json({error:'Load failed',message:e.message});}
});

app.delete('/api/excel/snapshot', async(req,res)=>{
  try{
    const{ids,beforeDate,olderThanDays,tags,dryRun}=req.body;
    const conds:string[]=[],params:any[]=[];
    if(ids?.length){params.push(ids);conds.push(`id=ANY($${params.length})`);}
    if(beforeDate){params.push(beforeDate);conds.push(`captured_at<$${params.length}::TIMESTAMPTZ`);}
    if(olderThanDays!=null){params.push(olderThanDays);conds.push(`captured_at<NOW()-($${params.length}||' days')::INTERVAL`);}
    if(tags?.length){params.push(tags);conds.push(`tags&&$${params.length}`);}
    if(!conds.length)return res.status(400).json({error:'Provide at least one filter'});
    const where=`WHERE ${conds.join(' AND ')}`;
    const preview=await pool.query(`SELECT id FROM nifty_premium_tracking.option_snapshots ${where}`,params);
    const delIds=preview.rows.map(r=>Number(r.id));
    if(dryRun||!delIds.length)return res.json({success:true,dryRun:true,deleted:delIds.length,ids:delIds,message:`DRY RUN: would delete ${delIds.length} snapshot(s)`});
    await pool.query(`DELETE FROM nifty_premium_tracking.option_snapshots ${where}`,params);
    console.log(`🗑️ Deleted ${delIds.length} snapshots: [${delIds.join(',')}]`);
    res.json({success:true,dryRun:false,deleted:delIds.length,ids:delIds,message:`Deleted ${delIds.length} snapshot(s)`});
  }catch(e:any){res.status(500).json({error:'Delete failed',message:e.message});}
});

app.post('/api/excel/autosave/start',(req,res)=>{
  if(autoTimer)clearInterval(autoTimer);
  const mins=Number(req.body.intervalMinutes)||15,tag=String(req.body.tag||'auto');
  autoTimer=setInterval(async()=>{
    try{
      const c=await waitForCache();if(!c.chainWithGreeks.length)return;
      const atmIV=getATMiv(c.chainWithGreeks,c.spotPrice),totalCe=c.chainWithGreeks.reduce((s,r)=>s+N(r.ce_oi),0),totalPe=c.chainWithGreeks.reduce((s,r)=>s+N(r.pe_oi),0),pcr=totalCe>0?totalPe/totalCe:1,dte=Math.max(0,Math.ceil((c.expiryDate.getTime()-Date.now())/86400000));
      const nowTime=new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'});
      const r=await pool.query<{id:number}>(`INSERT INTO nifty_premium_tracking.option_snapshots(label,spot_price,atm_strike,atm_iv,pcr_oi,days_to_expiry,expiry_date,row_count,tags,notes,chain_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[`Auto ${nowTime} IST`,c.spotPrice,c.atmStrike,atmIV,pcr,dte,c.expiryDate.toISOString().split('T')[0],c.chainWithGreeks.length,[tag,'auto'],'',JSON.stringify(c.chainWithGreeks)]);
      console.log(`⏱️ Auto-snapshot #${r.rows[0].id} @ ${nowTime} | ₹${c.spotPrice}`);
    }catch(e){console.error('Auto-snapshot error:',String(e).slice(0,80));}
  },mins*60_000);
  autoRunning=true;autoMins=mins;
  console.log(`🔄 Auto-snapshot STARTED: every ${mins}min (tag="${tag}")`);
  res.json({success:true,running:true,intervalMinutes:mins,tag,message:`Auto-snapshot every ${mins} min`});
});

app.post('/api/excel/autosave/stop',(_,res)=>{
  if(autoTimer){clearInterval(autoTimer);autoTimer=null;}autoRunning=false;autoMins=0;
  console.log('⏹️ Auto-snapshot STOPPED');
  res.json({success:true,running:false,message:'Auto-snapshot stopped'});
});

app.get('/api/excel/autosave/status',(_,res)=>{
  res.json({running:autoRunning,intervalMinutes:autoMins});
});

// ============================================================================
// ── PREMIUM PREDICTOR ENDPOINTS (23–24)
// ============================================================================
app.get('/api/premium/predictions', async (_, res) => {
  try {
    const c = await waitForCache();
    const dte = Math.max(0.5, (c.expiryDate.getTime() - Date.now()) / 86400000);
    const totalCe = c.chainWithGreeks.reduce((s: number, r: any) => s + N(r.ce_oi), 0);
    const totalPe = c.chainWithGreeks.reduce((s: number, r: any) => s + N(r.pe_oi), 0);
    const pcr_oi  = totalCe > 0 ? totalPe / totalCe : 1;
    const results = await predictor.scan(c.chainWithGreeks, c.spotPrice, dte, pcr_oi);
    res.json({ success: true, data: results });
  } catch (e: any) { console.error('Premium predictions error:', e); res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/premium/gex', async (_, res) => {
  try {
    const c = await waitForCache();
    const gex = predictor.calcGEX(c.chainWithGreeks, c.spotPrice);
    res.json({ success: true, data: gex });
  } catch (e: any) { console.error('GEX error:', e); res.status(500).json({ success: false, error: String(e) }); }
});

// ============================================================================
// ── SPOOFING ENDPOINTS (28–30)
// ============================================================================
app.get('/api/spoofing/history', async (req, res) => {
  try {
    const limit  = Math.min(500, parseInt(String(req.query.limit  || '100')));
    const state  = req.query.state  ? String(req.query.state)  : null;
    const type   = req.query.type   ? String(req.query.type)   : null;
    const strike = req.query.strike ? parseInt(String(req.query.strike)) : null;
    let sql = `SELECT id,detected_at,token,symbol,strike,option_type,alert_type,severity,state,regime,phase,ensemble,confidence,ltp,action,explanation,bid_qty,ask_qty,bid_ask_ratio,spread_pct,oi_change,ltp_change FROM nifty_premium_tracking.spoof_alerts WHERE detected_at > NOW() - INTERVAL '24 hours'`;
    const params: any[] = []; let p = 1;
    if (state)  { sql += ` AND state = $${p++}`;       params.push(state); }
    if (type)   { sql += ` AND alert_type = $${p++}`;  params.push(type); }
    if (strike) { sql += ` AND strike = $${p++}`;      params.push(strike); }
    sql += ` ORDER BY detected_at DESC LIMIT $${p}`; params.push(limit);
    const r = await pool.query(sql, params);
    res.json({ success: true, data: r.rows, count: r.rows.length });
  } catch (e: any) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/spoofing/stats', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT state,alert_type,COUNT(*) AS count,AVG(ensemble)::NUMERIC(5,1) AS avg_score,MAX(ensemble)::NUMERIC(5,1) AS max_score,MIN(detected_at AT TIME ZONE 'Asia/Kolkata') AS first_seen,MAX(detected_at AT TIME ZONE 'Asia/Kolkata') AS last_seen FROM nifty_premium_tracking.spoof_alerts WHERE detected_at > NOW() - INTERVAL '8 hours' GROUP BY state,alert_type ORDER BY COUNT(*) DESC`);
    res.json({ success: true, data: r.rows });
  } catch (e: any) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/spoofing/hotstrikes', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT strike,option_type,COUNT(*) AS total_alerts,SUM(CASE WHEN state='CRITICAL' THEN 1 ELSE 0 END) AS critical_count,SUM(CASE WHEN state='ALERT' THEN 1 ELSE 0 END) AS alert_count,AVG(ensemble)::NUMERIC(5,1) AS avg_score,MAX(ensemble)::NUMERIC(5,1) AS max_score,MAX(detected_at AT TIME ZONE 'Asia/Kolkata') AS last_alert FROM nifty_premium_tracking.spoof_alerts WHERE detected_at > NOW() - INTERVAL '8 hours' GROUP BY strike,option_type HAVING COUNT(*) >= 2 ORDER BY SUM(CASE WHEN state='CRITICAL' THEN 3 WHEN state='ALERT' THEN 2 ELSE 1 END) DESC LIMIT 20`);
    res.json({ success: true, data: r.rows });
  } catch (e: any) { res.status(500).json({ success: false, error: String(e) }); }
});

// ============================================================================
// ★ ADMIN ENDPOINTS — daily_close management (FIX R)
// ============================================================================
app.post('/api/admin/set-close', async (req, res) => {
  try {
    const { date, close } = req.body;
    if (!close || isNaN(Number(close)))
      return res.status(400).json({ error: 'close price is required (numeric)' });
    const tradeDate = date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO nifty_premium_tracking.daily_close (symbol, trade_date, close_price)
       VALUES ('NIFTY', $1, $2)
       ON CONFLICT (symbol, trade_date) DO UPDATE SET close_price = EXCLUDED.close_price`,
      [tradeDate, Number(close)]
    );
    console.log(`📌 Manual close set: NIFTY ₹${close} on ${tradeDate}`);
    res.json({ success: true, message: `NIFTY close set: ₹${close} on ${tradeDate}` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/close-history', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT symbol, trade_date, close_price, created_at
       FROM nifty_premium_tracking.daily_close
       WHERE symbol = 'NIFTY'
       ORDER BY trade_date DESC LIMIT 30`
    );
    res.json({ success: true, data: r.rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/save-close-now', async (_req, res) => {
  try {
    await saveDailyClose();
    res.json({ success: true, message: 'Daily close saved from current NIFTY LTP' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// ── OI SCANNER + OI PULSE ROUTES
// ============================================================================
registerOIScannerRoutes(app, pool);
registerOIPulseRoutes(app, pool);

// ============================================================================
// START SERVER
// ============================================================================
const httpServer = http.createServer(app);
wsEmitter.attach(httpServer);
batchWriter.start();

httpServer.listen(port, () => {
  runNetworkCheck();
  setInterval(runNetworkCheck, 5000);
  console.log(`🌐 Network monitor started — checking every 5s`);

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║  🚀 JOBBER PRO — 36 ENDPOINTS + ⚡ WS PUSH + BATCH WRITER  🚀     ║
╠════════════════════════════════════════════════════════════════════╣
║  Port: ${port}  |  Database: jobber_pro  |  Cache: 500ms refresh   ║
╠════════════════════════════════════════════════════════════════════╣
║  ✅ FIX R: spotChange uses daily_close (official NSE prev close)   ║
║  ✅ FIX 2: prevClose guard — never falls back to spotPrice         ║
║  ✅ FIX 1: payload has timestamp + source fields                   ║
║  ✅ FIX Q: expiry_date filter — weekly LTPs only                   ║
║  ✅ FIX S: OI Scanner + OI Pulse routes registered                 ║
╠════════════════════════════════════════════════════════════════════╣
║  ⚡ PERFORMANCE:                                                    ║
║  ✅ In-memory cache (500ms) — REST < 1ms                           ║
║  ✅ WebSocket /ws — instant chain push                             ║
║  ✅ BatchWriter — async bulk DB writes every 500ms                 ║
║  ✅ InMemoryTickStore — latest tick per token in RAM               ║
╠════════════════════════════════════════════════════════════════════╣
║  ★ ADMIN — daily_close:                                            ║
║  POST /api/admin/set-close       — seed/update close price        ║
║  GET  /api/admin/close-history   — view last 30 closes            ║
║  POST /api/admin/save-close-now  — save current LTP as close      ║
╠════════════════════════════════════════════════════════════════════╣
║  🌐 NETWORK MONITOR:                                               ║
║  GET  /api/network/status     — Mbps + latency + quality          ║
║  GET  /api/network/stream     — SSE quality alerts                ║
║  POST /api/network/speedtest  — manual speed test                 ║
╠════════════════════════════════════════════════════════════════════╣
║  Test: http://localhost:${port}/api/options/greeks                  ║
║  WS:   ws://localhost:${port}/ws                                    ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});