/**
 * ANALYTICS CALCULATOR
 * Advanced calculations for:
 * - Expected Move
 * - Probability of Touch
 * - Breakeven Analysis
 * - Position Greeks
 * - Portfolio Risk Metrics
 */

import { OptionWithGreeks } from './greeks-calculator';

// ============================================================================
// EXPECTED MOVE CALCULATIONS
// ============================================================================

/**
 * Calculate Expected Move using ATM Straddle price
 * Expected Move = Straddle Price * 0.85 (1 standard deviation)
 */
export interface ExpectedMoveResult {
  daily: number;
  weekly: number;
  toExpiry: number;
  upperRange: number;
  lowerRange: number;
  probability: number;
  atmStraddlePrice: number;
}

export function calculateExpectedMove(
  atmCall: number,
  atmPut: number,
  spotPrice: number,
  daysToExpiry: number
): ExpectedMoveResult {
  const straddlePrice = atmCall + atmPut;
  const expectedMoveToExpiry = straddlePrice * 0.85; // 1 std dev
  
  // Scale moves by square root of time
  const dailyMove = expectedMoveToExpiry / Math.sqrt(daysToExpiry);
  const weeklyMove = dailyMove * Math.sqrt(5); // 5 trading days
  
  return {
    daily: dailyMove,
    weekly: weeklyMove,
    toExpiry: expectedMoveToExpiry,
    upperRange: spotPrice + expectedMoveToExpiry,
    lowerRange: spotPrice - expectedMoveToExpiry,
    probability: 68, // 1 std dev = 68% probability
    atmStraddlePrice: straddlePrice
  };
}

// ============================================================================
// PROBABILITY CALCULATIONS
// ============================================================================

/**
 * Calculate Probability of Touch (POT) for a strike
 * Using simplified approximation: POT ≈ 2 * Delta
 */
export function calculateProbabilityOfTouch(
  strike: number,
  spotPrice: number,
  delta: number,
  optionType: 'CALL' | 'PUT'
): number {
  // Simplified: POT ≈ 2 * |Delta|
  const pot = 2 * Math.abs(delta);
  return Math.min(Math.max(pot * 100, 0), 100); // Return as percentage
}

/**
 * Calculate Probability of Expiring ITM
 * Using Delta as proxy: Delta ≈ Probability ITM
 */
export function calculateProbabilityITM(delta: number): number {
  return Math.abs(delta) * 100; // Return as percentage
}

/**
 * Calculate Probability of Profit for a position
 */
export function calculateProbabilityOfProfit(
  entryPrice: number,
  breakeven: number,
  spotPrice: number,
  delta: number,
  optionType: 'CALL' | 'PUT'
): number {
  if (optionType === 'CALL') {
    // For calls, profit if spot > breakeven
    if (spotPrice > breakeven) return 100;
    // Use delta to estimate probability
    const distanceToBreakeven = breakeven - spotPrice;
    const probability = Math.abs(delta) * 100 * (1 - distanceToBreakeven / spotPrice);
    return Math.max(Math.min(probability, 100), 0);
  } else {
    // For puts, profit if spot < breakeven
    if (spotPrice < breakeven) return 100;
    const distanceToBreakeven = spotPrice - breakeven;
    const probability = Math.abs(delta) * 100 * (1 - distanceToBreakeven / spotPrice);
    return Math.max(Math.min(probability, 100), 0);
  }
}

// ============================================================================
// BREAKEVEN ANALYSIS
// ============================================================================

export interface BreakevenAnalysis {
  upperBreakeven: number | null;
  lowerBreakeven: number | null;
  maxProfit: number | null;
  maxLoss: number;
  profitZoneWidth: number | null;
}

/**
 * Calculate breakeven points for straddle/strangle
 */
export function calculateStraddleBreakeven(
  strike: number,
  callPrice: number,
  putPrice: number
): BreakevenAnalysis {
  const totalCost = callPrice + putPrice;
  
  return {
    upperBreakeven: strike + totalCost,
    lowerBreakeven: strike - totalCost,
    maxProfit: null, // Unlimited for long straddle
    maxLoss: totalCost,
    profitZoneWidth: totalCost * 2
  };
}

/**
 * Calculate breakeven for credit spread
 */
export function calculateCreditSpreadBreakeven(
  longStrike: number,
  shortStrike: number,
  netCredit: number,
  spreadType: 'BULL_PUT' | 'BEAR_CALL'
): BreakevenAnalysis {
  if (spreadType === 'BULL_PUT') {
    // Bull Put Spread
    return {
      upperBreakeven: null,
      lowerBreakeven: shortStrike - netCredit,
      maxProfit: netCredit,
      maxLoss: (shortStrike - longStrike) - netCredit,
      profitZoneWidth: null
    };
  } else {
    // Bear Call Spread
    return {
      upperBreakeven: shortStrike + netCredit,
      lowerBreakeven: null,
      maxProfit: netCredit,
      maxLoss: (longStrike - shortStrike) - netCredit,
      profitZoneWidth: null
    };
  }
}

// ============================================================================
// POSITION GREEKS AGGREGATION
// ============================================================================

export interface PositionGreeks {
  totalDelta: number;
  totalGamma: number;
  totalTheta: number;
  totalVega: number;
  totalRho: number;
  notional: number;
  deltaPercentage: number;
}

export interface Position {
  strike: number;
  optionType: 'CALL' | 'PUT';
  quantity: number; // Positive for long, negative for short
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  price: number;
}

/**
 * Aggregate Greeks across multiple positions
 */
export function aggregatePositionGreeks(
  positions: Position[],
  spotPrice: number
): PositionGreeks {
  let totalDelta = 0;
  let totalGamma = 0;
  let totalTheta = 0;
  let totalVega = 0;
  let totalRho = 0;
  let notional = 0;
  
  for (const pos of positions) {
    const multiplier = pos.quantity; // Already signed
    
    totalDelta += (pos.greeks.delta * multiplier);
    totalGamma += (pos.greeks.gamma * multiplier);
    totalTheta += (pos.greeks.theta * multiplier);
    totalVega += (pos.greeks.vega * multiplier);
    totalRho += (pos.greeks.rho * multiplier);
    
    notional += Math.abs(pos.price * multiplier * spotPrice);
  }
  
  return {
    totalDelta,
    totalGamma,
    totalTheta,
    totalVega,
    totalRho,
    notional,
    deltaPercentage: (totalDelta / (notional / spotPrice)) * 100
  };
}

// ============================================================================
// PORTFOLIO RISK METRICS
// ============================================================================

export interface RiskMetrics {
  varDaily: number; // Value at Risk (1 day, 95% confidence)
  varWeekly: number; // Value at Risk (1 week, 95% confidence)
  maxDrawdown: number;
  sharpeRatio: number | null;
  portfolioBeta: number;
  concentration: number; // Largest position as % of portfolio
}

/**
 * Calculate portfolio Value at Risk (VaR)
 */
export function calculateVaR(
  portfolioValue: number,
  dailyVolatility: number,
  confidenceLevel: number = 0.95,
  timeHorizon: number = 1
): number {
  // Z-score for confidence level (1.645 for 95%, 1.96 for 97.5%, 2.33 for 99%)
  const zScore = confidenceLevel === 0.95 ? 1.645 : 
                 confidenceLevel === 0.975 ? 1.96 : 2.33;
  
  // VaR = Portfolio Value * Volatility * Z-score * sqrt(time)
  return portfolioValue * dailyVolatility * zScore * Math.sqrt(timeHorizon);
}

/**
 * Calculate Maximum Drawdown
 */
export function calculateMaxDrawdown(
  portfolioValues: number[]
): number {
  let maxDrawdown = 0;
  let peak = portfolioValues[0];
  
  for (const value of portfolioValues) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown * 100; // Return as percentage
}

/**
 * Calculate Sharpe Ratio
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0.065 // 6.5% RBI rate
): number {
  if (returns.length < 2) return 0;
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  // Sharpe = (Average Return - Risk Free Rate) / Standard Deviation
  return (avgReturn - riskFreeRate) / stdDev;
}

// ============================================================================
// VOLATILITY METRICS
// ============================================================================

/**
 * Calculate Historical Volatility (Standard Deviation of returns)
 */
export function calculateHistoricalVolatility(
  prices: number[]
): number {
  if (prices.length < 2) return 0;
  
  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  
  // Calculate standard deviation
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  
  // Annualize (sqrt(252 trading days))
  return dailyVol * Math.sqrt(252) * 100; // Return as percentage
}

/**
 * Calculate Realized Volatility (from actual price movements)
 */
export function calculateRealizedVolatility(
  highPrices: number[],
  lowPrices: number[]
): number {
  if (highPrices.length !== lowPrices.length || highPrices.length < 2) return 0;
  
  // Parkinson's Historical Volatility (uses high-low range)
  const n = highPrices.length;
  let sum = 0;
  
  for (let i = 0; i < n; i++) {
    const ratio = highPrices[i] / lowPrices[i];
    sum += Math.pow(Math.log(ratio), 2);
  }
  
  const dailyVol = Math.sqrt(sum / (4 * n * Math.log(2)));
  
  // Annualize
  return dailyVol * Math.sqrt(252) * 100; // Return as percentage
}

// ============================================================================
// OPTION SPREAD ANALYSIS
// ============================================================================

/**
 * Analyze Iron Condor profitability
 */
export interface IronCondorAnalysis {
  maxProfit: number;
  maxLoss: number;
  profitProbability: number;
  upperBreakeven: number;
  lowerBreakeven: number;
  riskRewardRatio: number;
}

export function analyzeIronCondor(
  callShortStrike: number,
  callLongStrike: number,
  putShortStrike: number,
  putLongStrike: number,
  netCredit: number,
  spotPrice: number
): IronCondorAnalysis {
  const maxLoss = Math.max(
    (callLongStrike - callShortStrike) - netCredit,
    (putShortStrike - putLongStrike) - netCredit
  );
  
  const upperBreakeven = callShortStrike + netCredit;
  const lowerBreakeven = putShortStrike - netCredit;
  
  // Estimate probability of profit (very simplified)
  const profitZoneWidth = upperBreakeven - lowerBreakeven;
  const totalRange = callLongStrike - putLongStrike;
  const profitProbability = (profitZoneWidth / totalRange) * 100;
  
  return {
    maxProfit: netCredit,
    maxLoss,
    profitProbability: Math.min(profitProbability, 95),
    upperBreakeven,
    lowerBreakeven,
    riskRewardRatio: maxLoss / netCredit
  };
}

// ============================================================================
// EXPORT ALL FUNCTIONS
// ============================================================================

export {
  calculateExpectedMove,
  calculateProbabilityOfTouch,
  calculateProbabilityITM,
  calculateProbabilityOfProfit,
  calculateStraddleBreakeven,
  calculateCreditSpreadBreakeven,
  aggregatePositionGreeks,
  calculateVaR,
  calculateMaxDrawdown,
  calculateSharpeRatio,
  calculateHistoricalVolatility,
  calculateRealizedVolatility,
  analyzeIronCondor
};
