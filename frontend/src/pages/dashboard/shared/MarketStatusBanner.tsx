// ============================================================================
// shared/MarketStatusBanner.tsx
// ============================================================================
import { useState, useEffect } from 'react';
import { MarketStatus } from '../types';

export function MarketStatusBanner({ status, latestDataAt }: { status?: MarketStatus; latestDataAt?: string }) {
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

