/**
 * JOBBER PRO — OI SCANNER ENGINE TYPES
 * ======================================
 * Shared interfaces used by oi-scanner-routes.ts and the live engine.
 */

export interface OIZone {
  strike:           number;
  expiry:           string;
  optionType:       'CE' | 'PE';
  zoneType:         string;
  zoneStrength:     number;
  oi:               number;         // ✅ `oi` — matches mapZoneRow and frontend
  oiRank:           number;         // ✅ fixes #undefined in ZoneCard
  oiVelocity:       number;         // ✅ fixes OI Vel. showing —
  oiVelocityZ:      number;         // ✅ fixes OI Z showing — (0 if not in DB)
  gexAbs:           number;         // ✅ fixes GEX showing —
  sweepCount:       number;
  ltp:              number;
  iv:               number;
  distanceFromSpot: number;
  distancePct:      number;
}

export interface OIScannerEngine {
  getTopZones(expiry?: string): OIZone[];
  getSummary(): Record<string, unknown>;
  // getFIIData removed — /fii route queries DB directly, engine method unused
}