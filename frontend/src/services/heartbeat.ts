/**
 * heartbeat.ts
 * Location: D:\jobber-perfect\frontend\src\services\heartbeat.ts
 *
 * Sends a heartbeat to Railway every 2 minutes while the app is running.
 * This is the ONLY file needed for admin dashboard Live Users to work.
 *
 * Does NOT touch auth, login, tokens, or Angel One credentials.
 * Reads the token already stored by optionlabApi.ts (localStorage).
 *
 * Usage — add to App.tsx useEffect after login:
 *   import { heartbeat } from './services/heartbeat';
 *   heartbeat.start();                          // call once after user logs in
 *   heartbeat.setMarketConnected(true/false);   // call when Angel One connects
 *   heartbeat.stop();                           // call on logout
 */

const RAILWAY_URL = 'https://web-production-8a8e1.up.railway.app';
const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isMarketConnected = false;

  /** Start sending heartbeats. Safe to call multiple times — won't double-start. */
  start(): void {
    if (this.timer) return; // already running

    // Send immediately, then on interval
    this._send();
    this.timer = setInterval(() => this._send(), INTERVAL_MS);
  }

  /** Stop heartbeats (call on logout). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isMarketConnected = false;
  }

  /** Call this when Angel One WebSocket connects or disconnects. */
  setMarketConnected(connected: boolean): void {
    this.isMarketConnected = connected;
    // Send immediately so admin sees the change right away
    this._send();
  }

  private async _send(): Promise<void> {
    const token = this._getToken();
    if (!token) return; // not logged in — skip silently

    const appVersion = await this._getAppVersion();
    const platform   = this._getPlatform();

    try {
      await fetch(`${RAILWAY_URL}/api/app/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          appVersion,
          platform,
          isMarketConnected: this.isMarketConnected,
        }),
      });
    } catch {
      // Heartbeat failure is non-fatal — silently ignore
      // App continues working even if Railway is unreachable
    }
  }

  private _getToken(): string | null {
    try {
      // Uses the same key that optionlabApi.ts stores after login
      return localStorage.getItem('optionlab_token');
    } catch {
      return null;
    }
  }

  private async _getAppVersion(): Promise<string> {
    try {
      if (window.electron?.getAppVersion) {
        return await window.electron.getAppVersion();
      }
    } catch { /* ignore */ }
    return '1.0.0';
  }

  private _getPlatform(): string {
    try {
      if (window.electron?.platform) return window.electron.platform;
    } catch { /* ignore */ }
    return navigator.platform || 'unknown';
  }
}

// Singleton — import this anywhere in the app
export const heartbeat = new HeartbeatService();