// frontend/src/hooks/useAuth.ts
// ============================================================================
// Central auth hook — wraps Electron IPC calls, updates Zustand store,
// and provides loading/error state for login/logout/register flows.
//
// Usage:
//   const { user, isAuthenticated, login, logout, register, trialStatus } = useAuth();
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

// ── Electron runtime detection ────────────────────────────────────────────────
const isElectron = typeof window !== 'undefined' && !!window.electron;

// ============================================================================
// TYPES
// ============================================================================

export interface AuthError {
  message: string;
  field?: 'identifier' | 'password' | 'email' | 'mobile' | 'general';
}

export interface LoginPayload {
  identifier: string;  // email or mobile number
  password: string;
}

export interface RegisterPayload {
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
}


// ============================================================================
// HOOK
// ============================================================================


// TrialStatus mirrors the shape in electron.d.ts — kept local to avoid
// circular type resolution issues across the types/ boundary.
type TrialStatus = {
  isValid: boolean;
  daysRemaining: number;
  plan: 'TRIAL' | 'PAID' | 'EXPIRED';
};

export function useAuth() {
  const {
    user,
    isAuthenticated,
    isTrialValid,
    trialDaysRemaining,
    setUser,
    setTrialStatus,
    reset,
  } = useAppStore();

  const navigate = useNavigate();

  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<AuthError | null>(null);
  const [initialized, setInitialized] = useState(false);

  // ── Session restore on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) {
      // Browser dev mode — skip Electron auth entirely
      setInitialized(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // 1. Check if a user session exists
        const { success, data: existingUser } = await window.electron.authGetUser();
        if (!cancelled && success && existingUser) {
          setUser(existingUser);

          // 2. Fetch trial/plan status
          const trialRes = await window.electron.authIsTrialValid();
          if (!cancelled && trialRes.success) {
            setTrialStatus(trialRes.data.isValid, trialRes.data.daysRemaining);
          }
        }
      } catch (e) {
        // Session check failed — treat as logged out
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (payload: LoginPayload): Promise<boolean> => {
    setLoading(true);
    setError(null);

    if (!payload.identifier.trim()) {
      setError({ message: 'Email or mobile number is required', field: 'identifier' });
      setLoading(false);
      return false;
    }
    if (!payload.password) {
      setError({ message: 'Password is required', field: 'password' });
      setLoading(false);
      return false;
    }

    try {
      if (!isElectron) {
        // Dev browser fallback — auto-login with a mock user
        setUser({
          id:          'dev-user',
          email:       payload.identifier,
          plan:        'PAID',
          status:      'ACTIVE',
          permissions: ['*'],
        });
        navigate('/dashboard', { replace: true });
        return true;
      }

      const result = await window.electron.authLogin(payload.identifier, payload.password);

      if (result.success && result.data) {
        setUser(result.data);

        // Fetch trial status after successful login
        try {
          const trialRes = await window.electron.authIsTrialValid();
          if (trialRes.success) {
            setTrialStatus(trialRes.data.isValid, trialRes.data.daysRemaining);
          }
        } catch {}

        navigate('/dashboard', { replace: true });
        return true;
      } else {
        const msg = result.error || 'Login failed. Please check your credentials.';
        setError({ message: msg, field: 'general' });
        return false;
      }
    } catch (e) {
      setError({ message: 'Unable to connect. Is the app running correctly?', field: 'general' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [navigate, setUser, setTrialStatus]);

  // ── REGISTER ───────────────────────────────────────────────────────────────
  const register = useCallback(async (payload: RegisterPayload): Promise<boolean> => {
    setLoading(true);
    setError(null);

    // Client-side validation
    if (!payload.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError({ message: 'Enter a valid email address', field: 'email' });
      setLoading(false);
      return false;
    }
    if (!payload.mobile.match(/^[6-9]\d{9}$/)) {
      setError({ message: 'Enter a valid 10-digit Indian mobile number', field: 'mobile' });
      setLoading(false);
      return false;
    }
    if (payload.password.length < 8) {
      setError({ message: 'Password must be at least 8 characters', field: 'password' });
      setLoading(false);
      return false;
    }
    if (payload.password !== payload.confirmPassword) {
      setError({ message: 'Passwords do not match', field: 'password' });
      setLoading(false);
      return false;
    }

    try {
      if (!isElectron) {
        setError({ message: 'Registration requires the Electron app', field: 'general' });
        setLoading(false);
        return false;
      }

      const result = await window.electron.authRegister(
        payload.email,
        payload.mobile,
        payload.password,
      );

      if (result.success && result.data) {
        setUser(result.data);
        setTrialStatus(true, 30); // New accounts start with 30-day trial
        navigate('/dashboard', { replace: true });
        return true;
      } else {
        setError({ message: result.error || 'Registration failed', field: 'general' });
        return false;
      }
    } catch (e) {
      setError({ message: 'Registration failed. Please try again.', field: 'general' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [navigate, setUser, setTrialStatus]);

  // ── LOGOUT ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      if (isElectron) {
        await window.electron.authLogout();
      }
    } catch {}
    reset();
    navigate('/login', { replace: true });
    setLoading(false);
  }, [navigate, reset]);

  // ── CLEAR ERROR ────────────────────────────────────────────────────────────
  const clearError = useCallback(() => setError(null), []);

  // ── REFRESH TRIAL STATUS ───────────────────────────────────────────────────
  const refreshTrialStatus = useCallback(async (): Promise<TrialStatus | null> => {
    if (!isElectron) return null;
    try {
      const res = await window.electron.authIsTrialValid();
      if (res.success) {
        setTrialStatus(res.data.isValid, res.data.daysRemaining);
        return res.data;
      }
    } catch {}
    return null;
  }, [setTrialStatus]);

  return {
    // State
    user,
    isAuthenticated,
    loading,
    error,
    initialized,

    // Trial
    isTrialValid,
    trialDaysRemaining,
    trialStatus: {
      isValid:       isTrialValid,
      daysRemaining: trialDaysRemaining,
      plan:          user?.plan ?? 'TRIAL',
    } as TrialStatus,

    // Actions
    login,
    register,
    logout,
    clearError,
    refreshTrialStatus,
  };
}