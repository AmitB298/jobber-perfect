// src/services/calculations.ts - Advanced Options Calculations

// ============================================================================
// TYPES
// ============================================================================

export interface OptionData {
  strike_price: number;
  ce_ltp: number | null;
  pe_ltp: number | null;
  ce_volume: number | null;
  pe_volume: number | null;
  ce_oi: number | null;
  pe_oi: number | null;
}

export interface PriceStructure {
  strongSupport: number[];
  support: number[];
  resistance: number[];
  strongResistance: number[];
  pivotPoint: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export interface OIAnalysis {
  totalCE_OI: number;
  totalPE_OI: number;
  pcr_oi: number;
  maxPainStrike: number;
  oiBuildupStrikes: number[];
  oiUnwindingStrikes: number[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface VolumeAnalysis {
  totalCE_Volume: number;
  totalPE_Volume: number;
  pcr_volume: number;
  highVolumeStrikes: number[];
  volumeSpikes: Array<{ strike: number; ratio: number }>;
}

export interface PremiumPrediction {
  direction: 'up' | 'down' | 'sideways';
  confidence: number; // 0-100
  targetStrikes: number[];
  signals: string[];
  timeframe: '5min' | '15min' | '1hour';
}

export interface MarketSentiment {
  overall: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  indicators: {
    pcr_oi: 'bullish' | 'bearish' | 'neutral';
    pcr_volume: 'bullish' | 'bearish' | 'neutral';
    maxPain: 'bullish' | 'bearish' | 'neutral';
    volume: 'bullish' | 'bearish' | 'neutral';
  };
}

// ============================================================================
// PRICE STRUCTURE ANALYSIS
// ============================================================================

export function analyzePriceStructure(
  spotPrice: number,
  optionsData: OptionData[]
): PriceStructure {
  // Calculate OI distribution
  const strikes = optionsData.map(d => d.strike_price).sort((a, b) => a - b);
  
  // Find strikes with high OI (potential support/resistance)
  const oiLevels = optionsData.map(d => ({
    strike: d.strike_price,
    totalOI: (d.ce_oi || 0) + (d.pe_oi || 0),
    ceOI: d.ce_oi || 0,
    peOI: d.pe_oi || 0,
  })).sort((a, b) => b.totalOI - a.totalOI);

  // Support levels (strikes below spot with high PE OI)
  const support = oiLevels
    .filter(l => l.strike < spotPrice && l.peOI > l.ceOI)
    .slice(0, 3)
    .map(l => l.strike);

  // Strong support (highest PE OI below spot)
  const strongSupport = oiLevels
    .filter(l => l.strike < spotPrice)
    .sort((a, b) => b.peOI - a.peOI)
    .slice(0, 2)
    .map(l => l.strike);

  // Resistance levels (strikes above spot with high CE OI)
  const resistance = oiLevels
    .filter(l => l.strike > spotPrice && l.ceOI > l.peOI)
    .slice(0, 3)
    .map(l => l.strike);

  // Strong resistance (highest CE OI above spot)
  const strongResistance = oiLevels
    .filter(l => l.strike > spotPrice)
    .sort((a, b) => b.ceOI - a.ceOI)
    .slice(0, 2)
    .map(l => l.strike);

  // Pivot point calculation
  const high = Math.max(...strikes);
  const low = Math.min(...strikes);
  const pivotPoint = (high + low + spotPrice) / 3;

  // Trend detection based on spot vs pivot
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (spotPrice > pivotPoint + 50) trend = 'bullish';
  else if (spotPrice < pivotPoint - 50) trend = 'bearish';

  return {
    strongSupport,
    support,
    resistance,
    strongResistance,
    pivotPoint: Math.round(pivotPoint),
    trend,
  };
}

// ============================================================================
// OPEN INTEREST ANALYSIS
// ============================================================================

export function analyzeOI(
  spotPrice: number,
  optionsData: OptionData[]
): OIAnalysis {
  const totalCE_OI = optionsData.reduce((sum, d) => sum + (d.ce_oi || 0), 0);
  const totalPE_OI = optionsData.reduce((sum, d) => sum + (d.pe_oi || 0), 0);
  const pcr_oi = totalPE_OI / totalCE_OI;

  // Max Pain calculation
  const maxPainStrike = calculateMaxPain(optionsData);

  // OI buildup detection (strikes with OI > average)
  const avgOI = (totalCE_OI + totalPE_OI) / (optionsData.length * 2);
  const oiBuildupStrikes = optionsData
    .filter(d => (d.ce_oi || 0) + (d.pe_oi || 0) > avgOI * 1.5)
    .map(d => d.strike_price)
    .sort((a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice))
    .slice(0, 5);

  // OI unwinding (low OI strikes near ATM)
  const oiUnwindingStrikes = optionsData
    .filter(d => {
      const totalOI = (d.ce_oi || 0) + (d.pe_oi || 0);
      return totalOI < avgOI * 0.5 && Math.abs(d.strike_price - spotPrice) < 200;
    })
    .map(d => d.strike_price);

  // Sentiment based on PCR OI
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (pcr_oi < 0.7) sentiment = 'bullish';
  else if (pcr_oi > 1.3) sentiment = 'bearish';

  return {
    totalCE_OI,
    totalPE_OI,
    pcr_oi: parseFloat(pcr_oi.toFixed(2)),
    maxPainStrike,
    oiBuildupStrikes,
    oiUnwindingStrikes,
    sentiment,
  };
}

// ============================================================================
// VOLUME ANALYSIS
// ============================================================================

export function analyzeVolume(optionsData: OptionData[]): VolumeAnalysis {
  const totalCE_Volume = optionsData.reduce((sum, d) => sum + (d.ce_volume || 0), 0);
  const totalPE_Volume = optionsData.reduce((sum, d) => sum + (d.pe_volume || 0), 0);
  const pcr_volume = totalPE_Volume / totalCE_Volume;

  // High volume strikes
  const avgVolume = (totalCE_Volume + totalPE_Volume) / (optionsData.length * 2);
  const highVolumeStrikes = optionsData
    .filter(d => (d.ce_volume || 0) + (d.pe_volume || 0) > avgVolume * 2)
    .map(d => d.strike_price)
    .slice(0, 5);

  // Volume spikes (volume > 3x average)
  const volumeSpikes = optionsData
    .map(d => ({
      strike: d.strike_price,
      totalVolume: (d.ce_volume || 0) + (d.pe_volume || 0),
    }))
    .filter(d => d.totalVolume > avgVolume * 3)
    .map(d => ({
      strike: d.strike,
      ratio: parseFloat((d.totalVolume / avgVolume).toFixed(2)),
    }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);

  return {
    totalCE_Volume,
    totalPE_Volume,
    pcr_volume: parseFloat(pcr_volume.toFixed(2)),
    highVolumeStrikes,
    volumeSpikes,
  };
}

// ============================================================================
// MAX PAIN CALCULATION
// ============================================================================

function calculateMaxPain(optionsData: OptionData[]): number {
  const strikes = [...new Set(optionsData.map(d => d.strike_price))].sort((a, b) => a - b);
  
  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  strikes.forEach(testStrike => {
    let totalPain = 0;

    optionsData.forEach(option => {
      const strike = option.strike_price;
      const ceOI = option.ce_oi || 0;
      const peOI = option.pe_oi || 0;

      // Calculate pain for CE holders
      if (testStrike > strike) {
        totalPain += (testStrike - strike) * ceOI;
      }

      // Calculate pain for PE holders
      if (testStrike < strike) {
        totalPain += (strike - testStrike) * peOI;
      }
    });

    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = testStrike;
    }
  });

  return maxPainStrike;
}

// ============================================================================
// PREMIUM MOVEMENT PREDICTION
// ============================================================================

export function predictPremiumMovement(
  spotPrice: number,
  optionsData: OptionData[],
  oiAnalysis: OIAnalysis,
  volumeAnalysis: VolumeAnalysis
): PremiumPrediction {
  const signals: string[] = [];
  let direction: 'up' | 'down' | 'sideways' = 'sideways';
  let confidence = 50;

  // Signal 1: PCR OI
  if (oiAnalysis.pcr_oi < 0.7) {
    signals.push('Low PCR OI suggests bullish sentiment');
    confidence += 10;
    direction = 'up';
  } else if (oiAnalysis.pcr_oi > 1.3) {
    signals.push('High PCR OI suggests bearish sentiment');
    confidence += 10;
    direction = 'down';
  }

  // Signal 2: PCR Volume
  if (volumeAnalysis.pcr_volume > 1.2) {
    signals.push('Put buying detected in volume');
    confidence += 10;
    if (direction === 'up') confidence -= 5; // Conflicting signal
  } else if (volumeAnalysis.pcr_volume < 0.8) {
    signals.push('Call buying detected in volume');
    confidence += 10;
  }

  // Signal 3: Max Pain drift
  const maxPainDrift = oiAnalysis.maxPainStrike - spotPrice;
  if (Math.abs(maxPainDrift) > 100) {
    signals.push(`Max Pain at ${oiAnalysis.maxPainStrike} suggests drift of ${maxPainDrift} points`);
    if (maxPainDrift > 0 && direction === 'up') confidence += 15;
    else if (maxPainDrift < 0 && direction === 'down') confidence += 15;
  }

  // Signal 4: Volume spikes
  if (volumeAnalysis.volumeSpikes.length > 0) {
    const topSpike = volumeAnalysis.volumeSpikes[0];
    signals.push(`Volume spike at ${topSpike.strike} (${topSpike.ratio}x avg)`);
    confidence += 10;
  }

  // Target strikes (strikes with high activity)
  const targetStrikes = oiAnalysis.oiBuildupStrikes.slice(0, 3);

  // Timeframe based on confidence
  let timeframe: '5min' | '15min' | '1hour' = '15min';
  if (confidence > 70) timeframe = '5min';
  else if (confidence < 60) timeframe = '1hour';

  return {
    direction,
    confidence: Math.min(confidence, 95), // Cap at 95%
    targetStrikes,
    signals,
    timeframe,
  };
}

// ============================================================================
// MARKET SENTIMENT COMPOSITE
// ============================================================================

export function calculateMarketSentiment(
  oiAnalysis: OIAnalysis,
  volumeAnalysis: VolumeAnalysis,
  maxPainStrike: number,
  spotPrice: number
): MarketSentiment {
  // Individual indicator sentiments
  const pcr_oi_sentiment = 
    oiAnalysis.pcr_oi < 0.8 ? 'bullish' : 
    oiAnalysis.pcr_oi > 1.2 ? 'bearish' : 'neutral';

  const pcr_volume_sentiment = 
    volumeAnalysis.pcr_volume < 0.8 ? 'bullish' : 
    volumeAnalysis.pcr_volume > 1.2 ? 'bearish' : 'neutral';

  const maxPain_sentiment = 
    maxPainStrike > spotPrice + 50 ? 'bullish' : 
    maxPainStrike < spotPrice - 50 ? 'bearish' : 'neutral';

  const volume_sentiment = 
    volumeAnalysis.totalCE_Volume > volumeAnalysis.totalPE_Volume * 1.2 ? 'bullish' : 
    volumeAnalysis.totalPE_Volume > volumeAnalysis.totalCE_Volume * 1.2 ? 'bearish' : 'neutral';

  // Calculate composite
  const bullishCount = [
    pcr_oi_sentiment === 'bullish',
    pcr_volume_sentiment === 'bullish',
    maxPain_sentiment === 'bullish',
    volume_sentiment === 'bullish',
  ].filter(Boolean).length;

  const bearishCount = [
    pcr_oi_sentiment === 'bearish',
    pcr_volume_sentiment === 'bearish',
    maxPain_sentiment === 'bearish',
    volume_sentiment === 'bearish',
  ].filter(Boolean).length;

  let overall: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (bullishCount >= 3) overall = 'bullish';
  else if (bearishCount >= 3) overall = 'bearish';

  const strength = Math.max(bullishCount, bearishCount) * 25; // 0-100

  return {
    overall,
    strength,
    indicators: {
      pcr_oi: pcr_oi_sentiment as 'bullish' | 'bearish' | 'neutral',
      pcr_volume: pcr_volume_sentiment as 'bullish' | 'bearish' | 'neutral',
      maxPain: maxPain_sentiment as 'bullish' | 'bearish' | 'neutral',
      volume: volume_sentiment as 'bullish' | 'bearish' | 'neutral',
    },
  };
}

// ============================================================================
// EXPORT ALL CALCULATIONS
// ============================================================================

export const OptionsCalculations = {
  analyzePriceStructure,
  analyzeOI,
  analyzeVolume,
  predictPremiumMovement,
  calculateMarketSentiment,
};
