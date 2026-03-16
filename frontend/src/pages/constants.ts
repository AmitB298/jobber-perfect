// src/pages/constants.ts
export const API_BASE = 'http://' + window.location.hostname + ':3000';
export const WS_URL   = 'ws://'  + window.location.hostname + ':3001/ws';
export const SSE_URL  = API_BASE + '/api/stream/chain';
export const ENDPOINTS = {
  chain:     API_BASE + '/api/options/chain',
  signals:   API_BASE + '/api/analytics/signals',
  analytics: API_BASE + '/api/analytics/pcr',
  network:   API_BASE + '/api/network/status',
  spoofing:  API_BASE + '/api/spoofing/history',
  ivHistory: API_BASE + '/api/analytics/iv-history',
  spot:      API_BASE + '/api/spot/nifty',
  stream:    API_BASE + '/api/stream/live',
} as const;
