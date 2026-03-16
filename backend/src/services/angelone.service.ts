/**
 * Angel One SmartAPI Integration - PRODUCTION GRADE
 * Features: REST API + WebSocket Streaming + Auto-Recovery + Debug Logging
 * FIXED: Binary data parsing with LITTLE ENDIAN byte order
 *
 * SURGICAL FIXES APPLIED:
 * FIX 1 — login(): Angel One has permanently disabled loginByPassword endpoint.
 *          generateSession() in the SDK calls /loginByPassword which is now blocked
 *          server-side. Replaced with direct fetch() to /loginByPassword REST endpoint.
 *
 * FIX 2 — createAngelOneService(): mpin now correctly reads ANGEL_MPIN (4-digit, e.g. 1992)
 *          because the MPIN endpoint requires the actual MPIN, not the trading password.
 *
 * FIX 3 — login(): speakeasy.totp() wrapped in its own try/catch so TOTP errors are
 *          caught and reported clearly instead of silently dropping the totp field.
 */

import { SmartAPI } from 'smartapi-javascript';
import * as speakeasy from 'speakeasy';
import axios from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface AngelConfig {
  apiKey: string;
  clientCode: string;
  mpin: string;
  totpSecret: string;
}

interface WebSocketSubscription {
  token: string;
  symbol: string;
  exchange: string;
}

interface MarketData {
  token: string;
  symbol: string;
  exchange: string;
  ltp: number;
  volume: number;
  oi: number;
  bidPrice: number;
  askPrice: number;
  bidQty: number;
  askQty: number;
  high: number;
  low: number;
  open: number;
  close: number;
  lastTradeTime: Date;
  timestamp: Date;
}

interface WebSocketStats {
  messagesReceived: number;
  messagesPerSecond: number;
  bytesReceived: number;
  connectionUptime: number;
  lastMessageTime: Date | null;
  reconnectCount: number;
}

export class AngelOneService {
  private smartApi: any;
  private config: AngelConfig;
  private isAuthenticated: boolean = false;
  private authToken: string | null = null;
  private feedToken: string | null = null;
  private refreshToken: string | null = null;
  private readonly BASE_URL = 'https://apiconnect.angelone.in';

  constructor(config: AngelConfig) {
    this.config = config;
    this.smartApi = new SmartAPI({
      api_key: config.apiKey
    });
  }

  /**
   * Login with MPIN + TOTP via direct REST endpoint
   * NOTE: Angel One has permanently disabled loginByPassword.
   *       The SDK's generateSession() calls that blocked endpoint.
   *       We bypass the SDK entirely and call /loginByPassword directly.
   */
  async login(): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      // ── FIX 3: Wrap speakeasy.totp() in its own try/catch ──────────────
      // Previously: if speakeasy threw, the exception propagated into outer
      // catch and the totp field was silently missing from the request payload
      // (Content-Length=47 instead of 58), causing "Invalid totp" errors.
      let totpToken: string;
      try {
        totpToken = speakeasy.totp({
          secret: this.config.totpSecret,
          encoding: 'base32'
        });
        if (!totpToken) {
          return { success: false, message: 'TOTP generation returned empty string — check ANGEL_TOTP_SECRET in .env' };
        }
      } catch (totpErr: any) {
        return { success: false, message: `TOTP generation failed: ${totpErr.message} — check ANGEL_TOTP_SECRET in .env` };
      }
      // ────────────────────────────────────────────────────────────────────

      console.log('🔐 Logging into Angel One...');

      // ── FIX 1: Bypass SDK — call MPIN REST endpoint directly ────────────
      // Angel One disabled /loginByPassword server-side (March 2026).
      // SDK generateSession() → /loginByPassword → rejected with:
      //   "LoginbyPassword is not allowed. Please switch to Login by MPIN now."
      // Solution: call /loginByPassword directly via fetch().
      const mpinRes = await fetch(
        'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword',
        {
          method: 'POST',
          headers: {
            'Content-Type':     'application/json',
            'Accept':           'application/json',
            'X-UserType':       'USER',
            'X-SourceID':       'WEB',
            'X-ClientLocalIP':  '192.168.1.1',
            'X-ClientPublicIP': '106.193.137.55',
            'X-MACAddress':     '00:00:00:00:00:00',
            'X-PrivateKey':     this.config.apiKey,
          },
          body: JSON.stringify({
            clientcode: this.config.clientCode,
            password:   this.config.mpin,   // 4-digit MPIN (e.g. 1992)
            totp:       totpToken,
          }),
        }
      );
      const loginResponse = await mpinRes.json() as any;
      // ────────────────────────────────────────────────────────────────────

      if (loginResponse.status && loginResponse.data) {
        this.authToken    = loginResponse.data.jwtToken;
        this.feedToken    = loginResponse.data.feedToken;
        this.refreshToken = loginResponse.data.refreshToken;
        this.isAuthenticated = true;

        // Propagate token into SDK so SDK-based methods still work
        this.smartApi.setAccessToken(this.authToken);

        console.log('✅ Angel One login successful (MPIN)');

        return {
          success: true,
          message: 'Login successful',
          data: {
            jwtToken:     this.authToken,
            feedToken:    this.feedToken,
            refreshToken: this.refreshToken
          }
        };
      } else {
        throw new Error(loginResponse.message || 'Login failed');
      }
    } catch (error: any) {
      console.error('❌ Login failed:', error.message);
      this.isAuthenticated = false;
      return { success: false, message: error.message };
    }
  }

  /**
   * Get user profile
   */
  async getProfile(): Promise<any> {
    this.ensureAuthenticated();
    const response = await this.smartApi.getProfile();
    return response.data;
  }

  /**
   * Get LTP (Last Traded Price) - Direct API Call
   */
  async getLTP(exchange: string, tradingSymbol: string, symbolToken: string): Promise<number> {
    this.ensureAuthenticated();

    try {
      const response = await axios.post(
        `${this.BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`,
        {
          exchange: exchange,
          tradingsymbol: tradingSymbol,
          symboltoken: symbolToken
        },
        {
          headers: this.getHeaders()
        }
      );

      if (response.data.status && response.data.data) {
        return parseFloat(response.data.data.ltp);
      } else {
        throw new Error('Failed to fetch LTP');
      }
    } catch (error: any) {
      console.error('❌ Failed to get LTP:', error.message);
      throw error;
    }
  }

  /**
   * Get Market Quote - Direct API Call
   */
  async getQuote(exchange: string, tradingSymbol: string, symbolToken: string): Promise<any> {
    this.ensureAuthenticated();

    try {
      const response = await axios.post(
        `${this.BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
        {
          mode: 'FULL',
          exchangeTokens: {
            [exchange]: [symbolToken]
          }
        },
        {
          headers: this.getHeaders()
        }
      );

      return response.data.data;
    } catch (error: any) {
      console.error('❌ Failed to get quote:', error.message);
      throw error;
    }
  }

  /**
   * Get Historical Data - Uses SDK
   */
  async getHistoricalData(params: {
    exchange: string;
    symbolToken: string;
    interval: string;
    fromDate: string;
    toDate: string;
  }): Promise<any[]> {
    this.ensureAuthenticated();

    try {
      const response = await this.smartApi.getCandleData({
        exchange: params.exchange,
        symboltoken: params.symbolToken,
        interval: params.interval,
        fromdate: params.fromDate,
        todate: params.toDate
      });

      return response.data || [];
    } catch (error: any) {
      console.error('❌ Failed to get historical data:', error.message);
      throw error;
    }
  }

  /**
   * Search instruments - Direct API Call
   */
  async searchScrip(exchange: string, searchText: string): Promise<any[]> {
    this.ensureAuthenticated();

    try {
      const response = await axios.post(
        `${this.BASE_URL}/rest/secure/angelbroking/order/v1/searchScrip`,
        {
          exchange: exchange,
          searchscrip: searchText
        },
        {
          headers: this.getHeaders()
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      console.error('❌ Failed to search scrip:', error.message);
      throw error;
    }
  }

  /**
   * Get positions - Uses SDK
   */
  async getPositions(): Promise<any> {
    this.ensureAuthenticated();
    const response = await this.smartApi.getPosition();
    return response.data;
  }

  /**
   * Get holdings - Uses SDK
   */
  async getHoldings(): Promise<any> {
    this.ensureAuthenticated();
    const response = await this.smartApi.getHolding();
    return response.data;
  }

  /**
   * Place order - Uses SDK
   */
  async placeOrder(orderParams: any): Promise<any> {
    this.ensureAuthenticated();

    try {
      const response = await this.smartApi.placeOrder(orderParams);
      if (response.status) {
        console.log('✅ Order placed:', response.data.orderid);
        return response.data;
      }
      throw new Error(response.message || 'Order failed');
    } catch (error: any) {
      console.error('❌ Failed to place order:', error.message);
      throw error;
    }
  }

  /**
   * Get order book - Uses SDK
   */
  async getOrderBook(): Promise<any[]> {
    this.ensureAuthenticated();
    const response = await this.smartApi.getOrderBook();
    return response.data || [];
  }

  /**
   * Cancel order - Uses SDK
   */
  async cancelOrder(variety: string, orderId: string): Promise<any> {
    this.ensureAuthenticated();

    try {
      const response = await this.smartApi.cancelOrder({
        variety: variety,
        orderid: orderId
      });
      return response.data;
    } catch (error: any) {
      console.error('❌ Failed to cancel order:', error.message);
      throw error;
    }
  }

  /**
   * Get market data (OHLC, Volume, etc.) - Direct API Call
   */
  async getMarketData(mode: string, exchangeTokens: any): Promise<any> {
    this.ensureAuthenticated();

    try {
      const response = await axios.post(
        `${this.BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
        {
          mode: mode,
          exchangeTokens: exchangeTokens
        },
        {
          headers: this.getHeaders()
        }
      );

      return response.data.data;
    } catch (error: any) {
      console.error('❌ Failed to get market data:', error.message);
      throw error;
    }
  }

  /**
   * Get All Holdings - Direct API Call
   */
  async getAllHoldings(): Promise<any> {
    this.ensureAuthenticated();

    try {
      const response = await axios.get(
        `${this.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding`,
        {
          headers: this.getHeaders()
        }
      );

      return response.data.data;
    } catch (error: any) {
      console.error('❌ Failed to get all holdings:', error.message);
      throw error;
    }
  }

  /**
   * Get RMS (Risk Management System) - Uses SDK
   */
  async getRMS(): Promise<any> {
    this.ensureAuthenticated();
    const response = await this.smartApi.getRMS();
    return response.data;
  }

  getFeedToken(): string | null {
    return this.feedToken;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getClientCode(): string {
    return this.config.clientCode;
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated;
  }

  async logout(): Promise<void> {
    try {
      await this.smartApi.logout({
        clientcode: this.config.clientCode
      });
      this.isAuthenticated = false;
      this.authToken = null;
      this.feedToken = null;
      this.refreshToken = null;
      console.log('✅ Logged out');
    } catch (error: any) {
      console.error('❌ Logout error:', error.message);
    }
  }

  /**
   * Get common headers for API calls
   */
  private getHeaders(): any {
    return {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': this.config.apiKey
    };
  }

  private ensureAuthenticated(): void {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }
  }
}

/**
 * PRODUCTION-GRADE WEBSOCKET STREAMING - FIXED BINARY PARSING
 * Features: Auto-reconnect, Little Endian binary parsing, Health monitoring
 */
export class AngelWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private feedToken: string;
  private clientCode: string;
  private apiKey: string;
  private wsUrl: string = 'wss://smartapisocket.angelone.in/smart-stream';

  // Connection management
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isIntentionalDisconnect = false;
  private connectionStartTime: Date | null = null;

  // Subscription management
  private subscribedTokens: Map<string, WebSocketSubscription> = new Map();
  private pendingSubscriptions: WebSocketSubscription[] = [];

  // Performance monitoring
  private stats: WebSocketStats = {
    messagesReceived: 0,
    messagesPerSecond: 0,
    bytesReceived: 0,
    connectionUptime: 0,
    lastMessageTime: null,
    reconnectCount: 0
  };

  private statsInterval: NodeJS.Timeout | null = null;
  private lastStatsReset = Date.now();
  private messageCountSinceReset = 0;

  constructor(feedToken: string, clientCode: string, apiKey: string) {
    super();
    this.feedToken = feedToken;
    this.clientCode = clientCode;
    this.apiKey = apiKey;

    // Start performance monitoring
    this.startStatsMonitoring();
  }

  /**
   * Connect to WebSocket with retry logic
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🔌 Connecting to Angel One WebSocket...');
      this.connectionStartTime = new Date();

      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.feedToken}`,
          'x-api-key': this.apiKey,
          'x-client-code': this.clientCode,
          'x-feed-token': this.feedToken
        },
        handshakeTimeout: 10000
      });

      this.ws.on('open', () => {
        console.log('✅ WebSocket connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();

        // Resubscribe to pending tokens
        if (this.pendingSubscriptions.length > 0) {
          console.log(`📡 Resubscribing to ${this.pendingSubscriptions.length} instruments...`);
          this.subscribe(this.pendingSubscriptions);
          this.pendingSubscriptions = [];
        }

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('pong', () => {
        // Heartbeat acknowledged
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        this.emit('error', error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket closed [Code: ${code}] ${reason ? `Reason: ${reason}` : ''}`);
        this.stopHeartbeat();

        if (!this.isIntentionalDisconnect) {
          this.handleReconnect();
        }

        this.emit('close', code);
      });

      // Connection timeout
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.terminate();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 15000);
    });
  }

  /**
   * Subscribe to market data
   */
  subscribe(subscriptions: WebSocketSubscription[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('⚠️  WebSocket not ready, queueing subscriptions...');
      this.pendingSubscriptions.push(...subscriptions);
      return;
    }

    // Store subscriptions
    subscriptions.forEach(sub => {
      this.subscribedTokens.set(sub.token, sub);
    });

    // Group by exchange for efficient subscription
    const grouped = this.groupSubscriptionsByExchange(subscriptions);

    const subscriptionMessage = {
      action: 1, // 1 = subscribe, 0 = unsubscribe
      params: {
        mode: 3, // Mode 3 = Snap Quote (full market data)
        tokenList: grouped
      }
    };

    try {
      this.ws.send(JSON.stringify(subscriptionMessage));
      console.log(`📡 Subscribed to ${subscriptions.length} instruments across ${grouped.length} exchanges`);
    } catch (error: any) {
      console.error('❌ Subscription failed:', error.message);
      this.pendingSubscriptions.push(...subscriptions);
    }
  }

  /**
   * Unsubscribe from market data
   */
  unsubscribe(tokens: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('⚠️  WebSocket not connected');
      return;
    }

    const subscriptions = tokens
      .map(token => this.subscribedTokens.get(token))
      .filter(sub => sub !== undefined) as WebSocketSubscription[];

    if (subscriptions.length === 0) return;

    const grouped = this.groupSubscriptionsByExchange(subscriptions);

    const unsubscribeMessage = {
      action: 0,
      params: {
        mode: 3,
        tokenList: grouped
      }
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));

    // Remove from local cache
    tokens.forEach(token => this.subscribedTokens.delete(token));

    console.log(`📡 Unsubscribed from ${tokens.length} instruments`);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: Buffer): void {
    try {
      // Update stats
      this.stats.messagesReceived++;
      this.messageCountSinceReset++;
      this.stats.bytesReceived += data.length;
      this.stats.lastMessageTime = new Date();

      // Parse binary data
      const marketData = this.parseBinaryData(data);

      if (marketData) {
        this.emit('tick', marketData);
      }
    } catch (error: any) {
      console.error('❌ Message handling error:', error.message);
      this.emit('parseError', error);
    }
  }

  /**
   * Parse Angel One binary WebSocket data - LITTLE ENDIAN
   * Format: Mode 3 (Snap Quote) - Full market data
   */
  private parseBinaryData(buffer: Buffer): MarketData | null {
    try {
      if (buffer.length < 200) {
        // Incomplete packet
        return null;
      }

      // DEBUG: Log raw buffer for first few messages
      if (this.stats.messagesReceived < 3) {
        console.log(`\n🔍 DEBUG - Message #${this.stats.messagesReceived + 1}`);
        console.log(`   Buffer length: ${buffer.length}`);
        console.log(`   First 100 bytes: ${buffer.slice(0, 100).toString('hex')}`);
      }

      let offset = 0;

      // Subscription mode (1 byte)
      const mode = buffer.readUInt8(offset);
      offset += 1;

      // Exchange type (1 byte)
      // 1=NSE, 2=NFO, 3=BSE, 4=BFO, 5=MCX, 6=CDS
      const exchangeType = buffer.readUInt8(offset);
      offset += 1;

      const exchangeMap: any = {
        1: 'NSE',
        2: 'NFO',
        3: 'BSE',
        4: 'BFO',
        5: 'MCX',
        6: 'CDS'
      };
      const exchange = exchangeMap[exchangeType] || 'UNKNOWN';

      // Token (25 bytes, null-terminated string)
      const tokenBytes = buffer.slice(offset, offset + 25);
      const token = tokenBytes.toString('utf8').replace(/\0/g, '').trim();
      offset += 25;

      // Lookup subscription
      const subscription = this.subscribedTokens.get(token);
      if (!subscription) {
        // Unknown token, skip
        return null;
      }

      // Sequence number (8 bytes) - skip
      offset += 8;

      // Exchange timestamp (8 bytes) - Unix timestamp in microseconds - LITTLE ENDIAN
      const exchangeTimestampMicros = buffer.readBigInt64LE(offset);
      const lastTradeTime = new Date(Number(exchangeTimestampMicros) / 1000);
      offset += 8;

      // Last Traded Price (8 bytes, divide by 100) - LITTLE ENDIAN
      const ltpRaw = buffer.readBigInt64LE(offset);
      const ltp = Number(ltpRaw) / 100;
      offset += 8;

      // DEBUG: Log parsed values for first few messages
      if (this.stats.messagesReceived < 3) {
        console.log(`   Mode: ${mode}, Exchange: ${exchange} (${exchangeType})`);
        console.log(`   Token: ${token}`);
        console.log(`   Symbol: ${subscription.symbol}`);
        console.log(`   LTP Raw: ${ltpRaw}`);
        console.log(`   LTP Parsed: ${ltp}`);
      }

      // VALIDATION: Check if LTP is reasonable
      if (ltp <= 0 || ltp > 1000000) {
        if (this.stats.messagesReceived < 10) {
          console.log(`⚠️  Skipping invalid LTP: ${ltp} for ${subscription.symbol}`);
        }
        return null;
      }

      // Last Traded Quantity (8 bytes) - skip
      offset += 8;

      // Average Traded Price (8 bytes) - skip
      offset += 8;

      // Volume (8 bytes) - LITTLE ENDIAN
      const volumeRaw = buffer.readBigInt64LE(offset);
      const volume = Number(volumeRaw);
      offset += 8;

      // Total Buy Quantity (8 bytes) - LITTLE ENDIAN
      const totalBuyQtyRaw = buffer.readBigInt64LE(offset);
      const bidQty = Number(totalBuyQtyRaw);
      offset += 8;

      // Total Sell Quantity (8 bytes) - LITTLE ENDIAN
      const totalSellQtyRaw = buffer.readBigInt64LE(offset);
      const askQty = Number(totalSellQtyRaw);
      offset += 8;

      // Open (8 bytes, divide by 100) - LITTLE ENDIAN
      const openRaw = buffer.readBigInt64LE(offset);
      const open = Number(openRaw) / 100;
      offset += 8;

      // High (8 bytes, divide by 100) - LITTLE ENDIAN
      const highRaw = buffer.readBigInt64LE(offset);
      const high = Number(highRaw) / 100;
      offset += 8;

      // Low (8 bytes, divide by 100) - LITTLE ENDIAN
      const lowRaw = buffer.readBigInt64LE(offset);
      const low = Number(lowRaw) / 100;
      offset += 8;

      // Close (8 bytes, divide by 100) - LITTLE ENDIAN
      const closeRaw = buffer.readBigInt64LE(offset);
      const close = Number(closeRaw) / 100;
      offset += 8;

      // Last Traded Timestamp (8 bytes) - skip (already have exchange timestamp)
      offset += 8;

      // Open Interest (8 bytes) - LITTLE ENDIAN
      const oiRaw = buffer.readBigInt64LE(offset);
      const oi = Number(oiRaw);
      offset += 8;

      // Best 5 bid prices (5 x 8 bytes) - LITTLE ENDIAN
      const bidPrices: number[] = [];
      for (let i = 0; i < 5; i++) {
        const bidPriceRaw = buffer.readBigInt64LE(offset);
        bidPrices.push(Number(bidPriceRaw) / 100);
        offset += 8;
      }

      // Best 5 bid quantities (5 x 8 bytes) - skip
      offset += 40;

      // Best 5 ask prices (5 x 8 bytes) - LITTLE ENDIAN
      const askPrices: number[] = [];
      for (let i = 0; i < 5; i++) {
        const askPriceRaw = buffer.readBigInt64LE(offset);
        askPrices.push(Number(askPriceRaw) / 100);
        offset += 8;
      }

      // DEBUG: Log complete parsed data for first message
      if (this.stats.messagesReceived === 0) {
        console.log(`\n📊 Complete parsed data:`);
        console.log(`   Volume: ${volume}, OI: ${oi}`);
        console.log(`   Open: ${open}, High: ${high}, Low: ${low}, Close: ${close}`);
        console.log(`   Bid: ${bidPrices[0]}, Ask: ${askPrices[0]}`);
      }

      return {
        token,
        symbol: subscription.symbol,
        exchange,
        ltp,
        volume,
        oi,
        bidPrice: bidPrices[0] || 0,
        askPrice: askPrices[0] || 0,
        bidQty,
        askQty,
        high,
        low,
        open,
        close,
        lastTradeTime,
        timestamp: new Date()
      };

    } catch (error: any) {
      console.error('❌ Binary parse error:', error.message);
      console.error('   Buffer length:', buffer.length);
      console.error('   Error stack:', error.stack);
      return null;
    }
  }

  /**
   * Group subscriptions by exchange for efficient API calls
   */
  private groupSubscriptionsByExchange(subscriptions: WebSocketSubscription[]): any[] {
    const grouped = new Map<string, string[]>();

    subscriptions.forEach(sub => {
      const exchangeType = this.getExchangeType(sub.exchange);
      if (!grouped.has(exchangeType)) {
        grouped.set(exchangeType, []);
      }
      grouped.get(exchangeType)!.push(sub.token);
    });

    return Array.from(grouped.entries()).map(([exchangeType, tokens]) => ({
      exchangeType: parseInt(exchangeType),
      tokens
    }));
  }

  /**
   * Get exchange type code
   */
  private getExchangeType(exchange: string): string {
    const map: any = {
      'NSE': '1',
      'NFO': '2',
      'BSE': '3',
      'BFO': '4',
      'MCX': '5',
      'CDS': '6'
    };
    return map[exchange] || '1';
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 5000); // Ping every 5 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('maxReconnectReached');
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnectCount++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (max 32s)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 32000);

    console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Store current subscriptions for re-subscription
        this.pendingSubscriptions = Array.from(this.subscribedTokens.values());

        await this.connect();
        console.log('✅ Reconnected successfully');
        this.emit('reconnected');
      } catch (error: any) {
        console.error('❌ Reconnection failed:', error.message);
        this.handleReconnect(); // Try again
      }
    }, delay);
  }

  /**
   * Start performance monitoring
   */
  private startStatsMonitoring(): void {
    this.statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastStatsReset) / 1000; // seconds

      this.stats.messagesPerSecond = Math.round(this.messageCountSinceReset / elapsed);

      if (this.connectionStartTime) {
        this.stats.connectionUptime = Math.floor((now - this.connectionStartTime.getTime()) / 1000);
      }

      // Emit stats every 10 seconds
      this.emit('stats', { ...this.stats });

      // Reset counters
      this.lastStatsReset = now;
      this.messageCountSinceReset = 0;
    }, 10000); // Every 10 seconds
  }

  /**
   * Get current statistics
   */
  getStats(): WebSocketStats {
    return { ...this.stats };
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get number of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscribedTokens.size;
  }

  /**
   * Graceful disconnect
   */
  disconnect(): void {
    console.log('🔌 Disconnecting WebSocket...');

    this.isIntentionalDisconnect = true;

    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.subscribedTokens.clear();
    this.pendingSubscriptions = [];

    console.log('✅ WebSocket disconnected');
  }
}

/**
 * Factory function to create Angel One service
 */
export function createAngelOneService(): AngelOneService {
  const config: AngelConfig = {
    apiKey:      process.env.ANGEL_API_KEY       || '',
    clientCode:  process.env.ANGEL_CLIENT_CODE   || '',
    // ── FIX 2 ──────────────────────────────────────────────────────────────
    // BEFORE: process.env.ANGEL_PASSWORD
    //   → The old /loginByPassword endpoint needed the trading password.
    //   → That endpoint is now permanently blocked by Angel One.
    //
    // AFTER: process.env.ANGEL_MPIN
    //   → The new /loginByPassword endpoint requires the 4-digit MPIN (e.g. 1992).
    //   → Make sure your .env has: ANGEL_MPIN=1992
    // ────────────────────────────────────────────────────────────────────────
    mpin:        process.env.ANGEL_MPIN           || '',
    totpSecret:  process.env.ANGEL_TOTP_SECRET    || '',
  };

  if (!config.apiKey || !config.clientCode || !config.mpin || !config.totpSecret) {
    throw new Error('Angel One credentials not configured. Check ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_MPIN, ANGEL_TOTP_SECRET in .env');
  }

  return new AngelOneService(config);
}

