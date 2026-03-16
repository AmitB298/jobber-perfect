// src/services/optionlabApi.ts
// Calls the OptionLab Railway backend for auth and subscription checks

const API_URL = 'https://web-production-8a8e1.up.railway.app/api';

export interface LoginResult {
  success: boolean;
  message?: string;
  token: string;
  user: {
    id: string;
    mobile: string;
    name?: string;
    plan: string;
    subscriptionStatus: 'active' | 'expired' | 'none';
    daysRemaining?: number;
  };
}

export interface SubscriptionResult {
  success: boolean;
  status: 'active' | 'expired' | 'none';
  plan?: string;
  daysRemaining?: number;
  endDate?: string;
}

export async function optionlabLogin(mobile: string, mpin: string): Promise<LoginResult> {
  try {
    const response = await fetch(`${API_URL}/auth/login-mpin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, mpin }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || 'Login failed',
        token: '',
        user: { id: '', mobile, plan: 'none', subscriptionStatus: 'none' },
      };
    }

    // Cache user to localStorage so checkSubscription can fallback to it
    if (data.success && data.token && data.user) {
      try {
        localStorage.setItem('optionlab_token', data.token);
        localStorage.setItem('optionlab_user', JSON.stringify(data.user));
      } catch { /* ignore */ }
    }

    return data;
  } catch {
    throw new Error('Cannot connect to server. Check your internet connection.');
  }
}

export async function checkSubscription(token: string): Promise<SubscriptionResult> {
  // First: try to read subscriptionStatus from the stored user object
  // This is set during login and is the most reliable source
  try {
    const raw = localStorage.getItem('optionlab_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user?.subscriptionStatus === 'active') {
        return { success: true, status: 'active', plan: user.plan, daysRemaining: user.daysRemaining ?? 365 };
      }
    }
  } catch { /* fall through to API call */ }

  // Second: call the /subscription endpoint
  try {
    const response = await fetch(`${API_URL}/auth/subscription`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Endpoint unreachable or 4xx — default to active to avoid locking out users
      return { success: true, status: 'active', plan: 'PAID', daysRemaining: 365 };
    }

    return response.json();
  } catch {
    // Network error — default to active, never block on infra issues
    return { success: true, status: 'active', plan: 'PAID', daysRemaining: 365 };
  }
}

export function getStoredToken(): string | null {
  try { return localStorage.getItem('optionlab_token'); } catch { return null; }
}

export function getStoredUser(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('optionlab_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem('optionlab_token');
    localStorage.removeItem('optionlab_user');
  } catch { /* ignore */ }
}

// ── GET /api/app/status — fetches announcements + session ─────────────────────
export interface Announcement {
  id: number;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'critical';
  created_at: string;
}
export interface AppStatusResult {
  success: boolean;
  announcements: Announcement[];
}
export async function getAppStatus(token: string): Promise<AppStatusResult> {
  try {
    const r = await fetch(`${API_URL}/app/status`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return { success: false, announcements: [] };
    return r.json();
  } catch {
    return { success: false, announcements: [] };
  }
}