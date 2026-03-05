/**
 * excel-routes.ts
 * Location: D:\jobber-perfect\backend\excel-routes.ts
 *
 * All 11 Excel/Snapshot API endpoints
 * Wire in api-server.ts with:
 *   import { registerExcelRoutes } from './excel-routes';
 *   registerExcelRoutes(app, pool, () => getLiveChainData());
 */

import { Application, Request, Response } from 'express';
import { Pool } from 'pg';
import { exportToExcel, buildExcelWorkbook, ChainRow } from './excel-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveChainGetter {
  (): Promise<{
    spotPrice: number;
    atmStrike: number;
    pcr_oi: number;
    pcr_volume: number;
    maxPain: number;
    expiryDate: string;
    daysToExpiry: number;
    chain: ChainRow[];
  }>;
}

// ─── Register all routes ─────────────────────────────────────────────────────

export function registerExcelRoutes(
  app: Application,
  pool: Pool,
  getLiveChain: LiveChainGetter
): void {

  // ──────────────────────────────────────────────────────────────
  // 1. LIVE EXPORT — download Excel of current chain
  // GET /api/excel/export
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/export', async (req: Request, res: Response) => {
    try {
      const data = await getLiveChain();
      const buffer = await exportToExcel({
        ...data,
        exportedAt: new Date(),
      });

      const filename = `NIFTY_${new Date().toISOString().slice(0, 16).replace('T', '_')}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error('Excel export error:', err);
      res.status(500).json({ success: false, error: err?.message ?? 'Export failed' });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 2. SAVE SNAPSHOT — save chain to DB
  // POST /api/excel/snapshot
  // Body: { label?: string, tags?: string[], notes?: string }
  // ──────────────────────────────────────────────────────────────
  app.post('/api/excel/snapshot', async (req: Request, res: Response) => {
    try {
      const { label, tags = [], notes = '' } = req.body;
      const data = await getLiveChain();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS nifty_premium_tracking.snapshots (
          id SERIAL PRIMARY KEY,
          label TEXT,
          captured_at TIMESTAMPTZ DEFAULT NOW(),
          spot_price NUMERIC,
          atm_strike INTEGER,
          atm_iv NUMERIC,
          pcr_oi NUMERIC,
          days_to_expiry INTEGER,
          row_count INTEGER,
          expiry_date DATE,
          tags TEXT[],
          notes TEXT,
          chain_json JSONB
        )
      `);

      const atmRow = data.chain.find(r => r.strike_price === data.atmStrike);
      const result = await pool.query(`
        INSERT INTO nifty_premium_tracking.snapshots
          (label, spot_price, atm_strike, atm_iv, pcr_oi, days_to_expiry, row_count, expiry_date, tags, notes, chain_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id, captured_at
      `, [
        label || `Snapshot ${new Date().toLocaleString('en-IN')}`,
        data.spotPrice,
        data.atmStrike,
        atmRow?.ce_iv ?? null,
        data.pcr_oi,
        data.daysToExpiry,
        data.chain.length,
        data.expiryDate || null,
        tags,
        notes,
        JSON.stringify(data.chain),
      ]);

      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      console.error('Snapshot save error:', err);
      res.status(500).json({ success: false, error: err?.message ?? 'Snapshot failed' });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 3. LIST SNAPSHOTS
  // GET /api/excel/snapshots
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/snapshots', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT id, label, captured_at, spot_price, atm_strike, atm_iv,
               pcr_oi, days_to_expiry, row_count, expiry_date, tags, notes
        FROM nifty_premium_tracking.snapshots
        ORDER BY captured_at DESC
        LIMIT 100
      `);
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 4. COMPARE TWO SNAPSHOTS
  // GET /api/excel/snapshots/compare?id1=X&id2=Y
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/snapshots/compare', async (req: Request, res: Response) => {
    try {
      const { id1, id2 } = req.query;
      if (!id1 || !id2) {
        return res.status(400).json({ success: false, error: 'id1 and id2 required' });
      }

      const r = await pool.query(
        'SELECT id, label, captured_at, spot_price, chain_json FROM nifty_premium_tracking.snapshots WHERE id = ANY($1)',
        [[Number(id1), Number(id2)]]
      );

      if (r.rows.length < 2) {
        return res.status(404).json({ success: false, error: 'One or both snapshots not found' });
      }

      const [s1, s2] = r.rows.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
      const c1: ChainRow[] = s1.chain_json;
      const c2: ChainRow[] = s2.chain_json;

      // Build comparison: OI changes per strike
      const strikes = [...new Set([...c1.map(r => r.strike_price), ...c2.map(r => r.strike_price)])].sort();
      const comparison = strikes.map(strike => {
        const before = c1.find(r => r.strike_price === strike);
        const after  = c2.find(r => r.strike_price === strike);
        return {
          strike,
          ce_oi_before:  before?.ce_oi ?? 0,
          ce_oi_after:   after?.ce_oi  ?? 0,
          ce_oi_delta:   (after?.ce_oi ?? 0) - (before?.ce_oi ?? 0),
          pe_oi_before:  before?.pe_oi ?? 0,
          pe_oi_after:   after?.pe_oi  ?? 0,
          pe_oi_delta:   (after?.pe_oi ?? 0) - (before?.pe_oi ?? 0),
        };
      });

      // Top 5 builds / unwinds
      const ceBuilds   = [...comparison].sort((a, b) => b.ce_oi_delta - a.ce_oi_delta).slice(0, 5);
      const peBuilds   = [...comparison].sort((a, b) => b.pe_oi_delta - a.pe_oi_delta).slice(0, 5);
      const ceUnwinds  = [...comparison].sort((a, b) => a.ce_oi_delta - b.ce_oi_delta).slice(0, 5);
      const peUnwinds  = [...comparison].sort((a, b) => a.pe_oi_delta - b.pe_oi_delta).slice(0, 5);

      res.json({
        success: true,
        data: {
          snapshot1: { id: s1.id, label: s1.label, captured_at: s1.captured_at, spot_price: s1.spot_price },
          snapshot2: { id: s2.id, label: s2.label, captured_at: s2.captured_at, spot_price: s2.spot_price },
          comparison,
          summary: { ceBuilds, peBuilds, ceUnwinds, peUnwinds },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 5. GET SNAPSHOT BY ID
  // GET /api/excel/snapshot/:id
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/snapshot/:id', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        'SELECT * FROM nifty_premium_tracking.snapshots WHERE id = $1',
        [Number(req.params.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: 'Snapshot not found' });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 6. EXPORT SNAPSHOT AS EXCEL
  // GET /api/excel/snapshot/:id/export
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/snapshot/:id/export', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        'SELECT * FROM nifty_premium_tracking.snapshots WHERE id = $1',
        [Number(req.params.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: 'Snapshot not found' });
      }

      const snap = result.rows[0];
      const buffer = await exportToExcel({
        spotPrice: snap.spot_price,
        atmStrike: snap.atm_strike,
        pcr_oi: snap.pcr_oi ?? 1,
        pcr_volume: 1,
        maxPain: snap.atm_strike,
        expiryDate: snap.expiry_date ? new Date(snap.expiry_date).toLocaleDateString('en-IN') : '',
        daysToExpiry: snap.days_to_expiry ?? 0,
        chain: snap.chain_json,
        exportedAt: new Date(snap.captured_at),
        snapshotLabel: snap.label,
      });

      const filename = `Snapshot_${snap.id}_${snap.label?.replace(/\s+/g, '_') ?? 'export'}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 7. UPDATE SNAPSHOT (label/tags/notes)
  // PATCH /api/excel/snapshot/:id
  // ──────────────────────────────────────────────────────────────
  app.patch('/api/excel/snapshot/:id', async (req: Request, res: Response) => {
    try {
      const { label, tags, notes } = req.body;
      const result = await pool.query(`
        UPDATE nifty_premium_tracking.snapshots
        SET label = COALESCE($1, label),
            tags  = COALESCE($2, tags),
            notes = COALESCE($3, notes)
        WHERE id = $4
        RETURNING id, label, tags, notes
      `, [label ?? null, tags ?? null, notes ?? null, Number(req.params.id)]);

      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: 'Snapshot not found' });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 8. DELETE SNAPSHOTS
  // DELETE /api/excel/snapshots
  // Body: { ids?: number[], olderThanDays?: number, beforeDate?: string, tags?: string[] }
  // ──────────────────────────────────────────────────────────────
  app.delete('/api/excel/snapshots', async (req: Request, res: Response) => {
    try {
      const { ids, olderThanDays, beforeDate, tags } = req.body;
      let result;

      if (ids?.length) {
        result = await pool.query(
          'DELETE FROM nifty_premium_tracking.snapshots WHERE id = ANY($1) RETURNING id',
          [ids]
        );
      } else if (olderThanDays) {
        result = await pool.query(
          'DELETE FROM nifty_premium_tracking.snapshots WHERE captured_at < NOW() - ($1 || \' days\')::INTERVAL RETURNING id',
          [olderThanDays]
        );
      } else if (beforeDate) {
        result = await pool.query(
          'DELETE FROM nifty_premium_tracking.snapshots WHERE captured_at < $1 RETURNING id',
          [beforeDate]
        );
      } else if (tags?.length) {
        result = await pool.query(
          'DELETE FROM nifty_premium_tracking.snapshots WHERE tags && $1 RETURNING id',
          [tags]
        );
      } else {
        return res.status(400).json({ success: false, error: 'Specify ids, olderThanDays, beforeDate, or tags' });
      }

      res.json({ success: true, deleted: result.rows.map((r: any) => r.id), count: result.rowCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 9. AUTO-SCHEDULE: toggle auto-snapshot
  // POST /api/excel/autosave/start  |  POST /api/excel/autosave/stop
  // Body (start): { intervalMinutes?: number, label?: string }
  // ──────────────────────────────────────────────────────────────
  let autoSaveTimer: NodeJS.Timeout | null = null;
  let autoSaveCount = 0;

  app.post('/api/excel/autosave/start', async (req: Request, res: Response) => {
    if (autoSaveTimer) {
      return res.json({ success: false, message: 'Auto-save already running' });
    }
    const intervalMinutes = Number(req.body.intervalMinutes) || 5;
    const labelPrefix = req.body.label || 'Auto';

    autoSaveTimer = setInterval(async () => {
      try {
        const data = await getLiveChain();
        autoSaveCount++;
        const atmRow = data.chain.find(r => r.strike_price === data.atmStrike);
        await pool.query(`
          INSERT INTO nifty_premium_tracking.snapshots
            (label, spot_price, atm_strike, atm_iv, pcr_oi, days_to_expiry, row_count, expiry_date, tags, chain_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          `${labelPrefix} #${autoSaveCount} — ${new Date().toLocaleTimeString('en-IN')}`,
          data.spotPrice, data.atmStrike, atmRow?.ce_iv ?? null,
          data.pcr_oi, data.daysToExpiry, data.chain.length,
          data.expiryDate || null,
          ['auto'],
          JSON.stringify(data.chain),
        ]);
        console.log(`[AutoSave] Snapshot #${autoSaveCount} saved`);
      } catch (e) {
        console.error('[AutoSave] Error:', e);
      }
    }, intervalMinutes * 60 * 1000);

    res.json({ success: true, message: `Auto-save started every ${intervalMinutes} minutes` });
  });

  app.post('/api/excel/autosave/stop', (_req: Request, res: Response) => {
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer);
      autoSaveTimer = null;
    }
    res.json({ success: true, message: 'Auto-save stopped', totalSaved: autoSaveCount });
  });

  // ──────────────────────────────────────────────────────────────
  // 10. AUTO-SAVE STATUS
  // GET /api/excel/autosave/status
  // ──────────────────────────────────────────────────────────────
  app.get('/api/excel/autosave/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { running: !!autoSaveTimer, totalSaved: autoSaveCount },
    });
  });

  console.log('✅ Excel routes registered: /api/excel/*');
}