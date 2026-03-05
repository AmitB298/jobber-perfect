/**
 * network-monitor.ts — Backend Internet Speed Monitor
 * Location: D:\jobber-perfect\backend\network-monitor.ts
 *
 * FIXES vs previous version:
 *  [NEW-1] MEDIUM  fetchUrl outer timer not cleared when req.setTimeout fires → timer leak fixed
 *  [NEW-2] MEDIUM  previousQuality race condition between runNetworkCheck + speedtest → speedtest now uses isolated call
 *  [NEW-3] MEDIUM  runNetworkCheck + speedtest write state concurrently → speedtest blocked while poll is running
 *  [NEW-4] LOW     startNetworkMonitor called twice creates duplicate intervals → guarded with 'started' flag
 *  [NEW-5] LOW     import * as dns left over after measureDNSLatency was removed → removed
 *
 * RETAINED FIXES from previous audit:
 *  [v1-1] FAIR recovery: OFFLINE/POOR→FAIR now fires RECOVERED alert
 *  [v1-2] Speed test uses checkCounter — deterministic (no Date.now()%15000)
 *  [v1-3] measureDNSLatency() removed (dead code)
 *  [v1-4] spd variable removed from gradeQuality (unused)
 *  [v1-5] import * as https removed
 *  [v1-6] SSE heartbeat added every 25s
 *  [v1-7] Dead SSE clients cleaned in heartbeat
 *  [v1-8] SPEED_TEST_URLS[1] used as fallback
 *  [v1-9] Manual speedtest updates consecutiveFailures + alert
 */

import { Router, Request, Response } from 'express';
import * as net from 'net';
import * as http from 'http';

// ============================================================================
// TYPES
// ============================================================================

export interface NetworkStatus {
  isOnline: boolean;
  quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'OFFLINE';
  downloadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLoss: number;           // 0–100 %
  lastChecked: string;          // ISO timestamp
  consecutiveFailures: number;
  alert: NetworkAlert | null;
}

export interface NetworkAlert {
  level: 'WARNING' | 'CRITICAL' | 'RECOVERED';
  message: string;
  timestamp: string;
}

// ============================================================================
// INTERNAL STATE
// ============================================================================

let state: NetworkStatus = {
  isOnline: true,
  quality: 'GOOD',
  downloadMbps: null,
  latencyMs: null,
  jitterMs: null,
  packetLoss: 0,
  lastChecked: new Date().toISOString(),
  consecutiveFailures: 0,
  alert: null,
};

// SSE clients subscribed to live network alerts
const sseClients = new Set<Response>();

// ============================================================================
// PING TARGETS
// ============================================================================

const PING_TARGETS = [
  { host: '8.8.8.8', port: 53, name: 'Google DNS'  },
  { host: '1.1.1.1', port: 53, name: 'Cloudflare'  },
  { host: '8.8.4.4', port: 53, name: 'Google DNS2' },
];

// ============================================================================
// SPEED TEST TARGETS — [1] used as fallback if [0] fails
// ============================================================================

const SPEED_TEST_URLS = [
  'http://www.gstatic.com/generate_204',
  'http://connectivitycheck.gstatic.com/generate_204',
];

// ============================================================================
// MEASURE LATENCY — TCP connect time to DNS port 53
// ============================================================================

function measureTCPLatency(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let resolved = false;

    const done = (result: number | null) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(Date.now() - start));
    socket.on('timeout',  () => done(null));
    socket.on('error',    () => done(null));
    socket.connect(port, host);
  });
}

// ============================================================================
// DOWNLOAD SPEED — FIX NEW-1: outer timer cleared on ALL exit paths
// ============================================================================

function fetchUrl(url: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let bytes = 0;
    let settled = false;

    const done = (mbps: number | null) => {
      if (!settled) { settled = true; resolve(mbps); }
    };

    // Outer safety net in case nothing else fires
    const timer = setTimeout(() => done(null), timeoutMs);

    try {
      const req = http.get(url, (res) => {
        res.on('data',  (chunk: Buffer) => { bytes += chunk.length; });
        res.on('end',   () => {
          clearTimeout(timer);                         // ← always clear here
          const elapsed = (Date.now() - start) / 1000;
          if (elapsed > 0 && bytes > 0) {
            done((bytes * 8) / elapsed / 1_000_000);
          } else if (elapsed > 0) {
            done(0.1);  // empty body (generate_204) — connection alive, mark as minimal speed
          } else {
            done(null);
          }
        });
        res.on('error', () => { clearTimeout(timer); done(null); });
      });

      // FIX NEW-1: clear outer timer before calling done() in req.setTimeout
      req.setTimeout(timeoutMs, () => {
        clearTimeout(timer);                           // ← was missing
        req.destroy();
        done(null);
      });

      req.on('error', () => { clearTimeout(timer); done(null); });

    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

async function measureDownloadSpeed(timeoutMs = 8000): Promise<number | null> {
  const primary = await fetchUrl(SPEED_TEST_URLS[0], timeoutMs);
  if (primary !== null) return primary;
  return fetchUrl(SPEED_TEST_URLS[1], timeoutMs);
}

// ============================================================================
// MULTI-PING
// ============================================================================

async function multiPing(): Promise<{ latencies: number[]; lossPercent: number }> {
  const results = await Promise.all(
    PING_TARGETS.map(t => measureTCPLatency(t.host, t.port, 2000))
  );
  const successful  = results.filter((r): r is number => r !== null);
  const lossPercent = Math.round(
    ((PING_TARGETS.length - successful.length) / PING_TARGETS.length) * 100
  );
  return { latencies: successful, lossPercent };
}

// ============================================================================
// JITTER
// ============================================================================

function calculateJitter(latencies: number[]): number {
  if (latencies.length < 2) return 0;
  let totalDiff = 0;
  for (let i = 1; i < latencies.length; i++) {
    totalDiff += Math.abs(latencies[i] - latencies[i - 1]);
  }
  return Math.round(totalDiff / (latencies.length - 1));
}

// ============================================================================
// QUALITY GRADER
// ============================================================================

function gradeQuality(
  isOnline: boolean,
  latency: number | null,
  packetLoss: number
): NetworkStatus['quality'] {
  if (!isOnline || packetLoss >= 100) return 'OFFLINE';
  if (packetLoss >= 50)               return 'POOR';

  const lat = latency ?? 9999;

  if (lat < 30  && packetLoss === 0) return 'EXCELLENT';
  if (lat < 80  && packetLoss < 5)  return 'GOOD';
  if (lat < 150 && packetLoss < 20) return 'FAIR';
  return 'POOR';
}

// ============================================================================
// ALERT GENERATOR — FIX NEW-2: accepts explicit prevQuality so callers can
// pass their own snapshot rather than mutating shared previousQuality.
// The shared previousQuality is ONLY updated by the background poller.
// The manual speedtest uses a read-only peek (no side-effect on shared state).
// ============================================================================

let previousQuality: NetworkStatus['quality'] = 'GOOD';

function generateAlertForPoller(newQuality: NetworkStatus['quality']): NetworkAlert | null {
  // Called ONLY by runNetworkCheck — updates the shared previousQuality
  const prev = previousQuality;
  previousQuality = newQuality;
  return buildAlert(prev, newQuality);
}

function generateAlertForSpeedtest(newQuality: NetworkStatus['quality']): NetworkAlert | null {
  // Called ONLY by /speedtest — reads previousQuality WITHOUT mutating it,
  // so the poller's transition tracking is never corrupted.
  return buildAlert(previousQuality, newQuality);
}

function buildAlert(prev: NetworkStatus['quality'], next: NetworkStatus['quality']): NetworkAlert | null {
  if (next === 'OFFLINE' && prev !== 'OFFLINE') {
    return {
      level: 'CRITICAL',
      message: '🔴 INTERNET LOST — Angel One WebSocket will disconnect! Check your connection.',
      timestamp: new Date().toISOString(),
    };
  }

  if (next === 'POOR' && !['POOR', 'OFFLINE'].includes(prev)) {
    return {
      level: 'WARNING',
      message: '⚠️ POOR CONNECTION — High latency detected. Data feed may be delayed.',
      timestamp: new Date().toISOString(),
    };
  }

  if (['EXCELLENT', 'GOOD', 'FAIR'].includes(next) && ['POOR', 'OFFLINE'].includes(prev)) {
    const qualifier = next === 'FAIR' ? ' (partial — still FAIR quality)' : '';
    return {
      level: 'RECOVERED',
      message: `✅ CONNECTION RESTORED — Network is back to ${next}${qualifier}.`,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// ============================================================================
// BROADCAST
// ============================================================================

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const dead: Response[] = [];

  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      dead.push(client);
    }
  }

  for (const client of dead) sseClients.delete(client);
}

// ============================================================================
// SPEED TEST COUNTER
// ============================================================================

let checkCounter = 0;
const SPEED_TEST_EVERY_N_CHECKS = 3; // every 3rd poll = every 15s at 5s interval

// ============================================================================
// MAIN POLLING LOOP — FIX NEW-3: exposes a lock that speedtest respects
// ============================================================================

let isPolling = false;

async function runNetworkCheck() {
  if (isPolling) return;
  isPolling = true;

  try {
    checkCounter++;

    const { latencies, lossPercent } = await multiPing();
    const isOnline   = latencies.length > 0;
    const avgLatency = isOnline
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    const jitter     = isOnline ? calculateJitter(latencies) : null;

    const shouldTestSpeed = (checkCounter % SPEED_TEST_EVERY_N_CHECKS) === 0;
    let downloadMbps = state.downloadMbps;
    if (shouldTestSpeed && isOnline) {
      downloadMbps = await measureDownloadSpeed(6000);
    }

    const quality = gradeQuality(isOnline, avgLatency, lossPercent);
    const alert   = generateAlertForPoller(quality);    // FIX NEW-2: dedicated function

    state = {
      isOnline,
      quality,
      downloadMbps,
      latencyMs: avgLatency,
      jitterMs: jitter,
      packetLoss: lossPercent,
      lastChecked: new Date().toISOString(),
      consecutiveFailures: isOnline ? 0 : state.consecutiveFailures + 1,
      alert,
    };

    if (alert) broadcast({ type: 'network_alert', ...state });

  } catch {
    state = {
      ...state,
      isOnline: false,
      quality: 'OFFLINE',
      consecutiveFailures: state.consecutiveFailures + 1,
      lastChecked: new Date().toISOString(),
      alert: {
        level: 'CRITICAL',
        message: '🔴 Network check failed — possible complete connection loss.',
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    isPolling = false;
  }
}

// ============================================================================
// SSE HEARTBEAT
// ============================================================================

function startSSEHeartbeat(intervalMs = 25_000) {
  setInterval(() => {
    const heartbeat = ': heartbeat\n\n'; // SSE comment line — clients ignore it
    const dead: Response[] = [];

    for (const client of sseClients) {
      try {
        client.write(heartbeat);
      } catch {
        dead.push(client);
      }
    }

    for (const client of dead) sseClients.delete(client);
  }, intervalMs);
}

// ============================================================================
// START — FIX NEW-4: guarded against being called twice
// ============================================================================

let monitorStarted = false;

export function startNetworkMonitor(intervalMs = 5000) {
  if (monitorStarted) {
    console.warn('⚠️  startNetworkMonitor() called more than once — ignoring duplicate call');
    return;
  }
  monitorStarted = true;

  console.log(`🌐 Network monitor started — checking every ${intervalMs / 1000}s`);
  runNetworkCheck();                        // immediate first check
  setInterval(runNetworkCheck, intervalMs);
  startSSEHeartbeat(25_000);
}

// ============================================================================
// EXPRESS ROUTES
// ============================================================================

export function registerNetworkRoutes(router: Router) {

  // GET /api/network/status
  router.get('/api/network/status', (_req: Request, res: Response) => {
    res.json({ success: true, data: state });
  });

  // GET /api/network/stream — SSE
  router.get('/api/network/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'network_status', ...state })}\n\n`);

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // POST /api/network/speedtest — FIX NEW-2 + NEW-3
  router.post('/api/network/speedtest', async (_req: Request, res: Response) => {
    // FIX NEW-3: if background poll is mid-flight, wait briefly rather than
    // writing state concurrently. Simple approach: reject with 429.
    if (isPolling) {
      // Poll will finish within a few seconds — tell client to retry
      res.status(429).json({
        success: false,
        error: 'Background check in progress — try again in a moment',
        retryAfterMs: 3000,
      });
      return;
    }

    try {
      const [{ latencies, lossPercent }, downloadMbps] = await Promise.all([
        multiPing(),
        measureDownloadSpeed(10_000),
      ]);

      const isOnline   = latencies.length > 0;
      const avgLatency = isOnline
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;
      const jitter     = calculateJitter(latencies);
      const quality    = gradeQuality(isOnline, avgLatency, lossPercent);

      // FIX NEW-2: use isolated alert generator — does NOT corrupt previousQuality
      const alert = generateAlertForSpeedtest(quality);

      state = {
        ...state,
        isOnline,
        quality,
        downloadMbps,
        latencyMs: avgLatency,
        jitterMs: jitter,
        packetLoss: lossPercent,
        lastChecked: new Date().toISOString(),
        consecutiveFailures: isOnline ? 0 : state.consecutiveFailures + 1,
        alert,
      };

      if (alert) broadcast({ type: 'network_alert', ...state });

      res.json({ success: true, data: state });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message ?? 'Speed test failed' });
    }
  });
}
