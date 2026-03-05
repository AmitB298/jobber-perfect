// ============================================================================
// shared/helpers.ts — Pure utility / formatting functions
// ============================================================================

export const n = (v: any, fb = 0): number => { if (v == null) return fb; const p = Number(v); return isNaN(p) ? fb : p; };
export const fmt = (v: any, d = 2): string => { const num = n(v, NaN); return isNaN(num) ? '–' : num.toFixed(d); };
export const fmtK = (v: any): string => {
  const num = n(v, 0);
  if (num >= 1_00_00_000) return (num / 1_00_00_000).toFixed(1) + 'Cr';
  if (num >= 1_00_000)    return (num / 1_00_000).toFixed(1) + 'L';
  if (num >= 1_000)       return (num / 1_000).toFixed(1) + 'K';
  return num.toFixed(0);
};
export const ivColor = (iv: any): string => {
  const v = n(iv, -1);
  if (v < 0)  return '#6B7280';
  if (v < 12) return '#22C55E';
  if (v < 18) return '#84CC16';
  if (v < 25) return '#FBBF24';
  if (v < 35) return '#F97316';
  return '#EF4444';
};
export const fmtRs = (v: number, d = 0): string =>
  '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
