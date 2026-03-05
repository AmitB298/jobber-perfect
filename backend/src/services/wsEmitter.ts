// backend/src/services/wsEmitter.ts
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

interface WsClient {
  ws: WebSocket;
  subs: Set<string>; // subscribed keys like 'tick:26000CE' or 'chain:NIFTY_2025-03-06'
}

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
          const msg = JSON.parse(raw.toString());
          const client = this.clients.get(id);
          if (!client) return;
          if (msg.action === 'subscribe')   msg.keys.forEach((k: string) => client.subs.add(k));
          if (msg.action === 'unsubscribe') msg.keys.forEach((k: string) => client.subs.delete(k));
        } catch {}
      });

      ws.on('close', () => this.clients.delete(id));
      ws.send(JSON.stringify({ type: 'connected', id }));
    });

    console.log(`✅ WsEmitter attached on /ws`);
  }

  // Push a single tick update
  emitTick(token: string, data: object): void {
    this._broadcast(`tick:${token}`, { type: 'tick', token, data });
  }

  // Push full option chain rebuild
  emitChain(key: string, chain: object[]): void {
    this._broadcast(`chain:${key}`, { type: 'chain', key, chain });
  }

  // Push spot price
  emitSpot(symbol: string, ltp: number): void {
    this._broadcast('ALL', { type: 'spot', symbol, ltp, ts: Date.now() });
  }

  private _broadcast(key: string, payload: object): void {
    const msg = JSON.stringify(payload);
    this.clients.forEach(({ ws, subs }) => {
      if ((subs.has(key) || subs.has('ALL')) && ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  }

  clientCount(): number { return this.clients.size; }
}

export const wsEmitter = new WsEmitter();