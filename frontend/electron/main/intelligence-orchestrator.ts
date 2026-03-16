// ============================================================
// intelligence-orchestrator.ts
// ADD THIS FILE TO: frontend/electron/main/
//
// This is the ONLY file you need to add to your existing index.ts.
// It initialises all 25 signal engines, processes every MarketSnapshot,
// pushes results to the renderer via IPC, and writes to PostgreSQL.
//
// HOW TO USE IN YOUR EXISTING index.ts:
//   1. import { IntelligenceOrchestrator } from './intelligence-orchestrator'
//   2. const intel = new IntelligenceOrchestrator(mainWindow, DB_CONFIG)
//   3. await intel.init()
//   4. Call intel.feedAngelTick(rawTick) from your Angel One WebSocket handler
// ============================================================

import { BrowserWindow } from 'electron'
import { Pool } from 'pg'

// ── Signal Engines ──────────────────────────────────────────────────────────
import { KyleLambdaEstimator }    from './signals/kyle-lambda'
import { VPINEstimator }          from './signals/vpin'
import { GMEstimator, HasbrouckISEstimator, AmihudKyleBridge }
                                  from './signals/gm-hasbrouck-amihud'
import { GEXEngine }              from './signals/gex-engine'
import { VannaCharmEngine }       from './signals/vanna-charm'
import { OIVelocityEngine }       from './signals/oi-velocity'
import { IVSkewVelocityMonitor }  from './signals/skew-velocity'
import { FIIAnalyzer }            from './signals/fii-analyzer'
import { BackBridgeDetector, NInsiderEstimator, OptionsDeltaFlowMonitor }
                                  from './signals/back-bridge-ninsider-deltaflow'
import { SGXCrossAssetMonitor }   from './signals/sgx-cross-asset'
import { AngelOneCollector }      from './collector/angel-collector'
import { buildSignals, computeComposite } from './composite/composite-engine'
import type {
  AppState, MarketSnapshot, OptionTick
} from './signals/types'

// ── DB Config type (matches your existing .env) ─────────────────────────────
export interface DBConfig {
  host:     string
  port:     number
  database: string
  user:     string
  password: string
  schema:   string  // 'nifty_premium_tracking'
}

// ── Raw Angel One tick shape from your websocket-collector.ts ───────────────
// These are the exact field names your SmartAPI WebSocket binary decoder outputs.
// If your decoder uses different names, adjust the mapping in feedAngelTick().
export interface RawAngelTick {
  token:                    string
  last_traded_price:        number   // in PAISE — divide by 100
  best_5_buy_data?:         { quantity: number; price: number }[]
  best_5_sell_data?:        { quantity: number; price: number }[]
  volume_trade_for_the_day: number
  open_interest:            number
  exchange_feed_time?:      number   // ms epoch
}

// ── Instrument metadata from your nifty_options.json ────────────────────────
export interface OptionMeta {
  token:       string
  symbol:      string
  strike:      number
  expiry:      string   // 'DDMMMYYYY' format like '27MAR2025'
  optionType:  'CE' | 'PE'
}

export interface FuturesMeta {
  token:  string
  symbol: string
}

export interface IndexMeta {
  token: string  // NIFTY spot token — usually '99926000'
}

export class IntelligenceOrchestrator {
  // ── Signal engine instances ────────────────────────────────────────────
  private kyle       = new KyleLambdaEstimator(300)
  private vpin       = new VPINEstimator(5000, 50)
  private gm         = new GMEstimator()
  private hasbrouck  = new HasbrouckISEstimator()
  private amihud     = new AmihudKyleBridge()
  private gex        = new GEXEngine()
  private vc         = new VannaCharmEngine()
  private oiVel      = new OIVelocityEngine()
  private skewVel    = new IVSkewVelocityMonitor()
  private fii        = new FIIAnalyzer()
  private bridge     = new BackBridgeDetector()
  private nInsider   = new NInsiderEstimator()
  private deltaFlow  = new OptionsDeltaFlowMonitor()
  private sgx        = new SGXCrossAssetMonitor()
  private collector!: AngelOneCollector

  // ── State ─────────────────────────────────────────────────────────────
  private state: AppState = {
    connected: false, marketOpen: false, timestamp: 0,
    spot: null, futures: null,
    kyle: null, vpin: null, gm: null, oiVelocity: null,
    gex: null, vannaCharm: null, skewVelocity: null,
    fii: null, bridge: null, nInsider: null,
    deltaFlow: null, sgxCross: null,
    amihud: null, hasbrouck: null,
    composite: null, chain: [], compositeHistory: [],
  }

  private pool:           Pool | null = null
  private win:            BrowserWindow
  private dbConfig:       DBConfig
  private lastDBWrite     = 0
  private lastAlertFired  = 0
  private sessionStarted  = false
  private ALERT_THRESHOLD = 0.68
  private SCHEMA:         string

  constructor(win: BrowserWindow, dbConfig: DBConfig) {
    this.win      = win
    this.dbConfig = dbConfig
    this.SCHEMA   = dbConfig.schema
  }

  // ── Initialise — call once after window is created ─────────────────────
  async init(): Promise<void> {
    // Connect to PostgreSQL
    try {
      this.pool = new Pool({
        host:     this.dbConfig.host,
        port:     this.dbConfig.port,
        database: this.dbConfig.database,
        user:     this.dbConfig.user,
        password: this.dbConfig.password,
        max: 5,
        idleTimeoutMillis: 30000,
      })
      await this.pool.query('SELECT 1')
      await this._createSchema()
      this.state.connected = true
      console.log('[Intel] DB connected')
    } catch (e) {
      console.error('[Intel] DB connection failed:', e)
    }

    // Initialise collector bridge
    this.collector = new AngelOneCollector((snap) => this._processSnapshot(snap))
    console.log('[Intel] Orchestrator ready — call registerTokens() then feedAngelTick()')
  }

  // ── Register all option/future/index tokens ────────────────────────────
  // Call this ONCE after your websocket-collector has the token list loaded.
  // Pass your nifty_options.json array + the futures token + spot index token.
  registerTokens(
    options:  OptionMeta[],
    futures:  FuturesMeta,
    indexTok: IndexMeta,
  ): void {
    // Register NIFTY spot index
    this.collector.registerToken(indexTok.token, {
      symbol: 'NIFTY', strike: 0, expiry: '', type: 'IDX', dte: 0,
    })

    // Register NIFTY futures
    this.collector.registerToken(futures.token, {
      symbol: futures.symbol, strike: 0, expiry: '', type: 'FUT', dte: 0,
    })

    // Register all options
    for (const opt of options) {
      const expDate = this._parseExpiry(opt.expiry)   // '27MAR2025' → '2025-03-27'
      const dte     = Math.max(0, Math.ceil(
        (new Date(expDate).getTime() - Date.now()) / 86400000
      ))
      this.collector.registerToken(opt.token, {
        symbol:  opt.symbol,
        strike:  opt.strike,
        expiry:  expDate,
        type:    opt.optionType,
        dte,
      })
    }
    console.log(`[Intel] Registered ${options.length} options + 1 futures + 1 index`)
  }

  // ── Feed a raw Angel One WebSocket tick ────────────────────────────────
  // Call this from INSIDE your websocket-collector.ts onTick handler.
  // Your existing processing (Greeks calc, DB write) runs FIRST as usual.
  // Then call this as one extra line at the end of your tick handler.
  feedAngelTick(raw: RawAngelTick): void {
    this.collector.processTick({
      token:             raw.token,
      ltp:               raw.last_traded_price / 100,   // paise → rupees
      best_5_buy_data:   raw.best_5_buy_data,
      best_5_sell_data:  raw.best_5_sell_data,
      volume:            raw.volume_trade_for_the_day,
      open_interest:     raw.open_interest,
      exchange_feed_time: raw.exchange_feed_time,
    })
  }

  // ── Manually update FII data (call from IPC handler) ──────────────────
  updateFIIData(longFutures: number, shortFutures: number): void {
    const result = this.fii.update({
      fiiLongFutures:  longFutures,
      fiiShortFutures: shortFutures,
    })
    this.state.fii = result
    console.log('[Intel] FII data updated:', result.regime)
  }

  // ── Update SGX / cross-asset data (call once at session start + each tick) ─
  updateCrossAsset(data: {
    sgxPrice?:   number
    usdInr?:     number
    crude?:      number
    spxFutures?: number
  }): void {
    this.state.sgxCross = this.sgx.update({ ...data, timestamp: Date.now() })
  }

  setSessionContext(prevClose: number, sgxPriceAt715: number): void {
    const openTs = new Date()
    openTs.setHours(9, 15, 0, 0)
    this.sgx.setSessionContext(prevClose, openTs.getTime())
    this.sgx.setSGXMorningRef(sgxPriceAt715)
    this.bridge.setSessionStart(openTs.getTime(), prevClose)
    this.sessionStarted = true
  }

  // ── Get current intelligence state (for IPC get-state handler) ─────────
  getState(): AppState { return this.state }

  // ── PRIVATE: process a MarketSnapshot through all 25 engines ───────────
  private _processSnapshot(snap: MarketSnapshot): void {
    const { spot, futures, chain, timestamp } = snap
    const prevFutLtp = this.state.futures?.ltp ?? futures?.ltp ?? 0
    const prevSpotLtp = this.state.spot?.ltp ?? spot?.ltp ?? 0

    this.state.spot      = spot
    this.state.futures   = futures
    this.state.chain     = chain
    this.state.timestamp = timestamp
    this.state.marketOpen = this._isMarketOpen(timestamp)

    // ── 1. Kyle Lambda ───────────────────────────────────────────────────
    if (futures) {
      const ofi = futures.volume  // proxy: total vol as OFI
      this.state.kyle = this.kyle.update(futures.ltp - prevFutLtp, ofi)
    }

    // ── 2. VPIN ──────────────────────────────────────────────────────────
    if (futures) {
      this.state.vpin = this.vpin.update(futures.ltp, futures.volume, prevFutLtp)
    }

    // ── 3. Glosten-Milgrom alpha ─────────────────────────────────────────
    if (futures) {
      this.state.gm = this.gm.update(
        futures.bid, futures.ask,
        futures.ltp, timestamp
      )
    }

    // ── 4. Hasbrouck IS ─────────────────────────────────────────────────
    if (spot && futures) {
      this.state.hasbrouck = this.hasbrouck.update(spot.ltp, futures.ltp, timestamp)
    }

    // ── 5. GEX ──────────────────────────────────────────────────────────
    if (chain.length > 0 && spot) {
      this.state.gex = this.gex.compute(chain, spot.ltp)
    }

    // ── 6. Vanna + Charm ─────────────────────────────────────────────────
    if (chain.length > 0 && spot) {
      this.state.vannaCharm = this.vc.compute(chain, spot.ltp)
    }

    // ── 7. OI Velocity ──────────────────────────────────────────────────
    if (chain.length > 0) {
      this.state.oiVelocity = this.oiVel.update(chain, timestamp)
    }

    // ── 8. IV Skew Velocity ──────────────────────────────────────────────
    if (chain.length > 0 && spot) {
      const near = chain.filter(o => o.dte <= 7)
      const far  = chain.filter(o => o.dte > 7 && o.dte <= 35)
      const ce25W = this._findClosestDelta(near, 'CE', 0.25)
      const pe25W = this._findClosestDelta(near, 'PE', -0.25)
      const ce25M = this._findClosestDelta(far,  'CE', 0.25)
      const pe25M = this._findClosestDelta(far,  'PE', -0.25)
      if (ce25W && pe25W) {
        this.state.skewVelocity = this.skewVel.update(
          ce25W.iv, pe25W.iv,
          ce25M?.iv ?? ce25W.iv,
          pe25M?.iv ?? pe25W.iv,
          timestamp
        )
      }
    }

    // ── 9. Back Bridge Detector ──────────────────────────────────────────
    if (spot && this.sessionStarted) {
      this.state.bridge = this.bridge.update(spot.ltp, timestamp)
    }

    // ── 10. Options Delta Flow ────────────────────────────────────────────
    if (chain.length > 0 && futures) {
      this.state.deltaFlow = this.deltaFlow.update(chain, futures.ltp, timestamp)
    }

    // ── 11. N-Insider (derived from Kyle Lambda) ─────────────────────────
    if (this.state.kyle) {
      this.state.nInsider = this.nInsider.update(this.state.kyle.lambda)
    }

    // ── 12. Composite ────────────────────────────────────────────────────
    const signals = buildSignals(this.state)
    this.state.composite = computeComposite(signals, timestamp)

    // Track composite history (last 300 points)
    if (this.state.composite) {
      this.state.compositeHistory.push({
        ts:        timestamp,
        p:         this.state.composite.pBullish,
        direction: this.state.composite.direction,
      })
      if (this.state.compositeHistory.length > 300) {
        this.state.compositeHistory.shift()
      }
    }

    // ── Push to renderer ─────────────────────────────────────────────────
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('intel-update', this.state)
    }

    // ── Write to DB every 60s ────────────────────────────────────────────
    const now = Date.now()
    if (now - this.lastDBWrite > 60000 && this.pool && this.state.composite) {
      this._writeSnapshot().catch(console.error)
      this.lastDBWrite = now
    }

    // ── Fire alert if composite crosses threshold ─────────────────────────
    if (
      this.state.composite &&
      this.state.composite.confidence >= this.ALERT_THRESHOLD &&
      now - this.lastAlertFired > 300000   // max 1 alert per 5 minutes
    ) {
      const alert = {
        confidence: this.state.composite.confidence,
        direction:  this.state.composite.direction,
        hypothesis: this.state.composite.hypothesis,
        spot:       spot?.ltp ?? 0,
      }
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('intel-alert', alert)
      }
      this._writeAlert(alert).catch(console.error)
      this.lastAlertFired = now
    }
  }

  // ── Helper: find option closest to target delta ────────────────────────
  private _findClosestDelta(
    chain: OptionTick[], type: 'CE' | 'PE', target: number
  ): OptionTick | null {
    const opts = chain.filter(o => o.type === type)
    if (!opts.length) return null
    return opts.reduce((best, o) =>
      Math.abs(o.delta - target) < Math.abs(best.delta - target) ? o : best
    )
  }

  // ── Helper: is market open ─────────────────────────────────────────────
  private _isMarketOpen(ts: number): boolean {
    const d   = new Date(ts)
    const hm  = d.getHours() * 100 + d.getMinutes()
    const day = d.getDay()
    return day >= 1 && day <= 5 && hm >= 915 && hm <= 1530
  }

  // ── Helper: parse Angel One expiry string ─────────────────────────────
  // Input:  '27MAR2025' or '27MAR25'
  // Output: '2025-03-27'
  private _parseExpiry(raw: string): string {
    const MONTHS: Record<string, string> = {
      JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06',
      JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12'
    }
    const m = raw.match(/^(\d{2})([A-Z]{3})(\d{2,4})$/)
    if (!m) return '2025-01-01'
    const [, day, mon, yr] = m
    const year = yr.length === 2 ? '20' + yr : yr
    return `${year}-${MONTHS[mon] ?? '01'}-${day}`
  }

  // ── DB: create schema tables ───────────────────────────────────────────
  private async _createSchema(): Promise<void> {
    if (!this.pool) return
    const s = this.SCHEMA
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.signal_snapshots (
        id              BIGSERIAL PRIMARY KEY,
        captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot            NUMERIC(10,2),
        futures         NUMERIC(10,2),
        kyle_lambda     NUMERIC(12,6),
        kyle_lambda_z   NUMERIC(8,4),
        kyle_regime     VARCHAR(20),
        vpin            NUMERIC(14,6),
        vpin_pct        NUMERIC(6,2),
        vpin_regime     VARCHAR(20),
        gm_alpha        NUMERIC(14,6),
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
        composite_bull  NUMERIC(14,6),
        composite_bear  NUMERIC(14,6),
        confidence      NUMERIC(14,6),
        direction       VARCHAR(10),
        position_size   NUMERIC(6,4),
        effective_n     NUMERIC(6,2),
        hypothesis      TEXT,
        fii_net_futures BIGINT,
        fii_short_squeeze BOOLEAN
      )
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_intel_ss_time
      ON ${s}.signal_snapshots (captured_at DESC)
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.intel_alerts (
        id          BIGSERIAL PRIMARY KEY,
        fired_at    TIMESTAMPTZ DEFAULT NOW(),
        direction   VARCHAR(10),
        confidence  NUMERIC(14,6),
        spot        NUMERIC(10,2),
        message     TEXT,
        acknowledged BOOLEAN DEFAULT FALSE
      )
    `)
  }

  private async _writeSnapshot(): Promise<void> {
    if (!this.pool || !this.state.composite) return
    const st = this.state
    await this.pool.query(`
      INSERT INTO ${this.SCHEMA}.signal_snapshots (
        spot, futures,
        kyle_lambda, kyle_lambda_z, kyle_regime,
        vpin, vpin_pct, vpin_regime, gm_alpha,
        gex_at_spot, gex_zero_cross, gex_regime, call_wall, put_wall,
        max_pain, vanna_flow, charm_flow, expiry_urgency,
        oi_net, skew_velocity_z,
        composite_bull, composite_bear, confidence, direction,
        position_size, effective_n, hypothesis,
        fii_net_futures, fii_short_squeeze
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
      )
    `, [
      st.spot?.ltp,   st.futures?.ltp,
      st.kyle?.lambda,  st.kyle?.lambdaZ,  st.kyle?.regime,
      st.vpin?.vpin,    st.vpin?.vpinPct,  st.vpin?.regime,
      st.gm?.alpha,
      st.gex?.gexAtSpot, st.gex?.zeroCross, st.gex?.regime,
      st.gex?.callWall,  st.gex?.putWall,
      st.vannaCharm?.maxPain, st.vannaCharm?.vannaFlow, st.vannaCharm?.charmFlow,
      st.vannaCharm?.expiryUrgency,
      st.oiVelocity?.oisNet, st.skewVelocity?.velocityZ,
      st.composite!.pBullish, st.composite!.pBearish, st.composite!.confidence,
      st.composite!.direction, st.composite!.positionSize, st.composite!.effectiveN,
      st.composite!.hypothesis,
      st.fii?.netFutures ?? null, st.fii?.shortSqueeze ?? false,
    ])
  }

  private async _writeAlert(a: {
    direction: string; confidence: number; spot: number; hypothesis: string
  }): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      INSERT INTO ${this.SCHEMA}.intel_alerts (direction, confidence, spot, message)
      VALUES ($1,$2,$3,$4)
    `, [a.direction, a.confidence, a.spot, a.hypothesis])
  }
}
