import React, { useState } from 'react';

interface ExpectedMoveProps {
  spotPrice: number;
  atmIV?: number;
  daysToExpiry?: number;
  straddlePremium?: number;
}

export const ExpectedMoveCalculator: React.FC<ExpectedMoveProps> = ({
  spotPrice,
  atmIV,
  daysToExpiry = 7,
  straddlePremium,
}) => {
  const [customDTE, setCustomDTE] = useState<number>(daysToExpiry);
  const [customIV, setCustomIV] = useState<number>(atmIV ?? 20);

  // Method 1: IV-based expected move
  const ivBasedMove = spotPrice * (customIV / 100) * Math.sqrt(customDTE / 365);
  const ivUpper = spotPrice + ivBasedMove;
  const ivLower = spotPrice - ivBasedMove;
  const ivPct = (ivBasedMove / spotPrice) * 100;

  // Method 2: Straddle-based (if straddle premium available)
  const straddleMove = straddlePremium ?? ivBasedMove * 0.85;
  const straddleUpper = spotPrice + straddleMove;
  const straddleLower = spotPrice - straddleMove;

  const fmt = (v: number) => v.toFixed(0);
  const fmtPct = (v: number) => v.toFixed(2);

  return (
    <div className="space-y-4">
      {/* Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3">
          <label className="text-gray-400 text-xs block mb-1">Days to Expiry</label>
          <input
            type="number"
            value={customDTE}
            onChange={e => setCustomDTE(Math.max(1, Number(e.target.value)))}
            className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
            min={1}
            max={90}
          />
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3">
          <label className="text-gray-400 text-xs block mb-1">ATM IV (%)</label>
          <input
            type="number"
            value={customIV}
            onChange={e => setCustomIV(Math.max(1, Number(e.target.value)))}
            className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
            min={1}
            max={200}
            step={0.5}
          />
        </div>
      </div>

      {/* Current spot */}
      <div className="text-center bg-gray-800/30 rounded-lg py-2">
        <span className="text-gray-400 text-xs">NIFTY Spot: </span>
        <span className="text-white font-bold text-lg">{fmt(spotPrice)}</span>
      </div>

      {/* IV-based expected move */}
      <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3">
        <p className="text-blue-400 font-semibold text-xs mb-3">1σ Expected Move (IV-Based)</p>
        <div className="flex items-center justify-between gap-2">
          <div className="text-center">
            <p className="text-red-400 text-xs">Lower</p>
            <p className="text-white font-mono font-bold text-base">{fmt(ivLower)}</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-gray-400 text-xs">±Move</p>
            <p className="text-yellow-400 font-bold">±{fmt(ivBasedMove)}</p>
            <p className="text-gray-500 text-xs">±{fmtPct(ivPct)}%</p>
          </div>
          <div className="text-center">
            <p className="text-green-400 text-xs">Upper</p>
            <p className="text-white font-mono font-bold text-base">{fmt(ivUpper)}</p>
          </div>
        </div>

        {/* Zone bar */}
        <div className="mt-3 relative h-6 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="absolute h-full bg-gradient-to-r from-red-900/60 via-green-900/40 to-red-900/60 rounded-full"
            style={{ left: '10%', right: '10%' }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-0.5 h-full bg-yellow-400/60" />
          </div>
          <div className="absolute inset-0 flex items-center justify-between px-2 text-xs">
            <span className="text-red-300 font-mono">{fmt(ivLower)}</span>
            <span className="text-yellow-400 font-mono">{fmt(spotPrice)}</span>
            <span className="text-green-300 font-mono">{fmt(ivUpper)}</span>
          </div>
        </div>
      </div>

      {/* Straddle-based */}
      <div className="bg-purple-900/20 border border-purple-700 rounded-lg p-3">
        <p className="text-purple-400 font-semibold text-xs mb-2">
          ATM Straddle-Based Move
          {!straddlePremium && <span className="text-gray-500 ml-1">(estimated)</span>}
        </p>
        <div className="flex justify-between text-xs">
          <div>
            <span className="text-gray-400">Lower: </span>
            <span className="text-red-300 font-mono font-bold">{fmt(straddleLower)}</span>
          </div>
          <div>
            <span className="text-gray-400">Straddle: </span>
            <span className="text-purple-300 font-mono">±{fmt(straddleMove)}</span>
          </div>
          <div>
            <span className="text-gray-400">Upper: </span>
            <span className="text-green-300 font-mono font-bold">{fmt(straddleUpper)}</span>
          </div>
        </div>
      </div>

      {/* Probability */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[
          { sigma: '1σ', prob: 68.2, color: 'text-green-400' },
          { sigma: '2σ', prob: 95.4, color: 'text-yellow-400' },
          { sigma: '3σ', prob: 99.7, color: 'text-red-400' },
        ].map(({ sigma, prob, color }) => {
          const move = ivBasedMove * (sigma === '1σ' ? 1 : sigma === '2σ' ? 2 : 3);
          return (
            <div key={sigma} className="bg-gray-800/50 rounded p-2">
              <p className={`font-bold ${color}`}>{sigma}</p>
              <p className="text-white text-xs">{prob}%</p>
              <p className="text-gray-500 text-xs">±{fmt(move)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
