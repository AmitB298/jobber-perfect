'use client';

import { useEffect, useState } from 'react';
import {
  fetchSpotPrice,
  fetchOptionsChain,
  fetchPCR,
  fetchMaxPain,
  fetchStats,
  formatNumber,
  formatPrice,
  getColorForPCR,
  type SpotPrice,
  type OptionsChainData,
  type PCRData,
  type MaxPainData,
  type SystemStats,
} from '@/lib/api';

export default function Dashboard() {
  const [spot, setSpot] = useState<SpotPrice | null>(null);
  const [chain, setChain] = useState<OptionsChainData | null>(null);
  const [pcr, setPcr] = useState<PCRData | null>(null);
  const [maxPain, setMaxPain] = useState<MaxPainData | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Fetch all data
  const fetchAllData = async () => {
    const [spotData, chainData, pcrData, maxPainData, statsData] = await Promise.all([
      fetchSpotPrice(),
      fetchOptionsChain(),
      fetchPCR(),
      fetchMaxPain(),
      fetchStats(),
    ]);

    setSpot(spotData);
    setChain(chainData);
    setPcr(pcrData);
    setMaxPain(maxPainData);
    setStats(statsData);
    setIsLoading(false);
    setLastUpdate(new Date());
  };

  // Initial fetch
  useEffect(() => {
    fetchAllData();
  }, []);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    const interval = setInterval(fetchAllData, 2000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading NIFTY Options Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">NIFTY Options Dashboard</h1>
              <p className="text-sm text-gray-500 mt-1">
                Live Market Data • Last Updated: {lastUpdate.toLocaleTimeString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-green-600">LIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Spot Price & Indicators Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* NIFTY Spot */}
          <div className="bg-white rounded-lg shadow-md p-6 md:col-span-2">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-sm font-medium text-gray-500">NIFTY 50</span>
              <span className="text-xs text-gray-400">NSE</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {spot ? formatPrice(spot.ltp) : '-'}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              ATM Strike: {chain ? formatNumber(chain.atmStrike) : '-'}
            </div>
          </div>

          {/* PCR OI */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-sm font-medium text-gray-500 mb-2">PCR (OI)</div>
            <div className={`text-2xl font-bold ${getColorForPCR(pcr?.pcr_oi ?? null)}`}>
              {pcr?.pcr_oi ?? '-'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {pcr && parseFloat(pcr.pcr_oi) > 1 ? 'Bearish' : pcr && parseFloat(pcr.pcr_oi) < 1 ? 'Bullish' : 'Neutral'}
            </div>
          </div>

          {/* PCR Volume */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-sm font-medium text-gray-500 mb-2">PCR (Volume)</div>
            <div className={`text-2xl font-bold ${getColorForPCR(pcr?.pcr_volume ?? null)}`}>
              {pcr?.pcr_volume ?? '-'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {pcr && parseFloat(pcr.pcr_volume) > 1 ? 'Put Buying' : 'Call Buying'}
            </div>
          </div>
        </div>

        {/* Max Pain & Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Max Pain */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-sm font-medium text-gray-500 mb-2">Max Pain Strike</div>
            <div className="text-2xl font-bold text-purple-600">
              {maxPain ? formatNumber(maxPain.max_pain_strike) : '-'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Total Pain: {maxPain ? formatNumber(maxPain.total_pain) : '-'}
            </div>
          </div>

          {/* System Stats */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-sm font-medium text-gray-500 mb-2">Today&apos;s Data Collection</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-600">
                {stats ? formatNumber(stats.total_records) : '-'}
              </span>
              <span className="text-sm text-gray-500">ticks</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {stats?.unique_options} unique options tracked
            </div>
          </div>
        </div>

        {/* Options Chain */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Options Chain</h2>
            <p className="text-sm text-gray-500 mt-1">
              ATM ±500 Strikes • Real-time Premium Data
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CE Volume
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CE OI
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CE LTP
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider bg-yellow-50">
                    Strike
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PE LTP
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PE OI
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PE Volume
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {chain?.chain.map((row) => {
                  const strikeNum = parseFloat(row.strike_price);
                  const isATM = strikeNum === chain.atmStrike;
                  return (
                    <tr
                      key={row.strike_price}
                      className={isATM ? 'bg-yellow-50 font-semibold' : 'hover:bg-gray-50'}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(row.ce_volume)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(row.ce_oi)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        {formatPrice(row.ce_ltp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-center">
                        {formatNumber(row.strike_price)}
                        {isATM && (
                          <span className="ml-2 text-xs text-yellow-600">ATM</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600 text-right">
                        {formatPrice(row.pe_ltp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatNumber(row.pe_oi)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatNumber(row.pe_volume)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto mt-6">
        <div className="bg-white rounded-lg shadow-md p-4 text-center text-sm text-gray-500">
          <p>
            NIFTY Options Premium Tracking System • WebSocket Real-time Data Collection
          </p>
          <p className="mt-1">
            Built with Next.js, TypeScript, PostgreSQL, and Angel One SmartAPI
          </p>
        </div>
      </div>
    </div>
  );
}