import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import { calculateChainGreeks, getNextNiftyExpiry } from './greeks-calculator';

const app = express();
const port = 3001;

// Database connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jobber_pro',
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ============================================================
// 📊 SPOT PRICE
// ============================================================
app.get('/api/spot/nifty', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT symbol, ltp, timestamp
      FROM nifty_premium_tracking.market_data
      WHERE symbol = 'NIFTY'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    res.json({
      success: true,
      data: result.rows[0] || null,
    });
  } catch (error) {
    console.error('Error fetching spot price:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch spot price' });
  }
});

// ============================================================
// 📈 OPTIONS CHAIN (ATM ±500)
// ============================================================
app.get('/api/options/chain', async (req: Request, res: Response) => {
  try {
    // Get latest spot price
    const spotResult = await pool.query(`
      SELECT ltp as spot_price
      FROM nifty_premium_tracking.market_data
      WHERE symbol = 'NIFTY'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    const spotPrice = spotResult.rows[0]?.spot_price || 25500;
    const atmStrike = Math.round(spotPrice / 50) * 50;
    const minStrike = atmStrike - 500;
    const maxStrike = atmStrike + 500;
    
    // Get latest options data
    const optionsResult = await pool.query(`
      WITH latest_options AS (
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price,
          option_type,
          ltp,
          volume,
          oi,
          timestamp
        FROM nifty_premium_tracking.options_data
        WHERE timestamp > NOW() - INTERVAL '72 hours'
          AND strike_price BETWEEN $1 AND $2
        ORDER BY strike_price, option_type, timestamp DESC
      )
      SELECT 
        strike_price,
        MAX(CASE WHEN option_type = 'CE' THEN ltp END) as ce_ltp,
        MAX(CASE WHEN option_type = 'PE' THEN ltp END) as pe_ltp,
        MAX(CASE WHEN option_type = 'CE' THEN volume END) as ce_volume,
        MAX(CASE WHEN option_type = 'PE' THEN volume END) as pe_volume,
        MAX(CASE WHEN option_type = 'CE' THEN oi END) as ce_oi,
        MAX(CASE WHEN option_type = 'PE' THEN oi END) as pe_oi
      FROM latest_options
      GROUP BY strike_price
      ORDER BY strike_price
    `, [minStrike, maxStrike]);
    
    // Calculate PCR
    const pcrResult = await pool.query(`
      WITH latest_options AS (
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price,
          option_type,
          oi,
          volume
        FROM nifty_premium_tracking.options_data
        WHERE timestamp > NOW() - INTERVAL '72 hours'
          AND strike_price BETWEEN $1 AND $2
        ORDER BY strike_price, option_type, timestamp DESC
      )
      SELECT 
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN oi ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN oi ELSE 0 END), 0), 2) as pcr_oi,
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN volume ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN volume ELSE 0 END), 0), 2) as pcr_volume
      FROM latest_options
    `, [minStrike, maxStrike]);
    
    // Calculate Max Pain
    let maxPain = atmStrike;
    let minPain = Infinity;
    
    for (const row of optionsResult.rows) {
      const strike = row.strike_price;
      let pain = 0;
      
      for (const otherRow of optionsResult.rows) {
        const otherStrike = otherRow.strike_price;
        const otherCE_OI = otherRow.ce_oi || 0;
        const otherPE_OI = otherRow.pe_oi || 0;
        
        if (otherStrike < strike) {
          pain += (strike - otherStrike) * otherPE_OI;
        }
        if (otherStrike > strike) {
          pain += (otherStrike - strike) * otherCE_OI;
        }
      }
      
      if (pain < minPain) {
        minPain = pain;
        maxPain = strike;
      }
    }
    
    // Count total ticks
    const statsResult = await pool.query(`
      SELECT COUNT(*) as total_ticks
      FROM nifty_premium_tracking.options_data
      WHERE timestamp > NOW() - INTERVAL '72 hours'
    `);
    
    res.json({
      success: true,
      data: {
        spotPrice,
        spotChange: 0,
        spotChangePercent: 0,
        atmStrike,
        pcr_oi: Number(pcrResult.rows[0]?.pcr_oi) || 0,
        pcr_volume: Number(pcrResult.rows[0]?.pcr_volume) || 0,
        maxPain,
        totalTicks: Number(statsResult.rows[0]?.total_ticks) || 0,
        chain: optionsResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching options chain:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch options chain' });
  }
});

// ============================================================
// 🧮 OPTIONS CHAIN WITH GREEKS & IV (NEW!)
// ============================================================
app.get('/api/options/greeks', async (req: Request, res: Response) => {
  try {
    // Get latest spot price
    const spotResult = await pool.query(`
      SELECT ltp as spot_price
      FROM nifty_premium_tracking.market_data
      WHERE symbol = 'NIFTY'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    const spotPrice = spotResult.rows[0]?.spot_price || 25500;
    const atmStrike = Math.round(spotPrice / 50) * 50;
    const minStrike = atmStrike - 500;
    const maxStrike = atmStrike + 500;
    
    // Get latest options data
    const optionsResult = await pool.query(`
      WITH latest_options AS (
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price,
          option_type,
          ltp,
          volume,
          oi,
          timestamp
        FROM nifty_premium_tracking.options_data
        WHERE timestamp > NOW() - INTERVAL '72 hours'
          AND strike_price BETWEEN $1 AND $2
        ORDER BY strike_price, option_type, timestamp DESC
      )
      SELECT 
        strike_price,
        MAX(CASE WHEN option_type = 'CE' THEN ltp END) as ce_ltp,
        MAX(CASE WHEN option_type = 'PE' THEN ltp END) as pe_ltp,
        MAX(CASE WHEN option_type = 'CE' THEN volume END) as ce_volume,
        MAX(CASE WHEN option_type = 'PE' THEN volume END) as pe_volume,
        MAX(CASE WHEN option_type = 'CE' THEN oi END) as ce_oi,
        MAX(CASE WHEN option_type = 'PE' THEN oi END) as pe_oi
      FROM latest_options
      GROUP BY strike_price
      ORDER BY strike_price
    `, [minStrike, maxStrike]);
    
    // Calculate Greeks for the entire chain
    const chainWithGreeks = calculateChainGreeks(
      optionsResult.rows,
      spotPrice,
      getNextNiftyExpiry()
    );
    
    // Calculate PCR
    const pcrResult = await pool.query(`
      WITH latest_options AS (
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price,
          option_type,
          oi,
          volume
        FROM nifty_premium_tracking.options_data
        WHERE timestamp > NOW() - INTERVAL '72 hours'
          AND strike_price BETWEEN $1 AND $2
        ORDER BY strike_price, option_type, timestamp DESC
      )
      SELECT 
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN oi ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN oi ELSE 0 END), 0), 2) as pcr_oi,
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN volume ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN volume ELSE 0 END), 0), 2) as pcr_volume
      FROM latest_options
    `, [minStrike, maxStrike]);
    
    // Calculate Max Pain
    let maxPain = atmStrike;
    let minPain = Infinity;
    
    for (const row of optionsResult.rows) {
      const strike = row.strike_price;
      let pain = 0;
      
      for (const otherRow of optionsResult.rows) {
        const otherStrike = otherRow.strike_price;
        const otherCE_OI = otherRow.ce_oi || 0;
        const otherPE_OI = otherRow.pe_oi || 0;
        
        if (otherStrike < strike) {
          pain += (strike - otherStrike) * otherPE_OI;
        }
        if (otherStrike > strike) {
          pain += (otherStrike - strike) * otherCE_OI;
        }
      }
      
      if (pain < minPain) {
        minPain = pain;
        maxPain = strike;
      }
    }
    
    // Count total ticks
    const statsResult = await pool.query(`
      SELECT COUNT(*) as total_ticks
      FROM nifty_premium_tracking.options_data
      WHERE timestamp > NOW() - INTERVAL '72 hours'
    `);
    
    res.json({
      success: true,
      data: {
        spotPrice,
        spotChange: 0,
        spotChangePercent: 0,
        atmStrike,
        pcr_oi: Number(pcrResult.rows[0]?.pcr_oi) || 0,
        pcr_volume: Number(pcrResult.rows[0]?.pcr_volume) || 0,
        maxPain,
        totalTicks: Number(statsResult.rows[0]?.total_ticks) || 0,
        chain: chainWithGreeks,
        expiryDate: getNextNiftyExpiry().toISOString()
      },
    });
  } catch (error) {
    console.error('Error fetching Greeks data:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate Greeks' });
  }
});

// ============================================================
// 📊 PUT-CALL RATIO (PCR)
// ============================================================
app.get('/api/analytics/pcr', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN oi ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN oi ELSE 0 END), 0), 2) as pcr_oi,
        ROUND(SUM(CASE WHEN option_type = 'PE' THEN volume ELSE 0 END)::NUMERIC / 
              NULLIF(SUM(CASE WHEN option_type = 'CE' THEN volume ELSE 0 END), 0), 2) as pcr_volume,
        MAX(timestamp) as calculated_at
      FROM nifty_premium_tracking.options_data
      WHERE timestamp > NOW() - INTERVAL '72 hours'
    `);
    
    res.json({
      success: true,
      data: result.rows[0] || { pcr_oi: null, pcr_volume: null },
    });
  } catch (error) {
    console.error('Error calculating PCR:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate PCR' });
  }
});

// ============================================================
// 💰 MAX PAIN CALCULATION
// ============================================================
app.get('/api/analytics/max-pain', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      WITH latest_oi AS (
        SELECT DISTINCT ON (strike_price, option_type)
          strike_price,
          option_type,
          oi
        FROM nifty_premium_tracking.options_data
        WHERE timestamp > NOW() - INTERVAL '72 hours'
        ORDER BY strike_price, option_type, timestamp DESC
      ),
      strike_list AS (
        SELECT DISTINCT strike_price
        FROM latest_oi
      ),
      pain_calculation AS (
        SELECT 
          s.strike_price as test_strike,
          SUM(
            CASE 
              WHEN o.option_type = 'CE' AND o.strike_price < s.strike_price 
              THEN (s.strike_price - o.strike_price) * o.oi
              WHEN o.option_type = 'PE' AND o.strike_price > s.strike_price 
              THEN (o.strike_price - s.strike_price) * o.oi
              ELSE 0 
            END
          ) as total_pain
        FROM strike_list s
        CROSS JOIN latest_oi o
        GROUP BY s.strike_price
      )
      SELECT 
        test_strike as max_pain_strike,
        total_pain
      FROM pain_calculation
      ORDER BY total_pain ASC
      LIMIT 1
    `);
    
    res.json({
      success: true,
      data: result.rows[0] || null,
    });
  } catch (error) {
    console.error('Error calculating max pain:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate max pain' });
  }
});

// ============================================================
// 📈 PREMIUM HISTORY (5-min chart data)
// ============================================================
app.get('/api/options/:symbol/history', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const minutes = parseInt(req.query.minutes as string) || 5;
    
    const result = await pool.query(`
      SELECT 
        trading_symbol,
        ltp,
        volume,
        oi,
        timestamp
      FROM nifty_premium_tracking.options_data
      WHERE trading_symbol = $1
        AND timestamp > NOW() - INTERVAL '${minutes} minutes'
      ORDER BY timestamp ASC
    `, [symbol]);
    
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

// ============================================================
// 📊 SYSTEM STATISTICS
// ============================================================
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT trading_symbol) as unique_options,
        MAX(timestamp) as latest_tick,
        MIN(timestamp) as first_tick
      FROM nifty_premium_tracking.options_data
      WHERE timestamp > NOW() - INTERVAL '72 hours'
    `);
    
    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// ============================================================
// 🔴 LIVE STREAM (Server-Sent Events)
// ============================================================
app.get('/api/stream/live', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  // Query database every second for latest data
  const interval = setInterval(async () => {
    try {
      // Get latest spot
      const spotResult = await pool.query(`
        SELECT symbol, ltp, timestamp
        FROM nifty_premium_tracking.market_data
        WHERE symbol = 'NIFTY'
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      
      // Get latest options (ATM ±3 strikes)
      const spotPrice = spotResult.rows[0]?.ltp || 25500;
      const atmStrike = Math.round(spotPrice / 50) * 50;
      
      const optionsResult = await pool.query(`
        WITH latest_options AS (
          SELECT DISTINCT ON (strike_price, option_type)
            strike_price,
            option_type,
            ltp,
            volume,
            oi
          FROM nifty_premium_tracking.options_data
          WHERE timestamp > NOW() - INTERVAL '2 seconds'
            AND strike_price BETWEEN $1 AND $2
          ORDER BY strike_price, option_type, timestamp DESC
        )
        SELECT * FROM latest_options
        ORDER BY strike_price, option_type
      `, [atmStrike - 150, atmStrike + 150]);
      
      const data = {
        timestamp: new Date().toISOString(),
        spot: spotResult.rows[0],
        options: optionsResult.rows,
      };
      
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error('Stream error:', error);
    }
  }, 1000);
  
  // Cleanup on close
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

// ============================================================
// 🚀 START SERVER
// ============================================================
app.listen(port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          🚀 NIFTY OPTIONS API SERVER RUNNING 🚀             ║
╠══════════════════════════════════════════════════════════════╣
║  Port:           ${port}                                        ║
║  Database:       jobber_pro                                  ║
║  Status:         ✅ READY                                    ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║  GET  /api/spot/nifty          - Latest spot price          ║
║  GET  /api/options/chain       - Options chain (ATM ±500)   ║
║  GET  /api/options/greeks      - ⚡ WITH GREEKS & IV ⚡      ║
║  GET  /api/analytics/pcr       - Put-Call Ratio             ║
║  GET  /api/analytics/max-pain  - Max Pain calculation       ║
║  GET  /api/options/:symbol/history - Premium history        ║
║  GET  /api/stats               - System statistics          ║
║  GET  /api/stream/live         - Live SSE stream            ║
╚══════════════════════════════════════════════════════════════╝
  `);
});