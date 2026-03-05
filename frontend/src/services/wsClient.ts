// frontend/src/services/wsClient.ts

type Callback = (data: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Callback>>();
  private url = `ws://${window.location.hostname}:3001/ws`;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('✅ WS connected to api-server');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      // Re-subscribe to all active subscriptions after reconnect
      const keys = Array.from(this.listeners.keys());
      if (keys.length) this.ws!.send(JSON.stringify({ action: 'subscribe', keys }));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        // Fire callbacks for this specific key AND for 'ALL' listeners
        this.listeners.get(`${msg.type}:${msg.token || msg.key || msg.symbol}`)
          ?.forEach(cb => cb(msg));
        this.listeners.get('ALL')?.forEach(cb => cb(msg));
      } catch {}
    };

    this.ws.onclose = () => {
      console.warn('WS disconnected — reconnecting in 2s');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
  }

  // Subscribe to specific tick: key = 'tick:TOKEN123'
  // Subscribe to chain: key = 'chain:NIFTY_2025-03-06'
  // Subscribe to everything: key = 'ALL'
  on(key: string, cb: Callback): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
      this.ws?.send(JSON.stringify({ action: 'subscribe', keys: [key] }));
    }
    this.listeners.get(key)!.add(cb);
    return () => {
      this.listeners.get(key)?.delete(cb);
      if (this.listeners.get(key)?.size === 0) this.listeners.delete(key);
    };
  }

  disconnect(): void { this.ws?.close(); }
}

export const wsClient = new WsClient();
wsClient.connect(); // Auto-connect when imported