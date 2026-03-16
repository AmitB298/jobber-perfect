// backtest/backtester.ts
// Signal Engine Backtester — uses Node built-in crypto.randomUUID()

import * as crypto from 'crypto'
import * as fs     from 'fs'
import * as path   from 'path'

// ── Types ────────────────────────────────────────────────────────────────────

export interface BacktestBar {
  ts:        number
  spot:      number
  direction: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  positionSize: number
  hypothesis: string
}

export interface BacktestTrade {
  id:          string
  entryTs:     number
  exitTs:      number
  entrySpot:   number
  exitSpot:    number
  direction:   'bullish' | 'bearish'
  confidence:  number
  positionSize: number
  pnlPct:      number
  pnlPts:      number
  hypothesis:  string
  result:      'win' | 'loss' | 'scratch'
}

export interface BacktestResult {
  totalTrades:   number
  wins:          number
  losses:        number
  scratches:     number
  winRate:       number
  avgWinPts:     number
  avgLossPts:    number
  profitFactor:  number
  expectancy:    number
  sharpe:        number
  maxDrawdown:   number
  totalPnlPts:   number
  trades:        BacktestTrade[]
  calByBucket:   Record<string, { n: number; wins: number; winRate: number }>
}

// ── Config ───────────────────────────────────────────────────────────────────

const ENTRY_THRESHOLD    = 0.68   // confidence to enter
const EXIT_THRESHOLD     = 0.50   // confidence to exit
const STOP_LOSS_PTS      = 40     // hard stop in Nifty points
const TARGET_PTS         = 80     // target in Nifty points
const MIN_HOLD_BARS      = 3      // minimum bars to hold

// ── Backtester ───────────────────────────────────────────────────────────────

export class Backtester {
  private bars:   BacktestBar[] = []
  private trades: BacktestTrade[] = []

  addBar(bar: BacktestBar) {
    this.bars.push(bar)
  }

  loadFromFile(filePath: string) {
    const raw  = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as BacktestBar[]
    this.bars  = data
    console.log(`[Backtester] Loaded ${data.length} bars from ${path.basename(filePath)}`)
  }

  run(): BacktestResult {
    this.trades = []
    const pnls: number[] = []
    let equity    = 0
    let peak      = 0
    let maxDD     = 0

    let inTrade    = false
    let entryBar!: BacktestBar
    let entryIdx   = 0

    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i]

      if (!inTrade) {
        // Entry condition
        if (
          (bar.direction === 'bullish' || bar.direction === 'bearish') &&
          bar.confidence >= ENTRY_THRESHOLD
        ) {
          inTrade  = true
          entryBar = bar
          entryIdx = i
        }
        continue
      }

      // In trade — check exit conditions
      const barsHeld  = i - entryIdx
      const ptsMoved  = entryBar.direction === 'bullish'
        ? bar.spot - entryBar.spot
        : entryBar.spot - bar.spot

      const stopHit   = ptsMoved <= -STOP_LOSS_PTS
      const targetHit = ptsMoved >= TARGET_PTS
      const signalFlip = bar.direction !== entryBar.direction && bar.confidence >= ENTRY_THRESHOLD
      const fadeExit  = bar.confidence < EXIT_THRESHOLD && barsHeld >= MIN_HOLD_BARS

      if (stopHit || targetHit || signalFlip || fadeExit) {
        const pnlPts = ptsMoved
        const pnlPct = pnlPts / entryBar.spot

        const result: BacktestTrade['result'] =
          Math.abs(pnlPts) < 5 ? 'scratch' :
          pnlPts > 0           ? 'win'     : 'loss'

        const trade: BacktestTrade = {
          // ── FIX: Node built-in crypto.randomUUID() — no uuid package needed ──
          id:           crypto.randomUUID(),
          entryTs:      entryBar.ts,
          exitTs:       bar.ts,
          entrySpot:    entryBar.spot,
          exitSpot:     bar.spot,
          direction:    entryBar.direction as 'bullish' | 'bearish',
          confidence:   entryBar.confidence,
          positionSize: entryBar.positionSize,
          pnlPct,
          pnlPts,
          hypothesis:   entryBar.hypothesis,
          result,
        }

        this.trades.push(trade)
        pnls.push(pnlPts)

        // Equity curve / drawdown
        equity += pnlPts
        if (equity > peak) peak = equity
        const dd = peak - equity
        if (dd > maxDD) maxDD = dd

        inTrade = false
      }
    }

    return this.summarise(pnls, maxDD)
  }

  private summarise(pnls: number[], maxDD: number): BacktestResult {
    const wins      = this.trades.filter(t => t.result === 'win')
    const losses    = this.trades.filter(t => t.result === 'loss')
    const scratches = this.trades.filter(t => t.result === 'scratch')

    const avgWin    = wins.length    ? wins.reduce((a, t) => a + t.pnlPts, 0)   / wins.length    : 0
    const avgLoss   = losses.length  ? losses.reduce((a, t) => a + t.pnlPts, 0) / losses.length  : 0
    const totalWin  = wins.reduce((a, t) => a + t.pnlPts, 0)
    const totalLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPts, 0))

    const mean   = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0
    const std    = pnls.length ? Math.sqrt(pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length) : 1
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

    // Calibration by time bucket
    const calByBucket: BacktestResult['calByBucket'] = {}
    for (const t of this.trades) {
      const hour   = new Date(t.entryTs).getHours()
      const bucket = hour < 11 ? '09-11' : hour < 13 ? '11-13' : hour < 15 ? '13-15' : '15+'
      if (!calByBucket[bucket]) calByBucket[bucket] = { n: 0, wins: 0, winRate: 0 }
      calByBucket[bucket].n++
      if (t.result === 'win') calByBucket[bucket].wins++
    }
    for (const b of Object.values(calByBucket)) {
      b.winRate = b.n > 0 ? b.wins / b.n : 0
    }

    return {
      totalTrades:  this.trades.length,
      wins:         wins.length,
      losses:       losses.length,
      scratches:    scratches.length,
      winRate:      this.trades.length > 0 ? wins.length / this.trades.length : 0,
      avgWinPts:    avgWin,
      avgLossPts:   avgLoss,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0,
      expectancy:   mean,
      sharpe,
      maxDrawdown:  maxDD,
      totalPnlPts:  pnls.reduce((a, b) => a + b, 0),
      trades:       this.trades,
      calByBucket,
    }
  }

  exportTrades(outPath: string) {
    fs.writeFileSync(outPath, JSON.stringify(this.trades, null, 2))
    console.log(`[Backtester] Exported ${this.trades.length} trades → ${outPath}`)
  }
}