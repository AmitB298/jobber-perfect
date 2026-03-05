/**
 * STRATEGY DETECTOR
 * Automatically identifies trading opportunities:
 * - Iron Condor setups
 * - Butterfly spreads
 * - Calendar spreads
 * - Diagonal spreads
 * - Ratio spreads
 */

import { OptionWithGreeks } from './greeks-calculator';

// ============================================================================
// STRATEGY INTERFACES
// ============================================================================

export interface StrategyOpportunity {
  strategyType: string;
  description: string;
  legs: StrategyLeg[];
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  profitProbability: number;
  capitalRequired: number;
  expectedReturn: number;
  riskRewardRatio: number;
  confidence: number;
}

export interface StrategyLeg {
  strike: number;
  optionType: 'CALL' | 'PUT';
  action: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  greeks?: any;
}

// ============================================================================
// IRON CONDOR DETECTOR
// ============================================================================

/**
 * Detect Iron Condor opportunities
 * Criteria:
 * - Balanced wing widths
 * - Good credit collected
 * - High probability of profit
 * - Delta < 0.30 for short strikes
 */
export function detectIronCondors(
  chain: OptionWithGreeks[],
  spotPrice: number,
  minCredit: number = 50
): StrategyOpportunity[] {
  const opportunities: StrategyOpportunity[] = [];
  const atmStrike = Math.round(spotPrice / 50) * 50;
  
  // Try different wing widths (50, 100, 150)
  for (const wingWidth of [50, 100, 150]) {
    // Try different distances from ATM
    for (let distance = 100; distance <= 300; distance += 50) {
      const callShortStrike = atmStrike + distance;
      const callLongStrike = callShortStrike + wingWidth;
      const putShortStrike = atmStrike - distance;
      const putLongStrike = putShortStrike - wingWidth;
      
      // Find options
      const callShort = chain.find(o => o.strike_price === callShortStrike);
      const callLong = chain.find(o => o.strike_price === callLongStrike);
      const putShort = chain.find(o => o.strike_price === putShortStrike);
      const putLong = chain.find(o => o.strike_price === putLongStrike);
      
      if (!callShort?.ce_ltp || !callLong?.ce_ltp || !putShort?.pe_ltp || !putLong?.pe_ltp) {
        continue;
      }
      
      // Check delta criteria (short strikes should be OTM with delta < 0.30)
      const callShortDelta = Math.abs(callShort.ce_greeks?.delta || 0);
      const putShortDelta = Math.abs(putShort.pe_greeks?.delta || 0);
      
      if (callShortDelta > 0.35 || putShortDelta > 0.35) {
        continue; // Too close to ATM
      }
      
      // Calculate net credit
      const netCredit = (callShort.ce_ltp - callLong.ce_ltp) + (putShort.pe_ltp - putLong.pe_ltp);
      
      if (netCredit < minCredit) {
        continue; // Not enough premium
      }
      
      const maxLoss = wingWidth - netCredit;
      const profitZoneWidth = (callShortStrike - putShortStrike);
      const profitProbability = Math.min(85, 50 + (profitZoneWidth / spotPrice * 100));
      
      opportunities.push({
        strategyType: 'IRON_CONDOR',
        description: `Iron Condor: ${putLongStrike}/${putShortStrike}/${callShortStrike}/${callLongStrike}`,
        legs: [
          { strike: putLongStrike, optionType: 'PUT', action: 'BUY', quantity: 1, price: putLong.pe_ltp },
          { strike: putShortStrike, optionType: 'PUT', action: 'SELL', quantity: 1, price: putShort.pe_ltp },
          { strike: callShortStrike, optionType: 'CALL', action: 'SELL', quantity: 1, price: callShort.ce_ltp },
          { strike: callLongStrike, optionType: 'CALL', action: 'BUY', quantity: 1, price: callLong.ce_ltp }
        ],
        maxProfit: netCredit,
        maxLoss,
        breakevens: [putShortStrike - netCredit, callShortStrike + netCredit],
        profitProbability,
        capitalRequired: maxLoss,
        expectedReturn: (netCredit / maxLoss) * 100,
        riskRewardRatio: maxLoss / netCredit,
        confidence: profitProbability
      });
    }
  }
  
  // Sort by expected return
  return opportunities.sort((a, b) => b.expectedReturn - a.expectedReturn).slice(0, 5);
}

// ============================================================================
// BUTTERFLY SPREAD DETECTOR
// ============================================================================

/**
 * Detect Butterfly Spread opportunities
 * Best for low volatility, range-bound markets
 */
export function detectButterflySpread(
  chain: OptionWithGreeks[],
  spotPrice: number,
  optionType: 'CALL' | 'PUT' = 'CALL'
): StrategyOpportunity[] {
  const opportunities: StrategyOpportunity[] = [];
  const atmStrike = Math.round(spotPrice / 50) * 50;
  
  // Try different wing widths
  for (const wingWidth of [50, 100, 150]) {
    for (let centerStrike = atmStrike - 100; centerStrike <= atmStrike + 100; centerStrike += 50) {
      const lowerStrike = centerStrike - wingWidth;
      const upperStrike = centerStrike + wingWidth;
      
      const lower = chain.find(o => o.strike_price === lowerStrike);
      const center = chain.find(o => o.strike_price === centerStrike);
      const upper = chain.find(o => o.strike_price === upperStrike);
      
      if (optionType === 'CALL') {
        if (!lower?.ce_ltp || !center?.ce_ltp || !upper?.ce_ltp) continue;
        
        const netDebit = lower.ce_ltp - (2 * center.ce_ltp) + upper.ce_ltp;
        if (netDebit >= 0) continue; // Should be a debit
        
        const maxProfit = wingWidth + netDebit;
        const maxLoss = Math.abs(netDebit);
        
        if (maxProfit <= 0 || maxLoss <= 0) continue;
        
        opportunities.push({
          strategyType: 'BUTTERFLY_SPREAD',
          description: `Call Butterfly: ${lowerStrike}/${centerStrike}/${upperStrike}`,
          legs: [
            { strike: lowerStrike, optionType: 'CALL', action: 'BUY', quantity: 1, price: lower.ce_ltp },
            { strike: centerStrike, optionType: 'CALL', action: 'SELL', quantity: 2, price: center.ce_ltp },
            { strike: upperStrike, optionType: 'CALL', action: 'BUY', quantity: 1, price: upper.ce_ltp }
          ],
          maxProfit,
          maxLoss,
          breakevens: [lowerStrike + maxLoss, upperStrike - maxLoss],
          profitProbability: 45,
          capitalRequired: maxLoss,
          expectedReturn: (maxProfit / maxLoss) * 100,
          riskRewardRatio: maxLoss / maxProfit,
          confidence: 60
        });
      }
    }
  }
  
  return opportunities.sort((a, b) => b.expectedReturn - a.expectedReturn).slice(0, 3);
}

// ============================================================================
// CALENDAR SPREAD DETECTOR
// ============================================================================

/**
 * Detect Calendar Spread opportunities
 * Sell near-term, buy far-term at same strike
 */
export function detectCalendarSpreads(
  nearTermChain: OptionWithGreeks[],
  farTermChain: OptionWithGreeks[],
  spotPrice: number
): StrategyOpportunity[] {
  const opportunities: StrategyOpportunity[] = [];
  const atmStrike = Math.round(spotPrice / 50) * 50;
  
  // Check ATM and nearby strikes
  for (let strike = atmStrike - 100; strike <= atmStrike + 100; strike += 50) {
    const nearCall = nearTermChain.find(o => o.strike_price === strike);
    const farCall = farTermChain.find(o => o.strike_price === strike);
    
    if (!nearCall?.ce_ltp || !farCall?.ce_ltp) continue;
    if (farCall.ce_ltp <= nearCall.ce_ltp) continue; // Far term should be more expensive
    
    const netDebit = farCall.ce_ltp - nearCall.ce_ltp;
    const nearTheta = Math.abs(nearCall.ce_greeks?.theta || 0);
    const farTheta = Math.abs(farCall.ce_greeks?.theta || 0);
    
    // Calendar profits from theta decay differential
    const thetaAdvantage = nearTheta - farTheta;
    
    if (thetaAdvantage <= 0) continue;
    
    opportunities.push({
      strategyType: 'CALENDAR_SPREAD',
      description: `Call Calendar at ${strike}`,
      legs: [
        { strike, optionType: 'CALL', action: 'SELL', quantity: 1, price: nearCall.ce_ltp },
        { strike, optionType: 'CALL', action: 'BUY', quantity: 1, price: farCall.ce_ltp }
      ],
      maxProfit: nearCall.ce_ltp, // If near expires worthless
      maxLoss: netDebit,
      breakevens: [strike], // Breakeven at strike if held to near expiry
      profitProbability: 55,
      capitalRequired: netDebit,
      expectedReturn: (thetaAdvantage * 7 / netDebit) * 100, // 1 week theta capture
      riskRewardRatio: netDebit / nearCall.ce_ltp,
      confidence: 65
    });
  }
  
  return opportunities.sort((a, b) => b.expectedReturn - a.expectedReturn).slice(0, 3);
}

// ============================================================================
// RATIO SPREAD DETECTOR
// ============================================================================

/**
 * Detect Ratio Spread opportunities
 * Buy 1 ATM, Sell 2 OTM for credit
 */
export function detectRatioSpreads(
  chain: OptionWithGreeks[],
  spotPrice: number
): StrategyOpportunity[] {
  const opportunities: StrategyOpportunity[] = [];
  const atmStrike = Math.round(spotPrice / 50) * 50;
  
  // Call Ratio Spreads (bullish)
  for (let otmDistance = 100; otmDistance <= 300; otmDistance += 50) {
    const buyStrike = atmStrike;
    const sellStrike = atmStrike + otmDistance;
    
    const buyOption = chain.find(o => o.strike_price === buyStrike);
    const sellOption = chain.find(o => o.strike_price === sellStrike);
    
    if (!buyOption?.ce_ltp || !sellOption?.ce_ltp) continue;
    
    const netCredit = (2 * sellOption.ce_ltp) - buyOption.ce_ltp;
    
    if (netCredit <= 0) continue; // Should be a credit
    
    const maxProfit = sellStrike - buyStrike + netCredit;
    const maxLoss = Infinity; // Naked upside above sell strike
    
    opportunities.push({
      strategyType: 'RATIO_SPREAD',
      description: `Call Ratio Spread: Buy 1x${buyStrike}, Sell 2x${sellStrike}`,
      legs: [
        { strike: buyStrike, optionType: 'CALL', action: 'BUY', quantity: 1, price: buyOption.ce_ltp },
        { strike: sellStrike, optionType: 'CALL', action: 'SELL', quantity: 2, price: sellOption.ce_ltp }
      ],
      maxProfit,
      maxLoss: 999999, // Undefined risk
      breakevens: [sellStrike + maxProfit],
      profitProbability: 50,
      capitalRequired: 0, // Credit trade
      expectedReturn: Infinity, // No capital required
      riskRewardRatio: 999,
      confidence: 40 // Lower confidence due to undefined risk
    });
  }
  
  return opportunities.sort((a, b) => a.riskRewardRatio - b.riskRewardRatio).slice(0, 2);
}

// ============================================================================
// MASTER STRATEGY SCANNER
// ============================================================================

/**
 * Scan all strategies and return best opportunities
 */
export function scanAllStrategies(
  chain: OptionWithGreeks[],
  spotPrice: number
): StrategyOpportunity[] {
  const allOpportunities: StrategyOpportunity[] = [];
  
  // Iron Condors
  allOpportunities.push(...detectIronCondors(chain, spotPrice));
  
  // Butterfly Spreads
  allOpportunities.push(...detectButterflySpread(chain, spotPrice, 'CALL'));
  allOpportunities.push(...detectButterflySpread(chain, spotPrice, 'PUT'));
  
  // Ratio Spreads
  allOpportunities.push(...detectRatioSpreads(chain, spotPrice));
  
  // Sort by confidence and expected return
  return allOpportunities
    .sort((a, b) => {
      const scoreA = a.confidence * 0.6 + (Math.min(a.expectedReturn, 100) / 100) * 0.4;
      const scoreB = b.confidence * 0.6 + (Math.min(b.expectedReturn, 100) / 100) * 0.4;
      return scoreB - scoreA;
    })
    .slice(0, 10);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  detectIronCondors,
  detectButterflySpread,
  detectCalendarSpreads,
  detectRatioSpreads,
  scanAllStrategies
};
