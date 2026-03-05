import { createAngelOneService } from '../services/angelone.service';
import pool from '../database/db';
import * as fs from 'fs';
import * as path from 'path';

interface NiftyOption {
  name: string;
  token: string;
  symbol: string;
  strike: string;
  expiry: string;
  lotsize: number;
  exch_seg: string;
}

async function collectNiftyOptions() {
  const angelService = createAngelOneService();
  
  try {
    console.log('🔐 Logging in to Angel One...');
    const loginResult = await angelService.login();
    
    if (!loginResult.success) {
      console.error('❌ Login failed:', loginResult.message);
      process.exit(1);
    }
    
    console.log('✅ Logged in successfully');
    
    // Load NIFTY options
    const symbolPath = path.join(__dirname, 'nifty_options.json');
    
    if (!fs.existsSync(symbolPath)) {
      console.error('❌ Symbol master not found!');
      console.log('💡 Run: npx ts-node src/scripts/download-symbols.ts');
      process.exit(1);
    }
    
    const allOptions: NiftyOption[] = JSON.parse(fs.readFileSync(symbolPath, 'utf-8'));
    
    // Get current NIFTY price
    const niftyLtp = await angelService.getLTP('NSE', 'NIFTY', '99926000');
    console.log(`📈 Current NIFTY: ₹${niftyLtp.toFixed(2)}\n`);
    
    // Find ATM strike
    const atmStrike = Math.round(niftyLtp / 50) * 50;
    console.log(`🎯 ATM Strike: ${atmStrike}\n`);
    
    // Get current week expiry options
    const today = new Date();
    const validOptions = allOptions
      .filter(opt => {
        try {
          // FIXED: Symbol format is NIFTY + DDMMMYY + STRIKE + CE/PE
          // Example: NIFTY13FEB2625800CE
          const expiryMatch = opt.symbol.match(/NIFTY(\d{2}[A-Z]{3}\d{2})/);
          if (!expiryMatch) return false;
          
          const expiryStr = expiryMatch[1]; // e.g., "13FEB26"
          const day = expiryStr.substring(0, 2);
          const month = expiryStr.substring(2, 5);
          const year = '20' + expiryStr.substring(5, 7);
          
          const monthMap: any = {
            'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
            'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
          };
          
          const expiryDate = new Date(parseInt(year), monthMap[month], parseInt(day));
          return expiryDate > today;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        const getExpiry = (opt: NiftyOption) => {
          const match = opt.symbol.match(/NIFTY(\d{2}[A-Z]{3}\d{2})/);
          if (!match) return new Date(0);
          const str = match[1];
          const monthMap: any = {
            'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
            'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
          };
          const year = '20' + str.substring(5, 7);
          return new Date(
            parseInt(year),
            monthMap[str.substring(2, 5)],
            parseInt(str.substring(0, 2))
          );
        };
        return getExpiry(a).getTime() - getExpiry(b).getTime();
      });
    
    if (validOptions.length === 0) {
      console.error('❌ No valid options found');
      process.exit(1);
    }
    
    // Get expiry from first option
    const firstExpiry = validOptions[0].symbol.match(/NIFTY(\d{2}[A-Z]{3}\d{2})/)?.[1];
    console.log(`📅 Current Expiry: ${firstExpiry}`);
    
    // Filter options: strikes are stored as strike * 100
    const minStrike = (atmStrike - 500) * 100;
    const maxStrike = (atmStrike + 500) * 100;
    
    const tradableOptions = validOptions.filter(opt => {
      const strikeValue = parseFloat(opt.strike);
      const hasCurrentExpiry = opt.symbol.includes(firstExpiry!);
      const inRange = strikeValue >= minStrike && strikeValue <= maxStrike;
      
      return hasCurrentExpiry && inRange;
    });
    
    console.log(`📊 Collecting ${tradableOptions.length} options (strikes ${atmStrike - 500} to ${atmStrike + 500})\n`);
    
    if (tradableOptions.length === 0) {
      console.error('❌ No tradable options found');
      console.log('\n📋 Sample options from file:');
      validOptions.slice(0, 10).forEach(opt => {
        const strike = parseFloat(opt.strike) / 100;
        console.log(`   ${opt.symbol} | Strike: ${strike}`);
      });
      process.exit(1);
    }
    
    // Collect data every 10 seconds
    let collectionCount = 0;
    
    setInterval(async () => {
      try {
        collectionCount++;
        console.log(`\n[Collection #${collectionCount}] ${new Date().toLocaleTimeString()}`);
        
        let savedCount = 0;
        const batchSize = 10;
        
        for (let i = 0; i < tradableOptions.length; i += batchSize) {
          const batch = tradableOptions.slice(i, i + batchSize);
          
          for (const option of batch) {
            try {
              const ltp = await angelService.getLTP('NFO', option.symbol, option.token);
              
              const optionType = option.symbol.includes('CE') ? 'CE' : 'PE';
              const strikePrice = parseFloat(option.strike) / 100;
              
              await pool.query(`
                INSERT INTO nifty_premium_tracking.options_data 
                (symbol, expiry_date, strike_price, option_type, exchange, 
                 trading_symbol, token, ltp, timestamp, user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `, ['NIFTY', firstExpiry, strikePrice, optionType, 'NFO', 
                  option.symbol, option.token, ltp, new Date(), 1]);
              
              savedCount++;
              await new Promise(resolve => setTimeout(resolve, 100));
              
            } catch (err: any) {
              if (err.message && err.message.includes('403')) {
                console.log('⚠️  Rate limit, slowing...');
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`✅ Saved ${savedCount} records`);
        
      } catch (error: any) {
        console.error('❌ Error:', error.message);
      }
    }, 10000);
    
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Stopping...');
  await pool.end();
  console.log('✅ Closed');
  process.exit(0);
});

collectNiftyOptions();