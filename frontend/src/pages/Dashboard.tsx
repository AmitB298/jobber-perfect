/**
 * Dashboard.tsx — JOBBER PRO — thin shell
 * =====================================================
 * All business logic lives in the dashboard/ sub-folder.
 * This file only owns:
 *   - data-fetching (SSE + REST fallback)
 *   - top-bar rendering
 *   - tab routing
 *
 * STRUCTURE
 * ─────────────────────────────────────────────────────
 * src/pages/
 *   Dashboard.tsx                 ← YOU ARE HERE
 *   dashboard/
 *     constants.ts                ← all endpoints & timing knobs
 *     types.ts                    ← all TypeScript interfaces
 *     shared/
 *       helpers.ts                ← n, fmt, fmtK, fmtRs, ivColor
 *       BS.ts                     ← Black-Scholes engine
 *       useNetworkMonitor.ts      ← v4 real-internet probe
 *       NetComponents.tsx         ← SignalBars, NetWidget, OfflineBanner…
 *       MarketStatusBanner.tsx    ← market-hours banner
 *       index.ts                  ← barrel re-export
 *     tabs/
 *       ChainTab.tsx              ← options chain table
 *       ChartsTab.tsx             ← OI / IV / Greeks / PCR charts
 *       SignalsTab.tsx            ← trading signals + strategy alerts
 *       AnalyticsTab.tsx          ← IV analysis + expected move
 *       StrategyBuilderTab.tsx    ← strategy builder + payoff chart
 *       SpoofingTab.tsx           ← live spoofing detection
 *       NetworkTab.tsx            ← network quality panel
 *       index.ts                  ← barrel re-export
 *   components/
 *     OIScannerTab.tsx            ← OI concentration scanner (v7.5)
 *     OIPulseTab.tsx              ← OI activity intelligence (v1.0)
 *     StrikeAnalyserTab.tsx       ← SEBI-safe strike analyser (v1.0)
 */

import React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import DataManager        from './components/DataManager';
import PremiumPredictor   from '../components/PremiumPredictor';
import OIScannerTab       from './components/OIScannerTab';
import OIPulseTab         from './components/OIPulseTab';
import StrikeAnalyserTab  from './components/StrikeAnalyserTab';
import IntelligenceTab    from './components/IntelligenceTab';
import Profile            from './Profile';

// ── Internal barrel imports ──────────────────────────────────────────────────
import type { DashData, SignalData, Tab } from './dashboard/types';
import { n, fmt, ivColor }                from './dashboard/shared/helpers';
import { useNetworkMonitor }              from './dashboard/shared/useNetworkMonitor';
import {
  NetWidget, NetToasts, OfflineBanner,
}                                         from './dashboard/shared/NetComponents';
import { MarketStatusBanner }             from './dashboard/shared/MarketStatusBanner';
import {
  ChainTab, ChartsTab, SignalsTab, AnalyticsTab,
  StrategyBuilderTab, SpoofingTab, NetworkTab,
}                                         from './dashboard/tabs';
import {
  ENDPOINTS, FALLBACK_POLL_MS, SSE_FALLBACK_TIMEOUT_MS,
}                                         from './dashboard/constants';

// ============================================================================
// DASHBOARD
// ============================================================================


// ─── OIScannerWrapper: sub-tab switcher ──────────────────────────────────────
function OIScannerWrapper({ chain, summary }: { chain: any; summary: any }) {
  const [subTab, setSubTab] = React.useState<'oi' | 'gex'>('oi');
  const base: React.CSSProperties = {
    flex: 1, padding: '11px 0', border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 700, letterSpacing: 1.5, transition: 'all 0.15s',
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Sub-tab switcher bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0d0d0d', flexShrink: 0 }}>
        <button onClick={() => setSubTab('oi')} style={{
          ...base,
          background: subTab === 'oi' ? 'rgba(249,115,22,0.10)' : 'transparent',
          borderBottom: subTab === 'oi' ? '2px solid #f97316' : '2px solid transparent',
          color: subTab === 'oi' ? '#f97316' : 'rgba(255,255,255,0.3)',
        }}>🔭&nbsp;&nbsp;OI CONCENTRATION SCANNER</button>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
        <button onClick={() => setSubTab('gex')} style={{
          ...base,
          background: subTab === 'gex' ? 'rgba(167,139,250,0.10)' : 'transparent',
          borderBottom: subTab === 'gex' ? '2px solid #a78bfa' : '2px solid transparent',
          color: subTab === 'gex' ? '#a78bfa' : 'rgba(255,255,255,0.3)',
        }}>📌&nbsp;&nbsp;GEX REGIME · STRIKE ANALYSER</button>
      </div>
      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {subTab === 'oi' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <OIScannerTab />
          </div>
        )}
        {subTab === 'gex' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <StrikeAnalyserTab chain={chain} summary={summary} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [data,          setData]          = useState<DashData | null>(null);
  const [signalData,    setSignalData]    = useState<SignalData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [activeTab,     setActiveTab]     = useState<Tab>('chain');
  const [lastUpdate,    setLastUpdate]    = useState(new Date());
  const [sseStatus,     setSseStatus]     = useState<'connecting' | 'live' | 'reconnecting' | 'fallback'>('connecting');
  const [pushLatencyMs,    setPushLatencyMs]    = useState<number | null>(null);
  const [oiScannerSummary, setOiScannerSummary] = useState<any>(null);
  const [showProfile,   setShowProfile]   = useState(false);
  const { net, toasts, isTesting, runManualTest } = useNetworkMonitor();

  // ── Refs ───────────────────────────────────────────────────────────────────
  const prevChainRef = useRef<Map<string, number>>(new Map());
  const sseRef       = useRef<EventSource | null>(null);
  const fallbackRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataRef      = useRef(data);
  const sseStatusRef = useRef<typeof sseStatus>('connecting');
  dataRef.current    = data;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setStatus(s: typeof sseStatus) {
    sseStatusRef.current = s;
    setSseStatus(s);
  }

  const applyData = useCallback((incoming: any) => {
    if (!incoming?.chain) return;

    // Track previous OI for flash-highlighting
    const prev = new Map<string, number>();
    if (dataRef.current?.chain) {
      for (const r of dataRef.current.chain) {
        prev.set(`ce_${n(r.strike_price)}`, n(r.ce_oi));
        prev.set(`pe_${n(r.strike_price)}`, n(r.pe_oi));
      }
    }
    prevChainRef.current = prev;
    setData(incoming);
    setLastUpdate(new Date());
    setError(null);
    setLoading(false);

    // Track SSE push latency
    if (incoming.timestamp && incoming.source === 'live_push') {
      const latency = Date.now() - new Date(incoming.timestamp).getTime();
      if (latency >= 0 && latency < 10_000) setPushLatencyMs(latency);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get(ENDPOINTS.greeks);
      if (res.data.success) applyData(res.data.data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Connection failed. Is the backend running on port 3001?');
      setLoading(false);
    }
  }, [applyData]);

  // ── SSE with exponential back-off + REST fallback ─────────────────────────
  useEffect(() => {
    let alive = true;
    let reconnectDelay = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connectSSE() {
      if (!alive) return;
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setStatus('connecting');

      const es = new EventSource(ENDPOINTS.streamChain);
      sseRef.current = es;

      es.onopen = () => {
        if (!alive) { es.close(); return; }
        setStatus('live');
        reconnectDelay = 1000;
        if (fallbackRef.current) { clearInterval(fallbackRef.current); fallbackRef.current = null; }
      };

      es.onmessage = (event) => {
        if (!alive) return;
        try { applyData(JSON.parse(event.data)); } catch (_) {}
      };

      es.onerror = () => {
        if (!alive) return;
        es.close(); sseRef.current = null; setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
          connectSSE();
        }, reconnectDelay);
      };
    }

    connectSSE();

    // After timeout, fall back to polling if SSE never connected
    const safetyTimer = setTimeout(() => {
      if (sseStatusRef.current !== 'live' && !fallbackRef.current) {
        setStatus('fallback');
        fallbackRef.current = setInterval(async () => {
          try {
            const res = await axios.get(ENDPOINTS.greeks);
            if (res.data.success) applyData(res.data.data);
          } catch (_) {}
        }, FALLBACK_POLL_MS);
      }
    }, SSE_FALLBACK_TIMEOUT_MS);

    return () => {
      alive = false;
      if (reconnectTimer)  clearTimeout(reconnectTimer);
      clearTimeout(safetyTimer);
      if (sseRef.current)  { sseRef.current.close(); sseRef.current = null; }
      if (fallbackRef.current) { clearInterval(fallbackRef.current); fallbackRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Signal data — only fetch when relevant tabs are visible ───────────────
  const fetchSignals = useCallback(async () => {
    try {
      const res = await axios.get(ENDPOINTS.signals);
      if (res.data.success) setSignalData(res.data.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (['signals', 'analytics', 'strategy', 'predictor'].includes(activeTab)) {
      fetchSignals();
      const id = setInterval(fetchSignals, 10_000);
      return () => clearInterval(id);
    }
  }, [activeTab, fetchSignals]);

  // ── OI Scanner summary — fetch when oiscanner tab is active ───────────────
  useEffect(() => {
    if (activeTab !== 'oiscanner') return;
    const fetchSummary = async () => {
      try {
        const res = await axios.get('http://localhost:3001/api/oi-scanner/summary');
        if (res.data.success) setOiScannerSummary(res.data.data);
      } catch (_) {}
    };
    fetchSummary();
    const id = setInterval(fetchSummary, 30_000);
    return () => clearInterval(id);
  }, [activeTab]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const chain     = data?.chain ?? [];
  const spotPrice = n(data?.spotPrice);
  const atmStrike = n(data?.atmStrike);
  const atmRow    = chain.find(r => Number(r.strike_price) === Number(atmStrike));
  const atmIV     = atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? null;
  const dte       = data?.expiryDate
    ? Math.max(1, Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / 86_400_000))
    : 7;
  const ivSource  = signalData?.ivHistorySource;
  const ivPoints  = signalData?.ivHistoryPoints ?? 0;

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading && !data) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-3 animate-spin">⚡</div>
        <p className="text-white text-lg">Loading JOBBER PRO…</p>
      </div>
    </div>
  );

  if (error && !data) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-6 max-w-sm text-center">
        <p className="text-red-400 text-xl font-bold mb-2">⚠️ Connection Error</p>
        <p className="text-gray-300 text-sm mb-4">{error}</p>
        <button onClick={fetchData} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors">
          🔄 Retry Connection
        </button>
      </div>
    </div>
  );

  if (!data) return null;

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs: Array<{ id: Tab; label: string; pulse?: boolean }> = [
    { id: 'chain',      label: '📋 Options Chain' },
    { id: 'charts',     label: '📈 Charts' },
    { id: 'signals',    label: '🎯 Signals' },
    { id: 'analytics',  label: '📐 Analytics' },
    { id: 'strategy',   label: '🧮 Strategy Builder' },
    { id: 'predictor',  label: '⚡ Predictor' },
    { id: 'data',       label: '📁 Data' },
    { id: 'spoofing',   label: '🚨 Spoofing' },
    {
      id: 'network',
      label: `🌐 Network${net?.quality === 'POOR' || net?.quality === 'OFFLINE' ? ' ⚠️' : ''}`,
      pulse: net?.quality === 'POOR' || net?.quality === 'OFFLINE',
    },
    { id: 'oiscanner',  label: '🔭 OI Scanner' },
    { id: 'oipulse',    label: '⚡ OI Pulse' },
    { id: 'intelligence', label: '🧠 Intelligence' },
  ];

  const isNetworkAlert = net?.quality === 'OFFLINE' || net?.quality === 'POOR';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col" style={{ height: '100vh' }}>

      {/* ── Toast notifications ── */}
      <NetToasts toasts={toasts} />

      {/* ── Market status banner ── */}
      <MarketStatusBanner status={data.marketStatus} latestDataAt={data.latestDataAt} />

      {/* ── Offline / poor-connection banner ── */}
      {isNetworkAlert && net && <OfflineBanner net={net} />}

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 sticky top-0 z-50 flex-wrap gap-2 flex-shrink-0">

        {/* Logo + Profile button */}
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 font-bold text-sm">⚡ JOBBER PRO</span>
          <button
            onClick={() => setShowProfile(true)}
            title="Profile & Settings"
            style={{
              background: '#111',
              border: '1px solid #1f1f1f',
              borderRadius: '50%',
              width: 28,
              height: 28,
              cursor: 'pointer',
              color: '#f97316',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#f97316')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f1f1f')}
          >
            👤
          </button>
        </div>

        {/* NIFTY price */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">NIFTY</span>
          <span className={`text-xl font-bold font-mono ${n(data.spotChange) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmt(spotPrice, 2)}
          </span>
          <span className={`text-xs ${n(data.spotChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {n(data.spotChange) >= 0 ? '▲' : '▼'} {fmt(Math.abs(n(data.spotChange)), 2)} ({fmt(Math.abs(n(data.spotChangePercent)), 2)}%)
          </span>
        </div>

        {/* Right-side stats — hidden on small screens */}
        <div className="hidden lg:flex items-center gap-4 text-xs">
          <div><span className="text-gray-500">ATM </span><span className="text-yellow-400 font-bold">{atmStrike}</span></div>
          <div><span className="text-gray-500">PCR </span><span className="text-orange-400 font-bold">{fmt(data.pcr_oi, 2)}</span></div>
          <div><span className="text-gray-500">Max Pain </span><span className="text-purple-400 font-bold">{data.maxPain}</span></div>
          <div>
            <span className="text-gray-500">ATM IV </span>
            <span style={{ color: ivColor(atmIV) }} className="font-bold">
              {atmIV != null ? `${fmt(atmIV, 1)}%` : '–'}
            </span>
          </div>

          {/* VIX badge */}
          {data.vix != null
            ? <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: data.vix > 20 ? 'rgba(127,29,29,0.5)' : data.vix > 15 ? 'rgba(120,53,15,0.4)' : 'rgba(6,78,59,0.4)',
                border: `1px solid ${data.vix > 20 ? '#ef4444' : data.vix > 15 ? '#f59e0b' : '#10b981'}`,
                borderRadius: 4, padding: '1px 7px',
              }}>
                <span style={{ fontSize: 9, color: '#9ca3af', letterSpacing: 0.5 }}>VIX</span>
                <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: 13, color: data.vix > 20 ? '#f87171' : data.vix > 15 ? '#fbbf24' : '#34d399' }}>
                  {fmt(data.vix, 2)}
                </span>
              </div>
            : <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(30,30,30,0.4)', border: '1px solid #374151', borderRadius: 4, padding: '1px 7px' }}>
                <span style={{ fontSize: 9, color: '#6b7280' }}>VIX</span>
                <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: 13, color: '#4b5563' }}>–</span>
              </div>
          }

          <div><span className="text-gray-500">DTE </span><span className="text-blue-400 font-bold">{dte}d</span></div>
          <div><span className="text-gray-500">Ticks </span><span className="text-blue-400 font-bold">{n(data.totalTicks).toLocaleString()}</span></div>

          {ivSource && (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${ivSource === 'real_db' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
              {ivSource === 'real_db' ? `📊 Real IV (${ivPoints}pts)` : '⚠️ Est. IV'}
            </span>
          )}

          {/* Market open/closed badge */}
          {data.marketStatus?.isOpen
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(5,46,22,0.8)', border: '1px solid #16a34a', color: '#4ade80', fontWeight: 'bold', fontSize: 11, padding: '2px 8px', borderRadius: 4, letterSpacing: 1 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                {data.marketStatus.session === 'MUHURAT' ? '✨ MUHURAT' : '● LIVE'}
              </span>
            : <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(30,20,5,0.8)', border: '1px solid #92400e', color: '#fbbf24', fontWeight: 'bold', fontSize: 11, padding: '2px 8px', borderRadius: 4, letterSpacing: 1 }}>
                {data.marketStatus?.session === 'WEEKEND'  ? '📅 WEEKEND'
                  : data.marketStatus?.session === 'HOLIDAY' ? '🎉 HOLIDAY'
                  : data.marketStatus?.session === 'PRE_OPEN' ? '🔵 PRE-OPEN'
                  : '🔴 CLOSED'}
              </span>
          }

          {/* SSE status badge */}
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
            sseStatus === 'live'         ? 'bg-green-900 text-green-300' :
            sseStatus === 'fallback'     ? 'bg-yellow-900 text-yellow-300' :
            sseStatus === 'reconnecting' ? 'bg-red-900 text-red-300' :
                                           'bg-gray-800 text-gray-400'}`}>
            {sseStatus === 'live'         ? '⚡ LIVE' :
             sseStatus === 'fallback'     ? '⚠ POLL' :
             sseStatus === 'reconnecting' ? '↻ RETRY' : '… CONN'}
            {sseStatus === 'live' && pushLatencyMs !== null && (
              <span className="ml-1 text-green-500">{pushLatencyMs}ms</span>
            )}
            {' '}{lastUpdate.toLocaleTimeString()}
          </span>

          {/* Network widget */}
          {net && <NetWidget net={net} onTest={runManualTest} isTesting={isTesting} />}
        </div>
      </div>

      {/* ── TAB BAR ── */}
      <div className="flex border-b border-gray-800 bg-gray-900 flex-shrink-0" style={{ overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ position: 'relative' }}
            className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.pulse && (
              <span style={{
                position: 'absolute', top: 6, right: 4,
                width: 6, height: 6, borderRadius: '50%',
                background: '#f97316', animation: 'pulse 1s infinite',
              }} />
            )}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-hidden">

        {activeTab === 'chain' && (
          <ChainTab data={data} prevChainRef={prevChainRef} />
        )}

        {activeTab === 'charts' && (
          <ChartsTab data={data} />
        )}

        {activeTab === 'signals' && (
          <SignalsTab signalData={signalData} ivSource={ivSource} ivPoints={ivPoints} />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab
            signalData={signalData}
            ivSource={ivSource}
            ivPoints={ivPoints}
            spotPrice={spotPrice}
            atmIV={atmIV}
            dte={dte}
          />
        )}

        {activeTab === 'strategy' && (
          <StrategyBuilderTab data={data} signalData={signalData} />
        )}

        {activeTab === 'predictor' && (
          <div className="h-full overflow-hidden"><PremiumPredictor /></div>
        )}

        {activeTab === 'data' && (
          <div className="h-full overflow-hidden"><DataManager /></div>
        )}

        {activeTab === 'spoofing' && (
          <div className="h-full overflow-hidden"><SpoofingTab /></div>
        )}

        {activeTab === 'network' && (
          net
            ? <NetworkTab net={net} onTest={runManualTest} isTesting={isTesting} />
            : <div className="flex items-center justify-center py-12 text-gray-500">
                <div className="text-center">
                  <div className="text-3xl mb-3 animate-spin">🌐</div>
                  <div className="text-sm">Initialising network monitor…</div>
                </div>
              </div>
        )}

        {/* ── v7.5: OI Scanner + v1.0: Strike Analyser (split view) ── */}
        {/* ── v8.0: OI Scanner + Strike Analyser (sub-tab switcher) ── */}
        {activeTab === 'oiscanner' && (
          <OIScannerWrapper chain={chain} summary={oiScannerSummary} />
        )}

        {/* ── v1.0: OI Pulse tab ── */}
        {/* ── v1.0: OI Pulse tab ── */}
        {activeTab === 'oipulse' && (
          <div className="h-full overflow-hidden">
            <OIPulseTab />
          </div>
        )}

        {/* ── Intelligence Engine tab ── */}
        {activeTab === 'intelligence' && (
          <div className="h-full overflow-hidden">
            <IntelligenceTab />
          </div>
        )}

      </div>

      {/* ── Profile modal ── */}
      {showProfile && <Profile onClose={() => setShowProfile(false)} />}

    </div>
  );
}