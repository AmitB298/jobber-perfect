// frontend/src/hooks/useChainSync.ts
//
// Moves SSE chain subscription + signals polling OUT of Dashboard.tsx
// and into a top-level hook that runs once for the app lifetime.
//
// Mount BOTH hooks in App.tsx (inside the authenticated route):
//   function MarketDataSync() {
//     useChainSync();
//     useSignalsSync();
//     return null;
//   }

import { useEffect, useRef } from 'react';
import axios from 'axios';
import { useAppStore } from '../store/appStore';

const API = 'http://localhost:3001';

// ─────────────────────────────────────────────────────────────────────────────
// useChainSync
// Connects to /api/stream/chain (SSE) and writes every push to appStore.setChain().
// Falls back to polling /api/options/greeks every 1 s if SSE fails after 4 s.
// ─────────────────────────────────────────────────────────────────────────────

export function useChainSync(): void {
  const setChain = useAppStore((s) => s.setChain);

  // Stable refs — never trigger re-renders
  const sseRef         = useRef<EventSource | null>(null);
  const fallbackRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef       = useRef(true);
  const statusRef      = useRef<'connecting' | 'live' | 'fallback'>('connecting');
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    aliveRef.current = true;

    // ── REST fallback poll ──────────────────────────────────────────────────
    function startFallback() {
      if (fallbackRef.current) return;                 // already running
      statusRef.current = 'fallback';
      console.warn('⚠️ useChainSync: SSE unavailable — polling REST every 1 s');

      fallbackRef.current = setInterval(async () => {
        if (!aliveRef.current) return;
        try {
          const res = await axios.get(`${API}/api/options/greeks`, { timeout: 3000 });
          if (res.data.success) {
            // REST response gets source: 'rest_poll' from the updated api-server,
            // so setChain() will skip latency calculation for it (correct behaviour)
            setChain(res.data.data);
          }
        } catch (_) {}
      }, 1000);
    }

    // ── SSE connect ────────────────────────────────────────────────────────
    function connectSSE() {
      if (!aliveRef.current) return;
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }

      const es = new EventSource(`${API}/api/stream/chain`);
      sseRef.current = es;

      es.onopen = () => {
        if (!aliveRef.current) { es.close(); return; }
        console.log('✅ useChainSync: SSE connected');
        statusRef.current = 'live';
        reconnectDelay.current = 1000;                 // reset backoff
        // Kill fallback now that SSE is live
        if (fallbackRef.current) {
          clearInterval(fallbackRef.current);
          fallbackRef.current = null;
        }
      };

      es.onmessage = (event) => {
        if (!aliveRef.current) return;
        try {
          const d = JSON.parse(event.data);
          setChain(d);                                 // → appStore.setChain()
        } catch (_) {}
      };

      es.onerror = () => {
        if (!aliveRef.current) return;
        es.close();
        sseRef.current = null;
        statusRef.current = 'connecting';
        // Exponential back-off reconnect (max 15 s)
        reconnectRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 15_000);
          connectSSE();
        }, reconnectDelay.current);
      };
    }

    connectSSE();

    // Safety net: if SSE hasn't connected after 4 s, start fallback polling
    // so the UI isn't blank while SSE is retrying
    const safetyTimer = setTimeout(() => {
      if (statusRef.current !== 'live') startFallback();
    }, 4000);

    return () => {
      aliveRef.current = false;
      clearTimeout(safetyTimer);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (sseRef.current)       { sseRef.current.close(); sseRef.current = null; }
      if (fallbackRef.current)  { clearInterval(fallbackRef.current); fallbackRef.current = null; }
    };
  }, [setChain]);
}

// ─────────────────────────────────────────────────────────────────────────────
// useSignalsSync
// Always-on 10 s polling for /api/analytics/signals → appStore.setSignalData().
// Replaces the tab-gated useEffect that was inside Dashboard.tsx, which meant
// signals only refreshed when the user was on the signals/analytics/strategy tab.
// ─────────────────────────────────────────────────────────────────────────────

export function useSignalsSync(): void {
  const setSignalData = useAppStore((s) => s.setSignalData);

  useEffect(() => {
    let alive = true;

    async function fetchSignals() {
      try {
        const res = await axios.get(`${API}/api/analytics/signals`, { timeout: 5000 });
        if (res.data.success && alive) setSignalData(res.data.data);
      } catch (_) {}
    }

    fetchSignals();                                    // immediate on mount
    const id = setInterval(fetchSignals, 10_000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setSignalData]);
}