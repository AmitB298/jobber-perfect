import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function downloadSymbolMaster() {
  try {
    console.log('📥 Downloading Angel One symbol master...');
    
    // Angel One symbol master URL
    const url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
    
    const response = await axios.get(url);
    
    // Save to file
    const filePath = path.join(__dirname, 'symbol_master.json');
    fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
    
    console.log(`✅ Symbol master saved to: ${filePath}`);
    console.log(`📊 Total symbols: ${response.data.length}`);
    
    // Filter NIFTY options
    const niftyOptions = response.data.filter((item: any) => 
      item.name === 'NIFTY' && 
      item.exch_seg === 'NFO' &&
      (item.symbol.includes('CE') || item.symbol.includes('PE'))
    );
    
    console.log(`🎯 NIFTY Options found: ${niftyOptions.length}`);
    
    // Save NIFTY options separately
    const niftyPath = path.join(__dirname, 'nifty_options.json');
    fs.writeFileSync(niftyPath, JSON.stringify(niftyOptions, null, 2));
    
    console.log(`✅ NIFTY options saved to: ${niftyPath}`);
    
    // Show sample
    console.log('\n📋 Sample NIFTY options:');
    niftyOptions.slice(0, 5).forEach((opt: any) => {
      console.log(`   ${opt.symbol} | Token: ${opt.token} | Strike: ${opt.strike}`);
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

downloadSymbolMaster();