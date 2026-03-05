import { createAngelOneService } from '../services/angelone.service';
import pool from '../database/db';

interface NiftyData {
  ltp: number;
  timestamp: Date;
}

async function collectNiftyData() {
  const angelService = createAngelOneService();
  
  try {
    // Login
    console.log('🔐 Logging in to Angel One...');
    const loginResult = await angelService.login();
    
    if (!loginResult.success) {
      console.error('❌ Login failed:', loginResult.message);
      process.exit(1);
    }
    
    console.log('✅ Logged in successfully');
    console.log('🚀 Starting NIFTY data collection...');
    console.log('📊 Collecting data every 1 second');
    console.log('⏸️  Press Ctrl+C to stop\n');
    
    // Collect data every 1 second
    let count = 0;
    setInterval(async () => {
      try {
        const ltp = await angelService.getLTP('NSE', 'NIFTY', '99926000');
        const timestamp = new Date();
        count++;
        
        // Save to database
        await pool.query(
          `INSERT INTO nifty_premium_tracking.market_data 
           (symbol, exchange, ltp, timestamp, user_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          ['NIFTY', 'NSE', ltp, timestamp, 1]
        );
        
        console.log(`[${count}] 📊 NIFTY: ₹${ltp.toFixed(2)} | ${timestamp.toLocaleTimeString()}`);
      } catch (error: any) {
        console.error('❌ Collection error:', error.message);
      }
    }, 1000); // Every 1 second
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Stopping data collection...');
  await pool.end();
  console.log('✅ Database connection closed');
  process.exit(0);
});

collectNiftyData();