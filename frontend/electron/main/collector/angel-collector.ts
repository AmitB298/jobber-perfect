// src/main/collector/angel-collector.ts
// Angel One SmartAPI WebSocket → MarketSnapshot bridge
// Wraps your existing websocket-collector.ts tick format into the signal engine format
// Insert your actual Angel One connection code in startAngelOneCollector()

import type { MarketSnapshot, OptionTick, SpotTick, FuturesTick } from '../signals/types'
import { bsDelta, bsGamma, bsTheta, bsVega, impliedVol } from '../signals/bs-math'

const RISK_FREE = 0.065
const LOT_SIZE  = 75

// Angel One SmartAPI token format from your collector:
// { token, ltp, best_5_buy_data, best_5_sell_data, volume, open_interest, ... }
interface AngelTick {
  token:             string
  ltp:               number
  best_5_buy_data?:  { quantity: number; price: number }[]
  best_5_sell_data?: { quantity: number; price: number }[]
  volume:            number
  open_interest:     number
  exchange_feed_time?: number
}

// Your token-to-instrument mapping (build from your SmartAPI instrument list)
interface InstrumentMeta {
  symbol:  string
  strike:  number
  expiry:  string    // YYYY-MM-DD
  type:    'CE' | 'PE' | 'FUT' | 'IDX'
  dte:     number
}

export class AngelOneCollector {
  private tokenMap:     Map<string, InstrumentMeta> = new Map()
  private latestChain:  Map<string, OptionTick>     = new Map()
  private latestSpot:   SpotTick | null = null
  private latestFut:    FuturesTick | null = null
  private onSnapshot:   (s: MarketSnapshot) => void
  private lastEmit:     number = 0

  constructor(onSnapshot: (s: MarketSnapshot) => void) {
    this.onSnapshot = onSnapshot
  }

  /**
   * Register instrument metadata for each token.
   * Call this after fetching the SmartAPI instrument list.
   */
  registerToken(token: string, meta: InstrumentMeta): void {
    this.tokenMap.set(token, meta)
  }

  /**
   * Feed a raw Angel One WebSocket tick.
   * Call this from your existing collector's onTick handler.
   */
  processTick(tick: AngelTick): void {
    const meta = this.tokenMap.get(tick.token)
    if (!meta) return

    const ts  = tick.exchange_feed_time ?? Date.now()
    const bid = tick.best_5_buy_data?.[0]?.price  ?? tick.ltp * 0.999
    const ask = tick.best_5_sell_data?.[0]?.price ?? tick.ltp * 1.001

    if (meta.type === 'IDX') {
      // NIFTY spot index
      this.latestSpot = {
        index:     'NIFTY',
        ltp:       tick.ltp,
        open:      tick.ltp,  // replace with session open when available
        high:      tick.ltp,
        low:       tick.ltp,
        timestamp: ts,
      }
    } else if (meta.type === 'FUT') {
      this.latestFut = {
        symbol:    meta.symbol,
        ltp:       tick.ltp,
        bid,
        ask,
        volume:    tick.volume,
        oi:        tick.open_interest,
        timestamp: ts,
      }
    } else if (meta.type === 'CE' || meta.type === 'PE') {
      // Compute IV and Greeks from LTP
      const spot    = this.latestSpot?.ltp ?? 22000
      const T       = Math.max(0.001, meta.dte / 252)
      const params  = { S: spot, K: meta.strike, T, r: RISK_FREE, type: meta.type }

      const iv      = impliedVol(tick.ltp, params)
      const bsP     = { ...params, sigma: iv }

      const optTick: OptionTick = {
        symbol:    meta.symbol,
        strike:    meta.strike,
        expiry:    meta.expiry,
        type:      meta.type,
        ltp:       tick.ltp,
        bid,
        ask,
        volume:    tick.volume,
        oi:        tick.open_interest,
        iv,
        delta:     bsDelta(bsP),
        gamma:     bsGamma(bsP),
        theta:     bsTheta(bsP),
        vega:      bsVega(bsP),
        timestamp: ts,
        dte:       meta.dte,
      }

      this.latestChain.set(tick.token, optTick)
    }

    // Emit snapshot every 1 second (throttle)
    const now = Date.now()
    if (now - this.lastEmit >= 1000 && this.latestSpot && this.latestFut) {
      this.lastEmit = now
      this.onSnapshot({
        spot:      this.latestSpot,
        futures:   this.latestFut,
        chain:     [...this.latestChain.values()],
        timestamp: now,
      })
    }
  }
}

/**
 * Wire your existing Angel One WebSocket collector to the signal pipeline.
 * Replace the body of this function with calls to your actual SmartAPI WebSocket.
 *
 * Your existing collector (websocket-collector.ts) should call:
 *   collector.processTick(tick)
 * on every incoming WebSocket message.
 */
export function startAngelOneCollector(
  config: { apiKey: string; clientId: string; jwtToken: string; feedToken: string },
  onSnapshot: (s: MarketSnapshot) => void
): AngelOneCollector {
  const collector = new AngelOneCollector(onSnapshot)

  // ────────────────────────────────────────────────────────────────────────
  // INTEGRATION POINT: replace this section with your actual SmartAPI code
  // ────────────────────────────────────────────────────────────────────────
  //
  // Example integration:
  //
  // import { SmartAPIWebSocket } from './your-existing-collector'
  //
  // const ws = new SmartAPIWebSocket(config)
  //
  // ws.onTick((rawTick) => {
  //   collector.processTick({
  //     token:             rawTick.token,
  //     ltp:               rawTick.last_traded_price / 100,  // SmartAPI sends paise
  //     best_5_buy_data:   rawTick.best_5_buy_data,
  //     best_5_sell_data:  rawTick.best_5_sell_data,
  //     volume:            rawTick.volume_trade_for_the_day,
  //     open_interest:     rawTick.open_interest,
  //     exchange_feed_time: rawTick.exchange_feed_time,
  //   })
  // })
  //
  // ws.connect()
  //
  // Also call: ws.subscribe(tokenList)  — your 1590 tokens in batches of 50
  //
  // ────────────────────────────────────────────────────────────────────────

  console.log('[AngelOne] Collector initialized. Wire your SmartAPI WebSocket in angel-collector.ts')
  return collector
}
