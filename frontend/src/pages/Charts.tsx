// src/pages/Charts.tsx - Premium Charts & Analysis
import React, { useEffect, useState } from 'react';
import { LineChart, TrendingUp, BarChart3, PieChart, Activity } from 'lucide-react';

export default function Charts() {
  const [selectedView, setSelectedView] = useState<'premium' | 'pcr' | 'volume' | 'oi'>('premium');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-2xl p-6 border border-slate-700">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <LineChart className="text-purple-400" size={32} />
            Premium Charts & Analysis
          </h1>
          <p className="text-sm text-gray-400 mt-2">
            Visual analysis of option premiums, PCR trends, and market sentiment
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-2 border border-slate-700 flex gap-2">
          <button
            onClick={() => setSelectedView('premium')}
            className={`flex-1 px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
              selectedView === 'premium'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:bg-slate-700'
            }`}
          >
            <TrendingUp size={18} />
            Premium Trends
          </button>
          
          <button
            onClick={() => setSelectedView('pcr')}
            className={`flex-1 px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
              selectedView === 'pcr'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:bg-slate-700'
            }`}
          >
            <Activity size={18} />
            PCR Analysis
          </button>
          
          <button
            onClick={() => setSelectedView('volume')}
            className={`flex-1 px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
              selectedView === 'volume'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:bg-slate-700'
            }`}
          >
            <BarChart3 size={18} />
            Volume Distribution
          </button>
          
          <button
            onClick={() => setSelectedView('oi')}
            className={`flex-1 px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
              selectedView === 'oi'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:bg-slate-700'
            }`}
          >
            <PieChart size={18} />
            Open Interest
          </button>
        </div>
      </div>

      {/* Chart Content */}
      <div className="max-w-7xl mx-auto">
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-8 border border-slate-700">
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-purple-900/30 mb-6">
              {selectedView === 'premium' && <TrendingUp className="text-purple-400" size={40} />}
              {selectedView === 'pcr' && <Activity className="text-purple-400" size={40} />}
              {selectedView === 'volume' && <BarChart3 className="text-purple-400" size={40} />}
              {selectedView === 'oi' && <PieChart className="text-purple-400" size={40} />}
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-4">
              {selectedView === 'premium' && 'Premium Trend Analysis'}
              {selectedView === 'pcr' && 'Put-Call Ratio Trends'}
              {selectedView === 'volume' && 'Volume Distribution'}
              {selectedView === 'oi' && 'Open Interest Analysis'}
            </h2>
            
            <p className="text-gray-400 mb-8 max-w-2xl mx-auto">
              {selectedView === 'premium' && 'Track option premium changes over time with interactive charts showing CE and PE price movements across different strikes.'}
              {selectedView === 'pcr' && 'Monitor Put-Call Ratio trends to gauge market sentiment. Track both OI-based and Volume-based PCR with historical comparisons.'}
              {selectedView === 'volume' && 'Analyze trading volume distribution across strikes. Identify high-activity zones and unusual volume patterns.'}
              {selectedView === 'oi' && 'Visualize open interest buildup across different strikes. Understand where traders are positioning for maximum insight.'}
            </p>
            
            <div className="inline-block">
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-6 py-4">
                <p className="text-blue-300 text-sm font-medium">📊 Chart Feature</p>
                <p className="text-blue-200 text-xs mt-1">
                  Advanced charting with Recharts will be integrated here
                </p>
                <p className="text-gray-400 text-xs mt-2">
                  Coming soon: Real-time line charts, candlestick patterns, and heatmaps
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="max-w-7xl mx-auto mt-6 grid grid-cols-3 gap-4">
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
          <div className="text-sm text-gray-400 mb-2">Highest CE Premium</div>
          <div className="text-2xl font-bold text-green-400">₹245.50</div>
          <div className="text-xs text-gray-500 mt-1">Strike: 25,200</div>
        </div>
        
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
          <div className="text-sm text-gray-400 mb-2">Highest PE Premium</div>
          <div className="text-2xl font-bold text-red-400">₹198.75</div>
          <div className="text-xs text-gray-500 mt-1">Strike: 25,700</div>
        </div>
        
        <div className="bg-slate-800/80 backdrop-blur-lg rounded-xl shadow-xl p-6 border border-slate-700">
          <div className="text-sm text-gray-400 mb-2">Total Premium Value</div>
          <div className="text-2xl font-bold text-purple-400">₹12.4 Cr</div>
          <div className="text-xs text-gray-500 mt-1">Across all strikes</div>
        </div>
      </div>
    </div>
  );
}
