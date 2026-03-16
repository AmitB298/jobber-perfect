// src/App.tsx
import { useEffect, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from './store/appStore';
import Login from './components/Auth/Login';
import Dashboard from './pages/Dashboard';
import SubscriptionExpired from './pages/SubscriptionExpired';
import { getStoredToken, getStoredUser, checkSubscription, clearAuth } from './services/optionlabApi';
import { heartbeat } from './services/heartbeat';
import AnnouncementBanner from './components/AnnouncementBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

export default function App() {
  const { isAuthenticated, setUser, setAngelConnected, updateTick, addSignal, reset } = useAppStore();
  const [subStatus, setSubStatus] = useState<'checking' | 'active' | 'expired'>('checking');
  const [appReady, setAppReady] = useState(false);

  // ── Logout handler ────────────────────────────────────────────────────────
  // Exposed via window so Dashboard/other components can call it
  const handleLogout = useCallback(() => {
    heartbeat.stop();
    clearAuth();
    reset();
    setSubStatus('active');
  }, [reset]);

  // Make logout available globally so Dashboard logout button can call it
  useEffect(() => {
    (window as any).__logout = handleLogout;
    return () => { delete (window as any).__logout; };
  }, [handleLogout]);

  // ── On startup: restore session ───────────────────────────────────────────
  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (token && storedUser) {
      setUser(storedUser as any);
      checkSubscription(token)
        .then(r => {
          const status = r.status === 'active' ? 'active' : 'expired';
          setSubStatus(status);
          // FIX 1: Only start heartbeat if subscription is active
          if (status === 'active') heartbeat.start();
        })
        .catch(() => {
          setSubStatus('active');
          heartbeat.start(); // Default to active on network error
        })
        .finally(() => setAppReady(true));
    } else {
      setSubStatus('active');
      setAppReady(true);
    }

    // Angel One + signal listeners
    const offConnected = (window as any).electronAPI?.angel?.onConnected?.(() => {
      setAngelConnected(true);
      heartbeat.setMarketConnected(true);   // FIX 3: wire market status
    });
    const offDisconnected = (window as any).electronAPI?.angel?.onDisconnected?.(() => {
      setAngelConnected(false);
      heartbeat.setMarketConnected(false);  // FIX 3: wire market status
    });
    const offTick   = (window as any).electronAPI?.angel?.onTick?.((tick: any) => updateTick(tick));
    const offSignal = (window as any).electronAPI?.signals?.onSignal?.((sig: any) => addSignal(sig));

    return () => {
      offConnected?.();
      offDisconnected?.();
      offTick?.();
      offSignal?.();
      heartbeat.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FIX 2: Start heartbeat on fresh login (no stored session at mount) ────
  useEffect(() => {
    if (!isAuthenticated) return;
    const token = getStoredToken();
    if (!token) return;

    // Start heartbeat in case this is a fresh login (not a restored session)
    heartbeat.start();

    checkSubscription(token)
      .then(r => setSubStatus(r.status === 'active' ? 'active' : 'expired'))
      .catch(() => setSubStatus('active'));
  }, [isAuthenticated]);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (!appReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="text-3xl mb-3 animate-pulse">⚡</div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen overflow-hidden bg-gray-950 text-white">
        {!isAuthenticated ? (
          <Login />
        ) : subStatus === 'expired' ? (
          <SubscriptionExpired />
        ) : (
          <>
            <AnnouncementBanner />
            <Dashboard />
          </>
        )}
      </div>
    </QueryClientProvider>
  );
}