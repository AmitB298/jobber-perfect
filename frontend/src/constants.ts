// ============================================================================
// src/pages/constants.ts
// Resolved by: src/pages/dashboard/tabs/ChartsTab.tsx → ../../constants
// ============================================================================

export const API_BASE =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:3000`
    : 'http://localhost:3000';

export const WS_URL   = `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001/ws`;
export const SSE_URL  = `${API_BASE}/api/v1/stream`;

export const ENDPOINTS = {
  chain:     `${API_BASE}/api/v1/chain`,
  signals:   `${API_BASE}/api/v1/signals`,
  analytics: `${API_BASE}/api/v1/analytics`,
  network:   `${API_BASE}/api/v1/network`,
  spoofing:  `${API_BASE}/api/v1/spoofing`,
  ivHistory: `${API_BASE}/api/v1/iv-history`,
} as const;