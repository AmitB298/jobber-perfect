/**
 * spoofing-dashboard-ws.ts — Live Spoofing Alert WebSocket Server (port 8765)
 * Location: D:\jobber-perfect\backend\src\services\spoofing-dashboard-ws.ts
 *
 * TypeScript port of dashboard_server.py from the Python spoofing package.
 * Broadcasts AlertPayload objects to all connected React dashboard tabs.
 *
 * ARCHITECTURE:
 *   websocket-collector.ts
 *     → spoofingDetector.onAlert(routeSpoofAlert)
 *     → routeSpoofAlert()            [alert-router.ts]
 *     → _wsBroadcast()               [registered here via registerWsBroadcast]
 *     → buildTextFrame() + socket.write() → each connected browser tab
 *
 * WHY SEPARATE FROM SSE:
 *   SSE stream (/api/stream/chain) carries full option chain + Greeks.
 *   This WebSocket carries ONLY spoof alerts — independent channel, same design
 *   as the Python package (dashboard_server.py on port 8765).
 *
 * NO EXTERNAL DEPENDENCIES:
 *   Only Node.js built-in modules: http, net, crypto.
 *
 * ENV VARS:
 *   SPOOF_WS_PORT=8765   (default — matches Python DASHBOARD_WS_PORT)
 */

import * as http   from 'http';
import * as net    from 'net';
import * as crypto from 'crypto';
import { AlertPayload, registerWsBroadcast } from './alert-router';

const WS_PORT = parseInt(process.env.SPOOF_WS_PORT || '8765');

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT REGISTRY
// We store the full socket reference so we can check .writable before writing.
// ─────────────────────────────────────────────────────────────────────────────

interface WsClient {
  id:     string;
  socket: net.Socket;
}

const clients          = new Set<WsClient>();
let   totalConnections = 0;
let   totalBroadcasts  = 0;
let   wsServer: http.Server | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// RFC 6455 FRAME BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/** Build a WebSocket text frame (FIN=1, opcode=0x01). Handles all 3 length ranges. */
function buildTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len     = payload.length;

  let header: Buffer;
  if (len < 126) {
    header    = Buffer.allocUnsafe(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header    = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header    = Buffer.allocUnsafe(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const PING_FRAME  = Buffer.from([0x89, 0x00]); // WS ping frame
const PONG_FRAME  = Buffer.from([0x8A, 0x00]); // WS pong frame
const CLOSE_FRAME = Buffer.from([0x88, 0x00]); // WS close frame

// ─────────────────────────────────────────────────────────────────────────────
// SAFE WRITE
// Always checks socket.writable before writing.
// Returns false if socket is dead — caller removes from registry.
// ─────────────────────────────────────────────────────────────────────────────

function safeWrite(socket: net.Socket, data: Buffer): boolean {
  if (socket.destroyed || !socket.writable) return false;
  try {
    socket.write(data);
    return true;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST — mirrors Python dashboard_server.broadcast()
// Called from alert-router.ts for every WATCH / ALERT / CRITICAL event.
// ─────────────────────────────────────────────────────────────────────────────

export function broadcastToWS(payload: AlertPayload): void {
  if (clients.size === 0) return;

  const frame = buildTextFrame(JSON.stringify(payload));
  const dead: WsClient[] = [];

  for (const client of clients) {
    if (safeWrite(client.socket, frame)) {
      totalBroadcasts++;
    } else {
      dead.push(client);
    }
  }

  for (const d of dead) {
    clients.delete(d);
    if (!d.socket.destroyed) {
      try { d.socket.destroy(); } catch (_) {}
    }
  }
}

export function getWsStats() {
  return { connectedClients: clients.size, totalConnections, totalBroadcasts, port: WS_PORT };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDSHAKE — RFC 6455 Sec-WebSocket-Accept key derivation
// ─────────────────────────────────────────────────────────────────────────────

function computeAcceptKey(clientKey: string): string {
  return crypto
    .createHash('sha1')
    .update(clientKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// INCOMING FRAME HANDLER
// The browser may send close / ping / pong frames.
// We must consume incoming data so the socket buffer never fills.
// We do NOT need to parse alert data from the browser — this is a send-only server.
// ─────────────────────────────────────────────────────────────────────────────

function handleIncomingFrame(
  socket: net.Socket,
  client: WsClient,
  pingTimer: NodeJS.Timeout,
  chunk: Buffer
): void {
  if (chunk.length < 2) return;

  const opcode = chunk[0] & 0x0f;

  switch (opcode) {
    case 0x08: // Close frame — browser disconnecting cleanly
      clearInterval(pingTimer);
      clients.delete(client);
      safeWrite(socket, CLOSE_FRAME); // echo close frame back (RFC 6455 §5.5.1)
      socket.destroy();
      break;

    case 0x09: // Ping from browser — send pong back
      safeWrite(socket, PONG_FRAME);
      break;

    case 0x0A: // Pong — browser responded to our ping. No action needed.
      break;

    // All other frames (text 0x01, binary 0x02, continuation 0x00):
    // We don't expect these from the browser, silently ignore.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER — mirrors Python start_server()
// Call ONCE from websocket-collector.ts main() before the reconnect loop.
// ─────────────────────────────────────────────────────────────────────────────

export function startSpoofDashboardWS(): void {

  // Register broadcastToWS with alert-router so it can call us.
  // This avoids a circular import: alert-router ← → dashboard-ws.
  registerWsBroadcast(broadcastToWS);

  wsServer = http.createServer((_req, res) => {
    // Plain HTTP health check — useful for monitoring and quick sanity checks
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'spoof-dashboard-ws',
      ok: true, port: WS_PORT,
      clients: clients.size, totalConnections, totalBroadcasts,
    }));
  });

  // WebSocket upgrade handler
  wsServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, _head: Buffer) => {

    // Reject non-WebSocket upgrades
    if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const clientKey = req.headers['sec-websocket-key'];
    if (typeof clientKey !== 'string' || !clientKey) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // ── TCP configuration — critical for low latency ──────────────────────
    // setNoDelay(true): disable Nagle's algorithm.
    //   Without this, the OS may buffer small frames for up to 40ms before sending.
    //   For a spoofing alert system, 40ms is unacceptable.
    socket.setNoDelay(true);

    // setKeepAlive: detect dead connections without waiting for timeout
    socket.setKeepAlive(true, 10_000);

    // ── Complete RFC 6455 handshake ───────────────────────────────────────
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${computeAcceptKey(clientKey)}\r\n` +
      '\r\n'
    );

    const clientId = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? Date.now()}`;
    const client: WsClient = { id: clientId, socket };

    clients.add(client);
    totalConnections++;
    process.stdout.write(`📡 [SpoofWS] + ${clientId}  (active=${clients.size})\n`);

    // ── Welcome frame ─────────────────────────────────────────────────────
    safeWrite(socket, buildTextFrame(JSON.stringify({
      type: 'connected', message: 'Spoof detection feed active',
      clients: clients.size, ts: Date.now(),
    })));

    // ── Keepalive ping every 30s ──────────────────────────────────────────
    // Mirrors Python's implicit keepalive from the websockets library.
    // If the ping fails (socket gone), we remove the client immediately.
    const pingTimer = setInterval(() => {
      if (!clients.has(client)) { clearInterval(pingTimer); return; }
      if (!safeWrite(socket, PING_FRAME)) {
        clearInterval(pingTimer);
        clients.delete(client);
      }
    }, 30_000);

    // ── Incoming data handler ─────────────────────────────────────────────
    socket.on('data', (chunk: Buffer) => {
      handleIncomingFrame(socket, client, pingTimer, chunk);
    });

    // ── Cleanup on socket close ───────────────────────────────────────────
    socket.on('close', () => {
      clearInterval(pingTimer);
      clients.delete(client);
      process.stdout.write(`📡 [SpoofWS] - ${clientId}  (active=${clients.size})\n`);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      clearInterval(pingTimer);
      clients.delete(client);
      // ECONNRESET is normal (browser tab closed without clean WS close)
      if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
        process.stderr.write(`📡 [SpoofWS] Socket error (${clientId}): ${err.message}\n`);
      }
    });
  });

  // ── Server-level error handling ───────────────────────────────────────────
  wsServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `📡 [SpoofWS] ❌ Port ${WS_PORT} already in use.\n` +
        `   → Add SPOOF_WS_PORT=8766 to .env to use a different port.\n`
      );
    } else {
      process.stderr.write(`📡 [SpoofWS] Server error: ${err.message}\n`);
    }
  });

  wsServer.listen(WS_PORT, '0.0.0.0', () => {
    process.stdout.write(`📡 [SpoofWS] Listening  →  ws://0.0.0.0:${WS_PORT}\n`);
    process.stdout.write(`📡 [SpoofWS] Health     →  http://localhost:${WS_PORT}/\n`);
  });
}
