// ============================================================================
// shared/useNetworkMonitor.ts — v4: real internet probe, not backend poll
// ─────────────────────────────────────────────────────────────────────────────
// FIX: Uses Google's 204 probe to determine internet status.
//      Backend /api/network/status is fetched *optionally* for richer stats
//      (download Mbps, jitter) but its failure NEVER triggers the red banner.
// ============================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import type { NetStatus, NetToast } from '../types';
import { ENDPOINTS, INTERNET_PROBE_URL, NET_POLL_MS } from '../constants';

export function useNetworkMonitor() {
  const [net, setNet] = useState<NetStatus>({
    isOnline: true,
    quality: 'GOOD',
    downloadMbps: null,
    latencyMs: null,
    jitterMs: null,
    packetLoss: 0,
    lastChecked: new Date().toISOString(),
    consecutiveFailures: 0,
    alert: null,
  });
  const [toasts, setToasts] = useState<NetToast[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  const toastIdRef    = useRef(0);
  const prevQualityRef = useRef<NetStatus['quality'] | null>(null);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const pushToast = useCallback((level: NetToast['level'], message: string, durationMs = 6000) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, level, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs);
  }, []);

  // ── Layer 1: real internet check via Google 204 ───────────────────────────
  const checkRealInternet = useCallback(async (): Promise<{ online: boolean; latencyMs: number | null }> => {
    const start = Date.now();
    try {
      await fetch(INTERNET_PROBE_URL, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      return { online: true, latencyMs: Date.now() - start };
    } catch {
      return { online: false, latencyMs: null };
    }
  }, []);

  // ── Layer 2: optional backend stats — failure silently ignored ────────────
  const tryGetBackendStats = useCallback(async (): Promise<Partial<NetStatus> | null> => {
    try {
      const res = await axios.get<{ success: boolean; data: NetStatus }>(
        ENDPOINTS.netStatus, { timeout: 3000 }
      );
      if (res.data.success) return res.data.data;
    } catch { /* backend down — NOT an internet failure */ }
    return null;
  }, []);

  const qualityFromLatency = (ms: number): NetStatus['quality'] => {
    if (ms < 80)  return 'EXCELLENT';
    if (ms < 150) return 'GOOD';
    if (ms < 300) return 'FAIR';
    return 'POOR';
  };

  // ── Main polling loop ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      // ── Step 1: does the internet actually work? ──────────────────────────
      const { online, latencyMs } = await checkRealInternet();
      if (cancelled) return;

      if (!online) {
        setNet(s => {
          const failures = s.consecutiveFailures + 1;
          if (prevQualityRef.current !== 'OFFLINE') {
            setTimeout(() => pushToast(
              'CRITICAL',
              '🔴 INTERNET CONNECTION LOST — Angel One WebSocket will disconnect!',
              10_000
            ), 0);
          }
          prevQualityRef.current = 'OFFLINE';
          return {
            ...s,
            isOnline: false,
            quality: 'OFFLINE',
            consecutiveFailures: failures,
            lastChecked: new Date().toISOString(),
          };
        });
        return;
      }

      // ── Step 2: internet is UP — get richer stats from backend (optional) ─
      const quality = latencyMs != null ? qualityFromLatency(latencyMs) : 'GOOD';
      const backendStats = await tryGetBackendStats();
      if (cancelled) return;

      setNet(s => {
        const prev = prevQualityRef.current;
        const newNet: NetStatus = {
          isOnline: true,
          // Backend quality overrides latency-based quality when available
          quality: backendStats?.quality ?? quality,
          downloadMbps: backendStats?.downloadMbps ?? s.downloadMbps,
          latencyMs,
          jitterMs: backendStats?.jitterMs ?? s.jitterMs,
          packetLoss: backendStats?.packetLoss ?? 0,
          lastChecked: new Date().toISOString(),
          consecutiveFailures: 0,
          alert: null,
        };
        const finalQ = newNet.quality;
        if (prev !== null && prev !== finalQ) {
          if (finalQ === 'POOR' && prev !== 'POOR')
            setTimeout(() => pushToast('WARNING', '⚠️ POOR CONNECTION — High latency detected.', 7000), 0);
          else if (['EXCELLENT', 'GOOD', 'FAIR'].includes(finalQ) && prev === 'OFFLINE')
            setTimeout(() => pushToast('RECOVERED', '✅ CONNECTION RESTORED — Back to normal.', 5000), 0);
          else if (['EXCELLENT', 'GOOD'].includes(finalQ) && prev === 'POOR')
            setTimeout(() => pushToast('RECOVERED', '✅ CONNECTION IMPROVED — Latency back to normal.', 5000), 0);
        }
        prevQualityRef.current = finalQ;
        return newNet;
      });
    };

    poll();
    const id = setInterval(poll, NET_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [checkRealInternet, tryGetBackendStats, pushToast]);

  // ── Manual speed test ─────────────────────────────────────────────────────
  const runManualTest = useCallback(async () => {
    setIsTesting(true);
    try {
      const res = await axios.post<{ success: boolean; data: NetStatus }>(
        ENDPOINTS.netSpeedtest, {}, { timeout: 15_000 }
      );
      if (res.data.success) {
        setNet(res.data.data);
        pushToast(
          'RECOVERED',
          `📶 Speed test: ${res.data.data.downloadMbps?.toFixed(1) ?? '?'} Mbps · ${res.data.data.latencyMs ?? '?'}ms`,
          5000
        );
      }
    } catch {
      // Backend unavailable — fall back to pure ping
      const { online, latencyMs } = await checkRealInternet();
      if (online && latencyMs != null)
        pushToast('RECOVERED', `📶 Ping: ${latencyMs}ms · Internet is UP (backend speed test unavailable)`, 5000);
      else
        pushToast('WARNING', '⚠️ Cannot reach internet — check your connection.', 5000);
    } finally {
      setIsTesting(false);
    }
  }, [pushToast, checkRealInternet]);

  return { net, toasts, isTesting, runManualTest };
}
