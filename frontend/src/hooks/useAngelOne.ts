// frontend/src/hooks/useAngelOne.ts
// ============================================================================
// JOBBER PRO — Angel One IPC Hook
// ============================================================================
// Bridges Electron IPC events → Zustand appStore.
// Import via <AngelBootstrap /> in App.tsx so listeners are registered once.
// ============================================================================

import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';

// ── Electron runtime detection ────────────────────────────────────────────────
const isElectron = typeof window !== 'undefined' && !!window.electron;

// ============================================================================
// HOOK
// ============================================================================

export function useAngelOne() {
  const {
    setAngelConnected,
    setAngelProfile,
    addSignal,
    addSpoofAlert,
    clearSpoofAlerts,
    angelConnected,
    angelProfile,
  } = useAppStore();

  const listenersRegistered = useRef(false);

  useEffect(() => {
    if (!isElectron || listenersRegistered.current) return;
    listenersRegistered.current = true;

    const unsubConnected = window.electron.onAngelConnected(() => {
      setAngelConnected(true);
    });

    const unsubDisconnected = window.electron.onAngelDisconnected((_reason: string) => {
      setAngelConnected(false);
    });

    const unsubTick = window.electron.onAngelTick((tick: any) => {
      if (!tick) return;
      if (tick.alertType === 'SPOOF' || tick.spoof === true) {
        addSpoofAlert({
          id:          `spoof_${Date.now()}_${tick.token ?? ''}`,
          token:       tick.token       ?? '',
          symbol:      tick.symbol      ?? tick.tk ?? 'UNKNOWN',
          state:       tick.state       ?? 'ALERT',
          phase:       tick.phase       ?? 'PATCH_I',
          severity:    tick.severity    ?? 'HIGH',
          type:        tick.type        ?? 'SPOOF_DETECTED',
          strike:      tick.strike      ?? 0,
          optionType:  tick.optionType  ?? 'CE',
          ensemble:    tick.ensemble    ?? 0,
          confidence:  tick.confidence  ?? 0,
          action:      tick.action      ?? 'WATCH',
          description: tick.description ?? `Spoofing detected on ${tick.symbol ?? tick.tk ?? 'UNKNOWN'}`,
          explanation: tick.explanation ?? '',
          ltp:         tick.ltp         ?? 0,
          detectedAt:  tick.detectedAt  ?? Date.now(),
          timestamp:   tick.timestamp   ?? new Date().toISOString(),
        });
      }
    });

    const unsubError = window.electron.onAngelError((_error: string) => {});

    const unsubSignal = window.electron.onSignal((signal: any) => {
      if (!signal) return;
      addSignal({
        id:             signal.id             ?? `sig_${Date.now()}`,
        type:           signal.type           ?? 'IV_CRUSH',
        strategy:       signal.strategy       ?? '',
        priority:       signal.priority       ?? 'MEDIUM',
        confidence:     signal.confidence     ?? 0,
        action:         signal.action         ?? '',
        description:    signal.description    ?? '',
        strikes:        signal.strikes        ?? [],
        expectedProfit: signal.expectedProfit ?? '',
        risk:           signal.risk           ?? '',
        timestamp:      signal.timestamp      ?? Date.now(),
      });
    });

    const unsubStarted = window.electron.onSignalEngineStarted(() => {});
    const unsubStopped = window.electron.onSignalEngineStopped(() => {});

    window.electron.angelGetStatus()
      .then((res: any) => {
        if (res?.success && res?.data) {
          setAngelConnected(res.data.connected ?? false);
          if (res.data.profile) setAngelProfile(res.data.profile);
        }
      })
      .catch(() => {});

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubTick();
      unsubError();
      unsubSignal();
      unsubStarted();
      unsubStopped();
      listenersRegistered.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async (): Promise<boolean> => {
    if (!isElectron) return false;
    try { return (await window.electron.angelConnect())?.success ?? false; }
    catch { return false; }
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!isElectron) return;
    try { await window.electron.angelDisconnect(); setAngelConnected(false); } catch {}
  }, [setAngelConnected]);

  const subscribe = useCallback(async (tokens: string[]): Promise<boolean> => {
    if (!isElectron) return false;
    try { return (await window.electron.angelSubscribe(tokens))?.success ?? false; }
    catch { return false; }
  }, []);

  const unsubscribe = useCallback(async (tokens: string[]): Promise<boolean> => {
    if (!isElectron) return false;
    try { return (await window.electron.angelUnsubscribe(tokens))?.success ?? false; }
    catch { return false; }
  }, []);

  // Returns number|undefined matching angelGetLTP's { data?: number } return type
  const getLTP = useCallback(async (
    exchange: string, symbol: string, token: string,
  ): Promise<number | undefined> => {
    if (!isElectron) return undefined;
    try {
      const res = await window.electron.angelGetLTP(exchange, symbol, token);
      return res?.success ? res.data : undefined;
    } catch { return undefined; }
  }, []);

  const startSignalEngine = useCallback(async (): Promise<boolean> => {
    if (!isElectron) return false;
    try { return (await window.electron.signalStart())?.success ?? false; }
    catch { return false; }
  }, []);

  const stopSignalEngine = useCallback(async (): Promise<void> => {
    if (!isElectron) return;
    try { await window.electron.signalStop(); } catch {}
  }, []);

  return {
    isConnected: angelConnected,
    profile:     angelProfile,
    isElectron,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getLTP,
    startSignalEngine,
    stopSignalEngine,
    clearSpoofAlerts,
  };
}