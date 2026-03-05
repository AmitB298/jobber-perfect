import axios, { AxiosInstance } from 'axios';
import Store from 'electron-store';
import { SecurityManager, DeviceFingerprint } from './SecurityManager';
import * as Sentry from '@sentry/electron/main';

export interface User {
  id: string;
  email: string;
  mobile?: string;
  plan: 'TRIAL' | 'PAID' | 'EXPIRED';
  status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  trialStartDate?: string;
  trialEndDate?: string;
  subscriptionEndDate?: string;
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
  requiresAngelLogin: boolean;
}

interface StoreSchema {
  userId?: string;
  deviceFingerprint?: DeviceFingerprint;
  lastSync?: number;
  angelClientId?: string;
}

export class AuthManager {
  private static instance: AuthManager;
  private securityManager: SecurityManager;
  private store: Store<StoreSchema>;
  private api: AxiosInstance;
  private currentUser: User | null = null;
  private tokens: AuthTokens | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  private readonly BACKEND_URL = process.env.BACKEND_URL || 'https://api.yourbackend.com';
  private readonly TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

  private constructor() {
    this.securityManager = SecurityManager.getInstance();
    this.store = new Store<StoreSchema>({
      name: 'auth-store',
      encryptionKey: 'your-encryption-key' // Use machineId in production
    });

    this.api = axios.create({
      baseURL: this.BACKEND_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.setupAxiosInterceptors();
  }

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  /**
   * Setup Axios request/response interceptors
   */
  private setupAxiosInterceptors(): void {
    // Request interceptor - add auth token
    this.api.interceptors.request.use(
      async (config) => {
        if (this.tokens?.accessToken) {
          config.headers.Authorization = `Bearer ${this.tokens.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle token refresh
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If 401 and not already retrying
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            await this.refreshAccessToken();
            return this.api(originalRequest);
          } catch (refreshError) {
            // Refresh failed, logout user
            await this.logout();
            throw refreshError;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Login user with email/mobile and password
   */
  async login(identifier: string, password: string): Promise<LoginResponse> {
    try {
      // Get device fingerprint
      const fingerprint = await this.securityManager.generateDeviceFingerprint();

      const response = await this.api.post<LoginResponse>('/auth/login', {
        identifier,
        password,
        deviceFingerprint: fingerprint
      });

      const { user, tokens, requiresAngelLogin } = response.data;

      // Store tokens securely
      this.tokens = tokens;
      this.currentUser = user;

      // Store user ID and fingerprint
      this.store.set('userId', user.id);
      this.store.set('deviceFingerprint', fingerprint);

      // Store refresh token in system keychain
      await this.securityManager.storeCredential(
        `refresh-token-${user.id}`,
        tokens.refreshToken
      );

      // Setup token refresh timer
      this.setupTokenRefresh();

      Sentry.setUser({
        id: user.id,
        email: user.email
      });

      return response.data;
    } catch (error) {
      Sentry.captureException(error);
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Register new user
   */
  async register(email: string, mobile: string, password: string): Promise<LoginResponse> {
    try {
      const fingerprint = await this.securityManager.generateDeviceFingerprint();

      const response = await this.api.post<LoginResponse>('/auth/register', {
        email,
        mobile,
        password,
        deviceFingerprint: fingerprint
      });

      const { user, tokens, requiresAngelLogin } = response.data;

      this.tokens = tokens;
      this.currentUser = user;

      this.store.set('userId', user.id);
      this.store.set('deviceFingerprint', fingerprint);

      await this.securityManager.storeCredential(
        `refresh-token-${user.id}`,
        tokens.refreshToken
      );

      this.setupTokenRefresh();

      Sentry.setUser({
        id: user.id,
        email: user.email
      });

      return response.data;
    } catch (error) {
      Sentry.captureException(error);
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      if (this.tokens?.refreshToken) {
        await this.api.post('/auth/logout', {
          refreshToken: this.tokens.refreshToken
        });
      }
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      // Clear local state
      if (this.currentUser) {
        await this.securityManager.deleteCredential(
          `refresh-token-${this.currentUser.id}`
        );
      }

      this.tokens = null;
      this.currentUser = null;
      this.store.clear();

      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }

      Sentry.setUser(null);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.currentUser || !this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.api.post<{ tokens: AuthTokens }>('/auth/refresh', {
        refreshToken: this.tokens.refreshToken
      });

      this.tokens = response.data.tokens;

      // Update refresh token in keychain
      await this.securityManager.storeCredential(
        `refresh-token-${this.currentUser.id}`,
        response.data.tokens.refreshToken
      );

      this.setupTokenRefresh();
    } catch (error) {
      throw new Error('Failed to refresh token');
    }
  }

  /**
   * Setup automatic token refresh
   */
  private setupTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.tokens) return;

    const expiresIn = this.tokens.expiresAt - Date.now();
    const refreshAt = expiresIn - this.TOKEN_REFRESH_BUFFER;

    if (refreshAt > 0) {
      this.refreshTimer = setTimeout(async () => {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          console.error('Auto token refresh failed:', error);
          await this.logout();
        }
      }, refreshAt);
    }
  }

  /**
   * Bind Angel One account to user
   */
  async bindAngelAccount(angelClientId: string): Promise<void> {
    try {
      await this.api.post('/auth/bind-angel', {
        angelClientId
      });

      this.store.set('angelClientId', angelClientId);
    } catch (error) {
      Sentry.captureException(error);
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Check if trial is valid
   */
  isTrialValid(): boolean {
    if (!this.currentUser) return false;

    if (this.currentUser.plan === 'PAID') return true;
    if (this.currentUser.plan === 'EXPIRED') return false;

    if (this.currentUser.trialEndDate) {
      return new Date(this.currentUser.trialEndDate) > new Date();
    }

    return false;
  }

  /**
   * Get remaining trial days
   */
  getRemainingTrialDays(): number {
    if (!this.currentUser?.trialEndDate) return 0;

    const endDate = new Date(this.currentUser.trialEndDate);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  /**
   * Check if user has permission
   */
  hasPermission(permission: string): boolean {
    if (!this.currentUser) return false;
    return this.currentUser.permissions.includes(permission);
  }

  /**
   * Sync user data with backend
   */
  async syncUser(): Promise<void> {
    try {
      const response = await this.api.get<{ user: User }>('/auth/me');
      this.currentUser = response.data.user;
      this.store.set('lastSync', Date.now());
    } catch (error) {
      console.error('User sync failed:', error);
    }
  }

  /**
   * Restore session from stored tokens
   */
  async restoreSession(): Promise<boolean> {
    try {
      const userId = this.store.get('userId');
      if (!userId) return false;

      const refreshToken = await this.securityManager.getCredential(
        `refresh-token-${userId}`
      );

      if (!refreshToken) return false;

      // Try to refresh access token
      this.tokens = {
        accessToken: '',
        refreshToken,
        expiresAt: 0
      };

      await this.refreshAccessToken();
      await this.syncUser();

      return true;
    } catch (error) {
      console.error('Session restore failed:', error);
      await this.logout();
      return false;
    }
  }

  /**
   * Get current user
   */
  getCurrentUser(): User | null {
    return this.currentUser;
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return this.tokens?.accessToken || null;
  }

  /**
   * Is user authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null && this.tokens !== null;
  }

  /**
   * Extract error message from axios error
   */
  private getErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.message || error.message;
    }
    return error.message || 'Unknown error occurred';
  }
}
