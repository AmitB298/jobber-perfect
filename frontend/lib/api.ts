// lib/api.ts - API Client for NIFTY Options Dashboard

const API_BASE_URL = 'http://localhost:3001';

export interface SpotPrice {
  symbol: string;
  ltp: string;
  timestamp: string;
}

export interface OptionRow {
  strike_price: string;
  ce_ltp: string | null;
  pe_ltp: string | null;
  ce_volume: string | null;
  pe_volume: string | null;
  ce_oi: string | null;
  pe_oi: string | null;
}

export interface OptionsChainData {
  spotPrice: string;
  atmStrike: number;
  chain: OptionRow[];
}

export interface PCRData {
  pcr_oi: string;
  pcr_volume: string;
  calculated_at: string;
}

export interface MaxPainData {
  max_pain_strike: string;
  total_pain: string;
}

export interface SystemStats {
  total_records: string;
  unique_options: string;
  latest_tick: string;
  first_tick: string;
}

export interface PremiumHistory {
  trading_symbol: string;
  ltp: number;
  volume: number;
  oi: number;
  timestamp: string;
}

// ============================================================
// API Functions
// ============================================================

export async function fetchSpotPrice(): Promise<SpotPrice | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/spot/nifty`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Error fetching spot price:', error);
    return null;
  }
}

export async function fetchOptionsChain(): Promise<OptionsChainData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/options/chain`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Error fetching options chain:', error);
    return null;
  }
}

export async function fetchPCR(): Promise<PCRData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics/pcr`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Error fetching PCR:', error);
    return null;
  }
}

export async function fetchMaxPain(): Promise<MaxPainData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics/max-pain`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Error fetching max pain:', error);
    return null;
  }
}

export async function fetchStats(): Promise<SystemStats | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Error fetching stats:', error);
    return null;
  }
}

export async function fetchPremiumHistory(
  symbol: string,
  minutes: number = 5
): Promise<PremiumHistory[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/options/${encodeURIComponent(symbol)}/history?minutes=${minutes}`
    );
    const data = await response.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error('Error fetching premium history:', error);
    return [];
  }
}

// ============================================================
// Utility Functions
// ============================================================

export function formatNumber(num: string | number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '-';
  return new Intl.NumberFormat('en-IN').format(n);
}

export function formatPrice(price: string | number | null | undefined): string {
  if (price === null || price === undefined) return '-';
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(p)) return '-';
  return '₹' + p.toFixed(2);
}

export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function getColorForPCR(pcr: string | null): string {
  if (pcr === null) return 'text-gray-500';
  const pcrNum = parseFloat(pcr);
  if (isNaN(pcrNum)) return 'text-gray-500';
  if (pcrNum > 1.2) return 'text-red-500'; // Bearish
  if (pcrNum < 0.8) return 'text-green-500'; // Bullish
  return 'text-yellow-500'; // Neutral
}

export function getPremiumChangeColor(change: number): string {
  if (change > 0) return 'text-green-600 bg-green-50';
  if (change < 0) return 'text-red-600 bg-red-50';
  return 'text-gray-600 bg-gray-50';
}