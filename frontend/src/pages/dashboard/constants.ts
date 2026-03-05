// ============================================================================
// constants.ts — Centralised config for JOBBER PRO
// Change API_BASE here and every tab picks it up automatically.
// ============================================================================

export const API_BASE = 'http://localhost:3001';

export const ENDPOINTS = {
  greeks:       `${API_BASE}/api/options/greeks`,
  streamChain:  `${API_BASE}/api/stream/chain`,
  signals:      `${API_BASE}/api/analytics/signals`,
  netStatus:    `${API_BASE}/api/network/status`,
  netSpeedtest: `${API_BASE}/api/network/speedtest`,
  spoofingWs:   'ws://localhost:8765',
  premiumPredict: `${API_BASE}/api/premium/predict`,
  snapshotList:   `${API_BASE}/api/snapshots`,
} as const;

/** How often the fallback REST poll fires when SSE is unavailable (ms) */
export const FALLBACK_POLL_MS = 1_000;

/** How long to wait before declaring SSE dead and falling back (ms) */
export const SSE_FALLBACK_TIMEOUT_MS = 4_000;

/** How often network quality is polled (ms) */
export const NET_POLL_MS = 5_000;

/** Internet probe URL — Google's 204 endpoint, 0 bytes, always fast */
export const INTERNET_PROBE_URL = 'https://www.gstatic.com/generate_204';
