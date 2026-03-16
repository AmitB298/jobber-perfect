/**
 * JOBBER PRO — OI SCANNER API ROUTES
 * ====================================
 * Add to api-server.ts
 *
 * HOW TO INTEGRATE:
 * ─────────────────
 * // 1. Import at top of api-server.ts:
 * import { registerOIScannerRoutes } from './oi-scanner-routes';
 *
 * // 2. After your existing routes (around line 900+ in api-server.ts):
 * registerOIScannerRoutes(app, db, oiScanner);
 *
 * // 3. The oiScanner instance is created in websocket-collector.ts.
 *    If they run in separate processes, this module queries DB directly.
 *    Pass null for oiScanner if separate process — it uses DB fallback.
 *
 * ENDPOINTS:
 * ──────────────────────────────────────────────────────────────────────
 * GET  /api/oi-scanner/summary         → Current market summary + top zones
 * GET  /api/oi-scanner/zones           → All active OI concentration zones
 * GET  /api/oi-scanner/zones/:expiry   → Zones for specific expiry
 * GET  /api/oi-scanner/history         → Zone event history (last 50)
 * GET  /api/oi-scanner/structure       → GEX walls, max pain, gamma flip
 * GET  /api/oi-scanner/fii             → FII positions
 */

import { Express, Request, Response } from 'express';
import { Pool } from 'pg';
import type { OIScannerEngine, OIZone } from './oi-scanner-engine';

export function registerOIScannerRoutes(
  app:        Express,
  db:         Pool,
  oiScanner?: OIScannerEngine | null
): void {

  // ── GET /api/oi-scanner/summary ──────────────────────────────
  app.get('/api/oi-scanner/summary', async (_req: Request, res: Response) => {
    try {
      // Prefer live engine data
      if (oiScanner) {
        const summary = oiScanner.getSummary();
        if (summary) return res.json({ success: true, data: summary, source: 'live' });
      }

      // Fallback: query DB for latest snapshot
      const summaryRow = await db.query(`
        SELECT *
        FROM nifty_premium_tracking.oi_scanner_summary
        ORDER BY summary_at DESC
        LIMIT 1
      `);

      if (!summaryRow.rows[0]) {
        return res.json({
          success: true, data: null, source: 'db',
          message: 'No data yet — scanner starting up'
        });
      }

      const s = summaryRow.rows[0];
      const spot = parseFloat(s.spot_price);

      // Get top zones from DB
      const zonesRow = await db.query(`
        SELECT * FROM nifty_premium_tracking.v_active_oi_zones
        LIMIT 20
      `);

      // ── Fetch LTP + IV + detail for topCE from oi_zone_events ──
      // oi_scanner_summary does NOT have top_ce_ltp / top_ce_iv columns,
      // so we join back to oi_zone_events to get real values.
      let topCEDetail: any = null;
      if (s.top_ce_strike) {
        const ceRes = await db.query(`
          SELECT ltp_at_detection, iv_at_detection,
                 component_oi_rank, component_oi_velocity,
                 component_gex, component_sweep_count,
                 zone_type, distance_pct
          FROM nifty_premium_tracking.oi_zone_events
          WHERE strike_price = $1
            AND option_type  = 'CE'
            AND active       = true
          ORDER BY detected_at DESC
          LIMIT 1
        `, [s.top_ce_strike]);
        topCEDetail = ceRes.rows[0] ?? null;
      }

      // ── Fetch LTP + IV + detail for topPE from oi_zone_events ──
      let topPEDetail: any = null;
      if (s.top_pe_strike) {
        const peRes = await db.query(`
          SELECT ltp_at_detection, iv_at_detection,
                 component_oi_rank, component_oi_velocity,
                 component_gex, component_sweep_count,
                 zone_type, distance_pct
          FROM nifty_premium_tracking.oi_zone_events
          WHERE strike_price = $1
            AND option_type  = 'PE'
            AND active       = true
          ORDER BY detected_at DESC
          LIMIT 1
        `, [s.top_pe_strike]);
        topPEDetail = peRes.rows[0] ?? null;
      }

      return res.json({
        success: true,
        source:  'db',
        data: {
          expiry:   s.expiry_date,
          spot,
          dte:      s.dte,
          maxPain:  s.max_pain_strike,
          gammaFlip: parseFloat(s.gamma_flip_level ?? 0),
          callWall:  s.call_wall_strike,
          putWall:   s.put_wall_strike,
          netGex:    parseFloat(s.net_gex  ?? 0),
          pcrOi:     parseFloat(s.pcr_oi   ?? 1),
          atmIv:     parseFloat(s.atm_iv   ?? 0),
          ivr:       parseFloat(s.ivr      ?? 50),

          topCE: s.top_ce_strike ? {
            strike:           parseFloat(s.top_ce_strike),
            expiry:           s.expiry_date,
            optionType:       'CE',
            zoneType:         topCEDetail?.zone_type                    ?? 'CALL_WALL',
            zoneStrength:     parseFloat(s.top_ce_zone_strength         ?? 0),
            oi:               parseInt(s.top_ce_oi                      ?? 0),
            oiRank:           parseInt(topCEDetail?.component_oi_rank   ?? 1),
            oiVelocity:       parseFloat(topCEDetail?.component_oi_velocity ?? 0),
            oiVelocityZ:      0,  // not stored yet — placeholder
            gexAbs:           parseFloat(topCEDetail?.component_gex     ?? 0),
            sweepCount:       parseInt(topCEDetail?.component_sweep_count ?? 0),
            ltp:              parseFloat(topCEDetail?.ltp_at_detection   ?? 0),  // ✅ real LTP
            iv:               parseFloat(topCEDetail?.iv_at_detection    ?? 0),  // ✅ real IV
            distanceFromSpot: parseFloat(s.top_ce_strike) - spot,
            distancePct:      parseFloat(topCEDetail?.distance_pct       ?? 0),
          } : null,

          topPE: s.top_pe_strike ? {
            strike:           parseFloat(s.top_pe_strike),
            expiry:           s.expiry_date,
            optionType:       'PE',
            zoneType:         topPEDetail?.zone_type                    ?? 'PUT_WALL',
            zoneStrength:     parseFloat(s.top_pe_zone_strength         ?? 0),
            oi:               parseInt(s.top_pe_oi                      ?? 0),
            oiRank:           parseInt(topPEDetail?.component_oi_rank   ?? 1),
            oiVelocity:       parseFloat(topPEDetail?.component_oi_velocity ?? 0),
            oiVelocityZ:      0,  // not stored yet — placeholder
            gexAbs:           parseFloat(topPEDetail?.component_gex     ?? 0),
            sweepCount:       parseInt(topPEDetail?.component_sweep_count ?? 0),
            ltp:              parseFloat(topPEDetail?.ltp_at_detection   ?? 0),  // ✅ real LTP
            iv:               parseFloat(topPEDetail?.iv_at_detection    ?? 0),  // ✅ real IV
            distanceFromSpot: parseFloat(s.top_pe_strike) - spot,
            distancePct:      parseFloat(topPEDetail?.distance_pct       ?? 0),
          } : null,

          zones:           zonesRow.rows.map(mapZoneRow),
          activeZoneCount: s.active_zone_count,
          sweepCount15m:   s.sweep_count_15m,
          updatedAt:       new Date(s.summary_at).getTime(),
        }
      });
    } catch (err: any) {
      console.error('[OIScanner] /summary error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-scanner/zones ────────────────────────────────
  app.get('/api/oi-scanner/zones', async (req: Request, res: Response) => {
    try {
      const expiry      = req.query.expiry as string | undefined;
      const minStrength = parseFloat(req.query.minStrength as string ?? '30');
      const optType     = req.query.type as 'CE' | 'PE' | undefined;

      if (oiScanner) {
        let zones = oiScanner.getTopZones(expiry);
        if (optType)     zones = zones.filter((z: OIZone) => z.optionType === optType);
        if (minStrength) zones = zones.filter((z: OIZone) => z.zoneStrength >= minStrength);
        return res.json({ success: true, data: zones, source: 'live' });
      }

      // DB fallback
      let query = `
        SELECT * FROM nifty_premium_tracking.v_active_oi_zones
        WHERE zone_strength >= $1
      `;
      const params: any[] = [minStrength];
      if (expiry)  { query += ` AND expiry_date = $${params.length + 1}`; params.push(expiry); }
      if (optType) { query += ` AND option_type = $${params.length + 1}`; params.push(optType); }
      query += ' ORDER BY zone_strength DESC LIMIT 30';

      const result = await db.query(query, params);
      res.json({ success: true, data: result.rows.map(mapZoneRow), source: 'db' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-scanner/zones/:expiry ────────────────────────
  app.get('/api/oi-scanner/zones/:expiry', async (req: Request, res: Response) => {
    try {
      const { expiry } = req.params;
      const result = await db.query(`
        SELECT *
        FROM nifty_premium_tracking.v_oi_concentration_top
        WHERE expiry_date = $1
        ORDER BY oi_rank
        LIMIT 40
      `, [expiry]);
      res.json({ success: true, data: result.rows, expiry });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-scanner/history ──────────────────────────────
  app.get('/api/oi-scanner/history', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string ?? '50'), 200);
      const result = await db.query(`
        SELECT
          id, detected_at, expiry_date, strike_price, option_type,
          zone_type, zone_strength, spot_price, distance_from_spot,
          oi_at_detection, ltp_at_detection, iv_at_detection,
          component_sweep_count, resolved_at, resolution_type, active
        FROM nifty_premium_tracking.oi_zone_events
        ORDER BY detected_at DESC
        LIMIT $1
      `, [limit]);
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-scanner/structure ────────────────────────────
  app.get('/api/oi-scanner/structure', async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT
          summary_at, expiry_date, spot_price, dte,
          max_pain_strike, gamma_flip_level,
          call_wall_strike, put_wall_strike,
          net_gex, pcr_oi, atm_iv, ivr
        FROM nifty_premium_tracking.oi_scanner_summary
        ORDER BY summary_at DESC
        LIMIT 1
      `);

      if (!result.rows[0]) return res.json({ success: true, data: null });

      const r = result.rows[0];
      res.json({
        success: true,
        data: {
          updatedAt:   r.summary_at,
          expiry:      r.expiry_date,
          spot:        parseFloat(r.spot_price),
          dte:         r.dte,
          maxPain:     r.max_pain_strike,
          gammaFlip:   parseFloat(r.gamma_flip_level ?? 0),
          callWall:    r.call_wall_strike,
          putWall:     r.put_wall_strike,
          netGex:      parseFloat(r.net_gex ?? 0),
          netGexLabel: parseFloat(r.net_gex ?? 0) > 0
                         ? 'POSITIVE (Pinning)'
                         : 'NEGATIVE (Expansion)',
          pcrOi:       parseFloat(r.pcr_oi ?? 1),
          atmIv:       parseFloat(r.atm_iv ?? 0),
          ivr:         parseFloat(r.ivr    ?? 50),
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/oi-scanner/fii ──────────────────────────────────
  app.get('/api/oi-scanner/fii', async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT *
        FROM nifty_premium_tracking.fii_positions
        ORDER BY trade_date DESC
        LIMIT 5
      `);
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('[OIScanner] Routes registered: /api/oi-scanner/*');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
//
// v_active_oi_zones column mapping:
//   oi_rank        ← component_oi_rank     (aliased in view)
//   oi_velocity    ← component_oi_velocity (aliased in view)
//   oi_velocity_z  ← hardcoded 0::numeric  (not in source table)
//   gex_abs        ← component_gex         (aliased in view)
//
// Required view DDL (run once in pgAdmin):
//   CREATE OR REPLACE VIEW nifty_premium_tracking.v_active_oi_zones AS
//   SELECT z.id, z.detected_at, z.expiry_date, z.strike_price, z.option_type,
//          z.zone_type, z.zone_strength, z.spot_price, z.distance_from_spot,
//          z.distance_pct, z.oi_at_detection, z.ltp_at_detection, z.iv_at_detection,
//          z.component_oi_rank       AS oi_rank,
//          z.component_oi_velocity   AS oi_velocity,
//          0::numeric                AS oi_velocity_z,
//          z.component_gex           AS gex_abs,
//          z.component_sweep_count, z.component_iv_move,
//          z.resolved_at, z.resolution_type, z.active,
//          EXTRACT(EPOCH FROM (NOW() - z.detected_at))/60 AS age
//   FROM nifty_premium_tracking.oi_zone_events z
//   WHERE z.active = true
//   ORDER BY z.zone_strength DESC;

function mapZoneRow(r: any): Record<string, any> {
  return {
    id:               r.id,
    detectedAt:       r.detected_at,
    expiry:           r.expiry_date,
    strike:           parseFloat(r.strike_price),
    optionType:       r.option_type,
    zoneType:         r.zone_type               ?? 'HIGH_OI_BUILDUP',
    zoneStrength:     parseFloat(r.zone_strength      ?? 0),
    spot:             parseFloat(r.spot_price         ?? 0),
    distanceFromSpot: parseFloat(r.distance_from_spot ?? 0),
    distancePct:      parseFloat(r.distance_pct       ?? 0),
    oi:               parseInt(r.oi_at_detection      ?? 0),   // ✅ `oi` — matches OIZone + frontend
    oiRank:           parseInt(r.oi_rank              ?? 0),   // ✅ from view alias component_oi_rank
    oiVelocity:       parseFloat(r.oi_velocity        ?? 0),   // ✅ from view alias component_oi_velocity
    oiVelocityZ:      parseFloat(r.oi_velocity_z      ?? 0),   // ✅ 0 until source column added
    gexAbs:           parseFloat(r.gex_abs            ?? 0),   // ✅ from view alias component_gex
    ltp:              parseFloat(r.ltp_at_detection   ?? 0),
    iv:               parseFloat(r.iv_at_detection    ?? 0),
    sweepCount:       parseInt(r.component_sweep_count ?? 0),
    age:              r.age,
    active:           r.active,
  };
}