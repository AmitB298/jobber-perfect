/**
 * Dashboard.tsx — JOBBER PRO — v3 OPTIMIZED + 🌐 INTERNET SPEED MONITOR
 * =====================================================
 * v3 FIXES (preserved from v3):
 *   ✅ sseStatusRef — fixes stale closure bug in safetyTimer
 *   ✅ Push latency display in SSE badge
 *   ✅ source field awareness for latency display
 *   ✅ setStatus() helper keeps ref + state in sync
 *
 * 🌐 NEW — Internet Speed Monitor:
 *   ✅ useNetworkMonitor hook — polls /api/network/status every 5s
 *   ✅ SignalBars — phone-style animated bars (EXCELLENT/GOOD/FAIR/POOR/OFFLINE)
 *   ✅ NetWidget — top bar: Mbps + latency + jitter + manual test button
 *   ✅ OfflineBanner — full-width critical alert when connection drops
 *   ✅ NetToasts — slide-in toast notifications (WARNING/CRITICAL/RECOVERED)
 *   ✅ 🌐 Network tab — download gauge, ping bar, packet loss grid, trading impact
 *
 * ALL ORIGINAL FEATURES PRESERVED (8 tabs + new network tab = 9 total)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import DataManager from './components/DataManager';
import PremiumPredictor from '../components/PremiumPredictor';

// ============================================================================
// TYPES
// ============================================================================

interface Greeks {
  delta: number | null; gamma: number | null; theta: number | null;
  vega: number | null;  rho: number | null;   iv: number | null;
}

interface ChainRow {
  strike_price: number;
  ce_ltp: number | null; pe_ltp: number | null;
  ce_volume: number | null; pe_volume: number | null;
  ce_oi: number | null;    pe_oi: number | null;
  ce_greeks?: Greeks;      pe_greeks?: Greeks;
}

interface MarketStatus {
  isOpen: boolean;
  session: 'LIVE' | 'PRE_OPEN' | 'POST_MARKET' | 'WEEKEND' | 'HOLIDAY' | 'MUHURAT';
  note: string;
  holidayName?: string;
  nextOpen?: string;
  minsToOpen?: number;
  minsToClose?: number;
  dataAgeMinutes?: number;
}

interface DashData {
  spotPrice: number; spotChange: number; spotChangePercent: number;
  atmStrike: number; pcr_oi: number; pcr_volume: number;
  maxPain: number;   totalTicks: number;
  chain: ChainRow[]; expiryDate: string;
  latestDataAt?: string;
  marketStatus?: MarketStatus;
  vix?: number | null;
}

interface SignalData {
  signals: any[]; ivAnalysis: any; expectedMove: any;
  spotPrice: number; atmStrike: number;
  daysToExpiry: number; currentIV: number;
  ivHistorySource?: 'real_db' | 'estimated';
  ivHistoryPoints?: number;
}

interface StratLeg {
  id: number;
  action: 'BUY' | 'SELL';
  type: 'CE' | 'PE';
  strike: number;
  premium: number;
  qty: number;
}

// 🌐 Network types
interface NetStatus {
  isOnline: boolean;
  quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'OFFLINE';
  downloadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLoss: number;
  lastChecked: string;
  consecutiveFailures: number;
  alert: { level: 'WARNING' | 'CRITICAL' | 'RECOVERED'; message: string; timestamp: string; } | null;
}
interface NetToast { id: number; level: 'WARNING' | 'CRITICAL' | 'RECOVERED'; message: string; }

type Tab = 'chain' | 'charts' | 'signals' | 'analytics' | 'strategy' | 'predictor' | 'data' | 'spoofing' | 'network';

// ============================================================================
// 🌐 NETWORK MONITOR HOOK
// ============================================================================

// Removed — internet detection is now done via SSE stream status (see useNetworkMonitor)

function useNetworkMonitor() {
  const [net, setNet] = useState<NetStatus>({
    isOnline: true, quality: 'GOOD', downloadMbps: null,
    latencyMs: null, jitterMs: null, packetLoss: 0,
    lastChecked: new Date().toISOString(), consecutiveFailures: 0, alert: null,
  });
  const [toasts, setToasts] = useState<NetToast[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const toastIdRef = useRef(0);

  const pushToast = useCallback((level: NetToast['level'], message: string, durationMs = 6000) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, level, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs);
  }, []);

  useEffect(() => {
    let prev: NetStatus['quality'] | null = null;
    const poll = async () => {
      try {
        const res = await axios.get<{ success: boolean; data: NetStatus }>(
          'http://localhost:3001/api/network/status', { timeout: 4000 }
        );
        if (res.data.success) {
          const d = res.data.data;
          setNet(d);
          if (prev !== null && prev !== d.quality) {
            if (d.quality === 'OFFLINE') pushToast('CRITICAL', '🔴 INTERNET LOST — Angel One WebSocket will disconnect!', 10000);
            else if (d.quality === 'POOR' && !['POOR', 'OFFLINE'].includes(prev)) pushToast('WARNING', '⚠️ POOR CONNECTION — High latency. Data feed may lag.', 7000);
            else if (['EXCELLENT', 'GOOD'].includes(d.quality) && ['POOR', 'OFFLINE'].includes(prev)) pushToast('RECOVERED', '✅ CONNECTION RESTORED — Back to normal.', 5000);
          }
          prev = d.quality;
        }
      } catch {
        setNet(s => ({ ...s, isOnline: false, quality: 'OFFLINE', consecutiveFailures: s.consecutiveFailures + 1, lastChecked: new Date().toISOString() }));
        if (prev !== 'OFFLINE') pushToast('CRITICAL', '🔴 INTERNET CONNECTION LOST — Angel One WebSocket will disconnect!', 10000);
        prev = 'OFFLINE';
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [pushToast]);

  const runManualTest = useCallback(async () => {
    setIsTesting(true);
    try {
      const res = await axios.post<{ success: boolean; data: NetStatus }>(
        'http://localhost:3001/api/network/speedtest', {}, { timeout: 15000 }
      );
      if (res.data.success) {
        setNet(res.data.data);
        pushToast('RECOVERED', `📶 Speed test done: ${res.data.data.downloadMbps?.toFixed(1) ?? '?'} Mbps · ${res.data.data.latencyMs ?? '?'}ms ping`, 5000);
      }
    } catch { pushToast('WARNING', '⚠️ Speed test failed — check backend.', 5000); }
    finally { setIsTesting(false); }
  }, [pushToast]);

  return { net, toasts, isTesting, runManualTest };
}
// ============================================================================
// 🌐 SIGNAL BARS COMPONENT
// ============================================================================

function SignalBars({ quality }: { quality: NetStatus['quality'] }) {
  const filled = { EXCELLENT: 4, GOOD: 3, FAIR: 2, POOR: 1, OFFLINE: 0 }[quality];
  const color  = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[quality];
  return (
    <div className="flex items-end gap-0.5" style={{ height: 14 }}>
      {[4, 7, 10, 14].map((h, i) => (
        <div key={i} style={{ width: 3, height: h, borderRadius: 1,
          background: i < filled ? color : 'rgba(255,255,255,0.15)',
          transition: 'background 0.4s' }} />
      ))}
    </div>
  );
}

// ============================================================================
// 🌐 NET WIDGET — top bar compact display
// ============================================================================

function NetWidget({ net, onTest, isTesting }: { net: NetStatus; onTest: () => void; isTesting: boolean }) {
  const qColor = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[net.quality];
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-lg text-xs"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${qColor}30` }}>
      <SignalBars quality={net.quality} />
      <div className="flex flex-col leading-tight">
        <span style={{ color: qColor }} className="font-bold text-xs leading-none">
          {net.quality === 'OFFLINE' ? '● OFFLINE'
            : net.downloadMbps != null
              ? `${net.downloadMbps >= 1 ? net.downloadMbps.toFixed(1) : (net.downloadMbps * 1000).toFixed(0) + 'k'} Mbps`
              : net.quality}
        </span>
        <span className="text-gray-500 leading-none" style={{ fontSize: 9 }}>
          {net.latencyMs != null ? `${net.latencyMs}ms` : '–'}{net.jitterMs ? ` ±${net.jitterMs}ms` : ''}{net.packetLoss > 0 ? ` · ${net.packetLoss}%loss` : ''}
        </span>
      </div>
      <button onClick={onTest} disabled={isTesting} title="Run speed test"
        className="text-gray-500 hover:text-white transition-colors" style={{ fontSize: 11 }}>
        {isTesting ? '⟳' : '🔄'}
      </button>
    </div>
  );
}

// ============================================================================
// 🌐 TOAST NOTIFICATIONS
// ============================================================================

function NetToasts({ toasts }: { toasts: NetToast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-14 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <style>{`@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      {toasts.map(t => {
        const bg     = t.level === 'CRITICAL' ? '#450a0a' : t.level === 'WARNING' ? '#431407' : '#052e16';
        const border = t.level === 'CRITICAL' ? '#dc2626' : t.level === 'WARNING' ? '#ea580c' : '#16a34a';
        const icon   = t.level === 'CRITICAL' ? '🔴'      : t.level === 'WARNING' ? '⚠️'      : '✅';
        return (
          <div key={t.id} style={{ background: bg, border: `1px solid ${border}`, borderLeft: `4px solid ${border}`, animation: 'slideIn 0.3s ease' }}
            className="rounded-lg px-4 py-3 text-sm text-white max-w-xs shadow-2xl pointer-events-auto">
            <div className="flex items-center gap-2"><span>{icon}</span><span className="font-semibold">{t.level}</span></div>
            <div className="text-gray-300 text-xs mt-1">{t.message}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 🌐 OFFLINE BANNER — full-width, hard to miss
// ============================================================================

function OfflineBanner({ net }: { net: NetStatus }) {
  if (net.quality !== 'OFFLINE' && net.quality !== 'POOR') return null;
  const isCritical = net.quality === 'OFFLINE';
  return (
    <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 text-xs font-bold"
      style={{
        background: isCritical ? 'rgba(127,29,29,0.95)' : 'rgba(124,45,18,0.90)',
        borderBottom: `2px solid ${isCritical ? '#dc2626' : '#ea580c'}`,
        animation: isCritical ? 'pulse 2s infinite' : 'none',
      }}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{isCritical ? '🔴' : '🟠'}</span>
        <div>
          <div style={{ color: isCritical ? '#fca5a5' : '#fdba74' }}>
            {isCritical
              ? '⚠️ INTERNET CONNECTION LOST — Angel One WebSocket has disconnected!'
              : '⚠️ POOR INTERNET — High latency detected. Data feed may be delayed.'}
          </div>
          <div className="text-gray-400 font-normal mt-0.5">
            {isCritical
              ? `${net.consecutiveFailures} consecutive check failures · Both backend + browser internet check failed · Last checked: ${new Date(net.lastChecked).toLocaleTimeString('en-IN')}`
              : `Latency: ${net.latencyMs}ms · Jitter: ±${net.jitterMs}ms · Packet loss: ${net.packetLoss}%`}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div style={{ color: isCritical ? '#f87171' : '#fb923c' }}>{isCritical ? 'OFFLINE' : `${net.latencyMs}ms`}</div>
        <div className="text-gray-500 font-normal">{isCritical ? 'No packets' : 'HIGH LATENCY'}</div>
      </div>
    </div>
  );
}

// ============================================================================
// 🌐 NETWORK DETAIL TAB PANEL
// ============================================================================

function NetworkDetailPanel({ net, onTest, isTesting }: { net: NetStatus; onTest: () => void; isTesting: boolean }) {
  const qual = net.quality;
  const qColor = { EXCELLENT: '#22C55E', GOOD: '#86EFAC', FAIR: '#FACC15', POOR: '#F97316', OFFLINE: '#EF4444' }[qual];
  const speedPercent = Math.min(100, ((net.downloadMbps ?? 0) / 100) * 100);
  const latPct = Math.min(100, (1 - Math.min((net.latencyMs ?? 300) / 300, 1)) * 100);
  const tradingRating = qual === 'EXCELLENT' ? 'Optimal for live trading' : qual === 'GOOD' ? 'Suitable for trading' : qual === 'FAIR' ? 'Trade with caution — delayed fills possible' : qual === 'POOR' ? 'NOT recommended for live trading' : 'STOP TRADING — connection lost';
  const tradingColor = qual === 'EXCELLENT' || qual === 'GOOD' ? '#22C55E' : qual === 'FAIR' ? '#FACC15' : '#EF4444';
  const rows = [
    { label: 'Status',      value: qual,                           color: qColor },
    { label: 'Download',    value: net.downloadMbps != null ? `${net.downloadMbps >= 1 ? net.downloadMbps.toFixed(2) : (net.downloadMbps * 1000).toFixed(1) + 'k'} Mbps` : '–', color: '#60A5FA' },
    { label: 'Ping (Avg)',  value: net.latencyMs != null ? `${net.latencyMs} ms` : '–', color: net.latencyMs != null && net.latencyMs < 50 ? '#22C55E' : net.latencyMs && net.latencyMs < 120 ? '#FACC15' : '#EF4444' },
    { label: 'Jitter',      value: net.jitterMs != null ? `±${net.jitterMs} ms` : '–', color: '#A78BFA' },
    { label: 'Packet Loss', value: `${net.packetLoss}%`,           color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' },
    { label: 'Failures',    value: String(net.consecutiveFailures), color: net.consecutiveFailures === 0 ? '#22C55E' : '#EF4444' },
    { label: 'Last Check',  value: new Date(net.lastChecked).toLocaleTimeString('en-IN'), color: '#9CA3AF' },
  ];
  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="grid grid-cols-3 gap-4 max-w-4xl mx-auto">

        {/* Quality card */}
        <div className="col-span-1 bg-gray-900 rounded-xl border p-5 flex flex-col items-center justify-center" style={{ borderColor: qColor + '40' }}>
          <div className="mb-3"><SignalBars quality={qual} /></div>
          <div className="text-4xl font-black mb-1" style={{ color: qColor }}>{qual}</div>
          <div className="text-xs text-center" style={{ color: tradingColor }}>{tradingRating}</div>
          <button onClick={onTest} disabled={isTesting} className="mt-4 px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{ background: isTesting ? 'rgba(255,255,255,0.05)' : qColor + '20', border: `1px solid ${qColor}50`, color: isTesting ? '#6B7280' : qColor }}>
            {isTesting ? '⟳ Running...' : '🔄 Run Speed Test'}
          </button>
        </div>

        {/* Stats */}
        <div className="col-span-1 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Network Stats</h3>
          <div className="space-y-3">
            {rows.map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">{r.label}</span>
                <span className="text-xs font-bold" style={{ color: r.color }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gauges */}
        <div className="col-span-1 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Live Gauges</h3>
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Download Speed</span>
              <span className="text-blue-400 font-bold">{net.downloadMbps != null ? `${net.downloadMbps.toFixed(1)} Mbps` : 'Testing…'}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${speedPercent}%`, background: 'linear-gradient(90deg,#3B82F6,#06B6D4)' }} />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5"><span>0</span><span>50</span><span>100+ Mbps</span></div>
          </div>
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Ping Quality</span>
              <span className="font-bold" style={{ color: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444' }}>{net.latencyMs != null ? `${net.latencyMs}ms` : '–'}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${latPct}%`, background: latPct > 70 ? '#22C55E' : latPct > 40 ? '#FACC15' : '#EF4444' }} />
            </div>
            <div className="flex justify-between text-xs text-gray-700 mt-0.5"><span>0ms</span><span>150ms</span><span>300ms+</span></div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Packet Loss</span>
              <span className="font-bold" style={{ color: net.packetLoss === 0 ? '#22C55E' : net.packetLoss < 20 ? '#FACC15' : '#EF4444' }}>{net.packetLoss}%</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex-1 h-3 rounded-sm transition-all duration-500"
                  style={{ background: net.packetLoss >= (i + 1) * 10 ? (net.packetLoss >= 50 ? '#EF4444' : '#F97316') : '#1F2937' }} />
              ))}
            </div>
          </div>
        </div>

        {/* Trading impact */}
        <div className="col-span-3 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">📡 Trading Impact Analysis</h3>
          <div className="grid grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Angel One WebSocket', ok: qual !== 'OFFLINE',                       note: qual === 'OFFLINE' ? 'DISCONNECTED' : qual === 'POOR' ? 'Unstable'  : 'Connected' },
              { label: 'Order Execution',     ok: !['OFFLINE', 'POOR'].includes(qual),      note: qual === 'OFFLINE' ? 'BLOCKED'      : qual === 'POOR' ? 'Delayed'   : 'Normal' },
              { label: 'Live Data Feed',      ok: !['OFFLINE', 'POOR'].includes(qual),      note: qual === 'OFFLINE' ? 'STOPPED'      : qual === 'POOR' ? 'Lagging'   : 'Live' },
              { label: 'DB Write Speed',      ok: qual !== 'OFFLINE',                       note: qual === 'OFFLINE' ? 'Local only'                                    : 'Normal' },
            ].map(item => (
              <div key={item.label} className="rounded-lg p-3 text-center"
                style={{ background: item.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.12)', border: `1px solid ${item.ok ? '#22C55E30' : '#EF444430'}` }}>
                <div className="text-lg mb-1">{item.ok ? '✅' : '❌'}</div>
                <div className="font-bold text-white">{item.label}</div>
                <div style={{ color: item.ok ? '#22C55E' : '#EF4444' }}>{item.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MARKET STATUS BANNER
// ============================================================================

function MarketStatusBanner({ status, latestDataAt }: { status?: MarketStatus; latestDataAt?: string }) {
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!status) return;
    const tick = () => {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const h = ist.getUTCHours(), m = ist.getUTCMinutes(), s = ist.getUTCSeconds();
      const timeMin = h * 60 + m;
      if (status.session === 'LIVE') {
        const secsLeft = (15 * 60 + 30 - timeMin) * 60 - s;
        const mm = Math.floor(secsLeft / 60), ss = secsLeft % 60;
        setCountdown(`Closes in ${mm}m ${ss}s`);
      } else if (status.session === 'PRE_OPEN') {
        const secsLeft = (9 * 60 + 15 - timeMin) * 60 - s;
        const mm = Math.floor(secsLeft / 60), ss = secsLeft % 60;
        setCountdown(`Opens in ${mm}m ${ss}s`);
      } else {
        setCountdown('');
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status?.session]);

  if (!status) return null;

  const dataAge = status.dataAgeMinutes;
  const dataAgeStr = latestDataAt
    ? new Date(latestDataAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })
    : null;
  const isDataStale = dataAge != null && dataAge > 60;

  const configs: Record<string, { bg: string; border: string; dot: string; dotAnim: boolean; label: string; emoji: string; labelColor: string }> = {
    LIVE:        { bg: 'rgba(5,46,22,0.95)',  border: '#16a34a', dot: '#22c55e', dotAnim: true,  label: 'MARKET LIVE',     emoji: '🟢', labelColor: '#4ade80' },
    PRE_OPEN:    { bg: 'rgba(12,45,60,0.95)', border: '#0284c7', dot: '#38bdf8', dotAnim: true,  label: 'PRE-OPEN',        emoji: '🔵', labelColor: '#7dd3fc' },
    POST_MARKET: { bg: 'rgba(23,23,34,0.95)', border: '#4b5563', dot: '#6b7280', dotAnim: false, label: 'MARKET CLOSED',   emoji: '🔴', labelColor: '#9ca3af' },
    WEEKEND:     { bg: 'rgba(30,20,5,0.95)',  border: '#92400e', dot: '#f59e0b', dotAnim: false, label: 'WEEKEND',         emoji: '📅', labelColor: '#fbbf24' },
    HOLIDAY:     { bg: 'rgba(40,10,40,0.95)', border: '#7c3aed', dot: '#a78bfa', dotAnim: false, label: 'NSE HOLIDAY',     emoji: '🎉', labelColor: '#c4b5fd' },
    MUHURAT:     { bg: 'rgba(40,30,0,0.95)',  border: '#d97706', dot: '#fbbf24', dotAnim: true,  label: 'MUHURAT TRADING', emoji: '✨', labelColor: '#fde68a' },
  };
  const cfg = configs[status.session] || configs.POST_MARKET;

  return (
    <div style={{ background: cfg.bg, borderBottom: `2px solid ${cfg.border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', flexShrink: 0, fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}`, animation: cfg.dotAnim ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>
        <span style={{ color: cfg.labelColor, fontWeight: 'bold', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>{cfg.emoji} {cfg.label}</span>
        <span style={{ color: '#374151', fontSize: '12px' }}>|</span>
        <span style={{ color: '#9ca3af', fontSize: '11px' }}>{status.session === 'HOLIDAY' && status.holidayName ? `${status.holidayName} — ${status.note.split('—')[1] || ''}` : status.note}</span>
        {countdown && <span style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${cfg.border}`, color: cfg.labelColor, fontSize: '11px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px' }}>⏱ {countdown}</span>}
        {!status.isOpen && status.nextOpen && <span style={{ color: '#6b7280', fontSize: '11px' }}>Next: <span style={{ color: '#93c5fd' }}>{status.nextOpen}</span></span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {dataAgeStr && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
            <span style={{ color: '#6b7280' }}>Last Angel One data:</span>
            <span style={{ color: isDataStale ? '#f97316' : '#34d399', fontWeight: 'bold', background: isDataStale ? 'rgba(251,146,60,0.1)' : 'rgba(52,211,153,0.1)', padding: '1px 6px', borderRadius: '3px', border: `1px solid ${isDataStale ? 'rgba(251,146,60,0.3)' : 'rgba(52,211,153,0.3)'}` }}>{dataAgeStr} IST</span>
            {dataAge != null && <span style={{ color: isDataStale ? '#f97316' : '#6b7280', fontSize: '10px' }}>({dataAge < 60 ? `${dataAge}m ago` : dataAge < 1440 ? `${Math.floor(dataAge / 60)}h ${dataAge % 60}m ago` : `${Math.floor(dataAge / 1440)}d ago`}){isDataStale && ' ⚠️ STALE'}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

const n = (v: any, fb = 0): number => { if (v == null) return fb; const p = Number(v); return isNaN(p) ? fb : p; };
const fmt = (v: any, d = 2): string => { const num = n(v, NaN); return isNaN(num) ? '–' : num.toFixed(d); };
const fmtK = (v: any): string => {
  const num = n(v, 0);
  if (num >= 1_00_00_000) return (num / 1_00_00_000).toFixed(1) + 'Cr';
  if (num >= 1_00_000)    return (num / 1_00_000).toFixed(1) + 'L';
  if (num >= 1_000)       return (num / 1_000).toFixed(1) + 'K';
  return num.toFixed(0);
};
const ivColor = (iv: any): string => {
  const v = n(iv, -1);
  if (v < 0)  return '#6B7280';
  if (v < 12) return '#22C55E';
  if (v < 18) return '#84CC16';
  if (v < 25) return '#FBBF24';
  if (v < 35) return '#F97316';
  return '#EF4444';
};
const fmtRs = (v: number, d = 0): string =>
  '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

// ============================================================================
// BLACK-SCHOLES ENGINE (client-side, for Strategy Builder)
// ============================================================================

const BS = (() => {
  const normCDF = (x: number): number => {
    if (x < -8) return 0; if (x > 8) return 1;
    if (x < 0) return 1 - normCDF(-x);
    const t = 1 / (1 + 0.2316419 * x);
    const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return 1 - 0.3989422804014327 * Math.exp(-0.5 * x * x) * p;
  };
  const normPDF = (x: number): number => Math.exp(-0.5 * x * x) * 0.3989422804014327;

  const greeks = (S: number, K: number, T: number, r: number, sigma: number) => {
    if (!isFinite(S) || !isFinite(K) || S <= 0 || K <= 0 || sigma <= 0) return null;
    if (T <= 0) return { callPrice: Math.max(0, S - K), putPrice: Math.max(0, K - S), callDelta: S > K ? 1 : S === K ? .5 : 0, putDelta: S < K ? -1 : S === K ? -.5 : 0, gamma: 0, callTheta: 0, putTheta: 0, vega: 0 };
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const Nd1 = normCDF(d1), Nd2 = normCDF(d2), nd1 = normPDF(d1), KerT = K * Math.exp(-r * T);
    return {
      callPrice: Math.max(0, S * Nd1 - KerT * Nd2),
      putPrice:  Math.max(0, KerT * (1 - Nd2) - S * (1 - Nd1)),
      callDelta: Nd1, putDelta: Nd1 - 1,
      gamma: nd1 / (S * sigma * sqrtT),
      callTheta: (-(S * nd1 * sigma) / (2 * sqrtT) - r * KerT * Nd2) / 252,
      putTheta:  (-(S * nd1 * sigma) / (2 * sqrtT) + r * KerT * (1 - Nd2)) / 252,
      vega: S * nd1 * sqrtT / 100,
    };
  };

  const strategyPoP = (legs: StratLeg[], spot: number, dte: number, iv: number, rate: number): number | null => {
    if (!legs.length) return null;
    const T = dte / 365;
    if (T <= 0) {
      const pl = legs.reduce((s, l) => { const intr = l.type === 'CE' ? Math.max(0, spot - l.strike) : Math.max(0, l.strike - spot); return s + (intr - l.premium) * (l.action === 'BUY' ? 1 : -1) * l.qty; }, 0);
      return pl > 0 ? 99.9 : 0.1;
    }
    const sigma = iv / 100, r = rate / 100;
    const mu = Math.log(spot) + (r - .5 * sigma * sigma) * T, sd = sigma * Math.sqrt(T);
    const N = 400, minZ = -5, maxZ = 5, dz = (maxZ - minZ) / N;
    let prob = 0;
    for (let i = 0; i <= N; i++) {
      const z = minZ + i * dz, price = Math.exp(mu + sd * z);
      const payoff = legs.reduce((s, l) => { const intr = l.type === 'CE' ? Math.max(0, price - l.strike) : Math.max(0, l.strike - price); return s + (intr - l.premium) * (l.action === 'BUY' ? 1 : -1) * l.qty; }, 0);
      const w = (i === 0 || i === N) ? 0.5 : 1.0;
      if (payoff > 0) prob += normPDF(z) * dz * w;
    }
    const totalW = normCDF(maxZ) - normCDF(minZ);
    return Math.min(99.9, Math.max(0.1, (prob / totalW) * 100));
  };

  return { greeks, strategyPoP };
})();

// ============================================================================
// OI DISTRIBUTION CHART
// ============================================================================

function OIDistributionChart({ data, atmStrike }: { data: any[]; atmStrike: number }) {
  if (!data || data.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const maxOI = Math.max(...data.map(d => Math.max(n(d.ce_oi), n(d.pe_oi))), 1);
  const atm5 = data.filter(d => Math.abs(n(d.strike) - atmStrike) <= 250).slice(0, 14);
  return (
    <div className="space-y-1 overflow-y-auto max-h-64">
      {atm5.map(d => {
        const cePct = (n(d.ce_oi) / maxOI) * 100, pePct = (n(d.pe_oi) / maxOI) * 100;
        const isAtm = n(d.strike) === atmStrike;
        return (
          <div key={d.strike} className={`flex items-center gap-2 text-xs ${isAtm ? 'bg-yellow-900/30 rounded' : ''}`}>
            <div className="w-14 text-right text-green-400" style={{ fontSize: 10 }}>{fmtK(d.ce_oi)}</div>
            <div className="flex-1 flex gap-0.5 h-4 items-center">
              <div className="flex-1 flex justify-end"><div className="bg-green-600/70 h-3 rounded-l" style={{ width: `${cePct}%`, minWidth: cePct > 0 ? 2 : 0 }} /></div>
              <div className="text-gray-400 text-center w-12" style={{ fontSize: 9 }}>{isAtm ? '◄►' : n(d.strike)}</div>
              <div className="flex-1"><div className="bg-red-600/70 h-3 rounded-r" style={{ width: `${pePct}%`, minWidth: pePct > 0 ? 2 : 0 }} /></div>
            </div>
            <div className="w-14 text-left text-red-400" style={{ fontSize: 10 }}>{fmtK(d.pe_oi)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// IV SMILE CHART (custom SVG — no recharts)
// ============================================================================

function IVSmileTooltip({ active, payload, label, atmStrike, spotPrice }: any) {
  if (!active || !payload || !payload.length) return null;
  const strike = Number(label);
  const ceIV = payload.find((p: any) => p.dataKey === 'ce_iv');
  const peIV = payload.find((p: any) => p.dataKey === 'pe_iv');
  const ceVal = ceIV?.value != null ? Number(ceIV.value) : null;
  const peVal = peIV?.value != null ? Number(peIV.value) : null;
  const isATM = strike === atmStrike;
  const moneyness = spotPrice > 0 ? ((strike - spotPrice) / spotPrice * 100) : 0;
  const skew = (ceVal != null && peVal != null) ? peVal - ceVal : null;
  const ivCol = (v: number | null) => { if (v == null) return '#6B7280'; if (v < 12) return '#22C55E'; if (v < 18) return '#84CC16'; if (v < 25) return '#FBBF24'; if (v < 35) return '#F97316'; return '#EF4444'; };
  const ivLabel = (v: number | null) => { if (v == null) return '–'; if (v < 12) return 'Very Low'; if (v < 18) return 'Low'; if (v < 25) return 'Normal'; if (v < 35) return 'High'; return 'Extreme'; };
  return (
    <div style={{ background: 'rgba(10,10,26,0.97)', border: `1px solid ${isATM ? '#FBBF24' : '#374151'}`, borderRadius: 8, padding: '10px 14px', minWidth: 200, boxShadow: isATM ? '0 0 16px rgba(251,191,36,0.25)' : '0 4px 20px rgba(0,0,0,0.6)', fontFamily: 'monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontWeight: 'bold', fontSize: 15, color: isATM ? '#FBBF24' : '#F1F5F9' }}>Strike {strike.toLocaleString('en-IN')}</span>
        {isATM && <span style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid #FBBF24', color: '#FBBF24', fontSize: 9, fontWeight: 'bold', padding: '1px 5px', borderRadius: 3, letterSpacing: 1 }}>ATM ★</span>}
        <span style={{ marginLeft: 'auto', color: moneyness > 0 ? '#F97316' : '#22C55E', fontSize: 10 }}>{moneyness >= 0 ? '+' : ''}{moneyness.toFixed(2)}%</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>📗 CE (Call) IV</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: ceVal != null ? ivCol(ceVal) : '#6B7280', fontWeight: 'bold', fontSize: 14 }}>{ceVal != null ? `${ceVal.toFixed(2)}%` : '–'}</span>
          {ceVal != null && <span style={{ color: ivCol(ceVal), fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{ivLabel(ceVal)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>📕 PE (Put) IV</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: peVal != null ? ivCol(peVal) : '#6B7280', fontWeight: 'bold', fontSize: 14 }}>{peVal != null ? `${peVal.toFixed(2)}%` : '–'}</span>
          {peVal != null && <span style={{ color: ivCol(peVal), fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{ivLabel(peVal)}</span>}
        </div>
      </div>
      {skew != null && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#9CA3AF', fontSize: 11 }}>⚖️ IV Skew (PE−CE)</span>
            <span style={{ color: skew > 2 ? '#EF4444' : skew < -2 ? '#22C55E' : '#FBBF24', fontWeight: 'bold', fontSize: 13 }}>{skew >= 0 ? '+' : ''}{skew.toFixed(2)}%</span>
          </div>
          <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: skew > 3 ? 'rgba(239,68,68,0.12)' : skew < -3 ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.08)', border: `1px solid ${skew > 3 ? 'rgba(239,68,68,0.3)' : skew < -3 ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.2)'}`, textAlign: 'center' }}>
            <span style={{ fontSize: 10, color: skew > 3 ? '#FCA5A5' : skew < -3 ? '#86EFAC' : '#FDE68A', fontWeight: 'bold' }}>
              {skew > 5 ? '🔴 Strong Put Skew — Fear/Hedging' : skew > 2 ? '🟠 Put Skew — Mild Bearish Bias' : skew < -5 ? '🟢 Strong Call Skew — Bullish Sentiment' : skew < -2 ? '🟢 Call Skew — Mild Bullish Bias' : '🟡 Neutral — Balanced IV'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function IVSmileChart({ data, atmStrike, spotPrice }: { data: any[]; atmStrike: number; spotPrice?: number }) {
  if (!data || data.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const valid = data.filter(d => d.ce_iv != null || d.pe_iv != null);
  if (valid.length === 0) return <div className="text-gray-500 text-sm p-4">Calculating IV…</div>;
  const near = valid.filter(d => Math.abs(n(d.strike) - atmStrike) <= 700).slice(0, 24);
  const spot = spotPrice || atmStrike;
  const allIVs = near.flatMap(d => [d.ce_iv, d.pe_iv].filter((v): v is number => v != null));
  const maxIV = Math.max(...allIVs, 1), minIV = Math.max(0, Math.min(...allIVs) - 2);
  return <div style={{ position: 'relative', width: '100%', height: 180 }}><IVSmileInner near={near} atmStrike={atmStrike} spot={spot} minIV={minIV} maxIV={maxIV} /></div>;
}

function IVSmileInner({ near, atmStrike, spot, minIV, maxIV }: any) {
  const [hovered, setHovered] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 540, H = 180, PL = 32, PR = 8, PT = 10, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const strikes = near.map((d: any) => n(d.strike));
  const minS = Math.min(...strikes), maxS = Math.max(...strikes);
  const xScale = (s: number) => PL + ((s - minS) / (maxS - minS + 1)) * chartW;
  const yScale = (iv: number) => PT + chartH - ((iv - minIV) / (maxIV - minIV + 0.001)) * chartH;
  const cePoints = near.filter((d: any) => d.ce_iv != null).map((d: any) => `${xScale(n(d.strike))},${yScale(n(d.ce_iv))}`).join(' ');
  const pePoints = near.filter((d: any) => d.pe_iv != null).map((d: any) => `${xScale(n(d.strike))},${yScale(n(d.pe_iv))}`).join(' ');
  const yTickValues = Array.from({ length: 5 }, (_, i) => minIV + (maxIV - minIV) * i / 4);
  const xLabels = near.filter((_: any, i: number) => i % 2 === 0);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    let closest = near[0], minDist = Infinity;
    for (const d of near) { const dist = Math.abs(xScale(n(d.strike)) - mx); if (dist < minDist) { minDist = dist; closest = d; } }
    setHovered(minDist < 30 ? closest : null);
  };
  const hovX = hovered ? xScale(n(hovered.strike)) : null;
  const isATMhov = hovered && n(hovered.strike) === atmStrike;
  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)} style={{ cursor: 'crosshair', display: 'block' }}>
        {yTickValues.map((v, i) => (<g key={i}><line x1={PL} y1={yScale(v)} x2={W - PR} y2={yScale(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} /><text x={PL - 3} y={yScale(v) + 3} textAnchor="end" fill="#4B5563" fontSize={8}>{v.toFixed(0)}%</text></g>))}
        <line x1={xScale(atmStrike)} y1={PT} x2={xScale(atmStrike)} y2={H - PB} stroke="rgba(251,191,36,0.25)" strokeWidth={1} strokeDasharray="4,3" />
        <text x={xScale(atmStrike)} y={PT - 2} textAnchor="middle" fill="#FBBF24" fontSize={7}>ATM</text>
        <polyline points={cePoints} fill="none" stroke="#22C55E" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pePoints} fill="none" stroke="#EF4444" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {near.map((d: any, i: number) => (
          <g key={i}>
            {d.ce_iv != null && <circle cx={xScale(n(d.strike))} cy={yScale(n(d.ce_iv))} r={n(d.strike) === atmStrike ? 5 : 3} fill={n(d.strike) === atmStrike ? '#FBBF24' : '#22C55E'} stroke={n(d.strike) === atmStrike ? '#FDE68A' : '#111'} strokeWidth={n(d.strike) === atmStrike ? 2 : 1} />}
            {d.pe_iv != null && <circle cx={xScale(n(d.strike))} cy={yScale(n(d.pe_iv))} r={n(d.strike) === atmStrike ? 5 : 3} fill={n(d.strike) === atmStrike ? '#FBBF24' : '#EF4444'} stroke={n(d.strike) === atmStrike ? '#FDE68A' : '#111'} strokeWidth={n(d.strike) === atmStrike ? 2 : 1} />}
          </g>
        ))}
        {hovered && hovX != null && (
          <>
            <line x1={hovX} y1={PT} x2={hovX} y2={H - PB} stroke={isATMhov ? '#FBBF24' : 'rgba(255,255,255,0.35)'} strokeWidth={1} strokeDasharray="3,2" />
            {hovered.ce_iv != null && <circle cx={hovX} cy={yScale(n(hovered.ce_iv))} r={6} fill="#22C55E" stroke="#fff" strokeWidth={2} />}
            {hovered.pe_iv != null && <circle cx={hovX} cy={yScale(n(hovered.pe_iv))} r={6} fill="#EF4444" stroke="#fff" strokeWidth={2} />}
          </>
        )}
        {xLabels.map((d: any, i: number) => { const isAtm = n(d.strike) === atmStrike; return <text key={i} x={xScale(n(d.strike))} y={H - 4} textAnchor="middle" fill={isAtm ? '#FBBF24' : '#4B5563'} fontSize={isAtm ? 9 : 7.5} fontWeight={isAtm ? 'bold' : 'normal'}>{isAtm ? `★${n(d.strike)}` : n(d.strike)}</text>; })}
        <g transform={`translate(${W - PR - 90}, ${PT})`}>
          <line x1={0} y1={5} x2={14} y2={5} stroke="#22C55E" strokeWidth={2.5} /><circle cx={7} cy={5} r={3} fill="#22C55E" /><text x={18} y={9} fill="#22C55E" fontSize={9}>CE IV</text>
          <line x1={0} y1={18} x2={14} y2={18} stroke="#EF4444" strokeWidth={2.5} /><circle cx={7} cy={18} r={3} fill="#EF4444" /><text x={18} y={22} fill="#EF4444" fontSize={9}>PE IV</text>
        </g>
      </svg>
      {hovered && (
        <div style={{ position: 'absolute', top: Math.max(0, mousePos.y - 160), left: mousePos.x > 300 ? mousePos.x - 220 : mousePos.x + 12, pointerEvents: 'none', zIndex: 100 }}>
          <IVSmileTooltip active={true} payload={[{ dataKey: 'ce_iv', value: hovered.ce_iv }, { dataKey: 'pe_iv', value: hovered.pe_iv }]} label={n(hovered.strike)} atmStrike={atmStrike} spotPrice={spot} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// GREEKS HEATMAP
// ============================================================================

function GreeksHeatmap({ chain, spotPrice }: { chain: ChainRow[]; spotPrice: number }) {
  const atm = chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 300).slice(0, 12);
  if (atm.length === 0) return <div className="text-gray-500 text-sm p-4">No data</div>;
  const dc = (v: number | null | undefined) => { const val = n(v), abs = Math.abs(val); if (abs > 0.7) return 'bg-blue-700'; if (abs > 0.5) return 'bg-blue-600'; if (abs > 0.3) return 'bg-blue-500/70'; return 'bg-blue-400/40'; };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-gray-500"><th className="py-1 text-right pr-2">Strike</th><th className="py-1 text-center">CE Δ</th><th className="py-1 text-center">CE Γ</th><th className="py-1 text-center">CE Θ</th><th className="py-1 text-center">CE IV</th><th className="py-1 text-center">PE Δ</th><th className="py-1 text-center">PE Γ</th><th className="py-1 text-center">PE Θ</th><th className="py-1 text-center">PE IV</th></tr></thead>
        <tbody>
          {atm.map(r => {
            const isAtm = n(r.strike_price) === Math.round(spotPrice / 50) * 50;
            return (
              <tr key={n(r.strike_price)} className={isAtm ? 'bg-yellow-900/30' : ''}>
                <td className={`py-0.5 pr-2 text-right font-bold ${isAtm ? 'text-yellow-300' : 'text-gray-300'}`}>{n(r.strike_price)}</td>
                <td className={`py-0.5 text-center rounded ${dc(r.ce_greeks?.delta)}`}>{fmt(r.ce_greeks?.delta, 3)}</td>
                <td className="py-0.5 text-center text-purple-300">{r.ce_greeks?.gamma != null ? n(r.ce_greeks.gamma).toFixed(4) : '–'}</td>
                <td className="py-0.5 text-center text-orange-300">{fmt(r.ce_greeks?.theta, 1)}</td>
                <td className="py-0.5 text-center font-bold" style={{ color: ivColor(r.ce_greeks?.iv) }}>{fmt(r.ce_greeks?.iv, 1)}</td>
                <td className={`py-0.5 text-center rounded ${dc(r.pe_greeks?.delta)}`}>{fmt(r.pe_greeks?.delta, 3)}</td>
                <td className="py-0.5 text-center text-purple-300">{r.pe_greeks?.gamma != null ? n(r.pe_greeks.gamma).toFixed(4) : '–'}</td>
                <td className="py-0.5 text-center text-orange-300">{fmt(r.pe_greeks?.theta, 1)}</td>
                <td className="py-0.5 text-center font-bold" style={{ color: ivColor(r.pe_greeks?.iv) }}>{fmt(r.pe_greeks?.iv, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// PCR GAUGE
// ============================================================================

function PCRGauge({ pcr }: { pcr: number }) {
  const clamp = Math.max(0, Math.min(pcr, 2)), pct = (clamp / 2) * 100;
  const color = pcr < 0.8 ? '#EF4444' : pcr > 1.3 ? '#22C55E' : '#FCD34D';
  const label = pcr < 0.7 ? 'Bearish — Call Heavy' : pcr > 1.3 ? 'Bullish — Put Heavy' : 'Neutral';
  return (
    <div className="space-y-3 p-2">
      <div className="flex justify-between text-xs text-gray-500"><span>0</span><span>0.7</span><span>1.0</span><span>1.3</span><span>2+</span></div>
      <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">PCR {pcr.toFixed(2)}</div>
      </div>
      <div className="text-center text-sm font-bold" style={{ color }}>{label}</div>
      <div className="grid grid-cols-3 gap-2 text-xs text-center mt-2">
        <div className="bg-red-900/30 rounded p-2"><div className="text-red-400 font-bold">{'< 0.7'}</div><div className="text-gray-400">Bearish</div></div>
        <div className="bg-yellow-900/30 rounded p-2"><div className="text-yellow-400 font-bold">0.7–1.3</div><div className="text-gray-400">Neutral</div></div>
        <div className="bg-green-900/30 rounded p-2"><div className="text-green-400 font-bold">{'> 1.3'}</div><div className="text-gray-400">Bullish</div></div>
      </div>
    </div>
  );
}

// ============================================================================
// HISTORICAL IV CHART (real DB only — no fake data)
// ============================================================================

function HistoricalIVChart({ currentIV }: { currentIV: number }) {
  const [ivHistory, setIvHistory] = useState<{ hour: string; avg_iv: number }[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    axios.get('http://localhost:3001/api/analytics/iv-history')
      .then(res => { if (res.data.success && res.data.data.length > 0) { const parsed = res.data.data.map((r: any) => ({ hour: r.hour, avg_iv: n(r.avg_iv, 0) })).filter((d: any) => d.avg_iv > 0).reverse(); setIvHistory(parsed); } })
      .catch(() => {}).finally(() => setHistLoading(false));
  }, [currentIV]);
  if (histLoading) return <div className="flex items-center justify-center h-28 text-gray-600 text-xs">Loading real IV history…</div>;
  if (ivHistory.length < 3) return (
    <div className="flex flex-col items-center justify-center h-28 text-gray-600">
      <div className="text-2xl mb-1">📊</div>
      <div className="text-xs text-center">Real IV history building up — <span className="text-blue-400">{ivHistory.length} hourly points</span><br /><span className="text-gray-500">(needs 3+ to draw chart)</span></div>
      <div className="text-[10px] text-yellow-600 mt-1">Current ATM IV: {fmt(currentIV, 1)}%</div>
    </div>
  );
  const allIVs = ivHistory.map(d => d.avg_iv);
  const maxV = Math.max(...allIVs, currentIV), minV = Math.min(...allIVs, currentIV), range = maxV - minV || 1;
  return (
    <div className="relative" style={{ height: 120 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${ivHistory.length * 10} 120`} preserveAspectRatio="none">
        {ivHistory.map((d, i) => { if (i === ivHistory.length - 1) return null; const next = ivHistory[i + 1]; return <line key={i} x1={i * 10 + 5} y1={100 - ((d.avg_iv - minV) / range) * 90} x2={(i + 1) * 10 + 5} y2={100 - ((next.avg_iv - minV) / range) * 90} stroke="#60A5FA" strokeWidth="1.5" />; })}
        <line x1="0" y1={100 - ((currentIV - minV) / range) * 90} x2={ivHistory.length * 10} y2={100 - ((currentIV - minV) / range) * 90} stroke="#FCD34D" strokeWidth="1" strokeDasharray="4" />
      </svg>
      <div className="absolute top-1 left-2 text-xs text-green-400">✅ Real DB IV ({ivHistory.length}h)</div>
      <div className="absolute top-1 right-2 text-xs text-yellow-400">— Current {fmt(currentIV, 1)}%</div>
    </div>
  );
}

// ============================================================================
// SIGNAL CARD
// ============================================================================

function SignalCard({ signal }: { signal: any }) {
  const colors: Record<string, string> = { HIGH: 'border-red-500/50 bg-red-950/30', MEDIUM: 'border-blue-500/50 bg-blue-950/30', LOW: 'border-gray-600/50 bg-gray-900/30' };
  const typeColors: Record<string, string> = { IV_CRUSH: '#EF4444', IV_EXPANSION: '#22C55E', DELTA_NEUTRAL: '#60A5FA', THETA_DECAY: '#FBBF24', GAMMA_SCALP: '#A78BFA' };
  const confidence = n(signal?.confidence, 0), typeColor = typeColors[signal?.type] || '#6B7280';
  return (
    <div className={`border rounded-xl p-4 mb-3 ${colors[signal?.priority] || colors.LOW}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-xs font-bold px-2 py-0.5 rounded mr-2" style={{ background: typeColor + '33', color: typeColor }}>{(signal?.type || '').replace('_', ' ')}</span>
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${signal?.priority === 'HIGH' ? 'bg-red-900/60 text-red-300' : signal?.priority === 'MEDIUM' ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>{signal?.priority}</span>
        </div>
        <div className="text-right"><div className="text-xs text-gray-500">Confidence</div><div className="font-bold" style={{ color: typeColor }}>{confidence}%</div></div>
      </div>
      <div className="text-sm font-bold text-white mb-1">{signal?.strategy}</div>
      <div className="text-xs text-gray-400 mb-3">{signal?.description}</div>
      <div className="h-1 bg-gray-700 rounded mb-3 overflow-hidden"><div className="h-full rounded" style={{ width: `${confidence}%`, background: typeColor }} /></div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><div className="text-gray-500 mb-0.5">Strikes</div><div className="text-yellow-400 font-bold">{(signal?.strikes || []).join(', ')}</div></div>
        <div><div className="text-gray-500 mb-0.5">Action</div><div className="text-white">{signal?.action}</div></div>
        <div><div className="text-gray-500 mb-0.5">Expected Profit</div><div className="text-green-400">{signal?.expectedProfit}</div></div>
        <div><div className="text-gray-500 mb-0.5">Risk</div><div className="text-red-400">{signal?.risk}</div></div>
      </div>
    </div>
  );
}

function TradingSignalsPanel({ signals }: { signals: any[] }) {
  const [filter, setFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  if (!signals || signals.length === 0) return <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">📡</div><div className="text-sm">Scanning market conditions…</div></div>;
  const filtered = filter === 'ALL' ? signals : signals.filter(s => s.priority === filter);
  const high = signals.filter(s => s.priority === 'HIGH').length, medium = signals.filter(s => s.priority === 'MEDIUM').length, low = signals.filter(s => s.priority === 'LOW').length;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-gray-500">Total {signals.length}</span>
        <span className="text-xs text-red-400">HIGH: {high}</span><span className="text-xs text-blue-400">MEDIUM: {medium}</span><span className="text-xs text-gray-400">LOW: {low}</span>
        <div className="ml-auto flex gap-1">{(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`text-xs px-2 py-0.5 rounded ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}>{f}</button>)}</div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>{filtered.map(s => <SignalCard key={s.id} signal={s} />)}</div>
    </div>
  );
}

// ============================================================================
// IV ANALYSIS PANEL
// ============================================================================

function IVAnalysisPanel({ ivAnalysis }: { ivAnalysis: any }) {
  if (!ivAnalysis) return <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">📊</div><div className="text-sm">Loading IV analysis…</div></div>;
  const rank = n(ivAnalysis.ivRank, 50), percentile = n(ivAnalysis.ivPercentile, 50), currentIV = n(ivAnalysis.currentIV, 20);
  const statusColors: Record<string, string> = { LOW: '#22C55E', NORMAL: '#60A5FA', HIGH: '#F97316', EXTREME: '#EF4444' };
  const statusColor = statusColors[ivAnalysis.status] || '#6B7280';
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 text-center border" style={{ borderColor: statusColor + '50', background: statusColor + '15' }}>
        <div className="text-lg font-bold mb-1" style={{ color: statusColor }}>{ivAnalysis.status} IV</div>
        <div className="text-xs text-gray-400">{ivAnalysis.status === 'LOW' ? 'Consider buying options (cheap premium)' : ivAnalysis.status === 'HIGH' ? 'Consider selling options (rich premium)' : ivAnalysis.status === 'EXTREME' ? 'Extreme IV — high risk' : 'No strong edge — be selective'}</div>
        <div className="text-sm font-bold mt-2" style={{ color: ivAnalysis.signal === 'BUY_PREMIUM' ? '#22C55E' : ivAnalysis.signal === 'SELL_PREMIUM' ? '#EF4444' : '#FCD34D' }}>— {ivAnalysis.signal?.replace('_', ' ') || 'NEUTRAL'} —</div>
      </div>
      <div className="text-center"><div className="text-xs text-gray-500 mb-1">ATM Implied Volatility</div><div className="text-3xl font-bold" style={{ color: ivColor(currentIV) }}>{currentIV.toFixed(2)}%</div></div>
      <div className="grid grid-cols-2 gap-4">
        {[{ label: 'IV Percentile', value: percentile }, { label: 'IV Rank', value: rank }].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-xs text-gray-500 mb-2">{label}</div>
            <div className="relative w-24 h-24 mx-auto">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#374151" strokeWidth="3" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="#60A5FA" strokeWidth="3" strokeDasharray={`${(value / 100) * 87.96} 87.96`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold text-white">{Math.round(value)}</span></div>
            </div>
          </div>
        ))}
      </div>
      {ivAnalysis.historicalRange && (
        <div className="space-y-1 text-xs">
          <div className="text-gray-500 mb-1">52-Week Historical Range</div>
          {[{ label: 'Min IV', value: ivAnalysis.historicalRange.min, color: '#22C55E' }, { label: 'Mean IV', value: ivAnalysis.historicalRange.mean, color: '#60A5FA' }, { label: 'Max IV', value: ivAnalysis.historicalRange.max, color: '#EF4444' }, { label: 'Current', value: currentIV, color: '#FCD34D' }].map(row => (
            <div key={row.label} className="flex justify-between"><span className="text-gray-500">{row.label}</span><span className="font-bold" style={{ color: row.color }}>{n(row.value).toFixed(2)}%</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXPECTED MOVE CALCULATOR
// ============================================================================

function ExpectedMoveCalculator({ expectedMove, spotPrice, atmIV, daysToExpiry }: { expectedMove: any; spotPrice: number; atmIV: number; daysToExpiry: number }) {
  const spot = n(spotPrice), upper = n(expectedMove?.upperRange, spot + 500), lower = n(expectedMove?.lowerRange, spot - 500);
  const toExp = n(expectedMove?.toExpiry, 300), daily = n(expectedMove?.daily, 100), weekly = n(expectedMove?.weekly, 220);
  const range = upper - lower || 1, spotPct = ((spot - lower) / range) * 100;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-800 rounded-lg p-3"><div className="text-gray-500 text-xs mb-1">Days to Expiry</div><div className="text-white font-bold text-lg">{daysToExpiry}</div></div>
        <div className="bg-gray-800 rounded-lg p-3"><div className="text-gray-500 text-xs mb-1">ATM IV (%)</div><div className="text-white font-bold text-lg">{n(atmIV).toFixed(1)}</div></div>
      </div>
      <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl p-3">
        <div className="text-xs text-blue-400 font-bold mb-2">1σ Expected Move</div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-red-400 font-bold">{lower.toFixed(0)}</span>
          <div className="text-center"><div className="text-yellow-400 font-bold">±{toExp.toFixed(0)}</div><div className="text-gray-500 text-xs">±{((toExp / spot) * 100).toFixed(1)}%</div></div>
          <span className="text-green-400 font-bold">{upper.toFixed(0)}</span>
        </div>
        <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden mt-2">
          <div className="absolute top-0 h-full w-0.5 bg-yellow-400" style={{ left: `${spotPct}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">{lower.toFixed(0)} — {spot.toFixed(0)} — {upper.toFixed(0)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[{ label: '1σ', pct: '68.2%', move: `±${toExp.toFixed(0)}`, color: '#60A5FA' }, { label: '2σ', pct: '95.4%', move: `±${(toExp * 2).toFixed(0)}`, color: '#A78BFA' }, { label: '3σ', pct: '99.7%', move: `±${(toExp * 3).toFixed(0)}`, color: '#F472B6' }].map(row => (
          <div key={row.label} className="bg-gray-800 rounded-lg p-2"><div className="font-bold text-sm mb-1" style={{ color: row.color }}>{row.label}</div><div className="text-white font-bold">{row.pct}</div><div className="text-gray-400">{row.move}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-center">
        <div className="bg-gray-800 rounded p-2"><div className="text-gray-500">Daily Move</div><div className="text-white font-bold">±{daily.toFixed(0)}</div></div>
        <div className="bg-gray-800 rounded p-2"><div className="text-gray-500">Weekly Move</div><div className="text-white font-bold">±{weekly.toFixed(0)}</div></div>
      </div>
    </div>
  );
}

// ============================================================================
// PAYOFF CHART (SVG — no external deps)
// ============================================================================

function PayoffChart({ legs, spotPrice, dte, iv, rate }: { legs: StratLeg[]; spotPrice: number; dte: number; iv: number; rate: number }) {
  const W = 600, H = 200, PAD = { t: 16, b: 32, l: 48, r: 16 };
  if (!legs.length) return <div className="flex items-center justify-center h-48 text-gray-600 text-sm">Add legs to see payoff chart</div>;
  const MARGIN = 0.30;
  const minP = spotPrice * (1 - MARGIN), maxP = spotPrice * (1 + MARGIN);
  const POINTS = 200, step = (maxP - minP) / POINTS;
  const strikeSet = legs.map(l => l.strike).filter(k => k >= minP && k <= maxP);
  const allPrices = [...new Set([...Array.from({ length: POINTS + 1 }, (_, i) => minP + i * step), ...strikeSet])].sort((a, b) => a - b);
  const payoffs = allPrices.map(price => legs.reduce((sum, leg) => {
    const T = dte / 365, sigma = iv / 100, r = rate / 100;
    let pl: number;
    if (T <= 0) { const intr = leg.type === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price); pl = (intr - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }
    else { const g = BS.greeks(price, leg.strike, T, r, sigma); if (!g) return sum; pl = ((leg.type === 'CE' ? g.callPrice : g.putPrice) - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }
    return sum + pl;
  }, 0));
  const maxPL = Math.max(...payoffs, 1), minPL = Math.min(...payoffs, -1), plRange = maxPL - minPL || 1;
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b;
  const toX = (p: number) => PAD.l + ((p - minP) / (maxP - minP)) * chartW;
  const toY = (pl: number) => PAD.t + (1 - (pl - minPL) / plRange) * chartH;
  const zeroY = toY(0), spotX = toX(spotPrice);
  const pathData = allPrices.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p).toFixed(1)},${toY(payoffs[i]).toFixed(1)}`).join(' ');
  const profitFill = `${pathData} L${toX(allPrices[allPrices.length - 1]).toFixed(1)},${zeroY.toFixed(1)} L${toX(allPrices[0]).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const uniqueStrikes = [...new Set(legs.map(l => l.strike))].filter(s => s >= minP && s <= maxP);
  const yTicks = [minPL, minPL / 2, 0, maxPL / 2, maxPL].map(v => ({ v, y: toY(v) }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
      {yTicks.map(({ v, y }) => (<g key={v}><line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? '0' : '4,4'} /><text x={PAD.l - 4} y={y + 4} textAnchor="end" fill="#6B7280" fontSize="8" fontFamily="monospace">{v >= 0 ? '+' : ''}{v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}</text></g>))}
      <clipPath id="lossMask"><rect x={PAD.l} y={zeroY} width={chartW} height={H - PAD.b - zeroY} /></clipPath>
      <path d={profitFill} fill="rgba(239,68,68,0.12)" clipPath="url(#lossMask)" />
      <clipPath id="profitMask"><rect x={PAD.l} y={PAD.t} width={chartW} height={zeroY - PAD.t} /></clipPath>
      <path d={profitFill} fill="rgba(34,197,94,0.12)" clipPath="url(#profitMask)" />
      <path d={pathData} fill="none" stroke="#F0B429" strokeWidth="2" />
      {uniqueStrikes.map(s => <line key={s} x1={toX(s)} y1={PAD.t} x2={toX(s)} y2={H - PAD.b} stroke="rgba(156,163,175,0.3)" strokeWidth="1" strokeDasharray="3,3" />)}
      <line x1={spotX} y1={PAD.t} x2={spotX} y2={H - PAD.b} stroke="rgba(56,189,248,0.8)" strokeWidth="1.5" strokeDasharray="4,4" />
      <text x={spotX} y={PAD.t - 3} textAnchor="middle" fill="rgba(56,189,248,0.8)" fontSize="8" fontFamily="monospace">SPOT</text>
      {[minP, minP + (maxP - minP) * 0.25, spotPrice, minP + (maxP - minP) * 0.75, maxP].map(p => (<text key={p} x={toX(p)} y={H - 4} textAnchor="middle" fill="#6B7280" fontSize="7.5" fontFamily="monospace">{p >= 1000 ? '₹' + (p / 1000).toFixed(1) + 'K' : '₹' + p.toFixed(0)}</text>))}
    </svg>
  );
}

// ============================================================================
// STRATEGY ANALYSIS ENGINE
// ============================================================================

function analyzeStrategy(legs: StratLeg[], spotPrice: number, dte: number, iv: number, rate: number, pcrOi: number, maxPain: number, ivRank: number) {
  if (!legs.length) return null;
  const T = dte / 365, sigma = iv / 100, r = rate / 100;
  let netDelta = 0, netTheta = 0, netVega = 0, netGamma = 0;
  legs.forEach(leg => {
    const g = BS.greeks(spotPrice, leg.strike, T, r, sigma); if (!g) return;
    const m = (leg.action === 'BUY' ? 1 : -1) * leg.qty;
    netDelta += (leg.type === 'CE' ? g.callDelta : g.putDelta) * m;
    netTheta += (leg.type === 'CE' ? g.callTheta : g.putTheta) * m;
    netVega += g.vega * m; netGamma += g.gamma * m;
  });
  const POINTS = 150, MARGIN = 0.30, minP = spotPrice * (1 - MARGIN), maxP = spotPrice * (1 + MARGIN);
  const prices = Array.from({ length: POINTS + 1 }, (_, i) => minP + i * (maxP - minP) / POINTS);
  const payoffs = prices.map(price => legs.reduce((sum, leg) => { const intr = leg.type === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price); return sum + (intr - leg.premium) * (leg.action === 'BUY' ? 1 : -1) * leg.qty; }, 0));
  const maxProfit = Math.max(...payoffs), maxLoss = Math.min(...payoffs);
  const netPremium = legs.reduce((s, l) => s + (l.action === 'BUY' ? -1 : 1) * l.premium * l.qty, 0);
  const pop = BS.strategyPoP(legs, spotPrice, dte, iv, rate) || 0;
  const buyCE = legs.filter(l => l.action === 'BUY' && l.type === 'CE');
  const sellCE = legs.filter(l => l.action === 'SELL' && l.type === 'CE');
  const buyPE = legs.filter(l => l.action === 'BUY' && l.type === 'PE');
  const sellPE = legs.filter(l => l.action === 'SELL' && l.type === 'PE');
  const nl = legs.length;
  let strategyName = 'Custom Strategy';
  if (nl === 1) strategyName = legs[0].action + ' ' + legs[0].type;
  else if (nl === 2) {
    if (buyCE.length === 1 && buyPE.length === 1 && !sellCE.length && !sellPE.length) strategyName = buyCE[0].strike === buyPE[0].strike ? 'Long Straddle' : 'Long Strangle';
    else if (sellCE.length === 1 && sellPE.length === 1 && !buyCE.length && !buyPE.length) strategyName = sellCE[0].strike === sellPE[0].strike ? 'Short Straddle' : 'Short Strangle';
    else if (buyCE.length === 1 && sellCE.length === 1 && !buyPE.length && !sellPE.length) strategyName = buyCE[0].strike < sellCE[0].strike ? 'Bull Call Spread' : 'Bear Call Spread';
    else if (buyPE.length === 1 && sellPE.length === 1 && !buyCE.length && !sellCE.length) strategyName = buyPE[0].strike > sellPE[0].strike ? 'Bear Put Spread' : 'Bull Put Spread';
    else if (buyCE.length === 1 && sellPE.length === 1) strategyName = 'Synthetic Long';
    else if (sellCE.length === 1 && buyPE.length === 1) strategyName = 'Synthetic Short';
  } else if (nl === 3 && legs.some(l => l.qty >= 2)) strategyName = 'Butterfly Spread';
  else if (nl === 4 && buyCE.length === 1 && sellCE.length === 1 && buyPE.length === 1 && sellPE.length === 1) strategyName = 'Iron Condor';
  else if (buyCE.length > 0 && buyPE.length > 0 && sellCE.length > 0 && sellPE.length > 0) strategyName = 'Iron Condor/Butterfly';
  const pcrSentiment = pcrOi > 1.3 ? 'bullish' : pcrOi < 0.7 ? 'bearish' : 'neutral';
  const ivSentiment = ivRank > 70 ? 'elevated (good for selling)' : ivRank < 30 ? 'low (good for buying)' : 'moderate';
  const spotVsMaxPain = spotPrice > maxPain ? `above Max Pain (${maxPain})` : spotPrice < maxPain ? `below Max Pain (${maxPain})` : `at Max Pain (${maxPain})`;
  const deltaBias = Math.abs(netDelta) < 0.1 ? 'market-neutral' : netDelta > 0 ? 'long delta (bullish)' : 'short delta (bearish)';
  const isNetSeller = netPremium > 0, isNetBuyer = netPremium < 0;
  let suitability = '', suitabilityColor = '#6B7280';
  if (isNetSeller && ivRank > 60) { suitability = '✅ Good fit: High IV favors premium sellers'; suitabilityColor = '#22C55E'; }
  else if (isNetSeller && ivRank < 30) { suitability = '⚠️ Caution: Low IV — selling premium is risky'; suitabilityColor = '#F97316'; }
  else if (isNetBuyer && ivRank < 30) { suitability = '✅ Good fit: Low IV favors premium buyers'; suitabilityColor = '#22C55E'; }
  else if (isNetBuyer && ivRank > 70) { suitability = '⚠️ Caution: High IV makes buying expensive'; suitabilityColor = '#F97316'; }
  else { suitability = '🔵 Neutral setup — monitor IV direction'; suitabilityColor = '#60A5FA'; }
  const breakevens: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = payoffs[i - 1], curr = payoffs[i];
    if (Math.abs(prev) + Math.abs(curr) > 1e-4 && ((prev < 0 && curr > 0) || (prev > 0 && curr < 0))) {
      const f = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
      breakevens.push(prices[i - 1] + f * (prices[i] - prices[i - 1]));
    }
  }
  return { strategyName, netDelta, netTheta, netVega, netGamma, maxProfit, maxLoss, netPremium, pop, breakevens, pcrSentiment, ivSentiment, spotVsMaxPain, deltaBias, suitability, suitabilityColor, isNetSeller, isNetBuyer };
}

// ============================================================================
// STRATEGY BUILDER TAB
// ============================================================================

const ATM_STRIKE = (S: number) => Math.round(S / 50) * 50;
let _legCounter = 0;
const nextLegId = () => ++_legCounter;

function StrategyBuilderTab({ data, signalData }: { data: DashData | null; signalData: SignalData | null }) {
  const spotPrice = n(data?.spotPrice, 22150);
  const atmStrike = n(data?.atmStrike, ATM_STRIKE(spotPrice));
  const chain = data?.chain ?? [];
  const pcrOi = n(data?.pcr_oi, 1);
  const maxPain = n(data?.maxPain, atmStrike);
  const atmRow = chain.find(r => Number(r.strike_price) === Number(atmStrike));
  const atmIV = n(atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? signalData?.currentIV ?? 18, 18);
  const ivRank = n(signalData?.ivAnalysis?.ivRank, 50);
  const dte = data?.expiryDate ? Math.max(1, Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / 86400000)) : n(signalData?.daysToExpiry, 7);

  const [legs, setLegs] = useState<StratLeg[]>([]);
  const [rateVal, setRate] = useState(6.5);
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [activePill, setActivePill] = useState<string>('');

  const effectiveIV = ivOverride !== null ? ivOverride : atmIV;
  const analysis = useMemo(() => analyzeStrategy(legs, spotPrice, dte, effectiveIV, rateVal, pcrOi, maxPain, ivRank), [legs, spotPrice, dte, effectiveIV, rateVal, pcrOi, maxPain, ivRank]);

  const getLivePremium = (strike: number, type: 'CE' | 'PE'): number => {
    const row = chain.find(r => Number(r.strike_price) === strike);
    if (row) { const ltp = type === 'CE' ? n(row.ce_ltp) : n(row.pe_ltp); if (ltp > 0) return ltp; }
    const g = BS.greeks(spotPrice, strike, dte / 365, rateVal / 100, effectiveIV / 100);
    return g ? Math.max(0, parseFloat((type === 'CE' ? g.callPrice : g.putPrice).toFixed(2))) : 0;
  };

  const addLeg = (action: 'BUY' | 'SELL', type: 'CE' | 'PE', strike?: number, _premium?: number, qty = 1) => {
    const K = Math.round((strike ?? spotPrice) / 50) * 50;
    const prem = getLivePremium(K, type);
    setLegs(prev => [...prev, { id: nextLegId(), action, type, strike: K, premium: Math.max(0, parseFloat(prem.toFixed(2))), qty }]);
  };

  const removeLeg = (id: number) => setLegs(prev => prev.filter(l => l.id !== id));

  const updateLeg = (id: number, field: keyof StratLeg, val: any) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === 'strike') { const s = Math.round(parseFloat(val) / 50) * 50; return { ...l, strike: s, premium: getLivePremium(s, l.type) }; }
      if (field === 'type') return { ...l, type: val, premium: getLivePremium(l.strike, val) };
      if (field === 'qty') return { ...l, qty: Math.max(1, parseInt(val) || 1) };
      if (field === 'premium') return { ...l, premium: Math.max(0, parseFloat(val) || 0) };
      return { ...l, [field]: val };
    }));
  };

  const loadPreset = (key: string) => {
    setActivePill(key);
    const S = spotPrice;
    const presets: Record<string, [string, string, number, number][]> = {
      'Long Call':     [['BUY', 'CE', ATM_STRIKE(S), 1]],
      'Long Put':      [['BUY', 'PE', ATM_STRIKE(S), 1]],
      'Short Call':    [['SELL', 'CE', ATM_STRIKE(S), 1]],
      'Short Put':     [['SELL', 'PE', ATM_STRIKE(S), 1]],
      'Bull Call':     [['BUY', 'CE', ATM_STRIKE(S), 1], ['SELL', 'CE', ATM_STRIKE(S) + 500, 1]],
      'Bear Put':      [['BUY', 'PE', ATM_STRIKE(S), 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1]],
      'Straddle':      [['BUY', 'CE', ATM_STRIKE(S), 1], ['BUY', 'PE', ATM_STRIKE(S), 1]],
      'Strangle':      [['BUY', 'CE', ATM_STRIKE(S) + 500, 1], ['BUY', 'PE', ATM_STRIKE(S) - 500, 1]],
      'Iron Condor':   [['BUY', 'PE', ATM_STRIKE(S) - 1000, 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1], ['SELL', 'CE', ATM_STRIKE(S) + 500, 1], ['BUY', 'CE', ATM_STRIKE(S) + 1000, 1]],
      'Butterfly':     [['BUY', 'CE', ATM_STRIKE(S) - 500, 1], ['SELL', 'CE', ATM_STRIKE(S), 2], ['BUY', 'CE', ATM_STRIKE(S) + 500, 1]],
      'Short Straddle': [['SELL', 'CE', ATM_STRIKE(S), 1], ['SELL', 'PE', ATM_STRIKE(S), 1]],
      'Short Strangle': [['SELL', 'CE', ATM_STRIKE(S) + 500, 1], ['SELL', 'PE', ATM_STRIKE(S) - 500, 1]],
    };
    const presetLegs = presets[key]; if (!presetLegs) return;
    setLegs([]);
    setTimeout(() => { presetLegs.forEach(([action, type, strike, qty]) => addLeg(action as any, type as any, strike as number, undefined, qty as number)); }, 0);
  };

  const PILLS = ['Long Call', 'Long Put', 'Short Call', 'Short Put', 'Bull Call', 'Bear Put', 'Straddle', 'Strangle', 'Short Straddle', 'Short Strangle', 'Iron Condor', 'Butterfly'];
  const typeIcons: Record<string, string> = { 'IV_CRUSH': '🔥', 'IV_EXPANSION': '🚀', 'DELTA_NEUTRAL': '⚖️', 'THETA_DECAY': '⏳', 'GAMMA_SCALP': '🎯' };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Strategy Presets */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        {PILLS.map(p => (<button key={p} onClick={() => loadPreset(p)} className={`text-xs px-3 py-1 rounded-full border transition-all ${activePill === p ? 'bg-yellow-500 border-yellow-500 text-black font-bold' : 'border-gray-700 text-gray-400 hover:border-yellow-600 hover:text-yellow-400'}`}>{p}</button>))}
        <button onClick={() => { setLegs([]); setActivePill(''); }} className="text-xs px-3 py-1 rounded-full border border-red-800/60 text-red-500 hover:bg-red-900/20 ml-auto">Clear All</button>
        <button onClick={() => addLeg('BUY', 'CE', atmStrike)} className="text-xs px-3 py-1 rounded-full border border-yellow-700 text-yellow-400 hover:bg-yellow-900/20">+ Add Leg</button>
      </div>

      <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: '1fr 1fr 340px', gridTemplateRows: '1fr' }}>

        {/* LEFT — Payoff Chart + Legs */}
        <div className="flex flex-col border-r border-gray-800 overflow-hidden">
          <div className="flex gap-3 px-3 py-2 bg-gray-900/50 border-b border-gray-800 flex-shrink-0 items-center">
            <div className="text-xs text-gray-500">Spot: <span className="text-yellow-400 font-bold font-mono">{spotPrice.toFixed(0)}</span></div>
            <div className="text-xs text-gray-500">DTE: <span className="text-blue-400 font-bold">{dte}d</span></div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">IV%:</span>
              <input type="number" value={ivOverride !== null ? ivOverride : atmIV} step="0.5" min="1" max="200" onChange={e => setIvOverride(parseFloat(e.target.value) || atmIV)} className="w-16 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500" />
              {ivOverride !== null && <button onClick={() => setIvOverride(null)} className="text-xs text-gray-600 hover:text-yellow-400">⟳</button>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Rate%:</span>
              <input type="number" value={rateVal} step="0.25" min="0" max="25" onChange={e => setRate(parseFloat(e.target.value) || 6.5)} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs font-mono text-gray-300 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="px-2 py-1 bg-gray-950 flex-shrink-0 border-b border-gray-800">
            <div className="text-xs text-gray-600 mb-1 px-1">Payoff at Expiry</div>
            <PayoffChart legs={legs} spotPrice={spotPrice} dte={dte} iv={effectiveIV} rate={rateVal} />
          </div>
          {analysis && (
            <div className="grid grid-cols-4 gap-px bg-gray-800 flex-shrink-0 text-xs">
              {[
                { label: 'Max Profit', value: analysis.maxProfit > 1e9 ? 'Unlimited' : fmtRs(analysis.maxProfit), color: 'text-green-400' },
                { label: 'Max Loss', value: analysis.maxLoss < -1e9 ? 'Unlimited' : fmtRs(Math.abs(analysis.maxLoss)), color: 'text-red-400' },
                { label: 'PoP', value: (analysis.pop || 0).toFixed(1) + '%', color: 'text-blue-400' },
                { label: 'Net Flow', value: (analysis.netPremium >= 0 ? 'Credit ' : 'Debit ') + fmtRs(Math.abs(analysis.netPremium), 2), color: analysis.netPremium >= 0 ? 'text-green-400' : 'text-purple-400' },
              ].map(m => (<div key={m.label} className="bg-gray-900 px-2 py-1.5 text-center"><div className="text-gray-600 text-[9px] uppercase tracking-wide">{m.label}</div><div className={`font-bold font-mono text-xs mt-0.5 ${m.color}`}>{m.value}</div></div>))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {!legs.length ? (
              <div className="text-center py-10 text-gray-600"><div className="text-3xl mb-2">📋</div><div className="text-xs">Select a strategy or add legs manually</div></div>
            ) : legs.map(leg => {
              const T = dte / 365, sigma = effectiveIV / 100, r = rateVal / 100;
              const g = BS.greeks(spotPrice, leg.strike, T, r, sigma);
              const delta = g ? (leg.type === 'CE' ? g.callDelta : g.putDelta) : null;
              const theta = g ? (leg.type === 'CE' ? g.callTheta : g.putTheta) : null;
              const m = leg.action === 'BUY' ? 1 : -1;
              const intr = leg.type === 'CE' ? Math.max(0, spotPrice - leg.strike) : Math.max(0, leg.strike - spotPrice);
              const plExpiry = (intr - leg.premium) * m * leg.qty;
              return (
                <div key={leg.id} className="mx-3 my-2 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${leg.action === 'BUY' ? 'bg-green-900/60 text-green-400 border border-green-800' : 'bg-red-900/60 text-red-400 border border-red-800'}`}>{leg.action}</span>
                    <div className="flex gap-1">{(['CE', 'PE'] as const).map(t => <button key={t} onClick={() => updateLeg(leg.id, 'type', t)} className={`text-xs px-2 py-0.5 rounded ${leg.type === t ? (t === 'CE' ? 'bg-blue-800 text-blue-300' : 'bg-purple-800 text-purple-300') : 'bg-gray-800 text-gray-500'}`}>{t}</button>)}</div>
                    <div className="flex gap-1 ml-1">{(['BUY', 'SELL'] as const).map(a => <button key={a} onClick={() => setLegs(prev => prev.map(l => l.id === leg.id ? { ...l, action: a } : l))} className={`text-xs px-2 py-0.5 rounded ${leg.action === a ? (a === 'BUY' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400') : 'bg-gray-800 text-gray-500'}`}>{a}</button>)}</div>
                    <div className={`ml-auto font-mono text-xs font-bold ${plExpiry >= 0 ? 'text-green-400' : 'text-red-400'}`}>{plExpiry >= 0 ? '+' : ''}{fmtRs(plExpiry, 2)}</div>
                    <button onClick={() => removeLeg(leg.id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Strike</div>
                      <select value={leg.strike} onChange={e => updateLeg(leg.id, 'strike', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-yellow-400 focus:outline-none focus:border-yellow-600">
                        {chain.length > 0 ? chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 1000).map(r => <option key={n(r.strike_price)} value={n(r.strike_price)}>{n(r.strike_price)}</option>) : Array.from({ length: 21 }, (_, i) => ATM_STRIKE(spotPrice) - 500 + i * 50).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Premium ₹ <span className="text-blue-600">live</span></div>
                      <input type="number" value={leg.premium} min="0" step="0.5" onChange={e => updateLeg(leg.id, 'premium', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase mb-0.5">Qty (lots)</div>
                      <input type="number" value={leg.qty} min="1" step="1" onChange={e => updateLeg(leg.id, 'qty', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-yellow-600" />
                    </div>
                  </div>
                  {g && (
                    <div className="flex gap-3 mt-2 text-[10px]">
                      {[
                        { n: 'Δ', v: (delta! * m * leg.qty).toFixed(3), c: delta! * m >= 0 ? 'text-green-400' : 'text-red-400' },
                        { n: 'Γ', v: (g.gamma * leg.qty).toFixed(5), c: 'text-purple-400' },
                        { n: 'Θ', v: (theta! * m * leg.qty).toFixed(2), c: theta! * m >= 0 ? 'text-green-400' : 'text-red-400' },
                        { n: 'ν', v: (g.vega * m * leg.qty).toFixed(2), c: 'text-blue-400' },
                        { n: 'IV', v: effectiveIV.toFixed(1) + '%', c: 'text-yellow-400' },
                        { n: 'LTP', v: '₹' + (leg.type === 'CE' ? n(chain.find(r => n(r.strike_price) === leg.strike)?.ce_ltp) : n(chain.find(r => n(r.strike_price) === leg.strike)?.pe_ltp)).toFixed(2), c: 'text-gray-400' },
                      ].map(({ n: name, v, c }) => (<div key={name} className="text-center"><div className="text-gray-600">{name}</div><div className={`font-mono font-bold ${c}`}>{v}</div></div>))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER — Live Options Chain */}
        <div className="flex flex-col border-r border-gray-800 overflow-hidden">
          <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0">
            <div className="flex items-center justify-between text-xs"><span className="text-gray-500 font-bold uppercase tracking-wide">Live Options Chain</span><span className="text-gray-600">Click to add leg</span></div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-900">
                <tr>
                  <th className="py-1.5 px-1 text-green-500 text-right text-[9px]">OI</th>
                  <th className="py-1.5 px-1 text-green-500 text-right text-[9px]">IV%</th>
                  <th className="py-1.5 px-2 text-green-400 text-right text-[10px] font-bold">CE LTP</th>
                  <th className="py-1.5 px-2 text-yellow-400 text-center text-[10px] font-bold bg-gray-800">STRIKE</th>
                  <th className="py-1.5 px-2 text-red-400 text-left text-[10px] font-bold">PE LTP</th>
                  <th className="py-1.5 px-1 text-red-500 text-left text-[9px]">IV%</th>
                  <th className="py-1.5 px-1 text-red-500 text-left text-[9px]">OI</th>
                </tr>
              </thead>
              <tbody>
                {chain.filter(r => Math.abs(n(r.strike_price) - spotPrice) <= 750).map(row => {
                  const strike = Number(row.strike_price);
                  const isATM = strike === Number(atmStrike);
                  const isITMce = strike < spotPrice, isITMpe = strike > spotPrice;
                  const maxCeOI2 = Math.max(...chain.map(r => n(r.ce_oi)), 1);
                  const maxPeOI2 = Math.max(...chain.map(r => n(r.pe_oi)), 1);
                  const ceOIPct = (n(row.ce_oi) / maxCeOI2) * 100, peOIPct = (n(row.pe_oi) / maxPeOI2) * 100;
                  return (
                    <tr key={strike} className={`border-b border-gray-800/30 hover:bg-gray-800/20 ${isATM ? 'bg-yellow-950/30' : isITMce ? 'bg-green-950/10' : isITMpe ? 'bg-red-950/10' : ''}`}>
                      <td className="py-1 px-1 text-right relative"><div className="absolute inset-0 bg-green-700/10 flex justify-end"><div style={{ width: `${ceOIPct}%` }} /></div><span className={isITMce ? 'text-green-400' : 'text-gray-600'}>{fmtK(row.ce_oi)}</span></td>
                      <td className="py-1 px-1 text-right font-mono text-[9px]" style={{ color: ivColor(row.ce_greeks?.iv) }}>{row.ce_greeks?.iv != null ? fmt(row.ce_greeks.iv, 1) : '–'}</td>
                      <td className="py-1 px-2 text-right"><button onClick={() => addLeg('BUY', 'CE', strike)} className={`font-bold font-mono hover:underline ${isITMce ? 'text-green-300' : 'text-green-700'}`}>{row.ce_ltp != null ? fmt(row.ce_ltp, 1) : '–'}</button></td>
                      <td className={`py-1 px-2 text-center font-bold bg-gray-800/50 ${isATM ? 'text-yellow-300' : 'text-gray-300'}`}>{isATM && <span className="text-yellow-500 mr-0.5 text-[9px]">►</span>}{strike}</td>
                      <td className="py-1 px-2 text-left"><button onClick={() => addLeg('BUY', 'PE', strike)} className={`font-bold font-mono hover:underline ${isITMpe ? 'text-red-300' : 'text-red-700'}`}>{row.pe_ltp != null ? fmt(row.pe_ltp, 1) : '–'}</button></td>
                      <td className="py-1 px-1 text-left font-mono text-[9px]" style={{ color: ivColor(row.pe_greeks?.iv) }}>{row.pe_greeks?.iv != null ? fmt(row.pe_greeks.iv, 1) : '–'}</td>
                      <td className="py-1 px-1 text-left relative"><div className="absolute inset-0 bg-red-700/10"><div style={{ width: `${peOIPct}%` }} /></div><span className={isITMpe ? 'text-red-400' : 'text-gray-600'}>{fmtK(row.pe_oi)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!chain.length && <div className="text-center py-10 text-gray-600 text-xs">Connect backend to load live chain</div>}
          </div>
          <div className="border-t border-gray-800 p-3 bg-gray-950 flex-shrink-0">
            <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">OI Distribution — CE(green) vs PE(red)</div>
            <OIDistributionChart data={chain.map(r => ({ strike: n(r.strike_price), ce_oi: n(r.ce_oi), pe_oi: n(r.pe_oi) }))} atmStrike={atmStrike} />
          </div>
        </div>

        {/* RIGHT — Strategy Analysis */}
        <div className="flex flex-col overflow-hidden bg-gray-950">
          <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
            <span className="text-sm font-bold text-gray-200">🧠 Strategy Analysis</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {analysis ? (
              <>
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 px-4 py-3 text-center">
                  <div className="text-[9px] text-yellow-600 uppercase tracking-widest mb-1">Detected Strategy</div>
                  <div className="text-xl font-bold text-yellow-400">{analysis.strategyName}</div>
                  {analysis.breakevens.length > 0 && <div className="text-xs text-gray-500 mt-1">BE: {analysis.breakevens.map(b => <span key={b} className="text-yellow-600 font-mono mx-1">{b.toFixed(0)}</span>)}</div>}
                </div>
                <div className="rounded-lg px-3 py-2 text-xs" style={{ background: analysis.suitabilityColor + '15', borderLeft: `3px solid ${analysis.suitabilityColor}` }}>
                  <span style={{ color: analysis.suitabilityColor }}>{analysis.suitability}</span>
                </div>
                <div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">Portfolio Greeks</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Net Δ Delta', value: analysis.netDelta.toFixed(4), color: analysis.netDelta >= 0 ? '#22C55E' : '#EF4444', desc: 'Market directional exposure' },
                      { label: 'Net Θ Theta', value: '₹' + analysis.netTheta.toFixed(2) + '/day', color: analysis.netTheta >= 0 ? '#22C55E' : '#EF4444', desc: 'Daily time decay P&L' },
                      { label: 'Net ν Vega', value: analysis.netVega.toFixed(2), color: analysis.netVega >= 0 ? '#60A5FA' : '#F97316', desc: 'P&L per 1% IV change' },
                      { label: 'Net Γ Gamma', value: analysis.netGamma.toFixed(5), color: '#A78BFA', desc: 'Delta change per ₹1 move' },
                    ].map(g => (
                      <div key={g.label} className="bg-gray-900 rounded-lg p-2 border border-gray-800">
                        <div className="text-[9px] text-gray-600 mb-0.5">{g.label}</div>
                        <div className="font-mono font-bold text-xs" style={{ color: g.color }}>{g.value}</div>
                        <div className="text-[8px] text-gray-700 mt-0.5">{g.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-blue-500 font-bold mb-1">📊 MARKET CONTEXT</div>
                    <span className="text-gray-400">PCR OI </span><span className={`font-bold ${pcrOi > 1.3 ? 'text-green-400' : pcrOi < 0.7 ? 'text-red-400' : 'text-yellow-400'}`}>{pcrOi.toFixed(2)}</span>
                    <span className="text-gray-500"> → </span><span className={`font-bold ${analysis.pcrSentiment === 'bullish' ? 'text-green-400' : analysis.pcrSentiment === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>{analysis.pcrSentiment}</span><br />
                    <span className="text-gray-400">Spot is </span><span className="text-yellow-300 font-bold">{analysis.spotVsMaxPain}</span>
                  </div>
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-purple-500 font-bold mb-1">⚡ IV ENVIRONMENT</div>
                    <span className="text-gray-400">ATM IV </span><span className="font-bold font-mono" style={{ color: ivColor(effectiveIV) }}>{effectiveIV.toFixed(1)}%</span>
                    <span className="text-gray-500"> | IV Rank </span><span className="font-bold text-blue-400">{ivRank.toFixed(0)}</span>
                    <span className="text-gray-500"> → {analysis.ivSentiment}</span>
                  </div>
                  <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                    <div className="text-[9px] text-yellow-500 font-bold mb-1">🎯 STRATEGY BIAS</div>
                    <span className="text-gray-400">This setup is </span><span className="text-white font-bold">{analysis.deltaBias}</span><br />
                    <span className="text-gray-500">{analysis.netTheta < 0 ? '⏳ Theta negative — time hurts. Trade when you expect a move.' : '⏳ Theta positive — time works in your favor. Decay strategy.'}</span>
                  </div>
                  {(isFinite(analysis.maxProfit) || isFinite(analysis.maxLoss)) && (
                    <div className="bg-gray-900 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-gray-300 border border-gray-800">
                      <div className="text-[9px] text-green-500 font-bold mb-1">💰 RISK / REWARD</div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Max Profit</span><span className="text-green-400 font-bold font-mono">{analysis.maxProfit > 1e9 ? 'Unlimited' : fmtRs(analysis.maxProfit)}</span></div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Max Loss</span><span className="text-red-400 font-bold font-mono">{analysis.maxLoss < -1e9 ? 'Unlimited' : fmtRs(Math.abs(analysis.maxLoss))}</span></div>
                      <div className="flex justify-between mb-1"><span className="text-gray-500">Prob of Profit</span><span className="text-blue-400 font-bold">{(analysis.pop || 0).toFixed(1)}%</span></div>
                      {isFinite(analysis.maxProfit) && isFinite(analysis.maxLoss) && analysis.maxLoss !== 0 && <div className="flex justify-between"><span className="text-gray-500">R/R Ratio</span><span className="text-yellow-400 font-bold">{(analysis.maxProfit / Math.abs(analysis.maxLoss)).toFixed(2)}x</span></div>}
                      {analysis.breakevens.length > 0 && <div className="mt-2 pt-2 border-t border-gray-800"><span className="text-gray-500">Breakevens: </span>{analysis.breakevens.map(b => <span key={b} className="text-yellow-400 font-mono font-bold mx-1">{b.toFixed(0)}</span>)}</div>}
                    </div>
                  )}
                  <div className="bg-blue-950/30 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs border border-blue-900/40">
                    <div className="text-[9px] text-blue-400 font-bold mb-1">💬 ANALYSIS SUMMARY</div>
                    <div className="text-gray-300 leading-relaxed">
                      {!legs.length ? 'Select a strategy preset or add legs to begin analysis.' :
                        `${analysis.strategyName} with ${dte}d to expiry. ${analysis.netPremium > 0 ? `Net credit ₹${analysis.netPremium.toFixed(2)} — you collect premium upfront.` : `Net debit ₹${Math.abs(analysis.netPremium).toFixed(2)} — you pay premium.`} ${analysis.suitability.slice(3)}. ${pcrOi > 1.2 ? 'PCR suggests bullish bias.' : pcrOi < 0.8 ? 'PCR suggests bearish bias.' : 'Market appears balanced per PCR.'} Max Pain at ${maxPain} could act as gravitational pull near expiry.`}
                    </div>
                  </div>
                </div>
                {signalData?.signals && signalData.signals.length > 0 && (
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-2">Related Signals</div>
                    <div className="space-y-2">
                      {signalData.signals.slice(0, 3).map(sig => (
                        <div key={sig.id} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-start gap-2">
                          <span className="text-base">{typeIcons[sig.type] || '🎯'}</span>
                          <div className="flex-1"><div className="text-xs font-bold text-white">{sig.strategy}</div><div className="text-[10px] text-gray-500 mt-0.5">{sig.action}</div></div>
                          <div className="text-xs font-bold text-blue-400">{n(sig.confidence)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-600"><div className="text-3xl mb-3">🧮</div><div className="text-sm">Select a strategy or add legs to see analysis</div></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 🚨 SPOOFING TAB — Live Detection Feed
// ============================================================================

type SpoofState = 'CLEAR' | 'WATCH' | 'ALERT' | 'CRITICAL';
type SpoofPhase = 'PATCH_I' | 'PATCH_II' | 'CLOSE_WATCH' | 'NORMAL';

interface LiveSpoofAlert {
  id:           string;
  token:        string;
  symbol:       string;
  state:        SpoofState;
  phase:        SpoofPhase;
  severity:     string;
  type:         string;
  strike:       number;
  optionType:   'CE' | 'PE';
  ensemble:     number;
  confidence:   number;
  action:       string;
  description:  string;
  explanation:  string;
  ltp:          number;
  bidPrice:     number;
  askPrice:     number;
  bidQty:       number;
  askQty:       number;
  oi:           number;
  oiChange:     number;
  ltpChange:    number;
  bidAskRatio:  number;
  spreadPct:    number;
  detectedAt:   number;
  timestamp:    string;
  fv:  { VPIN: number; OBI_L1: number; TBQ_TSQ: number; PostDist: number; spread_pct: number; oi_change: number; ltp_change: number; };
  js:  { pattern_prob: number; delta_proxy: number; patch1_buy_proxy: number; patch2_sell_proxy: number; ltp_aggression_frac: number; oi_buildup_p1: number; };
  scores: Record<string, number>;
}

const STATE_COLOR: Record<SpoofState, string> = {
  CLEAR: '#22c55e', WATCH: '#fbbf24', ALERT: '#f97316', CRITICAL: '#ef4444',
};
const STATE_BG: Record<SpoofState, string> = {
  CLEAR: 'rgba(21,128,61,.12)', WATCH: 'rgba(161,98,7,.15)', ALERT: 'rgba(194,65,12,.2)', CRITICAL: 'rgba(153,27,27,.3)',
};
const STATE_EMOJI: Record<SpoofState, string> = {
  CLEAR: '✅', WATCH: '👁', ALERT: '⚠️', CRITICAL: '🚨',
};
const TYPE_LABEL: Record<string, string> = {
  BID_WALL: 'Bid Wall', ASK_WALL: 'Ask Wall',
  LAYERING_BID: 'Layering (Bid)', LAYERING_ASK: 'Layering (Ask)',
  OI_DIVERGENCE: 'OI Divergence', SPREAD_COMPRESSION: 'Spread Collapse',
  QUOTE_STUFFING: 'Quote Stuffing', MOMENTUM_IGNITION: 'Momentum Ignition',
  ABSORPTION: 'Absorption',
};

function SpoofAlertCard({ a, onDismiss }: { a: LiveSpoofAlert; onDismiss: () => void }) {
  const age  = Math.round((Date.now() - a.detectedAt) / 1000);
  const col  = STATE_COLOR[a.state];
  const top4 = Object.entries(a.scores).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const isJSPhase = a.phase === 'PATCH_I' || a.phase === 'PATCH_II' || a.phase === 'CLOSE_WATCH';
  const phaseColor = a.phase === 'PATCH_I' ? '#4ade80' : a.phase === 'PATCH_II' ? '#f87171' : '#fbbf24';
  return (
    <div style={{ border: `1px solid ${col}44`, background: STATE_BG[a.state], borderRadius: '8px', padding: '12px 14px', marginBottom: '8px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '18px' }}>{STATE_EMOJI[a.state]}</span>
          <span style={{ color: col, fontWeight: 700, fontSize: '13px' }}>{a.state}</span>
          <span style={{ background: '#111827', color: '#fbbf24', fontWeight: 700, borderRadius: '4px', padding: '1px 7px', fontSize: '13px', fontFamily: 'monospace' }}>{a.strike} {a.optionType}</span>
          <span style={{ color: '#6b7280', fontSize: '11px' }}>{TYPE_LABEL[a.type] ?? a.type}</span>
          {isJSPhase && <span style={{ background: `${phaseColor}22`, border: `1px solid ${phaseColor}66`, color: phaseColor, fontSize: '10px', borderRadius: '3px', padding: '0 5px', fontWeight: 700 }}>{a.phase}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ color: '#4b5563', fontSize: '11px' }}>{age}s ago</span>
          <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '18px', padding: '0', lineHeight: 1, fontWeight: 400 }}>×</button>
        </div>
      </div>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ color: '#9ca3af', fontSize: '11px' }}>Ensemble score</span>
          <span style={{ color: col, fontWeight: 700, fontFamily: 'monospace', fontSize: '12px' }}>{a.ensemble.toFixed(1)} / 100</span>
        </div>
        <div style={{ height: '4px', background: '#1f2937', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(a.ensemble, 100)}%`, height: '100%', background: col, borderRadius: '2px', transition: 'width .3s ease' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px 12px', marginBottom: '8px', fontSize: '11px' }}>
        {[
          ['LTP', `₹${a.ltp.toFixed(2)}`, '#f1f5f9'],
          ['Bid', `₹${a.bidPrice.toFixed(2)}`, '#4ade80'],
          ['Ask', `₹${a.askPrice.toFixed(2)}`, '#f87171'],
          ['BidQty', a.bidQty.toLocaleString(), '#4ade80'],
          ['AskQty', a.askQty.toLocaleString(), '#f87171'],
          ['Ratio', a.bidAskRatio.toFixed(2), a.bidAskRatio > 3 ? '#f87171' : a.bidAskRatio < 0.33 ? '#4ade80' : '#9ca3af'],
        ].map(([label, val, color]) => (
          <div key={label}><span style={{ color: '#6b7280' }}>{label} </span><span style={{ color: color as string, fontFamily: 'monospace' }}>{val}</span></div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '8px', background: 'rgba(0,0,0,.25)', borderRadius: '5px', padding: '7px 9px', fontSize: '10px' }}>
        {[
          ['VPIN',    a.fv.VPIN.toFixed(3),    '#e2e8f0'],
          ['OBI-L1',  a.fv.OBI_L1.toFixed(3),  a.fv.OBI_L1 > 0.3 ? '#4ade80' : a.fv.OBI_L1 < -0.3 ? '#f87171' : '#e2e8f0'],
          ['TBQ/TSQ', a.fv.TBQ_TSQ.toFixed(2), '#e2e8f0'],
          ['Spread%', `${a.spreadPct.toFixed(2)}%`, '#e2e8f0'],
          ['JS Pat',  `${(a.js.pattern_prob * 100).toFixed(0)}%`, '#c084fc'],
          ['Δ proxy', a.js.delta_proxy.toFixed(1), a.js.delta_proxy > 2 ? '#4ade80' : a.js.delta_proxy < -2 ? '#f87171' : '#9ca3af'],
          ['P1-Buy',  a.js.patch1_buy_proxy.toFixed(2),  a.js.patch1_buy_proxy  > 0.5 ? '#f87171' : '#9ca3af'],
          ['P2-Sell', a.js.patch2_sell_proxy.toFixed(2), a.js.patch2_sell_proxy > 0.5 ? '#f87171' : '#9ca3af'],
        ].map(([label, val, color]) => (
          <div key={label}><span style={{ color: '#4b5563' }}>{label} </span><span style={{ color: color as string }}>{val}</span></div>
        ))}
      </div>
      {top4.length > 0 && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {top4.map(([k, v]) => <span key={k} style={{ background: '#111827', color: '#94a3b8', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{k}={v}</span>)}
        </div>
      )}
      <div style={{ background: `${col}1A`, border: `1px solid ${col}33`, borderRadius: '4px', padding: '6px 9px', fontSize: '11px', color: col, lineHeight: 1.5 }}>
        <strong>→ {a.explanation || a.action}</strong>
        {a.state === 'CRITICAL' && a.js.patch1_buy_proxy > 0.5 && <div style={{ marginTop: '3px', color: '#f87171' }}>⛔ JS PATCH I: Engineered rally. Do NOT buy calls.</div>}
        {a.state === 'CRITICAL' && a.js.patch2_sell_proxy > 0.5 && <div style={{ marginTop: '3px', color: '#f87171' }}>⛔ JS PATCH II: Dump phase. Exit longs immediately.</div>}
        {a.state === 'CRITICAL' && a.phase === 'CLOSE_WATCH' && <div style={{ marginTop: '3px', color: '#fbbf24' }}>⛔ MARKING THE CLOSE: Settlement manipulation possible.</div>}
      </div>
    </div>
  );
}

function SpoofingTab() {
  const [alerts,    setAlerts]    = useState<LiveSpoofAlert[]>([]);
  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'live' | 'disconnected'>('connecting');
  const [totalRx,   setTotalRx]   = useState(0);
  const [filter,    setFilter]    = useState<'ALL' | SpoofState>('ALL');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const wsRef  = useRef<WebSocket | null>(null);
  const retRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const WS_URL = `ws://localhost:${8765}`;
    function connect() {
      setWsStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => { setWsStatus('live'); };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data as string);
          if (d.type === 'connected') return;
          const state = d.state as SpoofState;
          if (!state || state === 'CLEAR') return;
          setTotalRx(n => n + 1);
          const alert: LiveSpoofAlert = {
            id: `${d.token ?? d.symbol ?? '?'}_${d.detectedAt ?? Date.now()}`,
            token: d.token ?? `${d.strike}_${d.optionType}`, symbol: d.symbol ?? `NIFTY${d.strike}${d.optionType}`,
            state, phase: (d.phase ?? 'NORMAL') as SpoofPhase, severity: d.severity ?? 'LOW', type: d.type ?? 'UNKNOWN',
            strike: d.strike ?? 0, optionType: d.optionType ?? 'CE', ensemble: d.ensemble ?? 0, confidence: d.confidence ?? 0,
            action: d.action ?? '', description: d.description ?? '', explanation: d.explanation ?? d.action ?? '',
            ltp: d.ltp ?? 0, bidPrice: d.bidPrice ?? 0, askPrice: d.askPrice ?? 0,
            bidQty: d.bidQty ?? 0, askQty: d.askQty ?? 0, oi: d.oi ?? 0, oiChange: d.oiChange ?? 0,
            ltpChange: d.ltpChange ?? 0, bidAskRatio: d.bidAskRatio ?? 1, spreadPct: d.spreadPct ?? 0,
            detectedAt: d.detectedAt ?? Date.now(), timestamp: d.timestamp ?? new Date().toISOString(),
            fv: { VPIN: d.fv?.VPIN ?? 0, OBI_L1: d.fv?.OBI_L1 ?? 0, TBQ_TSQ: d.fv?.TBQ_TSQ ?? 1, PostDist: d.fv?.PostDist ?? 0, spread_pct: d.fv?.spread_pct ?? 0, oi_change: d.fv?.oi_change ?? 0, ltp_change: d.fv?.ltp_change ?? 0 },
            js: { pattern_prob: d.js?.pattern_prob ?? 0, delta_proxy: d.js?.delta_proxy ?? 0, patch1_buy_proxy: d.js?.patch1_buy_proxy ?? 0, patch2_sell_proxy: d.js?.patch2_sell_proxy ?? 0, ltp_aggression_frac: d.js?.ltp_aggression_frac ?? 0, oi_buildup_p1: d.js?.oi_buildup_p1 ?? 0 },
            scores: d.scores ?? {},
          };
          setAlerts(prev => [alert, ...prev].slice(0, 100));
        } catch (_) {}
      };
      ws.onerror  = () => { setWsStatus('disconnected'); };
      ws.onclose  = () => { setWsStatus('disconnected'); retRef.current = setTimeout(connect, 5000); };
    }
    connect();
    return () => { wsRef.current?.close(); if (retRef.current) clearTimeout(retRef.current); };
  }, []);

  const visible = alerts.filter(a => !dismissed.has(a.id) && (filter === 'ALL' || a.state === filter));
  const counts = useMemo(() => alerts.reduce((acc, a) => { if (!dismissed.has(a.id)) acc[a.state] = (acc[a.state] ?? 0) + 1; return acc; }, {} as Record<string, number>), [alerts, dismissed]);
  const dismiss = useCallback((id: string) => { setDismissed(prev => new Set([...prev, id])); }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#030712' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1f2937', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>🚨 Spoofing Detection</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: wsStatus === 'live' ? 'rgba(5,46,22,.8)' : wsStatus === 'connecting' ? 'rgba(30,27,75,.8)' : 'rgba(69,10,10,.8)', border: `1px solid ${wsStatus === 'live' ? '#16a34a' : wsStatus === 'connecting' ? '#4f46e5' : '#dc2626'}`, color: wsStatus === 'live' ? '#4ade80' : wsStatus === 'connecting' ? '#818cf8' : '#f87171', fontSize: '11px', fontWeight: 700, padding: '1px 8px', borderRadius: '4px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block', boxShadow: wsStatus === 'live' ? '0 0 4px currentColor' : 'none' }} />
            {wsStatus === 'live' ? 'LIVE' : wsStatus === 'connecting' ? 'CONNECTING' : 'DISCONNECTED'}
          </span>
          <span style={{ color: '#374151', fontSize: '10px' }}>ws://localhost:8765</span>
          {totalRx > 0 && <span style={{ color: '#374151', fontSize: '10px' }}>Rx: {totalRx.toLocaleString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {(['ALL', 'CRITICAL', 'ALERT', 'WATCH'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? (f === 'ALL' ? '#1d4ed8' : `${STATE_COLOR[f as SpoofState]}22`) : 'transparent', border: `1px solid ${filter === f ? (f === 'ALL' ? '#3b82f6' : STATE_COLOR[f as SpoofState]) : '#374151'}`, color: f === 'ALL' ? '#93c5fd' : STATE_COLOR[f as SpoofState], borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontSize: '11px' }}>
              {f !== 'ALL' && `${STATE_EMOJI[f as SpoofState]} `}{f}{counts[f] ? ` (${counts[f]})` : ''}
            </button>
          ))}
          {dismissed.size > 0 && <button onClick={() => setDismissed(new Set())} style={{ background: 'transparent', border: '1px solid #374151', color: '#6b7280', borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontSize: '11px' }}>↺ Restore {dismissed.size}</button>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', padding: '10px 16px', borderBottom: '1px solid #111827', flexShrink: 0 }}>
        {(['CRITICAL', 'ALERT', 'WATCH', 'CLEAR'] as SpoofState[]).map(s => (
          <div key={s} onClick={() => setFilter(s)} style={{ background: STATE_BG[s], border: `1px solid ${STATE_COLOR[s]}33`, borderRadius: '6px', padding: '8px', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: '17px' }}>{STATE_EMOJI[s]}</div>
            <div style={{ color: STATE_COLOR[s], fontWeight: 700, fontSize: '22px', fontFamily: 'monospace' }}>{counts[s] ?? 0}</div>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '0.05em' }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {wsStatus === 'connecting' && <div style={{ textAlign: 'center', paddingTop: '60px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>↻</div><div style={{ fontSize: '14px', color: '#818cf8', marginBottom: '6px' }}>Connecting to detection engine...</div><div style={{ fontSize: '11px', color: '#374151' }}>ws://localhost:8765 — is websocket-collector.ts running?</div></div>}
        {wsStatus === 'disconnected' && <div style={{ textAlign: 'center', paddingTop: '60px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>🔌</div><div style={{ fontSize: '14px', color: '#f87171', marginBottom: '6px' }}>Disconnected — retrying in 5s</div><div style={{ fontSize: '11px', color: '#374151' }}>Check that websocket-collector.ts is running and port 8765 is not blocked</div></div>}
        {wsStatus === 'live' && visible.length === 0 && <div style={{ textAlign: 'center', paddingTop: '50px', color: '#4b5563' }}><div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div><div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '6px' }}>{filter !== 'ALL' ? `No ${filter} alerts — try "ALL" filter` : 'Scanning for spoofing patterns...'}</div></div>}
        {visible.map(a => <SpoofAlertCard key={a.id} a={a} onDismiss={() => dismiss(a.id)} />)}
      </div>
      <div style={{ borderTop: '1px solid #111827', padding: '6px 16px', background: '#0a0f1a', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '18px', fontSize: '10px', color: '#374151', flexWrap: 'wrap' }}>
          <span>✅ CLEAR — trade normally</span><span>👁 WATCH — reduce size 30%</span><span>⚠️ ALERT — no new positions in alert direction</span><span>🚨 CRITICAL — exit or hedge immediately</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

export default function Dashboard() {
  const [data,       setData]       = useState<DashData | null>(null);
  const [signalData, setSignalData] = useState<SignalData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<Tab>('chain');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [sseStatus,  setSseStatus]  = useState<'connecting' | 'live' | 'reconnecting' | 'fallback'>('connecting');
  const [pushLatencyMs, setPushLatencyMs] = useState<number | null>(null);
  // Track how long SSE has been non-live — used for true internet-down detection
  // 🌐 Network monitor
  const { net, toasts, isTesting, runManualTest } = useNetworkMonitor();

  const prevChainRef   = useRef<Map<string, number>>(new Map());
  const atmRef         = useRef<HTMLTableRowElement>(null);
  const sseRef         = useRef<EventSource | null>(null);
  const fallbackRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataRef        = useRef(data);
  const sseStatusRef   = useRef<'connecting' | 'live' | 'reconnecting' | 'fallback'>('connecting');
  dataRef.current      = data;

  const applyData = useCallback((incoming: any) => {
    if (!incoming?.chain) return;
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
    if (incoming.timestamp && incoming.source === 'live_push') {
      const sentAt = new Date(incoming.timestamp).getTime();
      const latency = Date.now() - sentAt;
      if (latency >= 0 && latency < 10000) setPushLatencyMs(latency);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get('http://localhost:3001/api/options/greeks');
      if (res.data.success) applyData(res.data.data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Connection failed. Is the backend running on port 3001?');
      setLoading(false);
    }
  }, [applyData]);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let alive = true;

    function setStatus(s: 'connecting' | 'live' | 'reconnecting' | 'fallback') {
      sseStatusRef.current = s;
      setSseStatus(s);

    }

    function connectSSE() {
      if (!alive) return;
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setStatus('connecting');

      const es = new EventSource('http://localhost:3001/api/stream/chain');
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
        es.close();
        sseRef.current = null;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
          connectSSE();
        }, reconnectDelay);
      };
    }

    connectSSE();

    const safetyTimer = setTimeout(() => {
      if (sseStatusRef.current !== 'live' && !fallbackRef.current) {
        setStatus('fallback');
        fallbackRef.current = setInterval(async () => {
          try {
            const res = await axios.get('http://localhost:3001/api/options/greeks');
            if (res.data.success) applyData(res.data.data);
          } catch (_) {}
        }, 1000);
      }
    }, 4000);

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearTimeout(safetyTimer);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if (fallbackRef.current) { clearInterval(fallbackRef.current); fallbackRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSignals = useCallback(async () => {
    try {
      const res = await axios.get('http://localhost:3001/api/analytics/signals');
      if (res.data.success) setSignalData(res.data.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (['signals', 'analytics', 'strategy', 'predictor'].includes(activeTab)) {
      fetchSignals();
      const id = setInterval(fetchSignals, 10000);
      return () => clearInterval(id);
    }
  }, [activeTab, fetchSignals]);

  useEffect(() => {
    if (atmRef.current && activeTab === 'chain') {
      atmRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [data?.atmStrike, activeTab]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const chain     = data?.chain ?? [];
  const spotPrice = n(data?.spotPrice);
  const atmStrike = n(data?.atmStrike);
  const atmRow    = chain.find(r => Number(r.strike_price) === Number(atmStrike));
  const atmIV     = atmRow?.ce_greeks?.iv ?? atmRow?.pe_greeks?.iv ?? null;
  const maxCeOI   = Math.max(...chain.map(r => n(r.ce_oi)), 1);
  const maxPeOI   = Math.max(...chain.map(r => n(r.pe_oi)), 1);
  const totalCeOI = chain.reduce((s, r) => s + n(r.ce_oi), 0);
  const totalPeOI = chain.reduce((s, r) => s + n(r.pe_oi), 0);
  const dte       = data?.expiryDate ? Math.max(1, Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / 86400000)) : 7;
  const oiDistData  = chain.map(r => ({ strike: n(r.strike_price), ce_oi: n(r.ce_oi), pe_oi: n(r.pe_oi) }));
  const ivSmileData = chain.map(r => ({ strike: n(r.strike_price), ce_iv: r.ce_greeks?.iv ?? null, pe_iv: r.pe_greeks?.iv ?? null }));
  const ivSource  = signalData?.ivHistorySource;
  const ivPoints  = signalData?.ivHistoryPoints ?? 0;

  if (loading && !data) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center"><div className="text-5xl mb-3 animate-spin">⚡</div><p className="text-white text-lg">Loading JOBBER PRO…</p></div>
    </div>
  );

  if (error && !data) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-6 max-w-sm text-center">
        <p className="text-red-400 text-xl font-bold mb-2">⚠️ Connection Error</p>
        <p className="text-gray-300 text-sm mb-4">{error}</p>
        <button onClick={fetchData} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors">🔄 Retry Connection</button>
      </div>
    </div>
  );

  if (!data) return null;

  // ── Tab definitions (9 tabs — network added) ──────────────────────────────
  const tabs: { id: Tab; label: string; pulse?: boolean }[] = [
    { id: 'chain',     label: '📋 Options Chain' },
    { id: 'charts',    label: '📈 Charts' },
    { id: 'signals',   label: '🎯 Signals' },
    { id: 'analytics', label: '📐 Analytics' },
    { id: 'strategy',  label: '🧮 Strategy Builder' },
    { id: 'predictor', label: '⚡ Predictor' },
    { id: 'data',      label: '⚡ Data' },
    { id: 'spoofing',  label: '🚨 Spoofing' },
    { id: 'network',   label: `🌐 Network${net?.quality === 'POOR' || net?.quality === 'OFFLINE' ? ' ⚠️' : ''}`, pulse: net?.quality === 'POOR' || net?.quality === 'OFFLINE' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col" style={{ height: '100vh' }}>

      {/* 🌐 Toast notifications */}
      <NetToasts toasts={toasts} />

      {/* ── MARKET STATUS BANNER ── */}
      <MarketStatusBanner status={data.marketStatus} latestDataAt={data.latestDataAt} />

      {/* 🌐 OFFLINE / POOR connection banner */}
      {net && (net.quality === 'OFFLINE' || net.quality === 'POOR') && <OfflineBanner net={net} />}

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 sticky top-0 z-50 flex-wrap gap-2 flex-shrink-0">
        <span className="text-yellow-400 font-bold text-sm">⚡ JOBBER PRO</span>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">NIFTY</span>
          <span className={`text-xl font-bold font-mono ${n(data.spotChange) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(spotPrice, 2)}</span>
          <span className={`text-xs ${n(data.spotChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {n(data.spotChange) >= 0 ? '▲' : '▼'} {fmt(Math.abs(n(data.spotChange)), 2)} ({fmt(Math.abs(n(data.spotChangePercent)), 2)}%)
          </span>
        </div>
        <div className="hidden lg:flex items-center gap-4 text-xs">
          <div><span className="text-gray-500">ATM </span><span className="text-yellow-400 font-bold">{atmStrike}</span></div>
          <div><span className="text-gray-500">PCR </span><span className="text-orange-400 font-bold">{fmt(data.pcr_oi, 2)}</span></div>
          <div><span className="text-gray-500">Max Pain </span><span className="text-purple-400 font-bold">{data.maxPain}</span></div>
          <div><span className="text-gray-500">ATM IV </span><span style={{ color: ivColor(atmIV) }} className="font-bold">{atmIV != null ? `${fmt(atmIV, 1)}%` : '–'}</span></div>
          {data.vix != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: data.vix > 20 ? 'rgba(127,29,29,0.5)' : data.vix > 15 ? 'rgba(120,53,15,0.4)' : 'rgba(6,78,59,0.4)', border: `1px solid ${data.vix > 20 ? '#ef4444' : data.vix > 15 ? '#f59e0b' : '#10b981'}`, borderRadius: '4px', padding: '1px 7px' }}>
              <span style={{ fontSize: '9px', color: '#9ca3af', letterSpacing: '0.5px' }}>VIX</span>
              <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '13px', color: data.vix > 20 ? '#f87171' : data.vix > 15 ? '#fbbf24' : '#34d399' }}>{fmt(data.vix, 2)}</span>
            </div>
          )}
          {data.vix == null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(30,30,30,0.4)', border: '1px solid #374151', borderRadius: '4px', padding: '1px 7px' }}>
              <span style={{ fontSize: '9px', color: '#6b7280' }}>VIX</span>
              <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '13px', color: '#4b5563' }}>–</span>
            </div>
          )}
          <div><span className="text-gray-500">DTE </span><span className="text-blue-400 font-bold">{dte}d</span></div>
          <div><span className="text-gray-500">Ticks </span><span className="text-blue-400 font-bold">{n(data.totalTicks).toLocaleString()}</span></div>
          {ivSource && <span className={`px-2 py-0.5 rounded text-xs font-bold ${ivSource === 'real_db' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>{ivSource === 'real_db' ? `📊 Real IV (${ivPoints}pts)` : '⚠️ Est. IV'}</span>}
          {data.marketStatus?.isOpen
            ? <span style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(5,46,22,0.8)', border: '1px solid #16a34a', color: '#4ade80', fontWeight: 'bold', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', letterSpacing: '1px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                {data.marketStatus.session === 'MUHURAT' ? '✨ MUHURAT' : '● LIVE'}
              </span>
            : <span style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(30,20,5,0.8)', border: '1px solid #92400e', color: '#fbbf24', fontWeight: 'bold', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', letterSpacing: '1px' }}>
                {data.marketStatus?.session === 'WEEKEND' ? '📅 WEEKEND' : data.marketStatus?.session === 'HOLIDAY' ? '🎉 HOLIDAY' : data.marketStatus?.session === 'PRE_OPEN' ? '🔵 PRE-OPEN' : '🔴 CLOSED'}
              </span>
          }
          {/* SSE status badge */}
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${sseStatus === 'live' ? 'bg-green-900 text-green-300' : sseStatus === 'fallback' ? 'bg-yellow-900 text-yellow-300' : sseStatus === 'reconnecting' ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
            {sseStatus === 'live' ? '⚡ LIVE' : sseStatus === 'fallback' ? '⚠ POLL' : sseStatus === 'reconnecting' ? '↻ RETRY' : '… CONN'}
            {sseStatus === 'live' && pushLatencyMs !== null && <span className="ml-1 text-green-500">{pushLatencyMs}ms</span>}
            {' '}{lastUpdate.toLocaleTimeString()}
          </span>

          {/* 🌐 Network widget */}
          {net && <NetWidget net={net} onTest={runManualTest} isTesting={isTesting} />}
        </div>
      </div>

      {/* ── TAB BAR ── */}
      <div className="flex border-b border-gray-800 bg-gray-900 flex-shrink-0" style={{ overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ position: 'relative' }}
            className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${activeTab === tab.id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {tab.label}
            {tab.pulse && <span style={{ position: 'absolute', top: 6, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#f97316', animation: 'pulse 1s infinite' }} />}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-hidden">

        {/* ══ OPTIONS CHAIN TAB ══ */}
        {activeTab === 'chain' && (
          <div className="h-full flex flex-col">
            <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex items-center gap-4 text-xs flex-wrap flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">CE OI:</span><span className="text-green-400 font-bold">{fmtK(totalCeOI)}</span>
                <div className="w-20 h-2 bg-gray-700 rounded overflow-hidden"><div className="h-full bg-green-600 rounded" style={{ width: `${totalCeOI / (totalCeOI + totalPeOI + 1) * 100}%` }} /></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">PE OI:</span><span className="text-red-400 font-bold">{fmtK(totalPeOI)}</span>
                <div className="w-20 h-2 bg-gray-700 rounded overflow-hidden"><div className="h-full bg-red-600 rounded" style={{ width: `${totalPeOI / (totalCeOI + totalPeOI + 1) * 100}%` }} /></div>
              </div>
              <div><span className="text-gray-500">PCR: </span><span className={`font-bold ${n(data.pcr_oi) > 1.2 ? 'text-green-400' : n(data.pcr_oi) < 0.8 ? 'text-red-400' : 'text-yellow-400'}`}>{fmt(data.pcr_oi, 2)}</span></div>
              <div className="ml-auto text-gray-600">DTE: <span className="text-white font-bold">{dte}d</span> | Expiry: {data.expiryDate ? new Date(data.expiryDate).toLocaleDateString('en-IN') : '–'}</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-900 shadow">
                  <tr>
                    <th className="py-2 px-1 text-green-500 text-right">OI Chg%</th>
                    <th className="py-2 px-1 text-green-500 text-right">OI</th>
                    <th className="py-2 px-1 text-green-500 text-right">Vol</th>
                    <th className="py-2 px-1 text-green-500 text-right">IV%</th>
                    <th className="py-2 px-1 text-green-500 text-right">Δ</th>
                    <th className="py-2 px-1 text-green-500 text-right">Θ</th>
                    <th className="py-2 px-2 text-green-400 text-right font-bold">CE LTP</th>
                    <th className="py-2 px-3 text-yellow-400 text-center font-bold bg-gray-800">STRIKE</th>
                    <th className="py-2 px-2 text-red-400 text-left font-bold">PE LTP</th>
                    <th className="py-2 px-1 text-red-500 text-left">Θ</th>
                    <th className="py-2 px-1 text-red-500 text-left">Δ</th>
                    <th className="py-2 px-1 text-red-500 text-left">IV%</th>
                    <th className="py-2 px-1 text-red-500 text-left">Vol</th>
                    <th className="py-2 px-1 text-red-500 text-left">OI</th>
                    <th className="py-2 px-1 text-red-500 text-left">OI Chg%</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.map((row, idx) => {
                    const strike = Number(row.strike_price), isATM = strike === Number(atmStrike);
                    const isITMce = strike < spotPrice, isITMpe = strike > spotPrice;
                    const rowBg = isATM ? 'bg-yellow-950/50' : isITMce ? 'bg-green-950/10' : isITMpe ? 'bg-red-950/10' : '';
                    const ceOI = n(row.ce_oi), peOI = n(row.pe_oi);
                    const prevCeOI = prevChainRef.current.get(`ce_${strike}`) ?? ceOI;
                    const prevPeOI = prevChainRef.current.get(`pe_${strike}`) ?? peOI;
                    const ceChg = prevCeOI > 0 ? ((ceOI - prevCeOI) / prevCeOI) * 100 : 0;
                    const peChg = prevPeOI > 0 ? ((peOI - prevPeOI) / prevPeOI) * 100 : 0;
                    const chgColor = (c: number) => c > 5 ? 'text-green-400' : c > 0 ? 'text-green-700' : c < -5 ? 'text-red-400' : c < 0 ? 'text-red-700' : 'text-gray-600';
                    const nextStrike = idx < chain.length - 1 ? Number(chain[idx + 1]?.strike_price) : null;
                    const isSpotHere = nextStrike != null && spotPrice >= strike && spotPrice < nextStrike;
                    return (
                      <>
                        <tr key={`row-${strike}`} ref={isATM ? atmRef : undefined}
                          className={`border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors ${rowBg}`}>
                          <td className={`py-1.5 px-1 text-right ${chgColor(ceChg)}`}>{ceChg !== 0 ? (ceChg > 0 ? '+' : '') + ceChg.toFixed(1) + '%' : '–'}</td>
                          <td className="py-1.5 px-1 text-right relative">
                            <div className="absolute inset-0 bg-green-600/10" style={{ width: `${(ceOI / maxCeOI) * 100}%` }} />
                            <span className={isITMce ? 'text-green-300 font-medium' : 'text-gray-500'}>{fmtK(ceOI)}</span>
                          </td>
                          <td className={`py-1.5 px-1 text-right ${isITMce ? 'text-green-400/70' : 'text-gray-600'}`}>{fmtK(row.ce_volume)}</td>
                          <td className="py-1.5 px-1 text-right font-mono" style={{ color: ivColor(row.ce_greeks?.iv) }}>{row.ce_greeks?.iv != null ? fmt(row.ce_greeks.iv, 1) : '–'}</td>
                          <td className={`py-1.5 px-1 text-right font-mono ${isITMce ? 'text-green-300' : 'text-gray-500'}`}>{row.ce_greeks?.delta != null ? fmt(row.ce_greeks.delta, 3) : '–'}</td>
                          <td className="py-1.5 px-1 text-right font-mono text-orange-400/80">{row.ce_greeks?.theta != null ? fmt(row.ce_greeks.theta, 1) : '–'}</td>
                          <td className={`py-1.5 px-2 text-right font-bold text-sm ${isITMce ? 'text-green-300' : 'text-green-700'}`}>{row.ce_ltp != null ? fmt(row.ce_ltp, 1) : '–'}</td>
                          <td className={`py-1.5 px-3 text-center font-bold bg-gray-800/60 ${isATM ? 'text-yellow-300 text-sm' : 'text-gray-200'}`}>{isATM && <span className="text-yellow-500 mr-1 text-xs">►</span>}{strike}</td>
                          <td className={`py-1.5 px-2 text-left font-bold text-sm ${isITMpe ? 'text-red-300' : 'text-red-700'}`}>{row.pe_ltp != null ? fmt(row.pe_ltp, 1) : '–'}</td>
                          <td className="py-1.5 px-1 text-left font-mono text-orange-400/80">{row.pe_greeks?.theta != null ? fmt(row.pe_greeks.theta, 1) : '–'}</td>
                          <td className={`py-1.5 px-1 text-left font-mono ${isITMpe ? 'text-red-300' : 'text-gray-500'}`}>{row.pe_greeks?.delta != null ? fmt(row.pe_greeks.delta, 3) : '–'}</td>
                          <td className="py-1.5 px-1 text-left font-mono" style={{ color: ivColor(row.pe_greeks?.iv) }}>{row.pe_greeks?.iv != null ? fmt(row.pe_greeks.iv, 1) : '–'}</td>
                          <td className={`py-1.5 px-1 text-left ${isITMpe ? 'text-red-400/70' : 'text-gray-600'}`}>{fmtK(row.pe_volume)}</td>
                          <td className="py-1.5 px-1 text-left relative">
                            <div className="absolute inset-0 bg-red-600/10" style={{ width: `${(peOI / maxPeOI) * 100}%` }} />
                            <span className={isITMpe ? 'text-red-300 font-medium' : 'text-gray-500'}>{fmtK(peOI)}</span>
                          </td>
                          <td className={`py-1.5 px-1 text-left ${chgColor(peChg)}`}>{peChg !== 0 ? (peChg > 0 ? '+' : '') + peChg.toFixed(1) + '%' : '–'}</td>
                        </tr>
                        {isSpotHere && (
                          <tr key={`spot-${strike}`}>
                            <td colSpan={15} className="p-0 h-0">
                              <div className="relative" style={{ height: 0 }}>
                                <div className="absolute left-0 right-0 border-t-2 border-yellow-400/80" style={{ top: 0 }} />
                                <span className="absolute bg-yellow-500 text-black text-xs font-bold px-2 rounded" style={{ top: -9, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>▶ {fmt(spotPrice, 2)}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ CHARTS TAB ══ */}
        {activeTab === 'charts' && (
          <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📊 OI Distribution</h3><OIDistributionChart data={oiDistData} atmStrike={atmStrike} /></div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📈 IV Smile</h3><IVSmileChart data={ivSmileData} atmStrike={atmStrike} spotPrice={spotPrice} /></div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">🔥 Greeks Heatmap</h3><GreeksHeatmap chain={chain} spotPrice={spotPrice} /></div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4"><h3 className="text-sm font-semibold text-gray-300 mb-3">📉 PCR Analysis</h3><PCRGauge pcr={n(data.pcr_oi, 1)} /></div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 col-span-2"><h3 className="text-sm font-semibold text-gray-300 mb-3">📉 Historical IV Trend</h3><HistoricalIVChart currentIV={n(atmIV, 20)} /></div>
          </div>
        )}

        {/* ══ SIGNALS TAB ══ */}
        {activeTab === 'signals' && (
          <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">🎯 Trading Signals</h3>
                {ivSource && <span className={`text-xs px-2 py-0.5 rounded font-bold ${ivSource === 'real_db' ? 'bg-green-900/60 text-green-400' : 'bg-yellow-900/60 text-yellow-400'}`}>{ivSource === 'real_db' ? `📊 Real IV (${ivPoints}pts)` : `⚠️ Est. IV`}</span>}
              </div>
              <TradingSignalsPanel signals={signalData?.signals ?? []} />
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">🔔 Strategy Alerts</h3>
              {signalData?.signals?.length ? (
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 400 }}>
                  {signalData.signals.map(s => (
                    <div key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border ${s.priority === 'HIGH' ? 'border-red-500/40 bg-red-950/20' : s.priority === 'MEDIUM' ? 'border-yellow-500/40 bg-yellow-950/20' : 'border-gray-700 bg-gray-900/50'}`}>
                      <div className="text-xl mt-0.5">{s.type === 'IV_CRUSH' ? '🔥' : s.type === 'IV_EXPANSION' ? '🚀' : s.type === 'DELTA_NEUTRAL' ? '⚖️' : s.type === 'THETA_DECAY' ? '⏳' : '🎯'}</div>
                      <div className="flex-1"><div className="text-sm font-bold text-white">{s.strategy}</div><div className="text-xs text-gray-400 mt-0.5">{s.action}</div><div className="text-xs text-green-400 mt-1">{s.expectedProfit}</div></div>
                      <div className="text-right"><div className="text-xs font-bold text-white">{n(s.confidence)}%</div><div className="text-xs text-gray-500">confidence</div></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500"><div className="text-3xl mb-3">🔕</div><div className="text-sm">No strategy setups detected</div></div>
              )}
            </div>
          </div>
        )}

        {/* ══ ANALYTICS TAB ══ */}
        {activeTab === 'analytics' && (
          <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto h-full">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">📊 IV Analysis</h3>
                {ivSource && <span className={`text-xs px-2 py-0.5 rounded font-bold ${ivSource === 'real_db' ? 'bg-green-900/60 text-green-400' : 'bg-yellow-900/60 text-yellow-400'}`}>{ivSource === 'real_db' ? `✅ Real DB (${ivPoints}pts)` : `⚠️ Est.`}</span>}
              </div>
              <IVAnalysisPanel ivAnalysis={signalData?.ivAnalysis} />
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">📐 Expected Move</h3>
              <ExpectedMoveCalculator expectedMove={signalData?.expectedMove} spotPrice={signalData?.spotPrice ?? spotPrice} atmIV={signalData?.currentIV ?? n(atmIV, 20)} daysToExpiry={signalData?.daysToExpiry ?? dte} />
            </div>
          </div>
        )}

        {/* ══ STRATEGY BUILDER TAB ══ */}
        {activeTab === 'strategy' && <StrategyBuilderTab data={data} signalData={signalData} />}

        {/* ══ PREDICTOR TAB ══ */}
        {activeTab === 'predictor' && (
          <div className="h-full overflow-hidden"><PremiumPredictor /></div>
        )}

        {/* ══ DATA TAB ══ */}
        {activeTab === 'data' && (
          <div className="h-full overflow-hidden"><DataManager /></div>
        )}

        {/* ══ SPOOFING TAB ══ */}
        {activeTab === 'spoofing' && (
          <div className="h-full overflow-hidden"><SpoofingTab /></div>
        )}

        {/* ══ 🌐 NETWORK TAB ══ */}
        {activeTab === 'network' && net && (
          <NetworkDetailPanel net={net} onTest={runManualTest} isTesting={isTesting} />
        )}
        {activeTab === 'network' && !net && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <div className="text-center"><div className="text-3xl mb-3 animate-spin">🌐</div><div className="text-sm">Initializing network monitor…</div></div>
          </div>
        )}

      </div>

      {/* ── FOOTER ── */}
      <div className="text-center text-gray-700 text-xs py-1.5 border-t border-gray-800 flex-shrink-0">
        JOBBER PRO · NIFTY Options Analytics · SSE live push &lt;500ms · Strategy Builder: live ATM IV + real premiums · ⚡ Premium Predictor · 🌐 Network Monitor
      </div>
    </div>
  );
}