/**
 * JOBBER PRO — OI SCANNER ENGINE
 * ================================
 * SEBI-SAFE: Pure data scanner. No buy/sell signals. No predictions.
 * Shows: "Where is OI concentrating?" — a factual market observation.
 *
 * This is the same information NSE publishes on their OI reports.
 * We just display it faster, richer, and with structural context.
 *
 * HOW TO ADD TO websocket-collector.ts:
 * ─────────────────────────────────────
 * // At top of file:
 * import { OIScannerEngine } from './oi-scanner-engine';
 *
 * // After `const db = new Pool(...)`:
 * const oiScanner = new OIScannerEngine(db, _directWsEmitter);
 *
 * // Inside handleTick(), after existing spoofing detector call:
 * oiScanner.onTick({
 *   token:      data.token,
 *   strike:     strikePrice,       // parsed from symbol
 *   expiry:     expiryStr,         // parsed from symbol (YYYY-MM-DD)
 *   optionType: optionType,        // 'CE' | 'PE'
 *   ltp:        data.ltp,
 *   bid:        data.bidPrice ?? data.best_buy_price ?? 0,
 *   ask:        data.askPrice ?? data.best_sell_price ?? 0,
 *   oi:         data.oi ?? 0,
 *   volume:     data.volume ?? 0,
 *   spot:       spotPrice,         // NIFTY index LTP
 *   timestamp:  Date.now(),
 * });
 *
 * // In your 5-minute interval (around line 800 in websocket-collector.ts):
 * await oiScanner.onFiveMinute();
 *
 * // In your 15-minute interval:
 * await oiScanner.onFifteenMinute();
 */

import { Pool } from 'pg';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface OIScannerTick {
  token:      number;
  strike:     number;
  expiry:     string;        // 'YYYY-MM-DD'
  optionType: 'CE' | 'PE';
  ltp:        number;
  bid:        number;
  ask:        number;
  oi:         number;
  volume:     number;
  spot:       number;        // NIFTY index LTP
  timestamp:  number;
}

export interface OIConcentrationZone {
  strike:       number;
  expiry:       string;
  optionType:   'CE' | 'PE';
  zoneType:     ZoneType;
  zoneStrength: number;      // 0-100 composite data score
  oi:           number;
  oiRank:       number;
  oiVelocity:   number;
  oiVelocityZ:  number;
  gexAbs:       number;
  sweepCount:   number;
  ltp:          number;
  iv:           number;
  distanceFromSpot: number;
  distancePct:  number;
}

type ZoneType =
  | 'HIGH_OI_BUILDUP'
  | 'OI_VELOCITY_SPIKE'
  | 'GEX_WALL'
  | 'SWEEP_CLUSTER'
  | 'IV_OI_DIVERGENCE'
  | 'CALL_WALL'
  | 'PUT_WALL';

export interface OIScannerSummary {
  expiry:         string;
  spot:           number;
  dte:            number;
  maxPain:        number;
  gammaFlip:      number;
  callWall:       number;
  putWall:        number;
  netGex:         number;
  pcrOi:          number;
  atmIv:          number;
  ivr:            number;
  topCE:          OIConcentrationZone | null;
  topPE:          OIConcentrationZone | null;
  zones:          OIConcentrationZone[];
  activeZoneCount: number;
  sweepCount15m:  number;
  updatedAt:      number;
}

interface StrikeState {
  strike:     number;
  expiry:     string;
  optionType: 'CE' | 'PE';
  oi:         number;
  oiPrev:     number;
  volume:     number;
  ltp:        number;
  bid:        number;
  ask:        number;
  iv:         number;
  gamma:      number;
  gex:        number;
  sweepCount5m: number;
  lastUpdate:  number;
}

// ─── BLACK-SCHOLES (minimal — IV + Gamma only) ────────────────────────────────

function norm_cdf(x: number): number {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1/(1+p*x);
  const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}

function norm_pdf(x: number): number {
  return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
}

function bs_gamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S/K) + (r+0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
  return norm_pdf(d1) / (S*sigma*Math.sqrt(T));
}

function bs_price(S: number, K: number, T: number, r: number, sigma: number, type: 'CE'|'PE'): number {
  if (T <= 0) return type==='CE' ? Math.max(0,S-K) : Math.max(0,K-S);
  const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2 = d1 - sigma*Math.sqrt(T);
  return type==='CE'
    ? S*norm_cdf(d1) - K*Math.exp(-r*T)*norm_cdf(d2)
    : K*Math.exp(-r*T)*norm_cdf(-d2) - S*norm_cdf(-d1);
}

function compute_iv(price: number, S: number, K: number, T: number, r: number, type: 'CE'|'PE'): number {
  if (T <= 0 || price <= 0) return 0;
  let lo=0.001, hi=5.0, mid=0.3;
  for (let i=0; i<50; i++) {
    mid = (lo+hi)/2;
    const p = bs_price(S,K,T,r,mid,type);
    if (Math.abs(p-price)<0.01) break;
    if (p > price) hi=mid; else lo=mid;
  }
  return mid;
}

// ─── OI VELOCITY ENGINE ───────────────────────────────────────────────────────

class OIVelocityEngine {
  // Rolling window: last 20 OI velocity readings per strike
  private history = new Map<string, number[]>();
  private lastOI   = new Map<string, number>();
  private lastTime = new Map<string, number>();

  record(key: string, oi: number, timestamp: number): { velocity: number; zScore: number } {
    const prevOI   = this.lastOI.get(key) ?? oi;
    const prevTime = this.lastTime.get(key) ?? timestamp;

    const dt = Math.max(1, (timestamp - prevTime) / 1000 / 60); // minutes
    const velocity = (oi - prevOI) / dt; // lots per minute

    this.lastOI.set(key, oi);
    this.lastTime.set(key, timestamp);

    const hist = this.history.get(key) ?? [];
    hist.push(velocity);
    if (hist.length > 20) hist.shift();
    this.history.set(key, hist);

    if (hist.length < 3) return { velocity, zScore: 0 };

    const mean = hist.reduce((a,b)=>a+b,0)/hist.length;
    const std  = Math.sqrt(hist.reduce((a,b)=>a+(b-mean)**2,0)/hist.length);
    const zScore = std > 0 ? (velocity-mean)/std : 0;

    return { velocity, zScore };
  }
}

// ─── GEX ENGINE ───────────────────────────────────────────────────────────────

class GEXEngine {
  private static LOT_SIZE = 50;

  static computeStrikeGEX(
    gamma: number,
    oi:    number,
    spot:  number,
    type:  'CE'|'PE'
  ): number {
    // GEX = gamma × OI × LotSize × Spot² / 100 (₹ crore)
    // CE dealers are short → negative GEX multiplier for puts
    const sign = type === 'CE' ? 1 : -1;
    return sign * gamma * oi * this.LOT_SIZE * spot * spot / 1e7;
  }

  static findGammaFlip(chainGex: Map<number, number>): number {
    const strikes = Array.from(chainGex.keys()).sort((a,b)=>a-b);
    let prevGex = chainGex.get(strikes[0]) ?? 0;
    for (let i=1; i<strikes.length; i++) {
      const gex = chainGex.get(strikes[i]) ?? 0;
      if (prevGex * gex < 0) {
        // Zero crossing between strikes[i-1] and strikes[i]
        const range = strikes[i] - strikes[i-1];
        return strikes[i-1] + range * Math.abs(prevGex) / (Math.abs(prevGex)+Math.abs(gex));
      }
      prevGex = gex;
    }
    return 0;
  }

  static findWalls(
    chainGex: Map<number, number>
  ): { callWall: number; putWall: number } {
    let maxCE = 0, maxPE = 0, callWall = 0, putWall = 0;
    chainGex.forEach((gex, strike) => {
      if (gex > 0 && gex > maxCE) { maxCE = gex; callWall = strike; }
      if (gex < 0 && Math.abs(gex) > maxPE) { maxPE = Math.abs(gex); putWall = strike; }
    });
    return { callWall, putWall };
  }
}

// ─── ZONE SCORER ─────────────────────────────────────────────────────────────

class ZoneScorer {
  /**
   * Produces a 0-100 data score for OI concentration.
   * Higher = more data evidence of institutional OI buildup.
   * This is a measurement, not a recommendation.
   */
  static score(params: {
    oiRankPct:   number;  // 0-1 (1 = highest OI strike)
    oiVelZ:      number;  // z-score of OI velocity
    gexRankPct:  number;  // 0-1 (1 = largest |GEX|)
    sweepCount:  number;  // sweeps in last 5m
    ivMove:      number;  // absolute IV change in last 5m
    distancePct: number;  // % distance from spot
  }): number {
    // OI rank: up to 35 points
    const oiScore = params.oiRankPct * 35;

    // OI velocity z-score: up to 25 points
    const velScore = Math.min(25, Math.max(0, params.oiVelZ * 8));

    // GEX magnitude rank: up to 20 points
    const gexScore = params.gexRankPct * 20;

    // Sweep cluster: up to 15 points
    const sweepScore = Math.min(15, params.sweepCount * 3);

    // IV move confirmation: up to 5 points
    const ivScore = Math.min(5, params.ivMove * 50);

    // Proximity penalty: strikes > 5% away score slightly less
    const proximityFactor = params.distancePct > 5 ? 0.85 : 1.0;

    return Math.min(100, (oiScore + velScore + gexScore + sweepScore + ivScore) * proximityFactor);
  }

  static classifyZone(
    strength: number,
    oiVelZ: number,
    gexRank: number,
    sweepCount: number,
    optionType: 'CE'|'PE'
  ): ZoneType {
    if (sweepCount >= 3)       return 'SWEEP_CLUSTER';
    if (oiVelZ > 2.5)          return 'OI_VELOCITY_SPIKE';
    if (gexRank > 0.9)         return optionType === 'CE' ? 'CALL_WALL' : 'PUT_WALL';
    if (strength >= 60)        return optionType === 'CE' ? 'CALL_WALL' : 'PUT_WALL';
    if (oiVelZ > 1.5)          return 'HIGH_OI_BUILDUP';
    return 'HIGH_OI_BUILDUP';
  }
}

// ─── MAX PAIN ─────────────────────────────────────────────────────────────────

function computeMaxPain(chain: Map<string, StrikeState>, spot: number): number {
  const strikes = new Set<number>();
  chain.forEach(s => strikes.add(s.strike));

  let minPain = Infinity, maxPainStrike = spot;
  strikes.forEach(testStrike => {
    let pain = 0;
    chain.forEach(s => {
      if (s.optionType === 'CE' && testStrike > s.strike) {
        pain += (testStrike - s.strike) * s.oi * 50;
      } else if (s.optionType === 'PE' && testStrike < s.strike) {
        pain += (s.strike - testStrike) * s.oi * 50;
      }
    });
    if (pain < minPain) { minPain = pain; maxPainStrike = testStrike; }
  });
  return maxPainStrike;
}

// ─── PCR ─────────────────────────────────────────────────────────────────────

function computePCR(chain: Map<string, StrikeState>): number {
  let totalCEOI = 0, totalPEOI = 0;
  chain.forEach(s => {
    if (s.optionType === 'CE') totalCEOI += s.oi;
    else totalPEOI += s.oi;
  });
  return totalCEOI > 0 ? totalPEOI / totalCEOI : 1;
}

// ─── IVR ─────────────────────────────────────────────────────────────────────

async function computeIVR(db: Pool, currentIV: number): Promise<number> {
  try {
    const res = await db.query(`
      SELECT MIN(iv) as iv_low, MAX(iv) as iv_high
      FROM nifty_premium_tracking.iv_history
      WHERE recorded_at >= NOW() - INTERVAL '52 weeks'
        AND iv > 0
    `);
    const { iv_low, iv_high } = res.rows[0] ?? {};
    if (!iv_low || !iv_high || iv_high === iv_low) return 50;
    return Math.round(((currentIV - iv_low) / (iv_high - iv_low)) * 100);
  } catch {
    return 50;
  }
}

// ─── MAIN OI SCANNER ENGINE ───────────────────────────────────────────────────

export class OIScannerEngine {
  private db:          Pool;
  private broadcaster: { broadcastPush: (p: any) => void } | null;

  // Live chain state: key = `${strike}_${type}_${expiry}`
  private chain = new Map<string, StrikeState>();

  // Tracking
  private spotPrice   = 0;
  private spotExpiry  = '';     // nearest expiry being tracked
  private oiVelocity  = new OIVelocityEngine();
  private sweepCounts = new Map<string, number>(); // key → sweeps in 5m
  private lastIV      = new Map<string, number>(); // key → IV 5m ago

  // 5-minute snapshot of top zones, broadcast to frontend
  private lastSummary: OIScannerSummary | null = null;

  // Broadcast throttle: only push if changed
  private lastBroadcastHash = '';

  constructor(
    db: Pool,
    broadcaster: { broadcastPush: (p: any) => void } | null = null
  ) {
    this.db          = db;
    this.broadcaster = broadcaster;
    console.log('[OIScanner] Engine initialized');
  }

  /**
   * Called by registerDirectWsEmitter() in websocket-collector.ts
   * once the real WS emitter is available.
   * The engine is created with null broadcaster at startup (pool not ready yet),
   * then wired to the real emitter here when it becomes available.
   */
  setEmitter(emitter: { broadcastPush: (p: any) => void }): void {
    this.broadcaster = emitter;
    console.log('[OIScanner] Emitter wired ✅');
  }

  /**
   * Graceful shutdown — called from shutdown() in websocket-collector.ts
   */
  destroy(): void {
    this.broadcaster = null;
    this.chain.clear();
    this.sweepCounts.clear();
    this.lastIV.clear();
    this.lastSummary = null;
    console.log('[OIScanner] Engine destroyed');
  }

  // ── TICK HANDLER (called from websocket-collector.ts handleTick) ──

  onTick(tick: OIScannerTick): void {
    const key = `${tick.strike}_${tick.optionType}_${tick.expiry}`;

    // Track nearest expiry spot
    if (tick.optionType === 'CE') {
      this.spotPrice  = tick.spot;
      this.spotExpiry = this.spotExpiry || tick.expiry;
      // Always track the nearest expiry
      if (tick.expiry < this.spotExpiry) this.spotExpiry = tick.expiry;
    }

    // Compute IV + Gamma
    const T = Math.max(0.0001, this._dte(tick.expiry) / 365);
    const r = 0.065;
    const iv    = compute_iv(tick.ltp, tick.spot, tick.strike, T, r, tick.optionType);
    const gamma = bs_gamma(tick.spot, tick.strike, T, r, iv || 0.15);
    const gex   = GEXEngine.computeStrikeGEX(gamma, tick.oi, tick.spot, tick.optionType);

    // OI velocity z-score
    const { velocity: oiVel, zScore: oiVelZ } =
      this.oiVelocity.record(key, tick.oi, tick.timestamp);

    // Update chain state
    const existing = this.chain.get(key);
    this.chain.set(key, {
      strike:     tick.strike,
      expiry:     tick.expiry,
      optionType: tick.optionType,
      oi:         tick.oi,
      oiPrev:     existing?.oi ?? tick.oi,
      volume:     tick.volume,
      ltp:        tick.ltp,
      bid:        tick.bid,
      ask:        tick.ask,
      iv:         iv || (existing?.iv ?? 0),
      gamma,
      gex,
      sweepCount5m: existing?.sweepCount5m ?? 0,
      lastUpdate:  tick.timestamp,
    });

    // High-frequency: detect sweep signal (large OI jump in single tick)
    if (existing && tick.oi - existing.oi > 500) {
      const cnt = (this.sweepCounts.get(key) ?? 0) + 1;
      this.sweepCounts.set(key, cnt);
    }
  }

  // ── 5-MINUTE CYCLE ───────────────────────────────────────────

  async onFiveMinute(): Promise<void> {
    try {
      const spot   = this.spotPrice;
      const expiry = this.spotExpiry;
      if (!spot || !expiry) return;

      const summary = this._buildSummary(spot, expiry);
      this.lastSummary = summary;

      // Persist snapshot to DB
      await this._persistSnapshot(summary);

      // Broadcast to frontend via wsEmitter
      this._broadcast(summary);

      // Reset 5-min sweep counters
      this.sweepCounts.clear();

      // Save current IV for delta comparison next cycle
      this.chain.forEach((s, key) => this.lastIV.set(key, s.iv));

      console.log(`[OIScanner] 5m cycle: spot=${spot} zones=${summary.activeZoneCount} topCE=${summary.topCE?.strike} topPE=${summary.topPE?.strike}`);
    } catch (err) {
      console.error('[OIScanner] 5m cycle error:', err);
    }
  }

  // ── 15-MINUTE CYCLE ──────────────────────────────────────────

  async onFifteenMinute(): Promise<void> {
    try {
      await this._saveSessionHistory();
      await this._resolveStaleZones();
    } catch (err) {
      console.error('[OIScanner] 15m cycle error:', err);
    }
  }

  // ── QUERY: Get current summary (for REST API) ─────────────────

  getSummary(): OIScannerSummary | null {
    return this.lastSummary;
  }

  getTopZones(expiry?: string): OIConcentrationZone[] {
    if (!this.lastSummary) return [];
    const zones = this.lastSummary.zones;
    if (expiry) return zones.filter(z => z.expiry === expiry);
    return zones;
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────

  private _buildSummary(spot: number, expiry: string): OIScannerSummary {
    // Filter chain to nearest expiry
    const expiryChain = new Map<string, StrikeState>();
    this.chain.forEach((s, key) => {
      if (s.expiry === expiry) expiryChain.set(key, s);
    });

    // Rank by OI
    const ceStrikes = Array.from(expiryChain.values()).filter(s => s.optionType === 'CE');
    const peStrikes = Array.from(expiryChain.values()).filter(s => s.optionType === 'PE');

    const totalCEOI  = ceStrikes.reduce((a,s) => a+s.oi, 0);
    const totalPEOI  = peStrikes.reduce((a,s) => a+s.oi, 0);
    const maxCEOI    = Math.max(...ceStrikes.map(s=>s.oi), 1);
    const maxPEOI    = Math.max(...peStrikes.map(s=>s.oi), 1);

    const chainGex = new Map<number, number>();
    expiryChain.forEach(s => {
      chainGex.set(s.strike, (chainGex.get(s.strike) ?? 0) + s.gex);
    });

    const gammaFlip = GEXEngine.findGammaFlip(chainGex);
    const { callWall, putWall } = GEXEngine.findWalls(chainGex);
    const netGex = Array.from(chainGex.values()).reduce((a,b)=>a+b,0);
    const pcrOi  = totalCEOI > 0 ? totalPEOI / totalCEOI : 1;
    const maxPain = computeMaxPain(expiryChain, spot);

    // Rank all GEX magnitudes for relative scoring
    const gexMags = Array.from(chainGex.values()).map(Math.abs).sort((a,b)=>b-a);
    const maxGex  = gexMags[0] || 1;

    // Build zone list for CE
    const ceRanked = [...ceStrikes].sort((a,b) => b.oi - a.oi);
    const peRanked = [...peStrikes].sort((a,b) => b.oi - a.oi);

    const buildZones = (
      ranked: StrikeState[],
      total: number,
      maxOI: number,
      type: 'CE'|'PE'
    ): OIConcentrationZone[] => {
      return ranked.slice(0, 10).map((s, idx) => {
        const key = `${s.strike}_${s.optionType}_${s.expiry}`;
        const oiVelRes = this.oiVelocity.record(key, s.oi, Date.now());
        const sweepCnt = this.sweepCounts.get(key) ?? 0;
        const prevIV   = this.lastIV.get(key) ?? s.iv;
        const ivMove   = Math.abs(s.iv - prevIV);
        const gexAbs   = Math.abs(chainGex.get(s.strike) ?? 0);
        const gexRankPct = maxGex > 0 ? gexAbs / maxGex : 0;
        const distFromSpot = s.strike - spot;
        const distPct = Math.abs(distFromSpot / spot * 100);
        const oiRankPct = maxOI > 0 ? s.oi / maxOI : 0;

        const strength = ZoneScorer.score({
          oiRankPct,
          oiVelZ:     oiVelRes.zScore,
          gexRankPct,
          sweepCount:  sweepCnt,
          ivMove,
          distancePct: distPct,
        });

        const zoneType = ZoneScorer.classifyZone(
          strength, oiVelRes.zScore, gexRankPct, sweepCnt, type
        );

        return {
          strike:      s.strike,
          expiry:      s.expiry,
          optionType:  type,
          zoneType,
          zoneStrength: Math.round(strength * 10) / 10,
          oi:          s.oi,
          oiRank:      idx + 1,
          oiVelocity:  Math.round(oiVelRes.velocity * 10) / 10,
          oiVelocityZ: Math.round(oiVelRes.zScore * 100) / 100,
          gexAbs:      Math.round(gexAbs * 100) / 100,
          sweepCount:  sweepCnt,
          ltp:         s.ltp,
          iv:          Math.round(s.iv * 10000) / 100, // as %
          distanceFromSpot: Math.round(distFromSpot),
          distancePct: Math.round(distPct * 100) / 100,
        };
      }).filter(z => z.zoneStrength > 5); // Only show meaningful zones
    };

    const ceZones = buildZones(ceRanked, totalCEOI, maxCEOI, 'CE');
    const peZones = buildZones(peRanked, totalPEOI, maxPEOI, 'PE');
    const allZones = [...ceZones, ...peZones].sort((a,b) => b.zoneStrength - a.zoneStrength);

    // ATM IV
    const atmStrike = Math.round(spot / 50) * 50;
    const atmCE = expiryChain.get(`${atmStrike}_CE_${expiry}`);
    const atmPE = expiryChain.get(`${atmStrike}_PE_${expiry}`);
    const atmIV = ((atmCE?.iv ?? 0) + (atmPE?.iv ?? 0)) / 2;

    const dte = this._dte(expiry);

    return {
      expiry,
      spot,
      dte,
      maxPain,
      gammaFlip,
      callWall,
      putWall,
      netGex:    Math.round(netGex * 100) / 100,
      pcrOi:     Math.round(pcrOi * 1000) / 1000,
      atmIv:     Math.round(atmIV * 10000) / 100,
      ivr:       50, // computed async via computeIVR, default 50
      topCE:     ceZones[0] ?? null,
      topPE:     peZones[0] ?? null,
      zones:     allZones.slice(0, 20),
      activeZoneCount: allZones.filter(z => z.zoneStrength >= 40).length,
      sweepCount15m: Array.from(this.sweepCounts.values()).reduce((a,b)=>a+b,0),
      updatedAt: Date.now(),
    };
  }

  private async _persistSnapshot(summary: OIScannerSummary): Promise<void> {
    const now = new Date();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Persist zone events for top zones
      for (const zone of summary.zones.filter(z => z.zoneStrength >= 40)) {
        await client.query(`
          INSERT INTO nifty_premium_tracking.oi_zone_events
            (detected_at, expiry_date, strike_price, option_type, zone_type,
             zone_strength, spot_price, distance_from_spot, distance_pct,
             oi_at_detection, ltp_at_detection, iv_at_detection,
             component_oi_rank, component_oi_velocity, component_gex,
             component_sweep_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT DO NOTHING
        `, [
          now, zone.expiry, zone.strike, zone.optionType, zone.zoneType,
          zone.zoneStrength, summary.spot, zone.distanceFromSpot, zone.distancePct,
          zone.oi, zone.ltp, zone.iv,
          zone.oiRank, zone.oiVelocity, zone.gexAbs, zone.sweepCount,
        ]);
      }

      // Summary row
      await client.query(`
        INSERT INTO nifty_premium_tracking.oi_scanner_summary
          (summary_at, expiry_date, spot_price, dte, max_pain_strike,
           gamma_flip_level, call_wall_strike, put_wall_strike,
           net_gex, pcr_oi, atm_iv, ivr,
           top_ce_strike, top_ce_oi, top_ce_zone_strength,
           top_pe_strike, top_pe_oi, top_pe_zone_strength,
           active_zone_count, sweep_count_15m)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (summary_at, expiry_date) DO UPDATE SET
          spot_price=EXCLUDED.spot_price, net_gex=EXCLUDED.net_gex,
          active_zone_count=EXCLUDED.active_zone_count
      `, [
        now, summary.expiry, summary.spot, summary.dte, summary.maxPain,
        summary.gammaFlip, summary.callWall, summary.putWall,
        summary.netGex, summary.pcrOi, summary.atmIv, summary.ivr,
        summary.topCE?.strike, summary.topCE?.oi, summary.topCE?.zoneStrength,
        summary.topPE?.strike, summary.topPE?.oi, summary.topPE?.zoneStrength,
        summary.activeZoneCount, summary.sweepCount15m,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[OIScanner] DB persist error:', err);
    } finally {
      client.release();
    }
  }

  private _broadcast(summary: OIScannerSummary): void {
    if (!this.broadcaster) return;
    const hash = `${summary.topCE?.strike}-${summary.topPE?.strike}-${summary.activeZoneCount}`;
    if (hash === this.lastBroadcastHash) return;
    this.lastBroadcastHash = hash;

    this.broadcaster.broadcastPush({
      type:    'OI_SCANNER_UPDATE',
      key:     'oi_scanner',
      payload: summary,
      ts:      Date.now(),
    });
  }

  private async _saveSessionHistory(): Promise<void> {
    const now     = new Date();
    const hour    = now.getHours();
    const minute  = now.getMinutes();
    let phase = 'MID';
    if (hour < 10 || (hour === 9 && minute < 30))  phase = 'OPEN';
    else if (hour >= 15 && minute >= 15)             phase = 'CLOSE';

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const [, s] of this.chain) {
        await client.query(`
          INSERT INTO nifty_premium_tracking.oi_session_history
            (session_date, session_phase, expiry_date, strike_price, option_type, oi, volume, ltp, iv)
          VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (session_date, session_phase, expiry_date, strike_price, option_type)
          DO UPDATE SET oi=EXCLUDED.oi, volume=EXCLUDED.volume, ltp=EXCLUDED.ltp, iv=EXCLUDED.iv
        `, [phase, s.expiry, s.strike, s.optionType, s.oi, s.volume, s.ltp, s.iv]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[OIScanner] Session history error:', err);
    } finally {
      client.release();
    }
  }

  private async _resolveStaleZones(): Promise<void> {
    try {
      await this.db.query(`
        UPDATE nifty_premium_tracking.oi_zone_events
        SET active=false, resolved_at=NOW(), resolution_type='EXPIRED'
        WHERE active=true
          AND detected_at < NOW() - INTERVAL '2 hours'
          AND expiry_date >= CURRENT_DATE
      `);
    } catch (err) {
      console.error('[OIScanner] Zone resolve error:', err);
    }
  }

  private _dte(expiry: string): number {
    const exp = new Date(expiry);
    const now = new Date();
    const ms  = exp.getTime() - now.getTime();
    return Math.max(0, Math.ceil(ms / (1000*60*60*24)));
  }
}