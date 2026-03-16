// src/main/db/database.ts
// PostgreSQL integration for nifty_premium_tracking schema
// Extends existing schema — all new tables under same schema

import { Pool, PoolClient } from 'pg'
import type { AppState, BacktestTrade } from '../signals/types'

let pool: Pool | null = null

export interface DBConfig {
  host:     string
  port:     number
  database: string
  user:     string
  password: string
  schema:   string  // default: nifty_premium_tracking
}

export async function initDB(config: DBConfig): Promise<void> {
  pool = new Pool({
    host:     config.host,
    port:     config.port,
    database: config.database,
    user:     config.user,
    password: config.password,
    max:      10,
    idleTimeoutMillis: 30000,
  })

  // Test connection
  const client = await pool.connect()
  await client.query('SELECT 1')
  client.release()

  // Create schema extensions
  await createSchema(config.schema)
  console.log('DB connected — schema ready')
}

async function createSchema(schema: string): Promise<void> {
  if (!pool) throw new Error('Pool not initialized')
  const client = await pool.connect()
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)

    // Signal snapshots — one row per tick (downsampled to 1/min)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.signal_snapshots (
        id              BIGSERIAL PRIMARY KEY,
        captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot            NUMERIC(10,2),
        futures         NUMERIC(10,2),
        -- Microstructure signals
        kyle_lambda     NUMERIC(12,6),
        kyle_lambda_z   NUMERIC(8,4),
        kyle_regime     VARCHAR(20),
        vpin            NUMERIC(8,6),
        vpin_pct        NUMERIC(6,2),
        vpin_regime     VARCHAR(20),
        gm_alpha        NUMERIC(8,6),
        -- Market structure
        gex_at_spot     NUMERIC(16,2),
        gex_zero_cross  NUMERIC(10,2),
        gex_regime      VARCHAR(20),
        call_wall       NUMERIC(10,2),
        put_wall        NUMERIC(10,2),
        max_pain        NUMERIC(10,2),
        vanna_flow      NUMERIC(16,2),
        charm_flow      NUMERIC(16,2),
        expiry_urgency  NUMERIC(6,4),
        oi_net          NUMERIC(10,4),
        skew_velocity_z NUMERIC(8,4),
        -- Composite
        composite_bull  NUMERIC(8,6),
        composite_bear  NUMERIC(8,6),
        confidence      NUMERIC(8,6),
        direction       VARCHAR(10),
        position_size   NUMERIC(6,4),
        effective_n     NUMERIC(6,2),
        hypothesis      TEXT,
        -- FII
        fii_net_futures BIGINT,
        fii_short_squeeze BOOLEAN
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_signal_snapshots_time
      ON ${schema}.signal_snapshots (captured_at DESC)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_signal_snapshots_confidence
      ON ${schema}.signal_snapshots (confidence DESC)
      WHERE confidence > 0.6
    `)

    // Backtest results
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.backtest_trades (
        id              BIGSERIAL PRIMARY KEY,
        run_id          VARCHAR(50) NOT NULL,
        trade_date      DATE,
        direction       VARCHAR(10),
        confidence      NUMERIC(8,6),
        entry_price     NUMERIC(10,2),
        exit_price      NUMERIC(10,2),
        pnl             NUMERIC(12,2),
        pnl_pct         NUMERIC(8,4),
        outcome         VARCHAR(10),
        signals_active  TEXT,
        holding_minutes INTEGER,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Alerts log
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.alerts (
        id          BIGSERIAL PRIMARY KEY,
        fired_at    TIMESTAMPTZ DEFAULT NOW(),
        type        VARCHAR(50),
        direction   VARCHAR(10),
        confidence  NUMERIC(8,6),
        spot        NUMERIC(10,2),
        message     TEXT,
        acknowledged BOOLEAN DEFAULT FALSE
      )
    `)

  } finally {
    client.release()
  }
}

/** Write one signal snapshot (called every minute during market hours) */
export async function writeSnapshot(state: AppState, schema: string): Promise<void> {
  if (!pool || !state.composite) return
  try {
    await pool.query(`
      INSERT INTO ${schema}.signal_snapshots (
        spot, futures,
        kyle_lambda, kyle_lambda_z, kyle_regime,
        vpin, vpin_pct, vpin_regime,
        gm_alpha,
        gex_at_spot, gex_zero_cross, gex_regime, call_wall, put_wall,
        max_pain, vanna_flow, charm_flow, expiry_urgency,
        oi_net, skew_velocity_z,
        composite_bull, composite_bear, confidence, direction, position_size,
        effective_n, hypothesis,
        fii_net_futures, fii_short_squeeze
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    `, [
      state.spot?.ltp,
      state.futures?.ltp,
      state.kyle?.lambda,
      state.kyle?.lambdaZ,
      state.kyle?.regime,
      state.vpin?.vpin,
      state.vpin?.vpinPct,
      state.vpin?.regime,
      state.gm?.alpha,
      state.gex?.gexAtSpot,
      state.gex?.zeroCross,
      state.gex?.regime,
      state.gex?.callWall,
      state.gex?.putWall,
      state.vannaCharm?.maxPain,
      state.vannaCharm?.vannaFlow,
      state.vannaCharm?.charmFlow,
      state.vannaCharm?.expiryUrgency,
      state.oiVelocity?.oisNet,
      state.skewVelocity?.velocityZ,
      state.composite.pBullish,
      state.composite.pBearish,
      state.composite.confidence,
      state.composite.direction,
      state.composite.positionSize,
      state.composite.effectiveN,
      state.composite.hypothesis,
      state.fii?.netFutures,
      state.fii?.shortSqueeze ?? false,
    ])
  } catch (err) {
    console.error('DB write error:', err)
  }
}

/** Write alert to DB */
export async function writeAlert(
  type: string, direction: string, confidence: number,
  spot: number, message: string, schema: string
): Promise<void> {
  if (!pool) return
  try {
    await pool.query(`
      INSERT INTO ${schema}.alerts (type, direction, confidence, spot, message)
      VALUES ($1,$2,$3,$4,$5)
    `, [type, direction, confidence, spot, message])
  } catch (err) {
    console.error('Alert write error:', err)
  }
}

/** Load historical snapshots for backtesting */
export async function loadHistoricalSnapshots(
  schema: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  if (!pool) return []
  const res = await pool.query(`
    SELECT * FROM ${schema}.signal_snapshots
    WHERE captured_at BETWEEN $1 AND $2
    ORDER BY captured_at ASC
  `, [startDate, endDate])
  return res.rows
}

/** Write backtest trades */
export async function writeBacktestTrades(
  trades: BacktestTrade[], runId: string, schema: string
): Promise<void> {
  if (!pool) return
  for (const t of trades) {
    await pool.query(`
      INSERT INTO ${schema}.backtest_trades
        (run_id, trade_date, direction, confidence, entry_price, exit_price,
         pnl, pnl_pct, outcome, signals_active, holding_minutes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      runId, t.date, t.direction, t.confidence,
      t.entryPrice, t.exitPrice, t.pnl, t.pnlPct,
      t.outcome, t.signalsActive.join(','), t.holdingMinutes
    ])
  }
}

export function getPool(): Pool | null { return pool }

export async function closeDB(): Promise<void> {
  if (pool) { await pool.end(); pool = null }
}
