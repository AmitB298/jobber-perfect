/**
 * spoofing-detector.ts — Real-Time Order Book Spoofing Detection Engine
 * Location: D:\jobber-perfect\backend\spoofing-detector.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS SPOOFING IN OPTIONS MARKETS?
 *
 * Spoofing = placing large fake orders to create false price signals,
 * then cancelling them before execution. In NIFTY options:
 *
 *  1. BID WALL SPOOF: Large bid appears → retail buys → wall vanishes → price drops
 *  2. ASK WALL SPOOF: Large ask appears → retail sells → wall vanishes → price rises
 *  3. LAYERING: Multiple fake levels on one side to push price
 *  4. ICEBERG SPOOF: Small visible qty, large hidden, fills partially then disappears
 *  5. MOMENTUM IGNITION: Small real trades to trigger algos, then reverse
 *  6. QUOTE STUFFING: Rapid bid/ask flip to slow competitor algos
 *  7. OI DIVERGENCE SPOOF: LTP moves but OI flat/drops = fake move (no real interest)
 *
 * WHY YOUR SPOOFING ALGO LAGS:
 *  - Old pipeline: tick → DB write (50–700ms) → API reads DB → algorithm runs
 *  - Result: by the time you detect the spoof, it's already been cancelled
 *  - Spoofs last 200–800ms. Your old detection took 500–1500ms. Always late.
 *
 * v3 FIX:
 *  - Detection runs IN the collector, on raw tick data, before any DB write
 *  - Angel One tick arrives → spoofing detector runs in <1ms → alert fired
 *  - Then the tick is stored to DB (non-blocking)
 *  - Detection is NOW, not 500ms later
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SpoofType =
  | 'BID_WALL'           // Abnormally large bid relative to ask
  | 'ASK_WALL'           // Abnormally large ask relative to bid
  | 'LAYERING_BID'       // Multiple strikes show coordinated bid pressure
  | 'LAYERING_ASK'       // Multiple strikes show coordinated ask pressure
  | 'OI_DIVERGENCE'      // LTP moved but OI dropped = unwinding, not real move
  | 'SPREAD_COMPRESSION' // Bid-ask spread suddenly collapses = algo activity
  | 'QUOTE_STUFFING'     // Rapid bid/ask flip = algo trying to slow others
  | 'MOMENTUM_IGNITION'  // Sharp LTP spike with low OI change = fake momentum
  | 'ABSORPTION'         // Large qty being absorbed without LTP moving = wall holding

export type SpoofSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface SpoofAlert {
  id:           string;        // unique per alert
  type:         SpoofType;
  severity:     SpoofSeverity;
  strike:       number;
  optionType:   'CE' | 'PE';
  detectedAt:   number;        // Date.now() — millisecond precision
  ltp:          number;
  bidPrice:     number;
  askPrice:     number;
  bidQty:       number;
  askQty:       number;
  oi:           number;
  oiChange:     number;        // vs previous tick
  ltpChange:    number;        // vs previous tick
  bidAskRatio:  number;        // bidQty / askQty
  spreadPct:    number;        // (ask - bid) / ltp * 100
  confidence:   number;        // 0–100
  description:  string;
  action:       string;        // what to do: AVOID_BUY / AVOID_SELL / WATCH / FADE
  expiresAt:    number;        // when this alert is no longer relevant (ms)
}

export interface TickSnapshot {
  ltp:      number;
  bidPrice: number;
  askPrice: number;
  bidQty:   number;
  askQty:   number;
  oi:       number;
  volume:   number;
  ts:       number;   // timestamp ms
}

// Per-strike history ring buffer — stores last N ticks for pattern detection
interface StrikeHistory {
  ce: TickSnapshot[];
  pe: TickSnapshot[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — tuned for NIFTY options market microstructure
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_DEPTH     = 20;    // ticks per strike to keep in memory
const BID_WALL_RATIO    = 5.0;   // bidQty > 5x askQty = suspicious
const ASK_WALL_RATIO    = 5.0;   // askQty > 5x bidQty = suspicious
const MIN_QTY_THRESHOLD = 50;    // ignore tiny qty (noise)
const SPREAD_COLLAPSE_PCT = 30;  // spread shrinks by 30%+ = algo activity
const LTP_SPIKE_PCT     = 0.8;   // 0.8% LTP move with low OI = momentum ignition
const OI_DROP_THRESHOLD = 0.02;  // OI drops 2%+ while LTP moves = divergence
const FLIP_WINDOW_MS    = 500;   // bid/ask flip within 500ms = quote stuffing
const ALERT_TTL_MS      = 3000;  // alerts expire after 3 seconds

// Layering: if 3+ strikes show same-side wall within 200ms = coordinated
const LAYER_WINDOW_MS   = 200;
const LAYER_MIN_STRIKES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// SPOOFING DETECTOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class SpoofingDetector {
  // Per-strike history: Map key = "STRIKE_TYPE" e.g. "24800_CE"
  private history = new Map<string, TickSnapshot[]>();

  // Active alerts (cleared after TTL)
  private activeAlerts = new Map<string, SpoofAlert>();

  // Recent wall detections for layering detection
  private recentWalls: { strike: number; side: 'BID' | 'ASK'; ts: number }[] = [];

  // Callbacks: called immediately on detection, before any DB write
  private onAlertCallbacks: Array<(alert: SpoofAlert) => void> = [];

  // Alert counter for unique IDs
  private alertSeq = 0;

  // ── Public API ─────────────────────────────────────────────────────────────

  onAlert(cb: (alert: SpoofAlert) => void) {
    this.onAlertCallbacks.push(cb);
  }

  /**
   * processTick — call this on EVERY option tick, before DB write
   * This is the hot path: must be synchronous and < 1ms
   */
  processTick(
    strike:     number,
    optionType: 'CE' | 'PE',
    ltp:        number,
    bidPrice:   number,
    askPrice:   number,
    bidQty:     number,
    askQty:     number,
    oi:         number,
    volume:     number,
  ) {
    const now = Date.now();
    const key = `${strike}_${optionType}`;

    // Build snapshot
    const snap: TickSnapshot = { ltp, bidPrice, askPrice, bidQty, askQty, oi, volume, ts: now };

    // Get / create history
    let hist = this.history.get(key);
    if (!hist) { hist = []; this.history.set(key, hist); }

    const prev = hist[hist.length - 1]; // previous tick (may be undefined)

    // Add to history (ring buffer)
    hist.push(snap);
    if (hist.length > HISTORY_DEPTH) hist.shift();

    // Expire old alerts
    this.cleanExpiredAlerts(now);

    // ── Run all detectors ────────────────────────────────────────────────────

    if (bidQty > MIN_QTY_THRESHOLD || askQty > MIN_QTY_THRESHOLD) {
      this.detectBidAskWall(strike, optionType, snap, prev, now);
    }

    if (prev) {
      this.detectOIDivergence(strike, optionType, snap, prev, now);
      this.detectSpreadCompression(strike, optionType, snap, prev, now);
      this.detectQuoteStuffing(strike, optionType, hist, now);
      this.detectMomentumIgnition(strike, optionType, snap, prev, now);
      this.detectAbsorption(strike, optionType, hist, now);
    }

    this.detectLayering(strike, now);
  }

  /** Get all currently active alerts (for SSE push to dashboard) */
  getActiveAlerts(): SpoofAlert[] {
    const now = Date.now();
    this.cleanExpiredAlerts(now);
    return Array.from(this.activeAlerts.values())
      .sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /** Get alerts for a specific strike */
  getAlertsForStrike(strike: number): SpoofAlert[] {
    return this.getActiveAlerts().filter(a => a.strike === strike);
  }

  /** Clear all state (call on reconnect) */
  reset() {
    this.history.clear();
    this.activeAlerts.clear();
    this.recentWalls = [];
  }

  // ── Private detectors ──────────────────────────────────────────────────────

  /**
   * DETECTOR 1: BID WALL / ASK WALL
   * bidQty >> askQty = fake support (spoofer wants you to think price won't fall)
   * askQty >> bidQty = fake resistance (spoofer wants you to think price won't rise)
   */
  private detectBidAskWall(
    strike: number, optionType: 'CE' | 'PE',
    snap: TickSnapshot, prev: TickSnapshot | undefined, now: number
  ) {
    const { bidQty, askQty, bidPrice, askPrice, ltp } = snap;
    if (!bidQty || !askQty) return;

    const ratio = bidQty / Math.max(askQty, 1);
    const spreadPct = askPrice > 0 ? ((askPrice - bidPrice) / ltp) * 100 : 0;

    if (ratio >= BID_WALL_RATIO) {
      // Check if this wall appeared suddenly (not there in prev tick)
      const prevRatio = prev ? (prev.bidQty / Math.max(prev.askQty, 1)) : 0;
      const isSudden = prevRatio < BID_WALL_RATIO * 0.5;

      const confidence = Math.min(95, 50 + (ratio - BID_WALL_RATIO) * 8 + (isSudden ? 20 : 0));
      const severity: SpoofSeverity = ratio > 15 ? 'CRITICAL' : ratio > 10 ? 'HIGH' : 'MEDIUM';

      // Track for layering detection
      this.recentWalls.push({ strike, side: 'BID', ts: now });

      this.fireAlert({
        type: 'BID_WALL',
        severity,
        strike, optionType,
        ltp, bidPrice, askPrice, bidQty, askQty,
        oi: snap.oi,
        oiChange: prev ? snap.oi - prev.oi : 0,
        ltpChange: prev ? ltp - prev.ltp : 0,
        bidAskRatio: ratio,
        spreadPct,
        confidence,
        description: `Fake bid wall detected: ${bidQty.toLocaleString()} bid vs ${askQty.toLocaleString()} ask (${ratio.toFixed(1)}x ratio)${isSudden ? ' — appeared suddenly' : ''}`,
        action: 'AVOID_BUY',  // Don't buy — support is fake
      }, now);
    }

    const inverseRatio = askQty / Math.max(bidQty, 1);
    if (inverseRatio >= ASK_WALL_RATIO) {
      const prevRatio = prev ? (prev.askQty / Math.max(prev.bidQty, 1)) : 0;
      const isSudden = prevRatio < ASK_WALL_RATIO * 0.5;

      const confidence = Math.min(95, 50 + (inverseRatio - ASK_WALL_RATIO) * 8 + (isSudden ? 20 : 0));
      const severity: SpoofSeverity = inverseRatio > 15 ? 'CRITICAL' : inverseRatio > 10 ? 'HIGH' : 'MEDIUM';

      this.recentWalls.push({ strike, side: 'ASK', ts: now });

      this.fireAlert({
        type: 'ASK_WALL',
        severity,
        strike, optionType,
        ltp, bidPrice, askPrice, bidQty, askQty,
        oi: snap.oi,
        oiChange: prev ? snap.oi - prev.oi : 0,
        ltpChange: prev ? ltp - prev.ltp : 0,
        bidAskRatio: inverseRatio,
        spreadPct,
        confidence,
        description: `Fake ask wall detected: ${askQty.toLocaleString()} ask vs ${bidQty.toLocaleString()} bid (${inverseRatio.toFixed(1)}x ratio)${isSudden ? ' — appeared suddenly' : ''}`,
        action: 'AVOID_SELL',  // Don't sell — resistance is fake
      }, now);
    }
  }

  /**
   * DETECTOR 2: OI DIVERGENCE
   * LTP moves UP but OI goes DOWN = people are unwinding (closing), not opening
   * This means the move has no real follow-through — it's a trap
   */
  private detectOIDivergence(
    strike: number, optionType: 'CE' | 'PE',
    snap: TickSnapshot, prev: TickSnapshot, now: number
  ) {
    const ltpChangePct = prev.ltp > 0 ? (snap.ltp - prev.ltp) / prev.ltp : 0;
    const oiChangePct  = prev.oi  > 0 ? (snap.oi  - prev.oi)  / prev.oi  : 0;

    // LTP moved significantly but OI dropped = divergence
    if (Math.abs(ltpChangePct) > LTP_SPIKE_PCT / 100 && oiChangePct < -OI_DROP_THRESHOLD) {
      const confidence = Math.min(90,
        40 + Math.abs(ltpChangePct) * 2000 + Math.abs(oiChangePct) * 1000
      );

      const direction = ltpChangePct > 0 ? 'UP' : 'DOWN';
      const spreadPct = snap.askPrice > 0 ? ((snap.askPrice - snap.bidPrice) / snap.ltp) * 100 : 0;

      this.fireAlert({
        type: 'OI_DIVERGENCE',
        severity: confidence > 70 ? 'HIGH' : 'MEDIUM',
        strike, optionType,
        ltp: snap.ltp, bidPrice: snap.bidPrice, askPrice: snap.askPrice,
        bidQty: snap.bidQty, askQty: snap.askQty, oi: snap.oi,
        oiChange: snap.oi - prev.oi,
        ltpChange: snap.ltp - prev.ltp,
        bidAskRatio: snap.bidQty / Math.max(snap.askQty, 1),
        spreadPct,
        confidence,
        description: `LTP moved ${direction} ${(ltpChangePct * 100).toFixed(2)}% but OI dropped ${(Math.abs(oiChangePct) * 100).toFixed(2)}% — unwinding, not real interest`,
        action: direction === 'UP' ? 'AVOID_BUY' : 'AVOID_SELL',
      }, now);
    }
  }

  /**
   * DETECTOR 3: SPREAD COMPRESSION
   * Bid-ask spread suddenly narrows sharply = institutional algo stepped in
   * Often precedes a large directional move
   */
  private detectSpreadCompression(
    strike: number, optionType: 'CE' | 'PE',
    snap: TickSnapshot, prev: TickSnapshot, now: number
  ) {
    const prevSpread = prev.askPrice - prev.bidPrice;
    const currSpread = snap.askPrice - snap.bidPrice;
    if (prevSpread <= 0 || currSpread <= 0 || snap.ltp <= 0) return;

    const spreadChange = (prevSpread - currSpread) / prevSpread;
    if (spreadChange > SPREAD_COLLAPSE_PCT / 100) {
      const spreadPct = (currSpread / snap.ltp) * 100;
      const confidence = Math.min(85, 40 + spreadChange * 100);

      this.fireAlert({
        type: 'SPREAD_COMPRESSION',
        severity: spreadChange > 0.6 ? 'HIGH' : 'MEDIUM',
        strike, optionType,
        ltp: snap.ltp, bidPrice: snap.bidPrice, askPrice: snap.askPrice,
        bidQty: snap.bidQty, askQty: snap.askQty, oi: snap.oi,
        oiChange: snap.oi - prev.oi,
        ltpChange: snap.ltp - prev.ltp,
        bidAskRatio: snap.bidQty / Math.max(snap.askQty, 1),
        spreadPct,
        confidence,
        description: `Spread compressed ${(spreadChange * 100).toFixed(0)}% (₹${prevSpread.toFixed(1)} → ₹${currSpread.toFixed(1)}) — institutional algo activity`,
        action: 'WATCH',  // Price move imminent — wait for direction
      }, now);
    }
  }

  /**
   * DETECTOR 4: QUOTE STUFFING
   * Bid and ask flip rapidly back and forth = algo trying to slow other algos
   * or create confusion. In NIFTY options, this is rare but real.
   */
  private detectQuoteStuffing(
    strike: number, optionType: 'CE' | 'PE',
    hist: TickSnapshot[], now: number
  ) {
    if (hist.length < 4) return;

    // Look at last 500ms of ticks
    const recent = hist.filter(h => now - h.ts < FLIP_WINDOW_MS);
    if (recent.length < 4) return;

    // Count direction flips in bid price
    let flips = 0;
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      if (prev.bidPrice > 0 && curr.bidPrice > 0) {
        const prevDir = prev.bidPrice > prev.askPrice * 0.98 ? 1 : -1;
        const currDir = curr.bidPrice > curr.askPrice * 0.98 ? 1 : -1;
        if (prevDir !== currDir) flips++;
      }
    }

    if (flips >= 3) {
      const last = hist[hist.length - 1];
      const spreadPct = last.askPrice > 0 ? ((last.askPrice - last.bidPrice) / last.ltp) * 100 : 0;

      this.fireAlert({
        type: 'QUOTE_STUFFING',
        severity: 'MEDIUM',
        strike, optionType,
        ltp: last.ltp, bidPrice: last.bidPrice, askPrice: last.askPrice,
        bidQty: last.bidQty, askQty: last.askQty, oi: last.oi,
        oiChange: 0,
        ltpChange: 0,
        bidAskRatio: last.bidQty / Math.max(last.askQty, 1),
        spreadPct,
        confidence: 60 + flips * 5,
        description: `${flips} bid/ask flips in ${FLIP_WINDOW_MS}ms — possible quote stuffing or algo manipulation`,
        action: 'AVOID_BUY',
      }, now);
    }
  }

  /**
   * DETECTOR 5: MOMENTUM IGNITION
   * Sharp LTP spike (> 0.8%) with minimal OI change = fake momentum
   * Spoofer takes small position to trigger stop-losses / algos, then reverses
   */
  private detectMomentumIgnition(
    strike: number, optionType: 'CE' | 'PE',
    snap: TickSnapshot, prev: TickSnapshot, now: number
  ) {
    if (prev.ltp <= 0) return;

    const ltpChangePct = Math.abs((snap.ltp - prev.ltp) / prev.ltp) * 100;
    const oiChangePct  = prev.oi > 0 ? Math.abs((snap.oi - prev.oi) / prev.oi) * 100 : 0;

    // Big LTP move but OI barely changed = no real position was opened
    if (ltpChangePct > LTP_SPIKE_PCT && oiChangePct < 0.5) {
      const confidence = Math.min(85, 40 + ltpChangePct * 15);
      const spreadPct = snap.askPrice > 0 ? ((snap.askPrice - snap.bidPrice) / snap.ltp) * 100 : 0;
      const direction = snap.ltp > prev.ltp ? 'UP' : 'DOWN';

      this.fireAlert({
        type: 'MOMENTUM_IGNITION',
        severity: ltpChangePct > 2 ? 'HIGH' : 'MEDIUM',
        strike, optionType,
        ltp: snap.ltp, bidPrice: snap.bidPrice, askPrice: snap.askPrice,
        bidQty: snap.bidQty, askQty: snap.askQty, oi: snap.oi,
        oiChange: snap.oi - prev.oi,
        ltpChange: snap.ltp - prev.ltp,
        bidAskRatio: snap.bidQty / Math.max(snap.askQty, 1),
        spreadPct,
        confidence,
        description: `LTP spiked ${direction} ${ltpChangePct.toFixed(2)}% but OI only changed ${oiChangePct.toFixed(3)}% — possible momentum ignition trap`,
        action: direction === 'UP' ? 'FADE_UP' : 'FADE_DOWN',
        // FADE = bet against the move (it's fake)
      }, now);
    }
  }

  /**
   * DETECTOR 6: ABSORPTION
   * Large qty being placed without moving the LTP = a big player absorbing
   * one side of the book. The wall is REAL (not being cancelled).
   * This is the OPPOSITE of a spoof — it signals genuine support/resistance.
   */
  private detectAbsorption(
    strike: number, optionType: 'CE' | 'PE',
    hist: TickSnapshot[], now: number
  ) {
    if (hist.length < 5) return;

    const recent = hist.slice(-5);
    const ltpRange = Math.max(...recent.map(h => h.ltp)) - Math.min(...recent.map(h => h.ltp));
    const avgBidQty = recent.reduce((s, h) => s + h.bidQty, 0) / recent.length;
    const avgAskQty = recent.reduce((s, h) => s + h.askQty, 0) / recent.length;
    const last = recent[recent.length - 1];

    // Consistent large bid qty, LTP not moving = absorption (real support)
    if (avgBidQty > MIN_QTY_THRESHOLD * 3 && ltpRange < last.ltp * 0.003) {
      const spreadPct = last.askPrice > 0 ? ((last.askPrice - last.bidPrice) / last.ltp) * 100 : 0;

      this.fireAlert({
        type: 'ABSORPTION',
        severity: 'LOW',  // Not dangerous — informational
        strike, optionType,
        ltp: last.ltp, bidPrice: last.bidPrice, askPrice: last.askPrice,
        bidQty: last.bidQty, askQty: last.askQty, oi: last.oi,
        oiChange: last.oi - recent[0].oi,
        ltpChange: last.ltp - recent[0].ltp,
        bidAskRatio: avgBidQty / Math.max(avgAskQty, 1),
        spreadPct,
        confidence: 65,
        description: `Consistent bid absorption: avg ${Math.round(avgBidQty).toLocaleString()} bid qty over last 5 ticks with LTP stable — genuine support level`,
        action: 'WATCH',  // This is real support — respect it
      }, now);
    }
  }

  /**
   * DETECTOR 7: LAYERING
   * 3+ strikes showing same-side wall within 200ms = coordinated manipulation
   * Much harder to detect because it requires cross-strike correlation
   */
  private detectLayering(strike: number, now: number) {
    // Clean old walls
    this.recentWalls = this.recentWalls.filter(w => now - w.ts < LAYER_WINDOW_MS);

    const bidStrikes = new Set(this.recentWalls.filter(w => w.side === 'BID').map(w => w.strike));
    const askStrikes = new Set(this.recentWalls.filter(w => w.side === 'ASK').map(w => w.strike));

    if (bidStrikes.size >= LAYER_MIN_STRIKES) {
      const strikes = Array.from(bidStrikes).sort((a, b) => a - b);
      const alertKey = `LAYERING_BID_${strikes.join('_')}`;

      if (!this.activeAlerts.has(alertKey)) {
        const last = this.history.get(`${strike}_CE`)?.slice(-1)[0] ||
                     this.history.get(`${strike}_PE`)?.slice(-1)[0];
        if (last) {
          this.fireAlertWithKey(alertKey, {
            type: 'LAYERING_BID',
            severity: 'CRITICAL',
            strike,
            optionType: 'CE',
            ltp: last.ltp, bidPrice: last.bidPrice, askPrice: last.askPrice,
            bidQty: last.bidQty, askQty: last.askQty, oi: last.oi,
            oiChange: 0, ltpChange: 0,
            bidAskRatio: last.bidQty / Math.max(last.askQty, 1),
            spreadPct: 0,
            confidence: 85,
            description: `Coordinated bid layering across ${bidStrikes.size} strikes (${strikes.join(', ')}) within ${LAYER_WINDOW_MS}ms — institutional manipulation`,
            action: 'AVOID_BUY',
          }, now);
        }
      }
    }

    if (askStrikes.size >= LAYER_MIN_STRIKES) {
      const strikes = Array.from(askStrikes).sort((a, b) => a - b);
      const alertKey = `LAYERING_ASK_${strikes.join('_')}`;

      if (!this.activeAlerts.has(alertKey)) {
        const last = this.history.get(`${strike}_CE`)?.slice(-1)[0] ||
                     this.history.get(`${strike}_PE`)?.slice(-1)[0];
        if (last) {
          this.fireAlertWithKey(alertKey, {
            type: 'LAYERING_ASK',
            severity: 'CRITICAL',
            strike,
            optionType: 'CE',
            ltp: last.ltp, bidPrice: last.bidPrice, askPrice: last.askPrice,
            bidQty: last.bidQty, askQty: last.askQty, oi: last.oi,
            oiChange: 0, ltpChange: 0,
            bidAskRatio: last.askQty / Math.max(last.bidQty, 1),
            spreadPct: 0,
            confidence: 85,
            description: `Coordinated ask layering across ${askStrikes.size} strikes (${strikes.join(', ')}) within ${LAYER_WINDOW_MS}ms — institutional manipulation`,
            action: 'AVOID_SELL',
          }, now);
        }
      }
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private fireAlert(
    partial: Omit<SpoofAlert, 'id' | 'detectedAt' | 'expiresAt'>,
    now: number
  ) {
    const key = `${partial.type}_${partial.strike}_${partial.optionType}`;
    this.fireAlertWithKey(key, partial, now);
  }

  private fireAlertWithKey(
    key: string,
    partial: Omit<SpoofAlert, 'id' | 'detectedAt' | 'expiresAt'>,
    now: number
  ) {
    // Don't re-fire same alert within TTL (deduplicate)
    const existing = this.activeAlerts.get(key);
    if (existing && now - existing.detectedAt < 500) return; // debounce 500ms

    const alert: SpoofAlert = {
      ...partial,
      id:          `${key}_${++this.alertSeq}`,
      detectedAt:  now,
      expiresAt:   now + ALERT_TTL_MS,
    };

    this.activeAlerts.set(key, alert);

    // Fire all callbacks synchronously (< 1ms)
    for (const cb of this.onAlertCallbacks) {
      try { cb(alert); } catch (_) {}
    }
  }

  private cleanExpiredAlerts(now: number) {
    for (const [key, alert] of this.activeAlerts) {
      if (now > alert.expiresAt) this.activeAlerts.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON — shared across the collector process
// ─────────────────────────────────────────────────────────────────────────────
export const spoofingDetector = new SpoofingDetector();
