/**
 * alert-router.ts
 * Location: D:\jobber-perfect\backend\src\services\alert-router.ts
 *
 * TypeScript port of alert_router.py from the Python spoofing detection package.
 * Wired into websocket-collector.ts via:
 *   spoofingDetector.onAlert(routeSpoofAlert);
 *
 * ─── WHAT IT DOES ────────────────────────────────────────────────────────────
 * Receives every SpoofAlert from spoofing-detector.ts, then:
 *   1. Maps severity+confidence → AlertState (CLEAR/WATCH/ALERT/CRITICAL)
 *   2. Derives AlertRegime (NORMAL/SUSPICIOUS/SPOOF) — mirrors Python engine
 *   3. Computes AlertPhase from IST time (PATCH_I/PATCH_II/CLOSE_WATCH/NORMAL)
 *   4. Builds full AlertPayload (all fields the dashboard and Telegram need)
 *   5. Writes JSONL file (daily rotation, IST date)
 *   6. Sends Telegram (ALERT+CRITICAL only, throttled 30s)
 *   7. Broadcasts to WS clients via spoofing-dashboard-ws.ts
 *
 * ─── TELEGRAM SETUP ──────────────────────────────────────────────────────────
 *   1. Message @BotFather → /newbot → copy token
 *   2. Message your bot once
 *   3. https://api.telegram.org/bot<TOKEN>/getUpdates → find chat_id
 *   4. .env:  TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...
 *
 * ─── FILE OUTPUT ─────────────────────────────────────────────────────────────
 *   alerts/alerts_YYYY-MM-DD.jsonl   ← ALERT + CRITICAL (+ Telegram)
 *   alerts/watch_YYYY-MM-DD.jsonl    ← WATCH only (file only, no Telegram)
 *
 * ─── ENV VARS (.env) ─────────────────────────────────────────────────────────
 *   TELEGRAM_BOT_TOKEN     blank = Telegram silently disabled
 *   TELEGRAM_CHAT_ID
 *   ALERT_THRESHOLD=52     confidence >= 52 → ALERT
 *   CRITICAL_THRESHOLD=72  confidence >= 72 → CRITICAL
 *   ALERT_DIR=alerts
 */

import * as fs    from 'fs';
import * as path  from 'path';
import * as https from 'https';
import { Pool }   from 'pg';
import { SpoofAlert } from '../../spoofing-detector';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  (mirrors Python config.py values)
// ─────────────────────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const ALERT_THRESHOLD    = parseInt(process.env.ALERT_THRESHOLD    || '52', 10);
const CRITICAL_THRESHOLD = parseInt(process.env.CRITICAL_THRESHOLD || '72', 10);
const ALERT_DIR          = process.env.ALERT_DIR || 'alerts';

// Ensure directory exists at import time
try { if (!fs.existsSync(ALERT_DIR)) fs.mkdirSync(ALERT_DIR, { recursive: true }); }
catch (_) { /* non-fatal */ }

// ─────────────────────────────────────────────────────────────────────────────
// DB — for persistent alert history (spoof_alerts table)
// Write-behind only, never blocks the real-time path.
// ─────────────────────────────────────────────────────────────────────────────
const _pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'jobber_pro',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  max:      3,   // small pool — alerts are low-frequency
});

async function persistToDb(p: AlertPayload): Promise<void> {
  try {
    await _pool.query(`
      INSERT INTO nifty_premium_tracking.spoof_alerts
        (detected_at, token, symbol, strike, option_type, alert_type, severity, state,
         regime, phase, ensemble, confidence, ltp, bid_price, ask_price, bid_qty,
         ask_qty, oi, oi_change, ltp_change, bid_ask_ratio, spread_pct, action, explanation, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
    `, [
      new Date(p.detectedAt), p.token, p.symbol, p.strike, p.optionType,
      p.type, p.severity, p.state, p.regime, p.phase,
      p.ensemble, p.confidence, p.ltp, p.bidPrice, p.askPrice,
      p.bidQty, p.askQty, p.oi, p.oiChange, p.ltpChange,
      p.bidAskRatio, p.spreadPct, p.action, p.explanation, JSON.stringify(p)
    ]);
  } catch (_) { /* non-fatal — never let DB errors stop the real-time path */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// AlertState  — mirrors Python AlertState enum
// AlertRegime — mirrors Python Regime enum (NORMAL / SUSPICIOUS / SPOOF)
// AlertPhase  — mirrors Python Phase  enum (PATCH_I / PATCH_II / CLOSE_WATCH / NORMAL)
// ─────────────────────────────────────────────────────────────────────────────
export type AlertState  = 'CLEAR' | 'WATCH' | 'ALERT' | 'CRITICAL';
export type AlertRegime = 'NORMAL' | 'SUSPICIOUS' | 'SPOOF';
export type AlertPhase  = 'PATCH_I' | 'PATCH_II' | 'CLOSE_WATCH' | 'NORMAL';

/**
 * AlertPayload — the canonical broadcast object.
 *
 * Field names mirror the Python engine's to_json() output so dashboard_live_patch.jsx
 * works without modification:
 *   data.token, data.symbol, data.state, data.regime, data.phase,
 *   data.ensemble, data.confidence, data.scores,
 *   data.fv.{VPIN, OBI_L1, TBQ_TSQ}, data.js.{patch1_buy_proxy, ...},
 *   data.explanation, data.action
 */
export interface AlertPayload {
  // ── Identity ──────────────────────────────────────────────────────────────
  token:       string;          // "24800_CE" — dashboard uses as state-map key
  symbol:      string;          // "NIFTY24800CE"
  strike:      number;
  optionType:  'CE' | 'PE';

  // ── Detection state (mirrors Python DetectionResult fields) ───────────────
  state:       AlertState;      // CLEAR / WATCH / ALERT / CRITICAL
  regime:      AlertRegime;     // NORMAL / SUSPICIOUS / SPOOF
  phase:       AlertPhase;      // PATCH_I / PATCH_II / CLOSE_WATCH / NORMAL

  // ── Severity (from TS spoofing-detector) ─────────────────────────────────
  severity:    string;          // LOW / MEDIUM / HIGH / CRITICAL

  // ── Type ──────────────────────────────────────────────────────────────────
  type:        string;          // BID_WALL / ASK_WALL / LAYERING_BID / etc.

  // ── Scores ────────────────────────────────────────────────────────────────
  ensemble:    number;          // 0–100  (Python names this 'ensemble')
  confidence:  number;          // 0–1    (ensemble / 100)

  // ── Raw market data ───────────────────────────────────────────────────────
  ltp:         number;
  bidPrice:    number;
  askPrice:    number;
  bidQty:      number;
  askQty:      number;
  oi:          number;
  oiChange:    number;
  ltpChange:   number;
  bidAskRatio: number;
  spreadPct:   number;

  // ── Action / guidance ─────────────────────────────────────────────────────
  action:      string;          // AVOID_BUY / AVOID_SELL / WATCH / FADE_UP / FADE_DOWN
  description: string;          // detection description from spoofing-detector
  explanation: string;          // trader guidance (what to do right now)

  // ── Timing ────────────────────────────────────────────────────────────────
  detectedAt:  number;          // ms epoch
  timestamp:   string;          // ISO-8601

  // ── Feature vector (mirrors Python engine fv dict) ────────────────────────
  // Used by dashboard_live_patch.jsx: data.fv.VPIN, data.fv.OBI_L1, data.fv.TBQ_TSQ
  fv: {
    VPIN:       number;   // volume imbalance proxy  (|bidQty-askQty| / totalQty)
    OBI_L1:     number;   // order book imbalance signed  (-1 to +1)
    TBQ_TSQ:    number;   // total bid qty / total sell qty
    PostDist:   number;   // posting distance from mid as fraction
    spread_pct: number;
    oi_change:  number;
    ltp_change: number;
  };

  // ── Jane Street proxies (mirrors Python engine js dict) ───────────────────
  // Used by dashboard_live_patch.jsx: data.js.patch1_buy_proxy, etc.
  js: {
    pattern_prob:        number;  // 0–1: engineered JS pattern probability
    delta_proxy:         number;  // directional exposure proxy (signed)
    patch1_buy_proxy:    number;  // 0–1: morning engineered rally (JS Patch I)
    patch2_sell_proxy:   number;  // 0–1: afternoon engineered dump (JS Patch II)
    ltp_aggression_frac: number;  // fraction of LTP move that looks aggressive
    oi_buildup_p1:       number;  // OI accumulation signal in Patch I window
  };

  // ── Per-module scores (mirrors Python engine scores dict) ─────────────────
  scores: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IST TIME UTILITIES
// IST = UTC + 5:30 = UTC + 330 minutes
// ─────────────────────────────────────────────────────────────────────────────

/** Returns current IST as fractional hours (e.g. 9.5 = 9:30 AM IST) */
function getISTHour(): number {
  const utcMs   = Date.now();
  const utcMins = Math.floor(utcMs / 60_000) % (24 * 60);  // minutes past UTC midnight
  const istMins = (utcMins + 330) % (24 * 60);             // +5h30m, wrap at 24h
  return istMins / 60;                                       // fractional hour
}

/** Returns IST date string "YYYY-MM-DD" for file naming */
function getISTDateString(): string {
  // Add 5h30m to UTC, then format as ISO date
  const istDate = new Date(Date.now() + 330 * 60_000);
  return istDate.toISOString().split('T')[0];
}

/** Market phase based on IST time — mirrors Python Phase enum */
function computePhase(): AlertPhase {
  const h = getISTHour();
  if (h >= 15.0  && h < 15.5) return 'CLOSE_WATCH';  // 15:00–15:30 takes priority
  if (h >= 9.25  && h < 11.0) return 'PATCH_I';       // 09:15–11:00
  if (h >= 13.0  && h < 15.5) return 'PATCH_II';      // 13:00–15:30
  return 'NORMAL';
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE + REGIME COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * toState — maps SpoofAlert confidence + severity to AlertState.
 * Confidence (0–100) takes priority over severity label.
 * Mirrors Python config.py ALERT_THRESHOLD / CRITICAL_THRESHOLD logic.
 */
function toState(alert: SpoofAlert): AlertState {
  if (alert.confidence >= CRITICAL_THRESHOLD) return 'CRITICAL';
  if (alert.confidence >= ALERT_THRESHOLD)    return 'ALERT';
  // Severity label as secondary signal
  if (alert.severity === 'CRITICAL')          return 'CRITICAL';
  if (alert.severity === 'HIGH')              return 'ALERT';
  if (alert.severity === 'MEDIUM')            return 'WATCH';
  return 'CLEAR';
}

/**
 * toRegime — maps AlertState → AlertRegime.
 * Mirrors Python Regime enum:
 *   NORMAL     = no manipulation detected
 *   SUSPICIOUS = possible manipulation, monitor
 *   SPOOF      = manipulation detected with confidence
 */
function toRegime(state: AlertState): AlertRegime {
  if (state === 'CRITICAL' || state === 'ALERT') return 'SPOOF';
  if (state === 'WATCH')                         return 'SUSPICIOUS';
  return 'NORMAL';
}

// ─────────────────────────────────────────────────────────────────────────────
// DELTA PROXY COMPUTATION
// Signed directional bias estimate. Positive = bullish setup, Negative = bearish.
// Each alert type has different directional implications.
// ─────────────────────────────────────────────────────────────────────────────
function computeDeltaProxy(alert: SpoofAlert): number {
  const r = alert.bidAskRatio;  // > 1 = bid heavy, < 1 = ask heavy
  switch (alert.type) {
    case 'BID_WALL':
      // Fake bid support — price will fall when wall is pulled → bearish actual
      return -r;
    case 'ASK_WALL':
      // Fake ask resistance — price will rise when wall is pulled → bullish actual
      return +r;
    case 'LAYERING_BID':
      // Coordinated fake bids → price falls → bearish actual
      return -r;
    case 'LAYERING_ASK':
      // Coordinated fake asks → price rises → bullish actual
      return +r;
    case 'OI_DIVERGENCE':
      // LTP moved but OI dropped = unwinding, fade the move
      // ltpChange > 0 means price went up on unwinding → will reverse down
      return alert.ltpChange > 0 ? -1.0 : +1.0;
    case 'MOMENTUM_IGNITION':
      // Sharp fake spike — fade it
      return alert.ltpChange > 0 ? -r : +r;
    case 'SPREAD_COMPRESSION':
      // Algo stepping in — direction unclear, use book imbalance as proxy
      return r > 1 ? +r : -r;
    case 'QUOTE_STUFFING':
      // Confusion creation — no reliable directional signal
      return 0;
    case 'ABSORPTION':
      // Genuine support below — bullish signal (real buyers absorbing)
      return +r;
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYLOAD BUILDER
// Converts a raw SpoofAlert (from spoofing-detector.ts) into the full
// AlertPayload that gets written to file, sent to Telegram, and broadcast to WS.
// ─────────────────────────────────────────────────────────────────────────────
export function buildPayload(alert: SpoofAlert): AlertPayload {
  const state  = toState(alert);
  const regime = toRegime(state);
  const phase  = computePhase();

  const totalQ = alert.bidQty + alert.askQty;

  // ── Feature vector ─────────────────────────────────────────────────────────
  // VPIN: unsigned imbalance ratio  |bidQty - askQty| / totalQty
  // True VPIN needs trade-classified volume which we don't have from Angel One
  // tick data. This approximation (sometimes called "order flow imbalance") is
  // widely used as a proxy and is what most implementations use in practice.
  const VPIN = totalQ > 0 ? Math.abs(alert.bidQty - alert.askQty) / totalQ : 0;

  // OBI_L1: signed order book imbalance at level 1  range [-1, +1]
  // Positive = bid heavy (buying pressure), Negative = ask heavy (selling pressure)
  const OBI_L1 = totalQ > 0 ? (alert.bidQty - alert.askQty) / totalQ : 0;

  // TBQ/TSQ: Total Bid Qty over Total Sell Qty
  const TBQ_TSQ = alert.askQty > 0
    ? alert.bidQty / alert.askQty
    : (alert.bidQty > 0 ? 99 : 1);

  // PostDist: posting distance = half-spread / mid price
  const mid     = (alert.bidPrice + alert.askPrice) / 2;
  const PostDist = mid > 0 ? (alert.askPrice - alert.bidPrice) / (2 * mid) : 0;

  // ── Jane Street proxies ────────────────────────────────────────────────────
  // pattern_prob: weighted estimate that this is a JS-style engineered move
  // Higher weight for patterns strongly correlated with JS activity
  const layeringW   = (alert.type === 'LAYERING_BID' || alert.type === 'LAYERING_ASK') ? 40 : 0;
  const momentumW   = alert.type === 'MOMENTUM_IGNITION' ? 35 : 0;
  const stuffingW   = alert.type === 'QUOTE_STUFFING'    ? 25 : 0;
  const pattern_prob = Math.min((layeringW + momentumW + stuffingW + alert.confidence) / 200, 1);

  const delta_proxy = computeDeltaProxy(alert);

  // ltp_aggression_frac: what fraction of LTP move looks aggressive vs passive
  // 0.01 LTP = 1% move → 100% aggressive (maximum signal)
  const ltp_aggression_frac = (alert.ltp > 0 && alert.ltpChange !== 0)
    ? Math.min(Math.abs(alert.ltpChange) / (alert.ltp * 0.01), 1)
    : 0;

  // oi_buildup_p1: OI accumulation in Patch I window (bullish build-up proxy)
  const oi_buildup_p1 = (phase === 'PATCH_I' && alert.oiChange > 0)
    ? Math.min(alert.oiChange / 1000, 1)
    : 0;

  // patch1_buy_proxy: morning engineered rally signal
  // High when: Patch I window + MOMENTUM_IGNITION + price going UP
  const patch1_buy_proxy = (
    phase === 'PATCH_I' &&
    alert.type === 'MOMENTUM_IGNITION' &&
    alert.ltpChange > 0
  ) ? Math.min(alert.confidence / 100, 1) : 0;

  // patch2_sell_proxy: afternoon engineered dump signal
  // High when: Patch II window + OI_DIVERGENCE or ABSORPTION + price going DOWN
  const patch2_sell_proxy = (
    phase === 'PATCH_II' &&
    (alert.type === 'OI_DIVERGENCE' || alert.type === 'ABSORPTION') &&
    alert.ltpChange < 0
  ) ? Math.min(alert.confidence / 100, 1) : 0;

  // ── Per-module scores ──────────────────────────────────────────────────────
  const scores: Record<string, number> = {
    VPIN:              Math.round(VPIN * 100),
    OBI:               Math.round(Math.abs(OBI_L1) * 100),
    SPREAD:            Math.round(alert.spreadPct * 10) / 10,
    BID_WALL:          alert.type === 'BID_WALL'          ? Math.round(alert.confidence) : 0,
    ASK_WALL:          alert.type === 'ASK_WALL'          ? Math.round(alert.confidence) : 0,
    LAYERING:          (alert.type === 'LAYERING_BID' || alert.type === 'LAYERING_ASK')
                                                           ? Math.round(alert.confidence) : 0,
    OI_DIVERGENCE:     alert.type === 'OI_DIVERGENCE'     ? Math.round(alert.confidence) : 0,
    MOMENTUM_IGNITION: alert.type === 'MOMENTUM_IGNITION' ? Math.round(alert.confidence) : 0,
    QUOTE_STUFFING:    alert.type === 'QUOTE_STUFFING'    ? Math.round(alert.confidence) : 0,
    ABSORPTION:        alert.type === 'ABSORPTION'        ? Math.round(alert.confidence) : 0,
    JS_PATTERN:        Math.round(pattern_prob * 100),
  };

  // ── Explanation: trader action guidance ───────────────────────────────────
  const stateGuide: Record<AlertState, string> = {
    CRITICAL: 'Exit or hedge immediately. Do NOT trade in the spoofed direction.',
    ALERT:    'No new positions in alert direction. Wait for wall to clear.',
    WATCH:    'Reduce position size by 30%. Monitor order book carefully.',
    CLEAR:    'Trade normally.',
  };

  // Phase note only for CRITICAL state (mirrors Python alert_router.py lines 69-76)
  let phaseNote = '';
  if (state === 'CRITICAL') {
    if      (phase === 'PATCH_I'     && patch1_buy_proxy  > 0.3) phaseNote = ' ⛔ JS PATCH I: Engineered rally. Do NOT buy calls.';
    else if (phase === 'PATCH_II'    && patch2_sell_proxy > 0.3) phaseNote = ' ⛔ JS PATCH II: Dump phase. Exit longs immediately.';
    else if (phase === 'CLOSE_WATCH')                            phaseNote = ' ⛔ MARKING THE CLOSE: Settlement manipulation possible.';
  }

  return {
    token:       `${alert.strike}_${alert.optionType}`,
    symbol:      `NIFTY${alert.strike}${alert.optionType}`,
    strike:      alert.strike,
    optionType:  alert.optionType,
    state,
    regime,
    phase,
    severity:    alert.severity,
    type:        alert.type,
    ensemble:    alert.confidence,        // 0-100, Python calls this 'ensemble'
    confidence:  alert.confidence / 100,  // 0-1
    ltp:         alert.ltp,
    bidPrice:    alert.bidPrice,
    askPrice:    alert.askPrice,
    bidQty:      alert.bidQty,
    askQty:      alert.askQty,
    oi:          alert.oi,
    oiChange:    alert.oiChange,
    ltpChange:   alert.ltpChange,
    bidAskRatio: alert.bidAskRatio,
    spreadPct:   alert.spreadPct,
    action:      alert.action,
    description: alert.description,
    explanation: stateGuide[state] + phaseNote,
    detectedAt:  alert.detectedAt,
    timestamp:   new Date(alert.detectedAt).toISOString(),
    fv:  { VPIN, OBI_L1, TBQ_TSQ, PostDist, spread_pct: alert.spreadPct, oi_change: alert.oiChange, ltp_change: alert.ltpChange },
    js:  { pattern_prob, delta_proxy, patch1_buy_proxy, patch2_sell_proxy, ltp_aggression_frac, oi_buildup_p1 },
    scores,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE LOGGING
// Daily JSONL rotation using IST date (market is India-based).
// Mirrors Python alert_router.py route_alert() / route_watch() file writes.
// ─────────────────────────────────────────────────────────────────────────────
function writeToFile(p: AlertPayload, kind: 'alerts' | 'watch'): void {
  try {
    const fpath = path.join(ALERT_DIR, `${kind}_${getISTDateString()}.jsonl`);
    fs.appendFileSync(fpath, JSON.stringify(p) + '\n');
  } catch (e) {
    // Non-fatal — never crash the hot path over a file error
    process.stderr.write(`[alert-router] File write failed: ${(e as Error).message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM
// Mirrors Python _format_telegram_message() exactly (same field order, same emojis).
// Throttled to max 1 message per 30 seconds (Telegram flood prevention).
// ─────────────────────────────────────────────────────────────────────────────
const STATE_EMOJI:  Record<AlertState,  string> = { CLEAR: '✅', WATCH: '👁', ALERT: '⚠️', CRITICAL: '🚨' };
const REGIME_EMOJI: Record<AlertRegime, string> = { NORMAL: '🟢', SUSPICIOUS: '🟡', SPOOF: '🔴' };

function formatTelegramMessage(p: AlertPayload): string {
  // Top 4 firing modules (mirrors Python lines 60-64)
  const top4 = Object.entries(p.scores)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v.toFixed(0)}`)
    .join(' | ');

  const lines: string[] = [
    // Line 1: state + symbol  (mirrors Python line 47)
    `${STATE_EMOJI[p.state]} <b>${p.state}</b> — ${p.symbol}`,
    ``,
    // Score + confidence  (mirrors Python line 49)
    `Score: <b>${p.ensemble.toFixed(1)}/100</b>  Confidence: ${(p.confidence * 100).toFixed(0)}%`,
    // Regime + phase  (mirrors Python line 50)
    `Regime: ${REGIME_EMOJI[p.regime]} ${p.regime}   Phase: ${p.phase}`,
    ``,
    // Feature vector  (mirrors Python lines 52-53)
    `VPIN: ${p.fv.VPIN.toFixed(4)}   OBI-L1: ${p.fv.OBI_L1.toFixed(3)}`,
    `TBQ/TSQ: ${p.fv.TBQ_TSQ.toFixed(3)}   PostDist: ${p.fv.PostDist.toFixed(4)}`,
    ``,
    // JS proxies  (mirrors Python lines 55-56)
    `JS Pattern: ${(p.js.pattern_prob * 100).toFixed(0)}%   Delta×: ${p.js.delta_proxy.toFixed(1)}`,
    `P1-Buy: ${p.js.patch1_buy_proxy.toFixed(2)}   P2-Sell: ${p.js.patch2_sell_proxy.toFixed(2)}`,
  ];

  // Top signals  (mirrors Python lines 60-64)
  if (top4) { lines.push(``); lines.push(`Top signals: ${top4}`); }

  // Action CTA  (mirrors Python line 66: f"<b>→ {result.action}</b>")
  lines.push(``);
  lines.push(`<b>→ ${p.action}</b>`);

  // CRITICAL phase guidance  (mirrors Python lines 68-76)
  if (p.state === 'CRITICAL') {
    if      (p.phase === 'PATCH_I'     && p.js.patch1_buy_proxy  > 0.3) lines.push(`⛔ JS PATCH I: Engineered rally. Do NOT buy calls.`);
    else if (p.phase === 'PATCH_II'    && p.js.patch2_sell_proxy > 0.3) lines.push(`⛔ JS PATCH II: Dump phase. Exit longs immediately.`);
    else if (p.phase === 'CLOSE_WATCH')                                  lines.push(`⛔ MARKING THE CLOSE: Settlement manipulation possible.`);
  }

  return lines.join('\n');
}

let _lastTelegramAt = 0;
const TELEGRAM_THROTTLE_MS = 30_000;

function sendTelegram(text: string): void {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  if (Date.now() - _lastTelegramAt < TELEGRAM_THROTTLE_MS) return;
  _lastTelegramAt = Date.now();

  const body = Buffer.from(JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }));

  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path:     `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
    },
    (res) => {
      res.resume(); // drain body to free socket
      if (res.statusCode && res.statusCode !== 200) {
        process.stderr.write(`[alert-router] Telegram HTTP ${res.statusCode}\n`);
      }
    }
  );

  req.on('error', (e) => {
    // Non-fatal — Telegram failures MUST NOT crash the trading system
    process.stderr.write(`[alert-router] Telegram send failed: ${e.message}\n`);
  });

  req.write(body);
  req.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD WS BRIDGE
// spoofing-dashboard-ws.ts registers its broadcast function here at startup.
// This avoids a circular import (alert-router → ws-server → alert-router).
// ─────────────────────────────────────────────────────────────────────────────
let _wsBroadcast: ((p: AlertPayload) => void) | null = null;

/** Called once by spoofing-dashboard-ws.ts to register its broadcast callback */
export function registerWsBroadcast(fn: (p: AlertPayload) => void): void {
  _wsBroadcast = fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATS  (for health display ticker in websocket-collector.ts)
// ─────────────────────────────────────────────────────────────────────────────
const _startedAt   = Date.now();
let _totalAlerts   = 0;
let _totalCritical = 0;
let _totalWatch    = 0;

export function getAlertStats() {
  return {
    totalAlerts:   _totalAlerts,
    totalCritical: _totalCritical,
    totalWatch:    _totalWatch,
    uptimeSecs:    Math.round((Date.now() - _startedAt) / 1000),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING  (mirrors Python route_alert() and route_watch())
// ─────────────────────────────────────────────────────────────────────────────

function routeAlert(alert: SpoofAlert): void {
  const p = buildPayload(alert);
  _totalAlerts++;
  if (p.state === 'CRITICAL') _totalCritical++;

  // 1. File (always, for ALERT and CRITICAL)
  writeToFile(p, 'alerts');
  persistToDb(p);  // write-behind to DB — non-blocking

  // 2. Telegram (ALERT + CRITICAL, throttled 30s) — mirrors Python route_alert
  sendTelegram(formatTelegramMessage(p));

  // 3. Dashboard WS broadcast
  if (_wsBroadcast) _wsBroadcast(p);

  // 4. Console log
  const tag = p.state === 'CRITICAL' ? '🚨 CRITICAL' : '⚠️  ALERT   ';
  process.stdout.write(
    `${tag} | ${p.symbol} | Score=${p.ensemble.toFixed(1)} | Regime=${p.regime} | Phase=${p.phase} | ${p.action}\n`
  );
  if (p.state === 'CRITICAL') {
    if (p.js.patch1_buy_proxy  > 0.3) process.stdout.write(`           ⛔ JS PATCH I  — Do NOT buy calls\n`);
    if (p.js.patch2_sell_proxy > 0.3) process.stdout.write(`           ⛔ JS PATCH II — Exit longs NOW\n`);
    if (p.phase === 'CLOSE_WATCH')    process.stdout.write(`           ⛔ CLOSE WATCH — Settlement manipulation risk\n`);
  }
}

function routeWatch(alert: SpoofAlert): void {
  const p = buildPayload(alert);
  _totalWatch++;
  // File only (no Telegram for WATCH — mirrors Python route_watch exactly)
  writeToFile(p, 'watch');
  // Still broadcast to dashboard so UI shows WATCH cards
  if (_wsBroadcast) _wsBroadcast(p);
}

/**
 * routeSpoofAlert — unified entry point.
 *
 * Register once in websocket-collector.ts main() BEFORE the session loop:
 *   spoofingDetector.onAlert(routeSpoofAlert);
 *
 * Called synchronously on every SpoofAlert. Total overhead < 1ms normally.
 * Telegram send is async and does not block.
 */
export function routeSpoofAlert(alert: SpoofAlert): void {
  const state = toState(alert);
  if      (state === 'CRITICAL' || state === 'ALERT') routeAlert(alert);
  else if (state === 'WATCH')                         routeWatch(alert);
  // CLEAR → silently ignore (no file, no broadcast, no noise)
}
