/**
 * AngelOneAdapter.ts — JOBBER PRO
 *
 * ════ FIXES APPLIED ════════════════════════════════════════════════════════
 *  FIX 1: Token refresh before every reconnect (session expiry → data stops)
 *  FIX 2: Re-subscribe all tokens after WebSocket reconnects
 *  FIX 3: Proper Angel One BINARY protocol parser (JSON.parse killed all ticks)
 *  FIX 4: No hard reconnect limit — retries forever with exponential backoff
 *  FIX 5: lastHeartbeat initialized to Date.now() (was 0 → disconnect in 30s)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { SecurityManager } from './SecurityManager';
import * as Sentry from '@sentry/electron/main';

export interface AngelCredentials {
  clientId: string;
  password: string;
  totp: string;
}

export interface AngelProfile {
  clientId: string;
  name: string;
  email: string;
  mobile: string;
  exchanges: string[];
  products: string[];
}

export interface MarketTick {
  symbol: string;
  token: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  lastTradeTime: number;
  oi?: number;
  bidPrice?: number;
  bidQty?: number;
  askPrice?: number;
  askQty?: number;
}

export interface OptionQuote {
  symbol: string;
  strikePrice: number;
  optionType: 'CE' | 'PE';
  expiryDate: string;
  ltp: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

// ─── Angel One binary tick mode sizes ────────────────────────────────────────
// Mode 1 (LTP):        8  bytes  → token(25) + ltp(4)  [simplified]
// Mode 2 (QUOTE):      44 bytes
// Mode 3 (SNAP_QUOTE): 184 bytes
// The header is always the first byte: subscription type + exchange segment
const ANGEL_HEADER_SIZE = 1;
const TICK_MODE_LTP        = 1;
const TICK_MODE_QUOTE      = 2;
const TICK_MODE_SNAP_QUOTE = 3;

export class AngelOneAdapter extends EventEmitter {
  private static instance: AngelOneAdapter;
  private securityManager: SecurityManager;
  private api: AxiosInstance;
  private ws: WebSocket | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private feedToken: string | null = null;
  private clientId: string | null = null;          // ← store for re-login
  private password: string | null = null;           // ← store for re-login
  private isConnected = false;
  private isReconnecting = false;
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  // ✅ FIX 4: No hard MAX — removed MAX_RECONNECT_ATTEMPTS cap
  //           Uses capped exponential backoff instead (max 30s)
  private readonly RECONNECT_BASE_DELAY = 1000;
  private readonly RECONNECT_MAX_DELAY  = 30_000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  // ✅ FIX 5: Initialize to Date.now() so the first 30s check doesn't fire
  private lastHeartbeat: number = Date.now();
  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly BASE_URL = 'https://apiconnect.angelbroking.com';
  private readonly WS_URL   = 'wss://smartapisocket.angelone.in/smart-stream';

  private constructor() {
    super();
    this.securityManager = SecurityManager.getInstance();

    this.api = axios.create({
      baseURL: this.BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.setupAxiosInterceptors();
  }

  static getInstance(): AngelOneAdapter {
    if (!AngelOneAdapter.instance) {
      AngelOneAdapter.instance = new AngelOneAdapter();
    }
    return AngelOneAdapter.instance;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AXIOS INTERCEPTORS
  // ──────────────────────────────────────────────────────────────────────────
  private setupAxiosInterceptors(): void {
    this.api.interceptors.request.use(
      (config) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
          config.headers['X-ClientLocalIP']  = this.getLocalIP();
          config.headers['X-ClientPublicIP'] = this.getPublicIP();
          config.headers['X-MACAddress']     = this.getMacAddress();
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        Sentry.captureException(error);
        return Promise.reject(error);
      },
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────────────────────
  async login(credentials: AngelCredentials): Promise<AngelProfile> {
    try {
      const response = await this.api.post(
        '/rest/auth/angelbroking/user/v1/loginByPassword',
        {
          clientcode: credentials.clientId,
          password:   credentials.password,
          totp:       credentials.totp,
        },
      );

      if (!response.data.status) {
        throw new Error(response.data.message || 'Login failed');
      }

      const { jwtToken, refreshToken, feedToken } = response.data.data;

      this.accessToken  = jwtToken;
      this.refreshToken = refreshToken;
      this.feedToken    = feedToken;

      // ✅ FIX 1: Store plain credentials so refreshSession() can re-login
      this.clientId = credentials.clientId;
      this.password = credentials.password;
      // Note: TOTP is time-based — refreshSession() generates a fresh one

      // Store tokens securely
      await this.securityManager.storeCredential(`angel-access-${credentials.clientId}`,  jwtToken);
      await this.securityManager.storeCredential(`angel-refresh-${credentials.clientId}`, refreshToken);
      await this.securityManager.storeCredential(`angel-feed-${credentials.clientId}`,    feedToken);

      const profile = await this.getProfile();
      this.emit('login', profile);
      return profile;
    } catch (error: any) {
      Sentry.captureException(error);
      throw new Error(error.response?.data?.message || error.message || 'Login failed');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ FIX 1: SESSION REFRESH — called before every reconnect attempt
  //   Uses Angel One's refresh-token endpoint first.
  //   Falls back to full re-login with a fresh TOTP if refresh fails.
  // ──────────────────────────────────────────────────────────────────────────
  private async refreshSession(): Promise<boolean> {
    // --- Try refresh-token flow first ---
    if (this.refreshToken) {
      try {
        const res = await this.api.post(
          '/rest/secure/angelbroking/jwt/v1/generateTokens',
          { refreshToken: this.refreshToken },
        );
        if (res.data.status && res.data.data?.jwtToken) {
          this.accessToken  = res.data.data.jwtToken;
          this.refreshToken = res.data.data.refreshToken ?? this.refreshToken;
          this.feedToken    = res.data.data.feedToken    ?? this.feedToken;
          console.log('✅ Angel One session refreshed via refresh-token');
          return true;
        }
      } catch (e) {
        console.warn('⚠️  Refresh-token failed, falling back to full re-login:', e);
      }
    }

    // --- Full re-login with fresh TOTP ---
    if (!this.clientId || !this.password) {
      console.error('❌ refreshSession: no stored credentials — cannot re-login');
      return false;
    }

    try {
      // Generate a fresh TOTP from the stored secret (requires totp-generator)
      // The TOTP secret must be stored securely. Retrieve it here:
      const totpSecret = await this.securityManager.getCredential(
        `angel-totp-secret-${this.clientId}`,
      ).catch(() => null);

      let freshTotp = '';
      if (totpSecret) {
        // Use the same TOTP library your app already uses
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const totpGenerator = require('totp-generator');
        freshTotp = totpGenerator(totpSecret);
      } else {
        console.error('❌ refreshSession: TOTP secret not stored — cannot re-login');
        return false;
      }

      await this.login({ clientId: this.clientId, password: this.password, totp: freshTotp });
      console.log('✅ Angel One session re-established via full re-login');
      return true;
    } catch (e: any) {
      console.error('❌ refreshSession: full re-login failed:', e.message);
      Sentry.captureException(e);
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET PROFILE
  // ──────────────────────────────────────────────────────────────────────────
  async getProfile(): Promise<AngelProfile> {
    try {
      const response = await this.api.get(
        '/rest/secure/angelbroking/user/v1/getProfile',
      );
      if (!response.data.status) {
        throw new Error(response.data.message || 'Failed to get profile');
      }
      return {
        clientId: response.data.data.clientcode,
        name:     response.data.data.name,
        email:    response.data.data.email,
        mobile:   response.data.data.mobileno,
        exchanges: response.data.data.exchanges,
        products:  response.data.data.products,
      };
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to get profile');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────────────────────
  async logout(): Promise<void> {
    try {
      if (this.accessToken && this.clientId) {
        await this.api.post('/rest/secure/angelbroking/user/v1/logout', {
          clientcode: this.clientId,
        });
      }
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      this.disconnectWebSocket();
      this.accessToken  = null;
      this.refreshToken = null;
      this.feedToken    = null;
      this.emit('logout');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONNECT WEBSOCKET
  // ──────────────────────────────────────────────────────────────────────────
  async connectWebSocket(): Promise<void> {
    if (this.ws && this.isConnected) {
      console.log('WebSocket already connected');
      return;
    }

    if (!this.feedToken) {
      throw new Error('Feed token not available. Please login first.');
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.WS_URL, {
          headers: {
            Authorization: `Bearer ${this.feedToken}`,
            'x-api-key':   this.accessToken || '',
          },
        });

        this.ws.on('open', () => {
          console.log('✅ WebSocket connected to Angel One');
          this.isConnected      = true;
          this.isReconnecting   = false;
          this.reconnectAttempts = 0;
          // ✅ FIX 5: Reset heartbeat timestamp on every fresh connection
          this.lastHeartbeat = Date.now();
          this.startHeartbeat();
          this.emit('connected');

          // ✅ FIX 2: Re-subscribe all tokens after reconnect
          if (this.subscriptions.size > 0) {
            const tokens = Array.from(this.subscriptions);
            console.log(`🔄 Re-subscribing ${tokens.length} tokens after reconnect`);
            this.resubscribeAll().catch(e =>
              console.error('Re-subscribe error:', e),
            );
          }

          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleWebSocketMessage(data);
        });

        // Handle WebSocket-level pong frames (keeps lastHeartbeat fresh)
        this.ws.on('pong', () => {
          this.lastHeartbeat = Date.now();
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          Sentry.captureException(error);
          this.emit('error', error);
          if (!this.isConnected) reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.warn(`⚠️  WebSocket closed — code=${code} reason=${reason?.toString()}`);
          this.isConnected = false;
          this.stopHeartbeat();
          this.emit('disconnected');
          this.scheduleReconnect();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DISCONNECT WEBSOCKET
  // ──────────────────────────────────────────────────────────────────────────
  disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected    = false;
    this.isReconnecting = false;
    this.subscriptions.clear();
    this.stopHeartbeat();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ FIX 4: RECONNECT — no hard limit, retries forever
  // ✅ FIX 1: Refreshes session token BEFORE each reconnect attempt
  // ──────────────────────────────────────────────────────────────────────────
  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    this.isReconnecting = true;

    const delay = Math.min(
      this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      this.RECONNECT_MAX_DELAY,
    );
    this.reconnectAttempts++;

    console.log(
      `🔄 Scheduling reconnect in ${delay}ms (attempt #${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.isReconnecting = false;

      // ✅ FIX 1: Refresh the Angel One session before reconnecting
      console.log('🔑 Refreshing Angel One session before reconnect...');
      const refreshed = await this.refreshSession();
      if (!refreshed) {
        console.error('❌ Session refresh failed — will retry reconnect anyway');
        // Still try — maybe it's a transient API error, not token expiry
      }

      this.connectWebSocket().catch(error => {
        console.error('❌ Reconnect failed:', error.message);
        // scheduleReconnect() will be called again by the 'close' event
      });
    }, delay);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ FIX 2: RE-SUBSCRIBE ALL SAVED TOKENS
  // ──────────────────────────────────────────────────────────────────────────
  private async resubscribeAll(): Promise<void> {
    if (!this.isConnected || !this.ws || this.subscriptions.size === 0) return;

    const tokens = Array.from(this.subscriptions);
    const action = 1; // Subscribe
    const modeValue = 3; // SNAP_QUOTE — full data

    const msg = {
      action,
      params: {
        mode: modeValue,
        tokenList: [{ exchangeType: 2, tokens }], // 2 = NFO
      },
    };

    this.ws.send(JSON.stringify(msg));
    console.log(`✅ Re-subscribed ${tokens.length} tokens`);
    this.emit('resubscribed', tokens);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUBSCRIBE
  // ──────────────────────────────────────────────────────────────────────────
  async subscribe(
    tokens: string[],
    mode: 'LTP' | 'QUOTE' | 'SNAP_QUOTE' = 'QUOTE',
  ): Promise<void> {
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket not connected');
    }

    const modeValue = mode === 'LTP' ? 1 : mode === 'QUOTE' ? 2 : 3;

    const subscribeMessage = {
      action: 1,
      params: {
        mode: modeValue,
        tokenList: [{ exchangeType: 2, tokens }],
      },
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    tokens.forEach(token => this.subscriptions.add(token));
    this.emit('subscribed', tokens);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UNSUBSCRIBE
  // ──────────────────────────────────────────────────────────────────────────
  async unsubscribe(tokens: string[]): Promise<void> {
    if (!this.isConnected || !this.ws) return;

    const unsubscribeMessage = {
      action: 0,
      params: {
        mode: 2,
        tokenList: [{ exchangeType: 2, tokens }],
      },
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));
    tokens.forEach(token => this.subscriptions.delete(token));
    this.emit('unsubscribed', tokens);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ FIX 3: BINARY PROTOCOL PARSER
  //
  // Angel One SmartAPI WebSocket binary format (SNAP_QUOTE mode 3):
  //   Byte  0      : subscription_type (1=LTP, 2=QUOTE, 3=SNAP_QUOTE)
  //   Byte  1      : exchange_type
  //   Bytes 2–26   : token (25 bytes, ASCII padded with nulls)
  //   Bytes 27–30  : sequence_number (Int32BE)
  //   Bytes 31–38  : exchange_timestamp (Int64BE ms)
  //   Bytes 39–42  : ltp (Int32BE, divide by 100)
  //   Bytes 43–46  : last_traded_qty (Int32BE)
  //   Bytes 47–50  : avg_traded_price (Int32BE, divide by 100)
  //   Bytes 51–54  : volume (Int32BE)
  //   Bytes 55–62  : total_buy_qty (Int64BE)
  //   Bytes 63–70  : total_sell_qty (Int64BE)
  //   Bytes 71–74  : open (Int32BE, /100)
  //   Bytes 75–78  : high (Int32BE, /100)
  //   Bytes 79–82  : low  (Int32BE, /100)
  //   Bytes 83–86  : close (Int32BE, /100)
  //   --- additional fields in SNAP_QUOTE (184 bytes total) ---
  //   Bytes 87–90  : last_trade_time (Int32BE, unix seconds)
  //   Bytes 91–94  : OI (Int32BE)
  //   Bytes 95–98  : OI_day_high (Int32BE)
  //   Bytes 99–102 : OI_day_low (Int32BE)
  //   Bytes 103–106: upper_circuit (Int32BE, /100)
  //   Bytes 107–110: lower_circuit (Int32BE, /100)
  //   Bytes 111–118: week52High (Int64BE, /100)
  //   Bytes 119–126: week52Low  (Int64BE, /100)
  //   Bytes 127–130: bid_price (Int32BE, /100)
  //   Bytes 131–134: bid_qty (Int32BE)
  //   Bytes 135–138: ask_price (Int32BE, /100)
  //   Bytes 139–142: ask_qty (Int32BE)
  // ──────────────────────────────────────────────────────────────────────────
  private handleWebSocketMessage(data: Buffer): void {
    try {
      // Angel One also sends JSON text frames for handshake/errors
      if (data[0] === 0x7b /* '{' */ || data[0] === 0x5b /* '[' */) {
        const text = data.toString('utf8');
        let json: any;
        try { json = JSON.parse(text); } catch { return; }

        // Heartbeat JSON frame
        if (json.type === 'heartbeat' || json.type === 'pong') {
          this.lastHeartbeat = Date.now();
          return;
        }
        // Error frame
        if (json.type === 'error') {
          console.error('Angel One WS error frame:', json.message || json);
          this.emit('error', new Error(json.message || 'Angel One WS error'));
          return;
        }
        return;
      }

      // Binary frame — minimum valid size is 43 bytes (LTP mode)
      if (!Buffer.isBuffer(data) || data.length < 43) return;

      const subscriptionType = data.readUInt8(0);   // 1=LTP 2=QUOTE 3=SNAP

      // Token: bytes 2–26 (25 bytes), ASCII, null-padded
      const tokenRaw = data.slice(2, 27).toString('ascii').replace(/\0/g, '').trim();

      // LTP: bytes 39–42
      const ltp = data.readInt32BE(39) / 100;

      if (ltp <= 0 || !tokenRaw) return;

      const tick: any = {
        token:  tokenRaw,
        symbol: tokenRaw,
        ltp,
        timestamp: Date.now(),
      };

      if (subscriptionType >= TICK_MODE_QUOTE && data.length >= 87) {
        tick.volume = data.readInt32BE(51);
        tick.open   = data.readInt32BE(71) / 100;
        tick.high   = data.readInt32BE(75) / 100;
        tick.low    = data.readInt32BE(79) / 100;
        tick.close  = data.readInt32BE(83) / 100;
      }

      if (subscriptionType >= TICK_MODE_SNAP_QUOTE && data.length >= 143) {
        tick.lastTradeTime = data.readInt32BE(87);
        tick.oi            = data.readInt32BE(91);
        tick.oiDayHigh     = data.readInt32BE(95);
        tick.oiDayLow      = data.readInt32BE(99);
        tick.bidPrice      = data.readInt32BE(127) / 100;
        tick.bidQty        = data.readInt32BE(131);
        tick.askPrice      = data.readInt32BE(135) / 100;
        tick.askQty        = data.readInt32BE(139);
      }

      // Update heartbeat on any binary data (Angel One sends data instead of pings)
      this.lastHeartbeat = Date.now();

      this.emit('tick', tick);
    } catch (error) {
      // Only log parse errors, do NOT re-throw (keeps socket alive)
      console.error('❌ Binary parse error:', (error as Error).message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HEARTBEAT
  // ──────────────────────────────────────────────────────────────────────────
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || !this.isConnected) return;

      const silence = Date.now() - this.lastHeartbeat;

      // ✅ FIX 5: Only disconnect if silent for >90s (Angel One sends data ~every second)
      if (silence > 90_000) {
        console.warn(`⚠️  No data for ${Math.round(silence / 1000)}s — forcing reconnect`);
        this.ws.terminate();
        // 'close' event will fire → scheduleReconnect()
        return;
      }

      // Send WebSocket ping to keep the TCP connection alive
      try { this.ws.ping(); } catch (_) {}
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REST: GET LTP
  // ──────────────────────────────────────────────────────────────────────────
  async getLTP(exchange: string, symbol: string, token: string): Promise<number> {
    try {
      const response = await this.api.post(
        '/rest/secure/angelbroking/market/v1/quote/',
        { mode: 'LTP', exchangeTokens: { [exchange]: [token] } },
      );
      if (!response.data.status) {
        throw new Error(response.data.message || 'Failed to get LTP');
      }
      return response.data.data.fetched[0].ltp;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to get LTP');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATUS
  // ──────────────────────────────────────────────────────────────────────────
  getConnectionStatus(): {
    isConnected: boolean;
    subscriptions: number;
    reconnectAttempts: number;
    lastHeartbeatAgo: number;
  } {
    return {
      isConnected:      this.isConnected,
      subscriptions:    this.subscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeatAgo: Math.round((Date.now() - this.lastHeartbeat) / 1000),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────
  getClientId(): string { return this.clientId ?? ''; }

  private getLocalIP(): string  { return '127.0.0.1'; }
  private getPublicIP(): string  { return ''; }
  private getMacAddress(): string { return ''; }
}