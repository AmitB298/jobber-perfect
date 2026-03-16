/**
 * OI PULSE ROUTES — JOBBER PRO
 * =====================================
 * Activity Intelligence: Long/Short Buildup & Unwinding
 *
 * HOW TO INTEGRATE into api-server.ts:
 * ──────────────────────────────────────
 * // 1. Import at top:
 * import { registerOIPulseRoutes } from './oi-pulse-routes';
 *
 * // 2. After existing routes (~line 900+):
 * registerOIPulseRoutes(app, db);
 *
 * ENDPOINTS:
 * ──────────────────────────────────────────────────────────────
 * GET /api/oi-pulse/activity     → All 4 patterns per strike
 * GET /api/oi-pulse/summary      → Aggregate market sentiment
 * GET /api/oi-pulse/dominance    → CE vs PE pressure + PCR per strike
 * GET /api/oi-pulse/velocity     → OI rate-of-change ranking
 * GET /api/oi-pulse/traps        → Bull/bear trap detection
 */

import { Express, Request, Response } from 'express';
import { Pool } from 'pg';

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ActivityType =
  | 'LONG_BUILDUP'
  | 'SHORT_BUILDUP'
  | 'LONG_UNWINDING'
  | 'SHORT_UNWINDING'
  | 'NEUTRAL';

interface ActivityRow {
  strike:        number;
  optionType:    'CE' | 'PE';
  expiry:        string;
  ltp:           number;
  prevClose:     number;
  priceChangePct: number;
  oi:            number;
  oiChange:      number;
  oiChangePct:   number;
  volume:        number;
  iv:            number;
  activity:      ActivityType;
  signalScore:   number;
  distanceFromSpot: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function classifyActivity(priceChgPct: number, oiChgPct: number): ActivityType {
  const priceUp = priceChgPct > 0.5;
  const priceDown = priceChgPct < -0.5;
  const oiUp = oiChgPct > 1;
  const oiDown = oiChgPct < -1;

  if (priceUp && oiUp)   return 'LONG_BUILDUP';
  if (priceDown && oiUp) return 'SHORT_BUILDUP';
  if (priceDown && oiDown) return 'LONG_UNWINDING';
  if (priceUp && oiDown)   return 'SHORT_UNWINDING';
  return 'NEUTRAL';
}

function computeSignalScore(
  priceChgPct: number,
  oiChgPct: number,
  volume: number,
  oi: number,
  activity: ActivityType
): number {
  if (activity === 'NEUTRAL') return 0;

  // Price magnitude (0-40 pts)
  const pricePts = Math.min(40, Math.abs(priceChgPct) * 8);

  // OI magnitude (0-40 pts)
  const oiPts = Math.min(40, Math.abs(oiChgPct) * 4);

  // Volume/OI ratio (0-20 pts) — high vol vs OI = conviction
  const volRatio = oi > 0 ? Math.min(1, volume / oi) : 0;
  const volPts = volRatio * 20;

  return Math.round(pricePts + oiPts + volPts);
}

function mapActivityRow(r: any, spot: number): ActivityRow {
  const ltp       = parseFloat(r.ltp ?? 0);
  const prevClose = parseFloat(r.close ?? r.ltp ?? 0);
  const oi        = parseInt(r.oi ?? 0);
  const oiChange  = parseInt(r.oi_change ?? 0);
  const volume    = parseInt(r.volume ?? 0);
  const strike    = parseFloat(r.strike_price);

  const priceChangePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0;
  const oiChangePct    = (oi - oiChange) > 0 ? (oiChange / (oi - oiChange)) * 100 : 0;

  const activity   = classifyActivity(priceChangePct, oiChangePct);
  const signalScore = computeSignalScore(priceChangePct, oiChangePct, volume, oi, activity);

  return {
    strike,
    optionType:     r.option_type as 'CE' | 'PE',
    expiry:         r.expiry_date,
    ltp,
    prevClose,
    priceChangePct: parseFloat(priceChangePct.toFixed(2)),
    oi,
    oiChange,
    oiChangePct:    parseFloat(oiChangePct.toFixed(2)),
    volume,
    iv:             parseFloat(r.iv ?? 0),
    activity,
    signalScore,
    distanceFromSpot: parseFloat((strike - spot).toFixed(0)),
  };
}

// ─── REGISTER ROUTES ─────────────────────────────────────────────────────────

export function registerOIPulseRoutes(app: Express, db: Pool): void {

  // ── GET /api/oi-pulse/activity ────────────────────────────────────────────
  // Core endpoint: all strikes classified by activity type
  app.get('/api/oi-pulse/activity', async (req: Request, res: Response) => {
    try {
      const expiry    = req.query.expiry as string | undefined;
      const typeFilter = req.query.type as ActivityType | 'ALL' | undefined;
      const optFilter  = req.query.opt as 'CE' | 'PE' | undefined;
      const minScore   = parseInt(req.query.minScore as string ?? '20');
      const limit      = Math.min(parseInt(req.query.limit as string ?? '50'), 100);

      // Get latest spot
      const spotRes = await db.query(`
        SELECT spot_price FROM nifty_premium_tracking.oi_scanner_summary
        ORDER BY summary_at DESC LIMIT 1
      `);
      const spot = parseFloat(spotRes.rows[0]?.spot_price ?? 22000);

      // Build query — use options_data which has oi_change and close
      let query = `
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price, option_type, expiry_date,
          ltp, close, oi, oi_change, volume, iv
        FROM nifty_premium_tracking.options_data
        WHERE oi > 0
          AND oi_change IS NOT NULL
      `;
      const params: any[] = [];

      if (expiry) {
        params.push(expiry);
        query += ` AND expiry_date = $${params.length}`;
      } else {
        // Default: nearest weekly expiry
        query += ` AND expiry_date = (
          SELECT MIN(expiry_date) FROM nifty_premium_tracking.options_data
          WHERE expiry_date >= CURRENT_DATE
        )`;
      }

      if (optFilter) {
        params.push(optFilter);
        query += ` AND option_type = $${params.length}`;
      }

      query += ` ORDER BY strike_price, option_type, timestamp DESC`;

      const result = await db.query(query, params);

      let rows: ActivityRow[] = result.rows
        .map((r: any) => mapActivityRow(r, spot))
        .filter((r: ActivityRow) => r.activity !== 'NEUTRAL' || typeFilter === 'ALL')
        .filter((r: ActivityRow) => r.signalScore >= minScore);

      if (typeFilter && typeFilter !== 'ALL') {
        rows = rows.filter((r: ActivityRow) => r.activity === typeFilter);
      }

      // Sort by signal score desc
      rows.sort((a, b) => b.signalScore - a.signalScore);
      rows = rows.slice(0, limit);

      // Aggregate counts
      const counts = {
        LONG_BUILDUP:    rows.filter(r => r.activity === 'LONG_BUILDUP').length,
        SHORT_BUILDUP:   rows.filter(r => r.activity === 'SHORT_BUILDUP').length,
        LONG_UNWINDING:  rows.filter(r => r.activity === 'LONG_UNWINDING').length,
        SHORT_UNWINDING: rows.filter(r => r.activity === 'SHORT_UNWINDING').length,
        NEUTRAL:         rows.filter(r => r.activity === 'NEUTRAL').length,
      };

      res.json({ success: true, spot, data: rows, counts, total: rows.length });
    } catch (err: any) {
      console.error('[OIPulse] /activity error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-pulse/summary ──────────────────────────────────────────────
  // Market-wide activity sentiment aggregation
  app.get('/api/oi-pulse/summary', async (_req: Request, res: Response) => {
    try {
      const spotRes = await db.query(`
        SELECT spot_price, pcr_oi, atm_iv, ivr, net_gex, max_pain_strike, call_wall_strike, put_wall_strike
        FROM nifty_premium_tracking.oi_scanner_summary
        ORDER BY summary_at DESC LIMIT 1
      `);
      const s = spotRes.rows[0];
      const spot = parseFloat(s?.spot_price ?? 22000);

      // Get aggregate OI change by type
      const aggRes = await db.query(`
        SELECT
          option_type,
          SUM(CASE WHEN oi_change > 0 THEN oi_change ELSE 0 END) AS oi_added,
          SUM(CASE WHEN oi_change < 0 THEN ABS(oi_change) ELSE 0 END) AS oi_shed,
          SUM(oi_change) AS net_oi_change,
          SUM(volume) AS total_volume,
          COUNT(*) AS strikes_count
        FROM nifty_premium_tracking.options_data
        WHERE expiry_date = (
          SELECT MIN(expiry_date) FROM nifty_premium_tracking.options_data
          WHERE expiry_date >= CURRENT_DATE
        )
        AND oi > 0
        GROUP BY option_type
      `);

      const ce = aggRes.rows.find((r: any) => r.option_type === 'CE') ?? {};
      const pe = aggRes.rows.find((r: any) => r.option_type === 'PE') ?? {};

      const ceNetOI = parseInt(ce.net_oi_change ?? 0);
      const peNetOI = parseInt(pe.net_oi_change ?? 0);
      const totalNetOI = ceNetOI + peNetOI;

      // Dominant side
      const cePressure = ceNetOI > 0 ? 'BUILDING' : 'UNWINDING';
      const pePressure = peNetOI > 0 ? 'BUILDING' : 'UNWINDING';

      // Market bias
      let marketBias = 'NEUTRAL';
      if (peNetOI > 0 && ceNetOI < 0)      marketBias = 'BULLISH';  // PE building, CE unwinding
      else if (ceNetOI > 0 && peNetOI < 0) marketBias = 'BEARISH';  // CE building, PE unwinding
      else if (ceNetOI > 0 && peNetOI > 0) marketBias = 'SIDEWAYS'; // Both building = rangebound
      else if (ceNetOI < 0 && peNetOI < 0) marketBias = 'BREAKOUT'; // Both unwinding = move expected

      res.json({
        success: true,
        data: {
          spot,
          pcrOi:        parseFloat(s?.pcr_oi ?? 1),
          atmIv:        parseFloat(s?.atm_iv ?? 0),
          ivr:          parseFloat(s?.ivr ?? 50),
          netGex:       parseFloat(s?.net_gex ?? 0),
          maxPain:      s?.max_pain_strike,
          callWall:     s?.call_wall_strike,
          putWall:      s?.put_wall_strike,
          ce: {
            oiAdded:    parseInt(ce.oi_added ?? 0),
            oiShed:     parseInt(ce.oi_shed ?? 0),
            netOiChange: ceNetOI,
            volume:     parseInt(ce.total_volume ?? 0),
            pressure:   cePressure,
          },
          pe: {
            oiAdded:    parseInt(pe.oi_added ?? 0),
            oiShed:     parseInt(pe.oi_shed ?? 0),
            netOiChange: peNetOI,
            volume:     parseInt(pe.total_volume ?? 0),
            pressure:   pePressure,
          },
          totalNetOiChange: totalNetOI,
          marketBias,
          updatedAt: Date.now(),
        }
      });
    } catch (err: any) {
      console.error('[OIPulse] /summary error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-pulse/velocity ─────────────────────────────────────────────
  // Top OI movers — fastest growing/shrinking OI this session
  app.get('/api/oi-pulse/velocity', async (req: Request, res: Response) => {
    try {
      const direction = req.query.dir as 'up' | 'down' | undefined; // up=buildup, down=unwinding
      const limit = Math.min(parseInt(req.query.limit as string ?? '20'), 50);

      const spotRes = await db.query(`SELECT spot_price FROM nifty_premium_tracking.oi_scanner_summary ORDER BY summary_at DESC LIMIT 1`);
      const spot = parseFloat(spotRes.rows[0]?.spot_price ?? 22000);

      let query = `
        SELECT
          strike_price, option_type, expiry_date, ltp, close,
          oi, oi_change, volume, iv,
          CASE WHEN (oi - oi_change) > 0
            THEN ROUND((oi_change::numeric / (oi - oi_change)::numeric) * 100, 2)
            ELSE 0
          END AS oi_change_pct
        FROM nifty_premium_tracking.options_data
        WHERE oi > 10000
          AND oi_change IS NOT NULL
          AND expiry_date = (
            SELECT MIN(expiry_date) FROM nifty_premium_tracking.options_data
            WHERE expiry_date >= CURRENT_DATE
          )
      `;

      if (direction === 'up')   query += ' AND oi_change > 0';
      if (direction === 'down') query += ' AND oi_change < 0';

      query += ` ORDER BY ABS(oi_change) DESC LIMIT ${limit}`;

      const result = await db.query(query);

      const rows = result.rows.map((r: any) => ({
        strike:         parseFloat(r.strike_price),
        optionType:     r.option_type,
        expiry:         r.expiry_date,
        ltp:            parseFloat(r.ltp ?? 0),
        prevClose:      parseFloat(r.close ?? r.ltp ?? 0),
        oi:             parseInt(r.oi ?? 0),
        oiChange:       parseInt(r.oi_change ?? 0),
        oiChangePct:    parseFloat(r.oi_change_pct ?? 0),
        volume:         parseInt(r.volume ?? 0),
        iv:             parseFloat(r.iv ?? 0),
        distanceFromSpot: parseFloat(r.strike_price) - spot,
      }));

      res.json({ success: true, data: rows, spot });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-pulse/traps ────────────────────────────────────────────────
  // Bull/Bear trap detection: price moved but OI disagrees
  app.get('/api/oi-pulse/traps', async (_req: Request, res: Response) => {
    try {
      const spotRes = await db.query(`SELECT spot_price FROM nifty_premium_tracking.oi_scanner_summary ORDER BY summary_at DESC LIMIT 1`);
      const spot = parseFloat(spotRes.rows[0]?.spot_price ?? 22000);

      // Bull trap: price up significantly but OI falling (SHORT_UNWINDING = weak move)
      // Bear trap: price down but OI also falling (LONG_UNWINDING = exhausted sellers)
      const result = await db.query(`
        SELECT
          strike_price, option_type, expiry_date, ltp, close, oi, oi_change, volume, iv,
          CASE WHEN close > 0 THEN ROUND(((ltp - close) / close) * 100, 2) ELSE 0 END AS price_chg_pct,
          CASE WHEN (oi - oi_change) > 0
            THEN ROUND((oi_change::numeric / (oi - oi_change)::numeric) * 100, 2)
            ELSE 0
          END AS oi_chg_pct
        FROM nifty_premium_tracking.options_data
        WHERE oi > 20000
          AND oi_change IS NOT NULL
          AND close IS NOT NULL
          AND close > 0
          AND expiry_date = (
            SELECT MIN(expiry_date) FROM nifty_premium_tracking.options_data
            WHERE expiry_date >= CURRENT_DATE
          )
          AND ABS(((ltp - close) / close) * 100) > 2   -- significant price move
          AND oi_change < 0                              -- but OI falling
        ORDER BY ABS(((ltp - close) / close) * 100) DESC
        LIMIT 20
      `);

      const traps = result.rows.map((r: any) => {
        const priceChg = parseFloat(r.price_chg_pct);
        const oiChg    = parseFloat(r.oi_chg_pct);
        const trapType = priceChg > 0
          ? 'BULL_TRAP'   // price up, OI down = short covering, not real buying
          : 'BEAR_TRAP';  // price down, OI down = long covering, not real selling
        return {
          strike:       parseFloat(r.strike_price),
          optionType:   r.option_type,
          expiry:       r.expiry_date,
          ltp:          parseFloat(r.ltp ?? 0),
          prevClose:    parseFloat(r.close ?? 0),
          priceChangePct: priceChg,
          oiChangePct:  oiChg,
          oi:           parseInt(r.oi ?? 0),
          oiChange:     parseInt(r.oi_change ?? 0),
          volume:       parseInt(r.volume ?? 0),
          iv:           parseFloat(r.iv ?? 0),
          trapType,
          distanceFromSpot: parseFloat(r.strike_price) - spot,
        };
      });

      res.json({ success: true, data: traps, spot });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-pulse/pcr-strikes ─────────────────────────────────────────
  // Per-strike PCR — dominant CE vs PE OI at each level
  app.get('/api/oi-pulse/pcr-strikes', async (_req: Request, res: Response) => {
    try {
      const spotRes = await db.query(`SELECT spot_price FROM nifty_premium_tracking.oi_scanner_summary ORDER BY summary_at DESC LIMIT 1`);
      const spot = parseFloat(spotRes.rows[0]?.spot_price ?? 22000);

      const result = await db.query(`
        SELECT
          strike_price,
          expiry_date,
          MAX(CASE WHEN option_type = 'CE' THEN oi ELSE 0 END) AS ce_oi,
          MAX(CASE WHEN option_type = 'PE' THEN oi ELSE 0 END) AS pe_oi,
          MAX(CASE WHEN option_type = 'CE' THEN oi_change ELSE 0 END) AS ce_oi_chg,
          MAX(CASE WHEN option_type = 'PE' THEN oi_change ELSE 0 END) AS pe_oi_chg,
          MAX(CASE WHEN option_type = 'CE' THEN ltp ELSE 0 END) AS ce_ltp,
          MAX(CASE WHEN option_type = 'PE' THEN ltp ELSE 0 END) AS pe_ltp,
          MAX(CASE WHEN option_type = 'CE' THEN iv ELSE 0 END) AS ce_iv,
          MAX(CASE WHEN option_type = 'PE' THEN iv ELSE 0 END) AS pe_iv
        FROM nifty_premium_tracking.options_data
        WHERE expiry_date = (
          SELECT MIN(expiry_date) FROM nifty_premium_tracking.options_data
          WHERE expiry_date >= CURRENT_DATE
        )
        AND oi > 0
        GROUP BY strike_price, expiry_date
        HAVING MAX(CASE WHEN option_type = 'CE' THEN oi ELSE 0 END) > 0
           AND MAX(CASE WHEN option_type = 'PE' THEN oi ELSE 0 END) > 0
        ORDER BY ABS(strike_price - $1)
        LIMIT 30
      `, [spot]);

      const rows = result.rows.map((r: any) => {
        const ceOI = parseInt(r.ce_oi ?? 0);
        const peOI = parseInt(r.pe_oi ?? 0);
        const pcr  = ceOI > 0 ? parseFloat((peOI / ceOI).toFixed(3)) : 0;
        const dominant = pcr > 1.2 ? 'PE' : pcr < 0.8 ? 'CE' : 'BALANCED';

        return {
          strike:       parseFloat(r.strike_price),
          expiry:       r.expiry_date,
          ceOI, peOI,
          ceOIChg:      parseInt(r.ce_oi_chg ?? 0),
          peOIChg:      parseInt(r.pe_oi_chg ?? 0),
          ceLtp:        parseFloat(r.ce_ltp ?? 0),
          peLtp:        parseFloat(r.pe_ltp ?? 0),
          ceIv:         parseFloat(r.ce_iv ?? 0),
          peIv:         parseFloat(r.pe_iv ?? 0),
          pcr,
          dominant,
          distanceFromSpot: parseFloat(r.strike_price) - spot,
        };
      });

      res.json({ success: true, data: rows, spot });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('[OIPulse] Routes registered: /api/oi-pulse/*');
}