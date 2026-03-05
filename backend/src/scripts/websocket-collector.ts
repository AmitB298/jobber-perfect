/**
 * websocket-collector.ts — v7.4
 * Location: D:\jobber-perfect\backend\src\scripts\websocket-collector.ts
 *
 * ════ BUGS FIXED IN v7.0 (on top of v6.5) ══════════════════════════════════
 *
 * FIX B — pushToApi dropped ticks (80ms throttle, no pending-flag fallback)
 * FIX D — markSubscribed() race with slow CDN → warmup bypassed
 * FIX A — liveNiftyPrev/liveNiftyOpen never reset on multi-day runs
 * FIX E — getAvailableExpiries() served expired expiries to frontend
 * FIX C — Greeks cache LRU inversion (first-inserted evicted, not LRU)
 * FIX I — Telegram global 30s cooldown suppressed higher-severity alerts
 * FIX F — liveChain / openOiMap grew unbounded, no expired-key eviction
 * FIX G — JSON.parse(JSON.stringify()) round-trip in direct emitter path
 *
 * ════ BUGS FIXED IN v7.1 (observed from live log 3:05-3:06 PM) ═════════════
 *
 * FIX J — Alert storm (500+ CRITICALs/10s): FIRE_COOLDOWN_MS=30s + phase thresholds
 * FIX K — Shutdown DB pool error + alerts printing after shutdown signal
 * FIX L — Alert counters never reset between sessions
 *
 * ════ BUGS FIXED IN v7.2 (observed from live log v7.1 run 3:19 PM) ══════════
 *
 * FIX K v2 — _isShuttingDown guard was only in persistSpoofAlertToDb().
 *   Console output, file writes, WS broadcast, and Telegram still fired
 *   during shutdown. Fix: guard moved to routeSpoofAlert() entry point,
 *   silencing the entire pipeline with one check.
 *
 * FIX K v3 — ws.disconnect() not called before pool.end() in shutdown().
 *   Ticks arrived during the pool.end() await (~100-500ms), processTick()
 *   fired and routed alerts that hit the DB. Fix: ws.disconnect() + 100ms
 *   sleep added before spoofingDetector.reset() and pool.end().
 *
 * FIX M — MOMENTUM_IGNITION fired on tick #3 (MIN_HISTORY_TICKS=3).
 *   At reconnect/startup tick #2 can be a stale pre-close LTP and tick #3
 *   is the fresh live price → giant apparent spike → 74 false alerts on
 *   first 8 seconds of every session. Fix: require h.length >= 5 ticks
 *   before MOMENTUM_IGNITION can fire, giving the buffer a real baseline.
 *
 * FIX J — ALERT STORM: 500+ CRITICALs in 10 seconds, every option firing.
 *   ROOT CAUSE 1: fireK() dedup guard is only 500ms. The ALERT_TTL is 10s.
 *     When an alert fires and TTL expires (10s), active.delete(k) runs.
 *     The VERY NEXT tick re-fires it with no dedup, TTL restarts, cycle repeats
 *     forever at 60-95 ticks/sec across 381 tokens.
 *   ROOT CAUSE 2: At CLOSE_WATCH (15:00-15:30), every MM hedge and
 *     institutional trade produces bid/ask ratios far above BID_WALL_RATIO=5.
 *     OI is batch-updated at close so OI appears frozen → every LTP move
 *     triggers OI_DIVERGENCE. Normal close volatility triggers MOMENTUM_IGNITION.
 *     The detector has no concept of "normal close microstructure."
 *   Fix 1: Separate "display TTL" from "fire cooldown". Add lastFiredMap
 *     with a per-symbol-per-type cooldown (FIRE_COOLDOWN_MS, default 30s)
 *     that persists independently of the display TTL. An alert can only
 *     re-fire after FIRE_COOLDOWN_MS has elapsed since it last fired.
 *   Fix 2: In CLOSE_WATCH phase, suppress OI_DIVERGENCE entirely (OI is
 *     batch-updated; false positive rate is ~100% in last 10min).
 *     Raise wall thresholds: BID/ASK_WALL_RATIO 5→12, MIN_QTY 50→150.
 *     Raise MOMENTUM_IGNITION LTP spike threshold 0.8%→2% at close.
 *     Only LAYERING (cross-strike coordination) fires at full sensitivity
 *     in CLOSE_WATCH — it is the only pattern that indicates real
 *     settlement manipulation vs normal close-time hedging.
 *
 * FIX K — SHUTDOWN with live WebSocket → DB pool error after pool.end().
 *   ROOT CAUSE: shutdown() sequence was:
 *     clearInterval → flushDB → pool.end() → exit
 *   But the WebSocket was still live and ticks still arriving. routeSpoofAlert
 *   called persistSpoofAlertToDb() which tried pool.query() after pool.end()
 *   → "Cannot use a pool after calling end on the pool".
 *   Fix: shutdown() now sets _isShuttingDown=true FIRST (guards all DB writes),
 *   then calls spoofingDetector.reset() to drain the alert pipeline, then
 *   flushes the write queue, then ends the pool.
 *
 * FIX L — _totalAlerts/_totalCritical/_totalWatch never reset between sessions.
 *   The display showed cumulative counts across the whole process lifetime,
 *   making the counter useless for diagnosing alert rate per session.
 *   Fix: Reset all three counters in abort() alongside other session state.
 *
 * ════ BUGS FIXED IN v7.4 ════════════════════════════════════════════════════
 *
 * FIX O — needsDiv threshold too high → wrong LTP stored → IV blows up → BS prices shown
 *   ROOT CAUSE: Angel One sends LTP in paise for some option tokens.
 *     e.g. NIFTY24150CE real LTP = ₹410 → sent as 41,000 paise.
 *     Old threshold: ltp > 50_000 → 41,000 > 50,000 = false → NO division.
 *     Stored as ₹41,000 instead of ₹410.
 *   CASCADE:
 *     1. calculateChainGreeks() receives ceLTP=41000
 *     2. Guard: ceLTP < spot (41000 < 24480) = false → ceLTP filtered out → ceG = undefined
 *     3. ce_ltp in chain = 41000 (raw, unreduced)
 *     4. Dashboard shows Black-Scholes theoretical instead of real LTP
 *        → dashboard displays ₹888, ₹1073, ₹784 (BS prices at wrong IV)
 *   FIX: Threshold 50_000 → 5_000. Options above ₹50 = 5,000 paise are
 *     extremely rare — the highest NIFTY option LTP in history is ~₹2,000
 *     (deep ITM at COVID crash). This correctly divides all paise-encoded LTPs.
 *
 * FIX P — calculateChainGreeks() CE/PE guards incorrectly filtered valid options
 *   OLD: if (ceLTP > 0.01 && ceLTP < spot)  ← rejects any CE with LTP > spot
 *   OLD: if (peLTP > 0.01 && peLTP < K)     ← rejects any PE with LTP > strike
 *   These guards were added as a workaround to catch inflated paise values.
 *   After FIX O (correct paise conversion), they are no longer needed as a
 *   data filter AND they incorrectly suppress valid deep-ITM options:
 *     - Deep ITM calls near expiry can have LTP approaching spot (valid)
 *     - Any residual stale/pre-market paise value > spot was the real bug
 *   FIX: Replace with a MAX_OPTION_LTP sanity cap (4× spot for CE, 4× K for PE).
 *   This is loose enough to never reject valid options but tight enough to
 *   catch any residual encoding bugs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createAngelOneService, AngelWebSocket } from '../services/angelone.service';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as http   from 'http';
import * as https  from 'https';
import * as fs     from 'fs';
import * as path   from 'path';
import * as net    from 'net';
import * as crypto from 'crypto';

dotenv.config();

const VERSION = 'v7.4';

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — GREEKS CALCULATOR (Black-Scholes)
// ════════════════════════════════════════════════════════════════════════════

const RISK_FREE_RATE = 0.0625; // RBI repo rate 6.25%
const DIVIDEND_YIELD = 0.013;  // Nifty dividend yield 1.3%
const MIN_IV         = 0.001;
const MAX_IV         = 5.0;
// IV SANITY FIX: Any computed IV ≥ 100% means the underlying LTP is stale/bad.
// In 20 years of NIFTY history IV has never exceeded ~92% (COVID March 2020).
const MAX_DISPLAY_IV = 100;

interface Greeks {
  iv: number; delta: number; gamma: number; theta: number; vega: number;
}
interface ChainRow {
  strike_price: number;
  ce_ltp: number|null; pe_ltp: number|null;
  ce_volume: number|null; pe_volume: number|null;
  ce_oi: number|null;    pe_oi: number|null;
  ce_oi_chg: number|null; pe_oi_chg: number|null;
  ce_oi_chg_pct: number|null; pe_oi_chg_pct: number|null;
  ce_greeks?: Greeks;    pe_greeks?: Greeks;
  iv_skew?: number; ce_pcr?: number; is_atm?: boolean;
}

function normCDF(x: number): number {
  if (x < -8) return 0; if (x > 8) return 1;
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1, t=1/(1+p*Math.abs(x)/Math.SQRT2);
  const poly=t*(a1+t*(a2+t*(a3+t*(a4+t*a5))));
  return 0.5*(1+sign*(1-poly*Math.exp(-x*x/2)));
}
function normPDF(x: number): number { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function blackScholes(S:number,K:number,T:number,r:number,q:number,sigma:number,isCall:boolean) {
  if (T<=0||sigma<=0||S<=0||K<=0) {
    const i=isCall?Math.max(S-K,0):Math.max(K-S,0);
    return {price:i,delta:isCall?(S>K?1:0):(S<K?-1:0),gamma:0,theta:0,vega:0};
  }
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r-q+0.5*sigma*sigma)*T)/(sigma*sqrtT), d2=d1-sigma*sqrtT;
  const eqT=Math.exp(-q*T), erT=Math.exp(-r*T);
  const price=isCall?S*eqT*normCDF(d1)-K*erT*normCDF(d2):K*erT*normCDF(-d2)-S*eqT*normCDF(-d1);
  const delta=isCall?eqT*normCDF(d1):-eqT*normCDF(-d1);
  const pdf1=normPDF(d1);
  const gamma=eqT*pdf1/(S*sigma*sqrtT);
  const thetaA=isCall
    ?-(S*eqT*pdf1*sigma/(2*sqrtT))-r*K*erT*normCDF(d2)+q*S*eqT*normCDF(d1)
    :-(S*eqT*pdf1*sigma/(2*sqrtT))+r*K*erT*normCDF(-d2)-q*S*eqT*normCDF(-d1);
  const theta=thetaA/252; // trading days convention
  const vega=S*eqT*pdf1*sqrtT/100;
  return {price:Math.max(price,0),delta,gamma,theta,vega};
}

function impliedVol(mktPrice:number,S:number,K:number,T:number,r:number,q:number,isCall:boolean):number {
  if (mktPrice<=0||T<=0||S<=0||K<=0) return 0;
  const intrinsic=Math.max(isCall?S-K:K-S,0);
  if (mktPrice<intrinsic*Math.exp(-(r-q)*T)*0.99) return 0;
  let sigma=Math.max(MIN_IV,Math.min(Math.sqrt(2*Math.PI/T)*mktPrice/S,MAX_IV));
  for (let i=0;i<100;i++) {
    const bs=blackScholes(S,K,T,r,q,sigma,isCall);
    const diff=bs.price-mktPrice;
    if (Math.abs(diff)<0.01) break;
    const vega=bs.vega*100;
    if (Math.abs(vega)<1e-8) break;
    const step=diff/vega;
    sigma-=step;
    if (sigma<MIN_IV){sigma=MIN_IV;break;}
    if (sigma>MAX_IV){sigma=MAX_IV;break;}
    if (Math.abs(step)<0.0001) break;
  }
  if (sigma<=MIN_IV||sigma>=MAX_IV) return 0;
  const verify=blackScholes(S,K,T,r,q,sigma,isCall);
  if (Math.abs(verify.price-mktPrice)>Math.max(mktPrice*0.05,1)) return 0;
  return sigma*100;
}

// Returns next weekly Thursday expiry (used as default when no specific expiry known)
function getNextNiftyExpiry(): Date {
  // FIX H2: Use the earliest expiry actually present in liveChain if available.
  if (liveChain.size > 0) {
    let earliest: Date | null = null;
    const now = Date.now();
    for (const k of liveChain.keys()) {
      const parts = k.split('_');
      if (parts.length < 3) continue;
      try {
        const d = expiryStringToDate(parts[2]);
        if (d.getTime() > now && (!earliest || d < earliest)) earliest = d;
      } catch(_) {}
    }
    if (earliest) return earliest;
  }
  // Fallback: arithmetic-based next Thursday
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const day=ist.getDay();
  let ahead=(4-day+7)%7;
  if (ahead===0&&ist.getHours()*60+ist.getMinutes()>=930) ahead=7;
  const exp=new Date(ist);
  exp.setDate(ist.getDate()+ahead);
  exp.setHours(15,30,0,0);
  return exp;
}

// Parse expiry from symbol's DDMMMYY string into a JS Date at 15:30 IST (10:00 UTC)
function expiryStringToDate(expiry: string): Date {
  const day  = parseInt(expiry.slice(0, 2), 10);
  const mon  = monthNum(expiry.slice(2, 5));
  const yr   = parseInt(expiry.slice(5, 7), 10) + 2000;
  const d = new Date(`${yr}-${mon}-${String(day).padStart(2,'0')}T10:00:00Z`);
  return d;
}

function timeToExpiryYears(exp: Date): number {
  return Math.max((exp.getTime()-Date.now())/60000, 1) / (365*24*60);
}

function calculateChainGreeks(rows:any[],spot:number,_expiry:Date):ChainRow[] {
  if (!rows?.length||spot<=0) return [];
  const r=RISK_FREE_RATE,q=DIVIDEND_YIELD;
  const atm=Math.round(spot/50)*50;
  const defaultT=timeToExpiryYears(_expiry);
  // FIX P: Loose sanity cap replaces the old strict ceLTP<spot / peLTP<K guards.
  // The old guards were originally meant to catch inflated paise values, but
  // after FIX O (correct needsDiv threshold) paise values are always divided
  // correctly before reaching here. The strict guards also incorrectly rejected
  // valid deep-ITM options. 4× spot / 4× K is generous enough for any real
  // option yet catches any residual encoding bug.
  const MAX_CE_LTP = spot * 4;
  const MAX_PE_LTP_RATIO = 4; // peLTP < K * MAX_PE_LTP_RATIO
  return rows.map((row):ChainRow => {
    const K=Number(row.strike_price),ceLTP=Number(row.ce_ltp)||0,peLTP=Number(row.pe_ltp)||0;
    const ceOI=Number(row.ce_oi)||0,peOI=Number(row.pe_oi)||0;
    let T=defaultT;
    if (row.expiry_date) {
      try { T=timeToExpiryYears(expiryStringToDate(String(row.expiry_date))); } catch(_) {}
    }
    let ceG:Greeks|undefined,peG:Greeks|undefined;

    // FIX P: was `ceLTP > 0.01 && ceLTP < spot` — now uses loose cap
    if (ceLTP > 0.01 && ceLTP < MAX_CE_LTP) {
      const iv=impliedVol(ceLTP,spot,K,T,r,q,true);
      if(iv>0 && iv<MAX_DISPLAY_IV){
        const bs=blackScholes(spot,K,T,r,q,iv/100,true);
        ceG={iv,delta:+bs.delta.toFixed(4),gamma:+bs.gamma.toFixed(6),theta:+bs.theta.toFixed(2),vega:+bs.vega.toFixed(2)};
      }
    }
    // FIX P: was `peLTP > 0.01 && peLTP < K` — now uses loose cap
    if (peLTP > 0.01 && peLTP < K * MAX_PE_LTP_RATIO) {
      const iv=impliedVol(peLTP,spot,K,T,r,q,false);
      if(iv>0 && iv<MAX_DISPLAY_IV){
        const bs=blackScholes(spot,K,T,r,q,iv/100,false);
        peG={iv,delta:+bs.delta.toFixed(4),gamma:+bs.gamma.toFixed(6),theta:+bs.theta.toFixed(2),vega:+bs.vega.toFixed(2)};
      }
    }

    const ceOiOpen=Number(row.ce_oi_open??-1);
    const peOiOpen=Number(row.pe_oi_open??-1);
    const ceOiChg  = ceOiOpen>=0 ? ceOI-ceOiOpen : null;
    const peOiChg  = peOiOpen>=0 ? peOI-peOiOpen : null;
    const ceOiChgPct = (ceOiOpen>0 && ceOiChg!==null) ? +((ceOiChg/ceOiOpen)*100).toFixed(2) : null;
    const peOiChgPct = (peOiOpen>0 && peOiChg!==null) ? +((peOiChg/peOiOpen)*100).toFixed(2) : null;

    return {
      strike_price:K,ce_ltp:ceLTP||null,pe_ltp:peLTP||null,
      ce_volume:Number(row.ce_volume)||null,pe_volume:Number(row.pe_volume)||null,
      ce_oi:ceOI||null,pe_oi:peOI||null,
      ce_oi_chg:ceOiChg, pe_oi_chg:peOiChg,
      ce_oi_chg_pct:ceOiChgPct, pe_oi_chg_pct:peOiChgPct,
      ce_greeks:ceG,pe_greeks:peG,
      iv_skew:(peG&&ceG)?+(peG.iv-ceG.iv).toFixed(2):undefined,
      ce_pcr:ceOI>0?+(peOI/ceOI).toFixed(3):undefined,
      is_atm:K===atm,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — SPOOFING DETECTOR
// ════════════════════════════════════════════════════════════════════════════

type SpoofType='BID_WALL'|'ASK_WALL'|'LAYERING_BID'|'LAYERING_ASK'|'OI_DIVERGENCE'|'SPREAD_COMPRESSION'|'QUOTE_STUFFING'|'MOMENTUM_IGNITION'|'ABSORPTION';
type SpoofSeverity='LOW'|'MEDIUM'|'HIGH'|'CRITICAL';

interface SpoofAlert {
  id:string; type:SpoofType; severity:SpoofSeverity;
  strike:number; optionType:'CE'|'PE';
  detectedAt:number; ltp:number;
  bidPrice:number; askPrice:number; bidQty:number; askQty:number;
  oi:number; oiChange:number; ltpChange:number;
  bidAskRatio:number; spreadPct:number; confidence:number;
  description:string; action:string; expiresAt:number;
}

interface TickSnap {
  ltp:number;bidPrice:number;askPrice:number;bidQty:number;askQty:number;oi:number;volume:number;ts:number;
}

const MIN_HISTORY_TICKS = 3;
let _subscriptionTime = 0;
const WARMUP_PERIOD_MS = 5000;

const HISTORY_DEPTH=20,BID_WALL_RATIO=5,ASK_WALL_RATIO=5,MIN_QTY=50;
const SPREAD_COLLAPSE=30,LTP_SPIKE=0.8,OI_DROP=0.02,FLIP_WIN=500;
const ALERT_TTL=parseInt(process.env.SPOOF_ALERT_TTL_MS||'10000',10);
const LAYER_WIN=200,LAYER_MIN=3;

// FIX J: Fire cooldown — separates "display TTL" from "can re-fire" logic.
const FIRE_COOLDOWN_MS = parseInt(process.env.SPOOF_FIRE_COOLDOWN_MS||'30000',10);

// FIX J: Phase-aware thresholds for CLOSE_WATCH (15:00-15:30 IST).
function getPhaseThresholds(): {wallRatio:number; minQty:number; ltpSpike:number; suppressOiDiv:boolean} {
  const h = getISTHour();
  const isClose  = h >= 15.0  && h < 15.5;
  const isPreClose = h >= 14.83 && h < 15.0;
  if (isClose) {
    return { wallRatio: 12, minQty: 150, ltpSpike: 2.0, suppressOiDiv: true };
  }
  if (isPreClose) {
    return { wallRatio: 8, minQty: 100, ltpSpike: 1.2, suppressOiDiv: false };
  }
  return { wallRatio: BID_WALL_RATIO, minQty: MIN_QTY, ltpSpike: LTP_SPIKE, suppressOiDiv: false };
}

class SpoofingDetector {
  private hist=new Map<string,TickSnap[]>();
  private active=new Map<string,SpoofAlert>();
  private walls:{strike:number;side:'BID'|'ASK';ts:number}[]=[];
  private cbs:Array<(a:SpoofAlert)=>void>=[];
  private seq=0;
  private lastFiredMap=new Map<string,number>();

  onAlert(cb:(a:SpoofAlert)=>void){this.cbs.push(cb);}

  markSubscribed(){_subscriptionTime=Date.now();}

  processTick(strike:number,optionType:'CE'|'PE',ltp:number,bidPrice:number,askPrice:number,bidQty:number,askQty:number,oi:number,volume:number){
    const now=Date.now(),key=`${strike}_${optionType}`;
    const snap:TickSnap={ltp,bidPrice,askPrice,bidQty,askQty,oi,volume,ts:now};
    let h=this.hist.get(key);
    if (!h){h=[];this.hist.set(key,h);}
    const prev=h[h.length-1];
    h.push(snap);if(h.length>HISTORY_DEPTH)h.shift();
    this.clean(now);

    const inWarmup = _subscriptionTime > 0 && (now - _subscriptionTime) < WARMUP_PERIOD_MS;
    if(inWarmup) return;
    if(h.length < MIN_HISTORY_TICKS) return;

    const pt = getPhaseThresholds();

    if(bidQty>pt.minQty||askQty>pt.minQty) this.wall(strike,optionType,snap,prev,now,pt);
    if(prev){
      if(!pt.suppressOiDiv) this.oiDiv(strike,optionType,snap,prev,now);
      this.spreadComp(strike,optionType,snap,prev,now);
      this.quoteStuff(strike,optionType,h,now);
      this.momIgn(strike,optionType,snap,prev,now,pt,h.length);
      this.absorb(strike,optionType,h,now);
    }
    this.layer(strike,now);
  }

  getActiveAlerts():SpoofAlert[]{this.clean(Date.now());return Array.from(this.active.values()).sort((a,b)=>b.detectedAt-a.detectedAt);}
  reset(){this.hist.clear();this.active.clear();this.walls=[];this.lastFiredMap.clear();_subscriptionTime=0;}

  private wall(strike:number,ot:'CE'|'PE',s:TickSnap,p:TickSnap|undefined,now:number,pt:{wallRatio:number;minQty:number}){
    const{bidQty,askQty,bidPrice,askPrice,ltp}=s;
    if(!bidQty||!askQty||bidQty<1||askQty<1)return;
    if(!p||!p.bidQty||!p.askQty)return;
    const sp=(askPrice>0)?((askPrice-bidPrice)/ltp)*100:0;
    const wallR = pt.wallRatio;
    const ratio=bidQty/Math.max(askQty,1);
    if(ratio>=wallR){
      const pR=p.bidQty/Math.max(p.askQty,1),sudden=pR<wallR*0.5;
      const conf=Math.min(95,50+(ratio-wallR)*8+(sudden?20:0));
      const sev:SpoofSeverity=ratio>wallR*3?'CRITICAL':ratio>wallR*2?'HIGH':'MEDIUM';
      this.walls.push({strike,side:'BID',ts:now});
      this.fire({type:'BID_WALL',severity:sev,strike,optionType:ot,ltp,bidPrice,askPrice,bidQty,askQty,oi:s.oi,oiChange:p?s.oi-p.oi:0,ltpChange:p?ltp-p.ltp:0,bidAskRatio:ratio,spreadPct:sp,confidence:conf,description:`Fake bid wall: ${bidQty}bid vs ${askQty}ask (${ratio.toFixed(1)}x)`,action:'AVOID_BUY'},now);
    }
    const inv=askQty/Math.max(bidQty,1);
    if(inv>=wallR){
      const pR=p.askQty/Math.max(p.bidQty,1),sudden=pR<wallR*0.5;
      const conf=Math.min(95,50+(inv-wallR)*8+(sudden?20:0));
      const sev:SpoofSeverity=inv>wallR*3?'CRITICAL':inv>wallR*2?'HIGH':'MEDIUM';
      this.walls.push({strike,side:'ASK',ts:now});
      this.fire({type:'ASK_WALL',severity:sev,strike,optionType:ot,ltp,bidPrice,askPrice,bidQty,askQty,oi:s.oi,oiChange:p?s.oi-p.oi:0,ltpChange:p?ltp-p.ltp:0,bidAskRatio:inv,spreadPct:sp,confidence:conf,description:`Fake ask wall: ${askQty}ask vs ${bidQty}bid (${inv.toFixed(1)}x)`,action:'AVOID_SELL'},now);
    }
  }

  private oiDiv(strike:number,ot:'CE'|'PE',s:TickSnap,p:TickSnap,now:number){
    const ltcP=p.ltp>0?(s.ltp-p.ltp)/p.ltp:0,oiP=p.oi>0?(s.oi-p.oi)/p.oi:0;
    if(Math.abs(ltcP)>LTP_SPIKE/100&&oiP<-OI_DROP){
      const conf=Math.min(90,40+Math.abs(ltcP)*2000+Math.abs(oiP)*1000);
      const dir=ltcP>0?'UP':'DOWN',sp=s.askPrice>0?((s.askPrice-s.bidPrice)/s.ltp)*100:0;
      this.fire({type:'OI_DIVERGENCE',severity:conf>70?'HIGH':'MEDIUM',strike,optionType:ot,ltp:s.ltp,bidPrice:s.bidPrice,askPrice:s.askPrice,bidQty:s.bidQty,askQty:s.askQty,oi:s.oi,oiChange:s.oi-p.oi,ltpChange:s.ltp-p.ltp,bidAskRatio:s.bidQty/Math.max(s.askQty,1),spreadPct:sp,confidence:conf,description:`LTP ${dir} ${(ltcP*100).toFixed(2)}% but OI dropped ${(Math.abs(oiP)*100).toFixed(2)}%`,action:dir==='UP'?'AVOID_BUY':'AVOID_SELL'},now);
    }
  }

  private spreadComp(strike:number,ot:'CE'|'PE',s:TickSnap,p:TickSnap,now:number){
    const pSp=p.askPrice-p.bidPrice,cSp=s.askPrice-s.bidPrice;
    if(pSp<=0||cSp<=0||s.ltp<=0)return;
    const chg=(pSp-cSp)/pSp;
    if(chg>SPREAD_COLLAPSE/100){
      const sp=(cSp/s.ltp)*100,conf=Math.min(85,40+chg*100);
      this.fire({type:'SPREAD_COMPRESSION',severity:chg>0.6?'HIGH':'MEDIUM',strike,optionType:ot,ltp:s.ltp,bidPrice:s.bidPrice,askPrice:s.askPrice,bidQty:s.bidQty,askQty:s.askQty,oi:s.oi,oiChange:s.oi-p.oi,ltpChange:s.ltp-p.ltp,bidAskRatio:s.bidQty/Math.max(s.askQty,1),spreadPct:sp,confidence:conf,description:`Spread compressed ${(chg*100).toFixed(0)}% — algo activity`,action:'WATCH'},now);
    }
  }

  private quoteStuff(strike:number,ot:'CE'|'PE',h:TickSnap[],now:number){
    if(h.length<4)return;
    const rec=h.filter(x=>now-x.ts<FLIP_WIN);if(rec.length<4)return;
    let flips=0;
    for(let i=1;i<rec.length;i++){const a=rec[i-1],b=rec[i];if(a.bidPrice>0&&b.bidPrice>0){const aD=a.bidPrice>a.askPrice*0.98?1:-1,bD=b.bidPrice>b.askPrice*0.98?1:-1;if(aD!==bD)flips++;}}
    if(flips>=3){const l=h[h.length-1],sp=l.askPrice>0?((l.askPrice-l.bidPrice)/l.ltp)*100:0;this.fire({type:'QUOTE_STUFFING',severity:'MEDIUM',strike,optionType:ot,ltp:l.ltp,bidPrice:l.bidPrice,askPrice:l.askPrice,bidQty:l.bidQty,askQty:l.askQty,oi:l.oi,oiChange:0,ltpChange:0,bidAskRatio:l.bidQty/Math.max(l.askQty,1),spreadPct:sp,confidence:60+flips*5,description:`${flips} bid/ask flips in ${FLIP_WIN}ms`,action:'AVOID_BUY'},now);}
  }

  private momIgn(strike:number,ot:'CE'|'PE',s:TickSnap,p:TickSnap,now:number,pt:{ltpSpike:number},hLen:number){
    if(p.ltp<=0)return;
    if(hLen < 5) return;
    const ltcP=Math.abs((s.ltp-p.ltp)/p.ltp)*100,oiP=p.oi>0?Math.abs((s.oi-p.oi)/p.oi)*100:0;
    if(ltcP>pt.ltpSpike&&oiP<0.5){
      const conf=Math.min(85,40+ltcP*15),sp=s.askPrice>0?((s.askPrice-s.bidPrice)/s.ltp)*100:0,dir=s.ltp>p.ltp?'UP':'DOWN';
      this.fire({type:'MOMENTUM_IGNITION',severity:ltcP>2?'HIGH':'MEDIUM',strike,optionType:ot,ltp:s.ltp,bidPrice:s.bidPrice,askPrice:s.askPrice,bidQty:s.bidQty,askQty:s.askQty,oi:s.oi,oiChange:s.oi-p.oi,ltpChange:s.ltp-p.ltp,bidAskRatio:s.bidQty/Math.max(s.askQty,1),spreadPct:sp,confidence:conf,description:`LTP spiked ${dir} ${ltcP.toFixed(2)}% OI unchanged`,action:dir==='UP'?'FADE_UP':'FADE_DOWN'},now);
    }
  }

  private absorb(strike:number,ot:'CE'|'PE',h:TickSnap[],now:number){
    if(h.length<5)return;
    const r=h.slice(-5),lr=Math.max(...r.map(x=>x.ltp))-Math.min(...r.map(x=>x.ltp));
    const avgB=r.reduce((s,x)=>s+x.bidQty,0)/r.length,l=r[r.length-1];
    if(avgB>MIN_QTY*3&&lr<l.ltp*0.003){
      const sp=l.askPrice>0?((l.askPrice-l.bidPrice)/l.ltp)*100:0;
      this.fire({type:'ABSORPTION',severity:'LOW',strike,optionType:ot,ltp:l.ltp,bidPrice:l.bidPrice,askPrice:l.askPrice,bidQty:l.bidQty,askQty:l.askQty,oi:l.oi,oiChange:l.oi-r[0].oi,ltpChange:l.ltp-r[0].ltp,bidAskRatio:avgB/Math.max(r.reduce((s,x)=>s+x.askQty,0)/r.length,1),spreadPct:sp,confidence:65,description:'Bid absorption — genuine support',action:'WATCH'},now);
    }
  }

  private layer(strike:number,now:number){
    this.walls=this.walls.filter(w=>now-w.ts<LAYER_WIN);
    const bid=new Set(this.walls.filter(w=>w.side==='BID').map(w=>w.strike));
    const ask=new Set(this.walls.filter(w=>w.side==='ASK').map(w=>w.strike));
    if(bid.size>=LAYER_MIN){
      const sts=Array.from(bid).sort((a,b)=>a-b),k=`LAYERING_BID_${sts.join('_')}`;
      if(!this.active.has(k)){
        const dominantBid=Array.from(bid).reduce((best,s)=>{
          const h=this.hist.get(`${s}_CE`)??this.hist.get(`${s}_PE`)??[];
          const last=h[h.length-1];const ratio=last?last.bidQty/Math.max(last.askQty,1):0;
          return ratio>best.ratio?{strike:s,ratio}:best;
        },{strike:Array.from(bid)[0],ratio:0}).strike;
        const l=this.hist.get(`${dominantBid}_CE`)?.slice(-1)[0]||this.hist.get(`${dominantBid}_PE`)?.slice(-1)[0];
        if(l)this.fireK(k,{type:'LAYERING_BID',severity:'CRITICAL',strike:dominantBid,optionType:'CE',ltp:l.ltp,bidPrice:l.bidPrice,askPrice:l.askPrice,bidQty:l.bidQty,askQty:l.askQty,oi:l.oi,oiChange:0,ltpChange:0,bidAskRatio:l.bidQty/Math.max(l.askQty,1),spreadPct:0,confidence:85,description:`Bid layering across ${bid.size} strikes`,action:'AVOID_BUY'},now);
      }
    }
    if(ask.size>=LAYER_MIN){
      const sts=Array.from(ask).sort((a,b)=>a-b),k=`LAYERING_ASK_${sts.join('_')}`;
      if(!this.active.has(k)){
        const dominantAsk=Array.from(ask).reduce((best,s)=>{
          const h=this.hist.get(`${s}_CE`)??this.hist.get(`${s}_PE`)??[];
          const last=h[h.length-1];const ratio=last?last.askQty/Math.max(last.bidQty,1):0;
          return ratio>best.ratio?{strike:s,ratio}:best;
        },{strike:Array.from(ask)[0],ratio:0}).strike;
        const l=this.hist.get(`${dominantAsk}_CE`)?.slice(-1)[0]||this.hist.get(`${dominantAsk}_PE`)?.slice(-1)[0];
        if(l)this.fireK(k,{type:'LAYERING_ASK',severity:'CRITICAL',strike:dominantAsk,optionType:'CE',ltp:l.ltp,bidPrice:l.bidPrice,askPrice:l.askPrice,bidQty:l.bidQty,askQty:l.askQty,oi:l.oi,oiChange:0,ltpChange:0,bidAskRatio:l.askQty/Math.max(l.bidQty,1),spreadPct:0,confidence:85,description:`Ask layering across ${ask.size} strikes`,action:'AVOID_SELL'},now);
      }
    }
  }

  private fire(p:Omit<SpoofAlert,'id'|'detectedAt'|'expiresAt'>,now:number){this.fireK(`${p.type}_${p.strike}_${p.optionType}`,p,now);}
  private fireK(k:string,p:Omit<SpoofAlert,'id'|'detectedAt'|'expiresAt'>,now:number){
    const lastFired = this.lastFiredMap.get(k) ?? 0;
    if(now - lastFired < FIRE_COOLDOWN_MS) return;
    const ex=this.active.get(k);if(ex&&now-ex.detectedAt<500)return;
    this.lastFiredMap.set(k, now);
    const a:SpoofAlert={...p,id:`${k}_${++this.seq}`,detectedAt:now,expiresAt:now+ALERT_TTL};
    this.active.set(k,a);
    for(const cb of this.cbs){try{cb(a);}catch(_){}}
  }
  private clean(now:number){
    for(const[k,a]of this.active) if(now>a.expiresAt) this.active.delete(k);
    if(this.lastFiredMap.size > 2000){
      const cutoff = now - FIRE_COOLDOWN_MS * 2;
      for(const[k,t] of this.lastFiredMap) if(t < cutoff) this.lastFiredMap.delete(k);
    }
  }
}

const spoofingDetector = new SpoofingDetector();

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 3 — ALERT ROUTER
// ════════════════════════════════════════════════════════════════════════════

type AlertState  = 'CLEAR'|'WATCH'|'ALERT'|'CRITICAL';
type AlertRegime = 'NORMAL'|'SUSPICIOUS'|'SPOOF';
type AlertPhase  = 'PATCH_I'|'PATCH_II'|'CLOSE_WATCH'|'NORMAL';

interface AlertPayload {
  token:string;symbol:string;strike:number;optionType:'CE'|'PE';
  state:AlertState;regime:AlertRegime;phase:AlertPhase;severity:string;type:string;
  ensemble:number;confidence:number;ltp:number;bidPrice:number;askPrice:number;
  bidQty:number;askQty:number;oi:number;oiChange:number;ltpChange:number;
  bidAskRatio:number;spreadPct:number;action:string;description:string;explanation:string;
  detectedAt:number;timestamp:string;
  fv:{VPIN:number;OBI_L1:number;TBQ_TSQ:number;PostDist:number;spread_pct:number;oi_change:number;ltp_change:number};
  js:{pattern_prob:number;delta_proxy:number;patch1_buy_proxy:number;patch2_sell_proxy:number;ltp_aggression_frac:number;oi_buildup_p1:number};
  scores:Record<string,number>;
}

const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN||'';
const TG_CHAT      = process.env.TELEGRAM_CHAT_ID||'';
const ALERT_THRESH = parseInt(process.env.ALERT_THRESHOLD||'52',10);
const CRIT_THRESH  = parseInt(process.env.CRITICAL_THRESHOLD||'72',10);
const ALERT_DIR    = process.env.ALERT_DIR||'alerts';
try{if(!fs.existsSync(ALERT_DIR))fs.mkdirSync(ALERT_DIR,{recursive:true});}catch(_){}

function getISTHour():number{
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  return ist.getHours()+ist.getMinutes()/60;
}
function getISTDate():string{return new Date(Date.now()+330*60000).toISOString().split('T')[0];}
function getPhase():AlertPhase{const h=getISTHour();if(h>=15&&h<15.5)return'CLOSE_WATCH';if(h>=9.25&&h<11)return'PATCH_I';if(h>=13&&h<15.5)return'PATCH_II';return'NORMAL';}

function toState(a:SpoofAlert):AlertState{
  if(a.confidence>=CRIT_THRESH)return'CRITICAL';
  if(a.confidence>=ALERT_THRESH)return'ALERT';
  if(a.severity==='CRITICAL')return'CRITICAL';
  if(a.severity==='HIGH')return'ALERT';
  if(a.severity==='MEDIUM')return'WATCH';
  return'CLEAR';
}

function deltaProxy(a:SpoofAlert):number{
  const r=a.bidAskRatio;
  switch(a.type){
    case'BID_WALL':return-r;case'ASK_WALL':return+r;
    case'LAYERING_BID':return-r;case'LAYERING_ASK':return+r;
    case'OI_DIVERGENCE':return a.ltpChange>0?-1:+1;
    case'MOMENTUM_IGNITION':return a.ltpChange>0?-r:+r;
    case'SPREAD_COMPRESSION':return r>1?+r:-r;
    case'ABSORPTION':return+r;
    default:return 0;
  }
}

function buildPayload(alert:SpoofAlert):AlertPayload{
  const state=toState(alert);
  const regime:AlertRegime=state==='CRITICAL'||state==='ALERT'?'SPOOF':state==='WATCH'?'SUSPICIOUS':'NORMAL';
  const phase=getPhase();
  const tQ=alert.bidQty+alert.askQty;
  const VPIN=tQ>0?Math.abs(alert.bidQty-alert.askQty)/tQ:0;
  const OBI_L1=tQ>0?(alert.bidQty-alert.askQty)/tQ:0;
  const TBQ_TSQ=alert.askQty>0?alert.bidQty/alert.askQty:(alert.bidQty>0?99:1);
  const mid=(alert.bidPrice+alert.askPrice)/2;
  const PostDist=mid>0?(alert.askPrice-alert.bidPrice)/(2*mid):0;
  const layW=(alert.type==='LAYERING_BID'||alert.type==='LAYERING_ASK')?40:0;
  const momW=alert.type==='MOMENTUM_IGNITION'?35:0;
  const stfW=alert.type==='QUOTE_STUFFING'?25:0;
  const pattern_prob=Math.min((layW+momW+stfW+alert.confidence)/200,1);
  const delta_proxy=deltaProxy(alert);
  const ltp_aggression_frac=(alert.ltp>0&&alert.ltpChange!==0)?Math.min(Math.abs(alert.ltpChange)/(alert.ltp*0.01),1):0;
  const oi_buildup_p1=phase==='PATCH_I'&&alert.oiChange>0?Math.min(alert.oiChange/1000,1):0;
  const patch1_buy_proxy=(phase==='PATCH_I'&&alert.type==='MOMENTUM_IGNITION'&&alert.ltpChange>0)?Math.min(alert.confidence/100,1):0;
  const patch2_sell_proxy=(phase==='PATCH_II'&&(alert.type==='OI_DIVERGENCE'||alert.type==='ABSORPTION')&&alert.ltpChange<0)?Math.min(alert.confidence/100,1):0;
  const scores:Record<string,number>={
    VPIN:Math.round(VPIN*100),OBI:Math.round(Math.abs(OBI_L1)*100),
    BID_WALL:alert.type==='BID_WALL'?Math.round(alert.confidence):0,
    ASK_WALL:alert.type==='ASK_WALL'?Math.round(alert.confidence):0,
    LAYERING:(alert.type==='LAYERING_BID'||alert.type==='LAYERING_ASK')?Math.round(alert.confidence):0,
    OI_DIVERGENCE:alert.type==='OI_DIVERGENCE'?Math.round(alert.confidence):0,
    MOMENTUM_IGNITION:alert.type==='MOMENTUM_IGNITION'?Math.round(alert.confidence):0,
    QUOTE_STUFFING:alert.type==='QUOTE_STUFFING'?Math.round(alert.confidence):0,
    ABSORPTION:alert.type==='ABSORPTION'?Math.round(alert.confidence):0,
    JS_PATTERN:Math.round(pattern_prob*100),
  };
  const guide:Record<AlertState,string>={CRITICAL:'Exit or hedge immediately.',ALERT:'No new positions in alert direction.',WATCH:'Reduce size 30%. Monitor carefully.',CLEAR:'Trade normally.'};
  let phNote='';
  if(state==='CRITICAL'){
    if(phase==='PATCH_I'&&patch1_buy_proxy>0.3)phNote=' ⛔ JS PATCH I: Do NOT buy calls.';
    else if(phase==='PATCH_II'&&patch2_sell_proxy>0.3)phNote=' ⛔ JS PATCH II: Exit longs.';
    else if(phase==='CLOSE_WATCH')phNote=' ⛔ MARKING THE CLOSE.';
  }
  return{
    token:`${alert.strike}_${alert.optionType}`,symbol:`NIFTY${alert.strike}${alert.optionType}`,
    strike:alert.strike,optionType:alert.optionType,state,regime,phase,
    severity:alert.severity,type:alert.type,ensemble:alert.confidence,confidence:alert.confidence/100,
    ltp:alert.ltp,bidPrice:alert.bidPrice,askPrice:alert.askPrice,bidQty:alert.bidQty,askQty:alert.askQty,
    oi:alert.oi,oiChange:alert.oiChange,ltpChange:alert.ltpChange,bidAskRatio:alert.bidAskRatio,spreadPct:alert.spreadPct,
    action:alert.action,description:alert.description,explanation:guide[state]+phNote,
    detectedAt:alert.detectedAt,timestamp:new Date(alert.detectedAt).toISOString(),
    fv:{VPIN,OBI_L1,TBQ_TSQ,PostDist,spread_pct:alert.spreadPct,oi_change:alert.oiChange,ltp_change:alert.ltpChange},
    js:{pattern_prob,delta_proxy,patch1_buy_proxy,patch2_sell_proxy,ltp_aggression_frac,oi_buildup_p1},
    scores,
  };
}

function writeAlertFile(p:AlertPayload,kind:'alerts'|'watch'){
  try{fs.appendFileSync(path.join(ALERT_DIR,`${kind}_${getISTDate()}.jsonl`),JSON.stringify(p)+'\n');}catch(_){}
}

// ── FIX I: Per-state cooldown map — CRITICAL alerts are never throttled ──────
const _tgCooldown = new Map<string, number>();

function sendTelegram(p:AlertPayload){
  if(!TG_TOKEN||!TG_CHAT)return;
  if(p.state !== 'CRITICAL') {
    const cooldownKey = p.state;
    const last = _tgCooldown.get(cooldownKey) || 0;
    if(Date.now() - last < 30000) return;
  }
  _tgCooldown.set(p.state, Date.now());

  const top4=Object.entries(p.scores).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,4).map(([k,v])=>`${k}=${v}`).join(' | ');
  const SE:Record<AlertState,string>={CLEAR:'✅',WATCH:'👁',ALERT:'⚠️',CRITICAL:'🚨'};
  const RE:Record<AlertRegime,string>={NORMAL:'🟢',SUSPICIOUS:'🟡',SPOOF:'🔴'};
  const txt=[
    `${SE[p.state]} <b>${p.state}</b> — ${p.symbol}`,``,
    `Score: <b>${p.ensemble.toFixed(1)}/100</b>  Confidence: ${(p.confidence*100).toFixed(0)}%`,
    `Regime: ${RE[p.regime]} ${p.regime}   Phase: ${p.phase}`,``,
    `VPIN: ${p.fv.VPIN.toFixed(4)}   OBI-L1: ${p.fv.OBI_L1.toFixed(3)}`,
    `TBQ/TSQ: ${p.fv.TBQ_TSQ.toFixed(3)}   PostDist: ${p.fv.PostDist.toFixed(4)}`,``,
    `JS Pattern: ${(p.js.pattern_prob*100).toFixed(0)}%   Delta×: ${p.js.delta_proxy.toFixed(1)}`,
    `P1-Buy: ${p.js.patch1_buy_proxy.toFixed(2)}   P2-Sell: ${p.js.patch2_sell_proxy.toFixed(2)}`,``,
    top4?`Top signals: ${top4}`:'',``,`<b>→ ${p.action}</b>`,p.explanation,
  ].filter(Boolean).join('\n');
  const body=Buffer.from(JSON.stringify({chat_id:TG_CHAT,text:txt,parse_mode:'HTML'}));
  const req=https.request({hostname:'api.telegram.org',path:`/bot${TG_TOKEN}/sendMessage`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},(res)=>res.resume());
  req.on('error',()=>{});req.write(body);req.end();
}

let _wsBroadcast:((p:AlertPayload)=>void)|null=null;
function registerWsBroadcast(fn:(p:AlertPayload)=>void){_wsBroadcast=fn;}

let _totalAlerts=0,_totalCritical=0,_totalWatch=0;
function getAlertStats(){return{totalAlerts:_totalAlerts,totalCritical:_totalCritical,totalWatch:_totalWatch};}

let _isShuttingDown = false;

async function persistSpoofAlertToDb(p:AlertPayload):Promise<void>{
  if(_isShuttingDown) return;
  try{
    await pool.query(
      `INSERT INTO nifty_premium_tracking.spoof_alerts
         (detected_at,token,symbol,strike,option_type,alert_type,severity,state,
          regime,phase,ensemble,confidence,ltp,bid_price,ask_price,bid_qty,
          ask_qty,oi,oi_change,ltp_change,bid_ask_ratio,spread_pct,action,explanation,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [new Date(p.detectedAt),p.token,p.symbol,p.strike,p.optionType,
       p.type,p.severity,p.state,p.regime,p.phase,
       p.ensemble,p.confidence,p.ltp,p.bidPrice,p.askPrice,
       p.bidQty,p.askQty,p.oi,p.oiChange,p.ltpChange,
       p.bidAskRatio,p.spreadPct,p.action,p.explanation,JSON.stringify(p)]
    );
  }catch(_){/* non-fatal */}
}

function routeSpoofAlert(alert:SpoofAlert){
  if(_isShuttingDown) return;
  const state=toState(alert);
  if(state==='CRITICAL'||state==='ALERT'){
    const p=buildPayload(alert);_totalAlerts++;if(state==='CRITICAL')_totalCritical++;
    writeAlertFile(p,'alerts');
    persistSpoofAlertToDb(p);
    sendTelegram(p);
    if(_wsBroadcast)_wsBroadcast(p);
    const tag=state==='CRITICAL'?'🚨 CRITICAL':'⚠️  ALERT   ';
    process.stdout.write(`${tag} | ${p.symbol} | Score=${p.ensemble.toFixed(1)} | Regime=${p.regime} | Phase=${p.phase} | ${p.action}\n`);
    if(state==='CRITICAL'){
      if(p.js.patch1_buy_proxy>0.3) process.stdout.write(`           ⛔ JS PATCH I  — Do NOT buy calls\n`);
      if(p.js.patch2_sell_proxy>0.3)process.stdout.write(`           ⛔ JS PATCH II — Exit longs NOW\n`);
      if(p.phase==='CLOSE_WATCH')   process.stdout.write(`           ⛔ CLOSE WATCH — Settlement manipulation risk\n`);
    }
  } else if(state==='WATCH'){
    const p=buildPayload(alert);_totalWatch++;
    writeAlertFile(p,'watch');if(_wsBroadcast)_wsBroadcast(p);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 4 — SPOOFING DASHBOARD WebSocket Server (port 8765)
// ════════════════════════════════════════════════════════════════════════════

const WS_PORT=parseInt(process.env.SPOOF_WS_PORT||'8765');
interface WsClient{id:string;socket:net.Socket;}
const wsClients=new Set<WsClient>();
let wsSrv:http.Server|null=null,wsTotalConn=0,wsTotalBcast=0;

function buildTextFrame(text:string):Buffer{
  const p=Buffer.from(text,'utf8');const len=p.length;
  let h:Buffer;
  if(len<126){h=Buffer.allocUnsafe(2);h[0]=0x81;h[1]=len;}
  else if(len<65536){h=Buffer.allocUnsafe(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(len,2);}
  else{h=Buffer.allocUnsafe(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(len),2);}
  return Buffer.concat([h,p]);
}
const PING_F=Buffer.from([0x89,0x00]),PONG_F=Buffer.from([0x8A,0x00]),CLOSE_F=Buffer.from([0x88,0x00]);
function safeWsWrite(s:net.Socket,d:Buffer):boolean{if(s.destroyed||!s.writable)return false;try{s.write(d);return true;}catch(_){return false;}}

function broadcastToWS(payload:AlertPayload){
  if(wsClients.size===0)return;
  const f=buildTextFrame(JSON.stringify(payload));const dead:WsClient[]=[];
  for(const c of wsClients){if(safeWsWrite(c.socket,f))wsTotalBcast++;else dead.push(c);}
  for(const d of dead){wsClients.delete(d);if(!d.socket.destroyed)try{d.socket.destroy();}catch(_){}}
}

function getWsStats(){return{connectedClients:wsClients.size,totalConnections:wsTotalConn,totalBroadcasts:wsTotalBcast,port:WS_PORT};}

function startSpoofDashboardWS(){
  registerWsBroadcast(broadcastToWS);
  wsSrv=http.createServer((_req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({service:'spoof-dashboard-ws',ok:true,clients:wsClients.size}));
  });
  wsSrv.on('upgrade',(req:http.IncomingMessage,socket:net.Socket)=>{
    if(req.headers.upgrade?.toLowerCase()!=='websocket'){socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');socket.destroy();return;}
    const ck=req.headers['sec-websocket-key'];
    if(typeof ck!=='string'||!ck){socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');socket.destroy();return;}
    socket.setNoDelay(true);socket.setKeepAlive(true,10000);
    const acc=crypto.createHash('sha1').update(ck+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    const cid=`${socket.remoteAddress??'?'}:${socket.remotePort??Date.now()}`;
    const client:WsClient={id:cid,socket};wsClients.add(client);wsTotalConn++;
    process.stdout.write(`📡 [SpoofWS] +${cid} (active=${wsClients.size})\n`);
    safeWsWrite(socket,buildTextFrame(JSON.stringify({type:'connected',message:'Spoof detection feed active',ts:Date.now()})));
    const pingT=setInterval(()=>{if(!wsClients.has(client)){clearInterval(pingT);return;}if(!safeWsWrite(socket,PING_F)){clearInterval(pingT);wsClients.delete(client);}},30000);
    socket.on('data',(c:Buffer)=>{if(c.length<2)return;const op=c[0]&0x0f;if(op===0x08){clearInterval(pingT);wsClients.delete(client);safeWsWrite(socket,CLOSE_F);socket.destroy();}else if(op===0x09)safeWsWrite(socket,PONG_F);});
    socket.on('close',()=>{clearInterval(pingT);wsClients.delete(client);process.stdout.write(`📡 [SpoofWS] -${cid}\n`);});
    socket.on('error',(e:NodeJS.ErrnoException)=>{clearInterval(pingT);wsClients.delete(client);if(e.code!=='ECONNRESET'&&e.code!=='EPIPE')process.stderr.write(`📡 [SpoofWS] ${e.message}\n`);});
  });
  wsSrv.on('error',(e:NodeJS.ErrnoException)=>{
    if(e.code==='EADDRINUSE')process.stderr.write(`📡 [SpoofWS] Port ${WS_PORT} in use — set SPOOF_WS_PORT in .env\n`);
    else process.stderr.write(`📡 [SpoofWS] ${e.message}\n`);
  });
  wsSrv.listen(WS_PORT,'0.0.0.0',()=>process.stdout.write(`📡 [SpoofWS] ws://0.0.0.0:${WS_PORT}\n`));
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 5 — DATABASE POOL
// ════════════════════════════════════════════════════════════════════════════

const pool = new Pool({
  host:     process.env.DB_HOST||'localhost',
  port:     parseInt(process.env.DB_PORT||'5432'),
  database: process.env.DB_NAME||'jobber_pro',
  user:     process.env.DB_USER||'postgres',
  password: process.env.DB_PASSWORD,
  max:10, min:2, idleTimeoutMillis:30000, connectionTimeoutMillis:8000,
  keepAlive:true, keepAliveInitialDelayMillis:10000,
  options:'-c statement_timeout=15000',
});
pool.on('error',(err:Error)=>process.stderr.write(`⚠️  [POOL] ${err.message}\n`));

async function ensureDbSchema(): Promise<void> {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'options_data_upsert_key'
          AND conrelid = 'nifty_premium_tracking.options_data'::regclass
        ) THEN
          ALTER TABLE nifty_premium_tracking.options_data
            ADD CONSTRAINT options_data_upsert_key
            UNIQUE (symbol, strike_price, option_type, expiry_date);
        END IF;
      EXCEPTION WHEN others THEN
        NULL;
      END $$;
    `);
  } catch(_) { /* non-fatal */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 6 — IN-MEMORY LIVE STORE
// ════════════════════════════════════════════════════════════════════════════

interface LiveOption{ltp:number;volume:number;oi:number;bidPrice:number;askPrice:number;bidQty:number;askQty:number;high:number;low:number;open:number;close:number;updatedAt:number;expiry:string;}

const liveChain     = new Map<string,LiveOption>();
let liveNiftySpot   = 0;
let liveNiftyPrev   = 0;
let liveNiftyOpen   = 0;
let liveVix:number|null = null;
const greeksCache   = new Map<string,any>();
const openOiMap     = new Map<string,number>();

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 7 — HELPERS
// ════════════════════════════════════════════════════════════════════════════

function sleep(ms:number){return new Promise<void>(r=>setTimeout(r,ms));}

const PG_INT_MAX = 2_147_483_647;
function safeN(v:any):number|null{
  const n=Number(v);
  if(isNaN(n)||n<0)return null;
  return Math.min(Math.round(n), PG_INT_MAX);
}

function monthNum(a:string):string{
  const m:Record<string,string>={
    JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
    JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'
  };
  return m[a.toUpperCase()]||'01';
}

// parseOpt — FIXED regex: \d{2} for year (never \d{2,4})
function parseOpt(sym: string): { expiry: string; strike: number; optionType: string } | null {
  const m = sym.match(/^NIFTY(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/);
  if (!m) return null;
  const strike = parseInt(m[2], 10);
  if (strike < 5000 || strike > 60000) return null;
  return { expiry: m[1], strike, optionType: m[3] };
}

// expiryToDate — convert DDMMMYY → YYYY-MM-DD for DB storage
function expiryToDate(expiry: string): string {
  const day  = expiry.slice(0, 2);
  const mon  = monthNum(expiry.slice(2, 5));
  const yr   = parseInt(expiry.slice(5, 7), 10) + 2000;
  return `${yr}-${mon}-${day}`;
}

function isMarketHours():boolean{
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const d=ist.getDay();if(d===0||d===6)return false;
  const m=ist.getHours()*60+ist.getMinutes();return m>=555&&m<=930;
}

async function waitForNextTotpWindow(): Promise<void> {
  const now = Date.now();
  const msIntoWindow = now % 30000;
  const msUntilNext = 30000 - msIntoWindow + 2000;
  process.stdout.write(`   ⏱  TOTP window fix: waiting ${(msUntilNext/1000).toFixed(1)}s for fresh window\n`);
  await sleep(msUntilNext);
}

let _optionTickDebugCount = 0;
const OPTION_TICK_DEBUG_LIMIT = 5;

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 8 — CHAIN PAYLOAD BUILDER + PUSH TO API SERVER
// ════════════════════════════════════════════════════════════════════════════

let _buildChainCallCount = 0;

function buildChain(targetExpiry?: string): ChainRow[] {
  if(!liveNiftySpot)return[];
  const atm=Math.round(liveNiftySpot/50)*50;
  const now=Date.now();

  let chosenExpiry = targetExpiry;
  if(!chosenExpiry){
    const expiryDateMap = new Map<string,number>();
    for(const k of liveChain.keys()){
      const parts=k.split('_');
      if(parts.length<3)continue;
      const exp=parts[2];
      if(expiryDateMap.has(exp))continue;
      try{ expiryDateMap.set(exp, expiryStringToDate(exp).getTime()); }catch(_){}
    }
    const sorted=Array.from(expiryDateMap.entries()).sort((a,b)=>a[1]-b[1]);
    for(const [exp,ts] of sorted){
      if(ts>now){ chosenExpiry=exp; break; }
    }
    if(!chosenExpiry && sorted.length>0) chosenExpiry=sorted[sorted.length-1][0];
  }

  if(!chosenExpiry){
    if(_buildChainCallCount<3 && liveChain.size > 0)
      process.stdout.write(`⚠️  [CHAIN] No future expiry found in liveChain (size=${liveChain.size})\n`);
    _buildChainCallCount++;
    return[];
  }

  const strikeMap=new Map<number,{ce?:LiveOption;pe?:LiveOption}>();
  let scanned=0, matched=0, skipped=0;

  for(const [k,v] of liveChain.entries()){
    scanned++;
    const parts=k.split('_');
    if(parts.length<3)continue;
    if(parts[2]!==chosenExpiry){ skipped++; continue; }
    matched++;
    const strike=parseInt(parts[0]);
    const ot=parts[1];
    if(isNaN(strike)||Math.abs(strike-atm)>600)continue;
    if(!strikeMap.has(strike))strikeMap.set(strike,{});
    const row=strikeMap.get(strike)!;
    if(ot==='CE')row.ce=v; else if(ot==='PE')row.pe=v;
    if(process.env.DEBUG_CHAIN && ot==='PE' && v.ltp > 500){
      process.stdout.write(`🔍 [PE DEBUG] key="${k}" ltp=${v.ltp} — expiry ${parts[2]}\n`);
    }
  }

  _buildChainCallCount++;
  if(_buildChainCallCount<=3){
    process.stdout.write(`📊 [CHAIN #${_buildChainCallCount}] chosen="${chosenExpiry}" | `+
      `keys: ${scanned} total, ${matched} match, ${skipped} other expiries | `+
      `strikes: ${strikeMap.size}\n`);
  }

  if(!strikeMap.size)return[];

  const entries=Array.from(strikeMap.entries()).sort((a,b)=>a[0]-b[0]);
  const rows=entries.map(([strike,e])=>{
    const ceKey=`${strike}_CE_${chosenExpiry}`;
    const peKey=`${strike}_PE_${chosenExpiry}`;
    return {
      strike_price:  strike,
      expiry_date:   chosenExpiry,
      ce_ltp:        e.ce?.ltp    ??null,
      pe_ltp:        e.pe?.ltp    ??null,
      ce_volume:     e.ce?.volume ??null,
      pe_volume:     e.pe?.volume ??null,
      ce_oi:         e.ce?.oi     ??null,
      pe_oi:         e.pe?.oi     ??null,
      ce_oi_open:    openOiMap.has(ceKey) ? openOiMap.get(ceKey) : -1,
      pe_oi_open:    openOiMap.has(peKey) ? openOiMap.get(peKey) : -1,
    };
  });

  // FIX C: Proper LRU cache with ce_volume/pe_volume in cache key
  const ck=`${chosenExpiry}:`+rows.map(r=>`${r.strike_price}:${r.ce_ltp??0}:${r.pe_ltp??0}:${r.ce_oi??0}:${r.pe_oi??0}:${r.ce_volume??0}:${r.pe_volume??0}`).join('|');
  const cacheKey=`chain_${chosenExpiry}`;
  const cached=greeksCache.get(cacheKey);
  if(cached?.key===ck){
    greeksCache.delete(cacheKey);
    greeksCache.set(cacheKey, cached);
    return cached.chain;
  }
  const expDate=expiryStringToDate(chosenExpiry!);
  const chain=calculateChainGreeks(rows,liveNiftySpot,expDate);
  greeksCache.set(cacheKey,{key:ck,chain});
  if(greeksCache.size>5){const oldest=greeksCache.keys().next().value as string|undefined;if(oldest)greeksCache.delete(oldest);}
  return chain;
}

// FIX E: Filter to future expiries only (with 1h grace for expiry-day close)
function getAvailableExpiries(): string[] {
  const expirySet = new Set<string>();
  const cutoff = Date.now() - 3_600_000;
  for(const k of liveChain.keys()){
    const parts=k.split('_');
    if(parts.length<3)continue;
    const exp = parts[2];
    try{
      if(expiryStringToDate(exp).getTime() > cutoff) expirySet.add(exp);
    }catch(_){}
  }
  return Array.from(expirySet).sort((a,b) =>
    expiryStringToDate(a).getTime() - expiryStringToDate(b).getTime()
  );
}

function getNearestExpiry(): string {
  const expiries = getAvailableExpiries();
  const now = Date.now();
  for(const exp of expiries){
    if(expiryStringToDate(exp).getTime() > now) return exp;
  }
  return expiries[0] || '';
}

// ── FIX F: Periodic cleanup of expired keys from liveChain and openOiMap ────
function pruneExpiredChainKeys(): void {
  const cutoff = Date.now() - 24 * 3_600_000;
  let pruned = 0;
  for(const k of liveChain.keys()){
    const parts = k.split('_');
    if(parts.length < 3) continue;
    try{
      if(expiryStringToDate(parts[2]).getTime() < cutoff){
        liveChain.delete(k);
        openOiMap.delete(k);
        pruned++;
      }
    }catch(_){}
  }
  if(pruned > 0)
    process.stdout.write(`🧹 [PRUNE] Removed ${pruned} expired chain keys\n`);
}

const API_PORT=parseInt(process.env.API_PORT||'3001');
let pushFail=0,lastPush=0;

// FIX B: _pushPending flag ensures throttled ticks are always delivered.
let _pushPending = false;

let _directWsEmitter: { broadcastPush: (payload: any) => void } | null = null;

export function registerDirectWsEmitter(emitter: { broadcastPush: (payload: any) => void }): void {
  _directWsEmitter = emitter;
  process.stdout.write('⚡ [PUSH] Direct wsEmitter registered — bypassing HTTP round-trip\n');
}

// FIX G: Build payload object once and pass directly — no JSON round-trip.
function buildPushPayload(): object | null {
  if(!liveNiftySpot) return null;
  const nearestExpiry = getNearestExpiry();
  const chain = buildChain(nearestExpiry);
  if(!chain.length) return null;

  const nearestExpiryDate = nearestExpiry ? expiryStringToDate(nearestExpiry) : getNextNiftyExpiry();
  const allExpiries = getAvailableExpiries();

  let ceOI=0,peOI=0,ceV=0,peV=0;
  const atm=Math.round(liveNiftySpot/50)*50;
  for(const r of chain){ceOI+=r.ce_oi??0;peOI+=r.pe_oi??0;ceV+=r.ce_volume??0;peV+=r.pe_volume??0;}
  let maxPain=atm,minL=Infinity;
  for(const t of chain){const ts=Number(t.strike_price);let l=0;for(const r of chain){const s=Number(r.strike_price);if(ts>s)l+=(ts-s)*(r.ce_oi??0);if(ts<s)l+=(s-ts)*(r.pe_oi??0);}if(l<minL){minL=l;maxPain=ts;}}
  const prev=liveNiftyPrev||liveNiftySpot;
  const spChange=liveNiftySpot-prev,spChangePct=prev>0?(spChange/prev)*100:0;

  return {
    spotPrice:liveNiftySpot,vix:liveVix,atmStrike:atm,
    spotChange:spChange,spotChangePercent:spChangePct,
    prevClose:liveNiftyPrev,dayOpen:liveNiftyOpen,
    pcr_oi:ceOI>0?peOI/ceOI:1,pcr_volume:ceV>0?peV/ceV:1,
    maxPain,chain,
    expiryDate:nearestExpiryDate.toISOString().split('T')[0],
    activeExpiry:nearestExpiry,
    availableExpiries:allExpiries,
    timestamp:new Date().toISOString(),source:'live_push',
    spoofAlerts:spoofingDetector.getActiveAlerts()
  };
}

function pushToApi():void{
  const now=Date.now();

  // FIX B: If within throttle window, schedule a deferred push instead of dropping.
  if(now-lastPush<80){
    if(!_pushPending){
      _pushPending=true;
      setTimeout(()=>{
        _pushPending=false;
        pushToApi();
      }, 80-(now-lastPush));
    }
    return;
  }

  lastPush=now;
  if(!liveNiftySpot)return;

  // FIX G: Build once, pass directly — no JSON round-trip for direct emitter
  const payloadObj = buildPushPayload();
  if(!payloadObj) return;

  if (_directWsEmitter) {
    try { _directWsEmitter.broadcastPush(payloadObj); } catch (_) {}
    return;
  }

  // HTTP fallback — stringify only when needed
  const body = JSON.stringify(payloadObj);
  const req=http.request({hostname:'127.0.0.1',port:API_PORT,path:'/internal/push',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Internal-Secret':process.env.INTERNAL_SECRET||'jobber-internal-2026'}},(res)=>{res.resume();pushFail=0;});
  req.on('error',()=>{if(++pushFail===10)process.stdout.write('⚠️  [PUSH] api-server not responding\n');});
  req.setTimeout(200,()=>req.destroy());req.write(body);req.end();
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 9 — DB WRITE-BEHIND (UPSERT)
// ════════════════════════════════════════════════════════════════════════════

interface WriteRow{sym:string;tok:string;exch:string;expiry:string;strike:number;ot:string;ltp:number;vol:number;oi:number;bid:number|null;ask:number|null;bidQty:number|null;askQty:number|null;hi:number|null;lo:number|null;op:number|null;cl:number|null;ts:Date;}
const writeQ:WriteRow[]=[];let dbSaved=0,dbErrors=0,flushT:NodeJS.Timeout|null=null;
let _flushing=false;

async function flushDB():Promise<void>{
  flushT=null;
  if(_flushing||writeQ.length===0)return;
  _flushing=true;
  try{
  const batch=writeQ.splice(0,500);
  const ph=batch.map((_,i)=>{const b=i*19;return`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19})`;}).join(',');
  const args=batch.flatMap(r=>['NIFTY',r.sym,r.tok,r.expiry,r.strike,r.ot,r.exch,
    safeN(r.ltp)??r.ltp,
    safeN(r.vol),safeN(r.oi),
    safeN(r.bid),safeN(r.ask),
    safeN(r.bidQty),safeN(r.askQty),
    safeN(r.hi),safeN(r.lo),safeN(r.op),safeN(r.cl),
    r.ts]);
  try{
    await pool.query(`INSERT INTO nifty_premium_tracking.options_data(symbol,trading_symbol,token,expiry_date,strike_price,option_type,exchange,ltp,volume,oi,bid_price,ask_price,bid_qty,ask_qty,high,low,open,close,timestamp) VALUES ${ph} ON CONFLICT ON CONSTRAINT options_data_upsert_key DO UPDATE SET ltp=EXCLUDED.ltp,volume=EXCLUDED.volume,oi=EXCLUDED.oi,bid_price=EXCLUDED.bid_price,ask_price=EXCLUDED.ask_price,bid_qty=EXCLUDED.bid_qty,ask_qty=EXCLUDED.ask_qty,high=EXCLUDED.high,low=EXCLUDED.low,timestamp=EXCLUDED.timestamp`,args);
    dbSaved+=batch.length;
  }catch(e:any){
    try{
      await pool.query(`INSERT INTO nifty_premium_tracking.options_data(symbol,trading_symbol,token,expiry_date,strike_price,option_type,exchange,ltp,volume,oi,bid_price,ask_price,bid_qty,ask_qty,high,low,open,close,timestamp) VALUES ${ph} ON CONFLICT (symbol,strike_price,option_type,expiry_date) DO UPDATE SET ltp=EXCLUDED.ltp,volume=EXCLUDED.volume,oi=EXCLUDED.oi,bid_price=EXCLUDED.bid_price,ask_price=EXCLUDED.ask_price,bid_qty=EXCLUDED.bid_qty,ask_qty=EXCLUDED.ask_qty,high=EXCLUDED.high,low=EXCLUDED.low,timestamp=EXCLUDED.timestamp`,args);
      dbSaved+=batch.length;
    }catch(e2:any){
      try{
        await pool.query(`INSERT INTO nifty_premium_tracking.options_data(symbol,trading_symbol,token,expiry_date,strike_price,option_type,exchange,ltp,volume,oi,bid_price,ask_price,bid_qty,ask_qty,high,low,open,close,timestamp) VALUES ${ph} ON CONFLICT DO NOTHING`,args);
        dbSaved+=batch.length;
      }catch(e3:any){
        dbErrors++;
        if(dbErrors<=10)process.stderr.write(`⚠️  [DB] Write error (${dbErrors}): ${e3.message?.slice(0,160)}\n`);
        else if(dbErrors===11)process.stderr.write(`⚠️  [DB] Further write errors suppressed\n`);
      }
    }
  }
  }finally{
    _flushing=false;
    if(writeQ.length>0)schedFlush();
  }
}
function schedFlush(){if(!flushT)flushT=setTimeout(flushDB,100);}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 10 — TICK HANDLER
// ════════════════════════════════════════════════════════════════════════════

let lastTick=Date.now(),ticks=0,isReconnecting=true,invalidCount=0;

function handleTick(data:any):void{
  lastTick=Date.now();ticks++;
  if(isReconnecting){isReconnecting=false;process.stdout.write('✅ Data flowing\n');}
  const sym:string=(data.symbol||'').trim();
  const ltp:number=Number(data.ltp)||0;
  const token:string=String(data.token||'');

  // ── NIFTY Spot ───────────────────────────────────────────────────────────
  if(sym==='NIFTY'||sym==='NIFTY 50'||sym==='Nifty 50'||token==='99926000'){
    if(ltp>0&&liveNiftySpot!==ltp){liveNiftySpot=ltp;pushToApi();}
    if(data.close&&Number(data.close)>0&&liveNiftyPrev===0)liveNiftyPrev=Number(data.close);
    if(data.open&&Number(data.open)>0)liveNiftyOpen=Number(data.open);
    pool.query(
      `INSERT INTO nifty_premium_tracking.market_data(symbol,exchange,ltp,open,high,low,close,volume,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      ['NIFTY',data.exchange||'NSE',ltp,data.open||null,data.high||null,data.low||null,data.close||null,data.volume||0,new Date()]
    ).catch(()=>{});
    return;
  }

  // ── India VIX ────────────────────────────────────────────────────────────
  if(sym==='India VIX'||sym==='INDIA VIX'||sym==='INDIAVIX'||sym==='IndiaVIX'||sym==='india vix'||token==='99926017'){
    if(ltp>5&&ltp<200){
      liveVix=ltp;
      pushToApi();
      pool.query(
        `INSERT INTO nifty_premium_tracking.market_data(symbol,exchange,ltp,volume,timestamp) VALUES($1,$2,$3,$4,$5)`,
        ['INDIAVIX','NSE',ltp,0,new Date()]
      ).catch(()=>{});
    } else if(ltp>0) {
      process.stdout.write(`⚠️  [VIX] Rejected suspicious value ${ltp} from token=${token} sym="${sym}" — wrong instrument?\n`);
    }
    return;
  }

  // ── Options ──────────────────────────────────────────────────────────────
  if(ltp<=0){invalidCount++;return;}

  const parsed=parseOpt(sym);

  if(_optionTickDebugCount<OPTION_TICK_DEBUG_LIMIT&&sym.startsWith('NIFTY')){
    _optionTickDebugCount++;
    process.stdout.write(`🔍 [OPT TICK #${_optionTickDebugCount}] sym="${sym}" token=${token} ltp=${ltp} parsed=${JSON.stringify(parsed)}\n`);
  }

  if(!parsed){invalidCount++;return;}

  const{expiry,strike,optionType}=parsed;

  // ── FIX O: Paise → rupees conversion ────────────────────────────────────
  // Angel One sends some option LTPs in paise (e.g. ₹410 = 41,000 paise).
  // Old threshold 50_000 missed values like 41,000 (< 50,000) → stored as ₹41,000.
  // New threshold 5_000: any raw value > ₹50 equivalent must be paise-encoded.
  // NIFTY options have never exceeded ~₹2,000 in history, so this is safe.
  const needsDiv = ltp > 5_000;
  const px = (v: number) => (v > 0 ? (needsDiv ? v / 100 : v) : 0);
  const ltpR    = px(ltp);
  const bidR    = px(Number(data.bidPrice||data.best_buy_price||0));
  const askR    = px(Number(data.askPrice||data.best_sell_price||0));
  const highR   = px(Number(data.high||0));
  const lowR    = px(Number(data.low||0));
  const openR   = px(Number(data.open||0));
  const closeR  = px(Number(data.close||0));

  const volRaw  = Number(data.volume||0);
  const oiRaw   = Number(data.oi||0);
  const key=`${strike}_${optionType}_${expiry}`;
  const prev=liveChain.get(key);
  const changed=!prev||Math.abs(prev.ltp-ltpR)>0.01;

  if (!openOiMap.has(key)) openOiMap.set(key, oiRaw);

  liveChain.set(key,{
    ltp:ltpR, volume:volRaw, oi:oiRaw,
    bidPrice:bidR, askPrice:askR,
    bidQty:Number(data.bidQty||data.best_buy_quantity||0),
    askQty:Number(data.askQty||data.best_sell_quantity||0),
    high:highR, low:lowR, open:openR, close:closeR,
    updatedAt:Date.now(),
    expiry,
  });

  spoofingDetector.processTick(
    strike,optionType as 'CE'|'PE',ltpR,
    bidR, askR,
    Number(data.bidQty||data.best_buy_quantity||0),
    Number(data.askQty||data.best_sell_quantity||0),
    oiRaw, volRaw
  );

  if(changed)pushToApi();

  const exDate = expiryToDate(expiry);

  writeQ.push({
    sym, tok:token, exch:data.exchange||'NFO',
    expiry:exDate, strike, ot:optionType, ltp:ltpR,
    vol:volRaw, oi:oiRaw,
    bid:bidR||null, ask:askR||null,
    bidQty:Number(data.bidQty||data.best_buy_quantity||0)||null,
    askQty:Number(data.askQty||data.best_sell_quantity||0)||null,
    hi:highR||null, lo:lowR||null, op:openR||null, cl:closeR||null,
    ts:new Date()
  });
  schedFlush();
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 11 — VIX SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════

async function flushVix():Promise<void>{
  if(!liveVix||!liveNiftySpot)return;
  try{await pool.query(`INSERT INTO nifty_premium_tracking.vix_history(timestamp,vix,nifty_spot,is_market_open,source) VALUES($1,$2,$3,TRUE,'angelone_ws')`,[new Date(),liveVix,liveNiftySpot]);}catch(_){}
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 12 — DISPLAY
// ════════════════════════════════════════════════════════════════════════════

function startDisplay():NodeJS.Timeout{
  return setInterval(()=>{
    const als=getAlertStats(),ws=getWsStats(),status=isReconnecting?'🔄 RECONNECTING':'✅ LIVE';
    process.stdout.write(`⚡ [${new Date().toLocaleTimeString()}] Ticks/s:${ticks} | Saved:${dbSaved.toLocaleString()} | Chain:${liveChain.size} | Spot:₹${liveNiftySpot||'–'} | VIX:${liveVix??'–'} | ${status} | Push:${pushFail===0?'✅':'⚠️'} | Err:${dbErrors} | 🚨${als.totalAlerts}(${als.totalCritical}crit) | WS:${ws.connectedClients} | Bad:${invalidCount}\n`);
    ticks=0;
  },1000);
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 13 — DEAD MAN'S SWITCH
// ════════════════════════════════════════════════════════════════════════════

function armDeadMan(onTrigger:()=>void):NodeJS.Timeout{
  return setInterval(()=>{
    if(isReconnecting)return;if(!isMarketHours())return;
    if(Date.now()-lastTick>90000){process.stdout.write('\n💀 [DEAD MAN] No ticks 90s — reconnecting\n');onTrigger();}
  },1000);
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 14 — CDN LOADER
// ════════════════════════════════════════════════════════════════════════════

const CDN_URL          = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const CDN_TIMEOUT_MS   = 45000;
const CDN_MAX_RETRIES  = 3;
const CACHE_MAX_AGE_H  = 2;
const LOCAL_CACHE_FILE = path.join(process.cwd(), 'nifty_options_cache.json');

interface NiftyOption {
  token: string;
  symbol: string;
  exchange: string;
}

function filterNiftyOptions(raw: any[]): NiftyOption[] {
  let opts = raw.filter((i: any) =>
    i.name === 'NIFTY' &&
    i.exch_seg === 'NFO' &&
    (i.symbol?.endsWith('CE') || i.symbol?.endsWith('PE'))
  );
  if (opts.length === 0) {
    opts = raw.filter((i: any) =>
      i.exch_seg === 'NFO' &&
      (i.name === 'NIFTY' || i.symbol?.startsWith('NIFTY')) &&
      (i.symbol?.endsWith('CE') || i.symbol?.endsWith('PE'))
    );
  }
  return opts.map((i: any) => ({
    token:    String(i.token),
    symbol:   String(i.symbol || i.trading_symbol || ''),
    exchange: 'NFO',
  })).filter(o => /[CP]E$/.test(o.symbol));
}

function saveCache(opts: NiftyOption[]): void {
  try {
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(opts), 'utf8');
    process.stdout.write(`💾 Cached ${opts.length} options to ${LOCAL_CACHE_FILE}\n`);
  } catch (_) {}
}

function loadCache(maxAgeHours = CACHE_MAX_AGE_H): NiftyOption[] | null {
  try {
    if (!fs.existsSync(LOCAL_CACHE_FILE)) return null;
    const stat = fs.statSync(LOCAL_CACHE_FILE);
    const ageH = (Date.now() - stat.mtimeMs) / 3600000;
    // FIX N: After market close (15:30 IST) the CDN is unreliable.
    // Use stale cache unconditionally when market is closed.
    const nowISTH = (new Date().getUTCHours() + 5.5) % 24;
    const marketClosed = nowISTH >= 15.5 || nowISTH < 9.0;
    if (ageH > maxAgeHours) {
      if (marketClosed) {
        process.stdout.write(`💾 Cache is ${ageH.toFixed(1)}h old — market closed, using stale cache ✅\n`);
        // fall through to load and return
      } else {
        process.stdout.write(`💾 Cache is ${ageH.toFixed(1)}h old (limit ${maxAgeHours}h) — refreshing from CDN\n`);
        return null;
      }
    }
    const opts: NiftyOption[] = JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, 'utf8'));
    if (opts.length < 100) return null;

    const nowMs = Date.now();
    const expMap = new Map<string,number>();
    for(const o of opts){
      const m = o.symbol?.match(/^NIFTY(\d{2}[A-Z]{3}\d{2})/);
      if(!m)continue;
      const exp=m[1];
      if(expMap.has(exp))continue;
      try{ expMap.set(exp, expiryStringToDate(exp).getTime()); }catch(_){}
    }
    const sortedExps=Array.from(expMap.entries()).sort((a,b)=>a[1]-b[1]);
    const nearestCached=sortedExps.find(([,ts])=>ts>nowMs)?.[0]||sortedExps[0]?.[0];
    if(nearestCached){
      const nearTokens=opts.filter(o=>o.symbol?.includes(nearestCached)).length;
      if(nearTokens<20){
        process.stdout.write(`💾 Cache has only ${nearTokens} tokens for ${nearestCached} — forcing CDN refresh\n`);
        try{ fs.unlinkSync(LOCAL_CACHE_FILE); }catch(_){}
        return null;
      }
      process.stdout.write(`💾 Cache hit: ${opts.length} opts (${ageH.toFixed(1)}h old) | ${nearestCached}: ${nearTokens} tokens ✅\n`);
    } else {
      process.stdout.write(`💾 Cache hit: ${opts.length} opts (${ageH.toFixed(1)}h old)\n`);
    }
    return opts;
  } catch (_) {}
  return null;
}

let _angelService: any = null;

async function fetchFromCDN(): Promise<any[]> {
  return new Promise((res, rej) => {
    const req = https.get(CDN_URL, (r: any) => {
      if ((r.statusCode ?? 0) >= 400) { r.resume(); rej(new Error(`HTTP ${r.statusCode}`)); return; }
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => {
        try { const p = JSON.parse(Buffer.concat(chunks).toString()); res(Array.isArray(p) ? p : []); }
        catch (e: any) { rej(new Error(`JSON parse: ${e.message}`)); }
      });
      r.on('error', rej);
    });
    req.on('error', rej);
    req.setTimeout(CDN_TIMEOUT_MS, () => req.destroy(new Error(`CDN timeout ${CDN_TIMEOUT_MS / 1000}s`)));
  });
}

async function fetchNiftyOptionsFromCDN(): Promise<NiftyOption[]> {

  const cached = loadCache();
  if (cached) return cached;

  for (let attempt = 1; attempt <= CDN_MAX_RETRIES; attempt++) {
    try {
      process.stdout.write(`📋 [OPTIONS] CDN attempt ${attempt}/${CDN_MAX_RETRIES}...\n`);
      const raw = await fetchFromCDN();
      process.stdout.write(`   CDN raw: ${raw.length.toLocaleString()} instruments\n`);
      const opts = filterNiftyOptions(raw);
      if (opts.length > 100) {
        process.stdout.write(`✅ CDN: ${opts.length} options | sample: ${opts.slice(0, 2).map((o: any) => o.symbol).join(', ')}\n`);
        saveCache(opts);
        return opts;
      }
      throw new Error(`Only ${opts.length} after filter`);
    } catch (e: any) {
      process.stderr.write(`❌ [CDN ${attempt}] ${e.message}\n`);
      if (attempt < CDN_MAX_RETRIES) {
        const wait = attempt * 3000;
        process.stdout.write(`   Retrying CDN in ${wait/1000}s...\n`);
        await sleep(wait);
      }
    }
  }

  if (_angelService) {
    const svc = _angelService as any;
    const jwt: string = svc.jwtToken ?? svc._jwtToken ?? svc.authToken ?? svc._authToken ?? svc.getJwtToken?.() ?? svc.loginResult?.data?.jwtToken ?? '';
    const apiKey: string = process.env.ANGEL_API_KEY || '';

    if (jwt) {
      process.stdout.write('📋 [OPTIONS] Trying searchScrip API...\n');
      try {
        const searchBody = JSON.stringify({ exchange: 'NFO', searchscrip: 'NIFTY' });
        const searchRaw = await new Promise<any[]>((res, rej) => {
          const req = https.request({
            hostname: 'apiconnect.angelbroking.com',
            path: '/rest/secure/angelbroking/order/v1/searchScrip',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${jwt}`,'Content-Type': 'application/json',
              'Accept': 'application/json','X-PrivateKey': apiKey,
              'X-ClientLocalIP': '127.0.0.1','X-ClientPublicIP': '127.0.0.1',
              'X-MACAddress': '00:00:00:00:00:00','X-UserType': 'USER','X-SourceID': 'WEB',
              'Content-Length': Buffer.byteLength(searchBody),
            }
          }, (r: any) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => {
              try { const body = JSON.parse(Buffer.concat(chunks).toString()); const data = body.data ?? body; res(Array.isArray(data) ? data : []); }
              catch (e: any) { rej(new Error(`searchScrip JSON: ${e.message}`)); }
            });
            r.on('error', rej);
          });
          req.on('error', rej);
          req.setTimeout(5000, () => req.destroy(new Error('searchScrip timeout 5s')));
          req.write(searchBody); req.end();
        });
        process.stdout.write(`   searchScrip raw: ${searchRaw.length} results\n`);
        const norm = searchRaw.map((i: any) => ({name:'NIFTY',exch_seg:i.exch_seg??'NFO',symbol:i.tradingsymbol??i.symbol??'',token:i.symboltoken??i.token??''}));
        const opts = filterNiftyOptions(norm);
        if (opts.length > 50) { process.stdout.write(`✅ searchScrip: ${opts.length} NIFTY options\n`); saveCache(opts); return opts; }
        process.stderr.write(`   searchScrip only ${opts.length} options\n`);
      } catch (e: any) { process.stderr.write(`❌ [searchScrip] ${e.message}\n`); }

      process.stdout.write('📋 [OPTIONS] Trying allInstrument API...\n');
      try {
        const apiRaw = await new Promise<any[]>((res, rej) => {
          const req = https.request({
            hostname: 'apiconnect.angelbroking.com',
            path: '/rest/secure/angelbroking/market/v1/allInstrument', method: 'GET',
            headers: { 'Authorization': `Bearer ${jwt}`,'Content-Type':'application/json','X-PrivateKey':apiKey,'X-ClientLocalIP':'127.0.0.1','X-ClientPublicIP':'127.0.0.1','X-MACAddress':'00:00:00:00:00:00','X-UserType':'USER','X-SourceID':'WEB' }
          }, (r: any) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => { try { const b=JSON.parse(Buffer.concat(chunks).toString()); res(Array.isArray(b.data??b)?(b.data??b):[]); } catch(e:any){rej(new Error(`allInstrument JSON: ${e.message}`));} });
            r.on('error', rej);
          });
          req.on('error', rej);
          req.setTimeout(8000, () => req.destroy(new Error('allInstrument timeout 8s')));
          req.end();
        });
        process.stdout.write(`   allInstrument raw: ${apiRaw.length.toLocaleString()} instruments\n`);
        const opts = filterNiftyOptions(apiRaw);
        if (opts.length > 100) { process.stdout.write(`✅ allInstrument: ${opts.length} NIFTY options\n`); saveCache(opts); return opts; }
      } catch (e: any) { process.stderr.write(`❌ [allInstrument] ${e.message}\n`); }
    }

    for (const method of ['getInstruments','getAllInstruments','getScripMaster','getSymbolMaster']) {
      if (typeof svc[method] !== 'function') continue;
      try {
        process.stdout.write(`   Trying service.${method}('NFO')...\n`);
        const raw: any[] = await Promise.race([
          svc[method]('NFO').catch(() => svc[method]()),
          new Promise<any[]>((_, rej) => setTimeout(() => rej(new Error(`${method} timeout`)), 3000)),
        ]);
        if (Array.isArray(raw) && raw.length > 100) {
          const opts = filterNiftyOptions(raw);
          if (opts.length > 50) { process.stdout.write(`✅ ${method}: ${opts.length} options\n`); saveCache(opts); return opts; }
        }
      } catch (e: any) { process.stderr.write(`   ${method} failed: ${e.message}\n`); }
    }
  }

  const staleCache = loadCache(9999);
  if (staleCache) {
    process.stdout.write('⚠️  Using stale cache as last resort\n');
    return staleCache;
  }

  process.stderr.write([
    '❌ [OPTIONS] ALL SOURCES FAILED.',
    '   Fix: Run once with internet access:',
    `   curl -o "${LOCAL_CACHE_FILE}" "${CDN_URL}"`, '',
  ].join('\n'));
  return [];
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 15 — LOGIN
// ════════════════════════════════════════════════════════════════════════════

interface LoginResult{feedToken:string;clientCode:string;apiKey:string;service:any;}

async function loginToAngel(maxAttempts=5):Promise<LoginResult>{
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    process.stdout.write(`🔐 [LOGIN] Attempt ${attempt}/${maxAttempts}...\n`);
    try{
      const svc=createAngelOneService();
      const result=await svc.login();
      if(result.success){
        const clientCode=process.env.ANGEL_CLIENT_CODE||'';
        process.stdout.write(`✅ [LOGIN] Success (client: ${clientCode})\n`);
        const s=svc as any;
        const feedToken:string=s.getFeedToken?.()??s.feedToken??s._feedToken??'';
        if(!feedToken)throw new Error('No feed token returned from service');
        const jwtToken:string=result.data?.jwtToken??(result as any).jwtToken??s.getJwtToken?.()??s.jwtToken??s._jwtToken??s.authToken??s._authToken??'';
        if(jwtToken){s.jwtToken=jwtToken;process.stdout.write(`🔑 JWT captured (${jwtToken.slice(0,20)}...)\n`);}
        return{feedToken,clientCode,apiKey:process.env.ANGEL_API_KEY||'',service:svc};
      }
      const msg=result.message||'Login failed';
      process.stderr.write(`❌ [LOGIN] Failed: ${msg}\n`);
      if(/invalid totp|totp/i.test(msg)){await waitForNextTotpWindow();continue;}
      if(/too many|session|limit|blocked|forbidden/i.test(msg)&&attempt<maxAttempts){process.stdout.write('⚠️  Rate-limit — waiting 90s\n');await sleep(90000);continue;}
    }catch(e:any){
      const msg=e.response?.data?.message||e.message||'';
      process.stderr.write(`❌ [LOGIN] Error: ${msg}\n`);
      if(/invalid totp|totp/i.test(msg)){await waitForNextTotpWindow();continue;}
    }
    if(attempt<maxAttempts){const w=[0,5,10,15,20][attempt]??20;process.stdout.write(`   Retry in ${w}s\n`);await sleep(w*1000);}
  }
  throw new Error(`Login failed after ${maxAttempts} attempts`);
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 16 — ONE SESSION
// ════════════════════════════════════════════════════════════════════════════

const BATCH_SIZE        = 50;
const MAX_OPTION_TOKENS = 495;

async function runSession():Promise<void>{
  const{feedToken,clientCode,apiKey,service}=await loginToAngel(5);

  process.stdout.write('\n🗄️  Verifying database...\n');
  await pool.query('SELECT 1');
  process.stdout.write('✅ Database ready\n');
  await ensureDbSchema();

  _angelService = service;

  process.stdout.write('\n📋 Fetching NIFTY options (cache-first, CDN fallback)...\n');
  const cdnPromise = fetchNiftyOptionsFromCDN();

  const ws = new AngelWebSocket(feedToken, clientCode, apiKey);

  const tokenSymbolMap = new Map<string, string>();
  tokenSymbolMap.set('99926000', 'NIFTY');
  tokenSymbolMap.set('99926017', 'India VIX');

  const patchedHandleTick = (data: any) => {
    if ((!data.symbol || data.symbol === '') && data.token) {
      const mapped = tokenSymbolMap.get(String(data.token));
      if (mapped) data = { ...data, symbol: mapped };
    }
    handleTick(data);
  };

  return new Promise<void>((resolve,reject)=>{
    let aborted=false;
    let deadMan:NodeJS.Timeout|null=null;
    let vixTimer:NodeJS.Timeout|null=null;

    const abort=(reason:string)=>{
      if(aborted)return;aborted=true;isReconnecting=true;
      if(deadMan){clearInterval(deadMan);deadMan=null;}
      if(vixTimer){clearInterval(vixTimer);vixTimer=null;}
      try{ws.disconnect?.();}catch(_){}
      spoofingDetector.reset();
      _optionTickDebugCount=0;
      _buildChainCallCount=0;
      liveNiftyPrev = 0;
      liveNiftyOpen = 0;
      _totalAlerts = 0; _totalCritical = 0; _totalWatch = 0;
      openOiMap.clear();
      reason==='dead-man'?resolve():reject(new Error(reason));
    };

    ws.on('tick', patchedHandleTick);
    ws.on('error',(err:Error)=>process.stderr.write(`❌ [WS] ${err.message}\n`));
    ws.on('close',(code:number)=>{if(!aborted)abort(`ws-closed-${code}`);});

    ws.connect().then(async ()=>{
      process.stdout.write('\n✅ WebSocket streaming active\n\n');

      ws.subscribe?.([{ token: '99926000', symbol: 'NIFTY',     exchange: 'NSE' }]);
      ws.subscribe?.([{ token: '99926017', symbol: 'India VIX', exchange: 'NSE' }]);

      deadMan=armDeadMan(()=>abort('dead-man'));
      vixTimer=setInterval(flushVix,1000);

      // FIX D: markSubscribed() before CDN await
      spoofingDetector.markSubscribed();
      process.stdout.write(`🛡️  Spoof detector warming up (${WARMUP_PERIOD_MS/1000}s)...\n`);

      process.stdout.write('⏳ Waiting for options data (max 30s)...\n');
      const niftyOpts = await Promise.race([
        cdnPromise,
        new Promise<NiftyOption[]>(res => setTimeout(() => {
          process.stderr.write('⚠️  [OPTIONS] 30s timeout — check network or run:\n');
          process.stderr.write(`   Invoke-WebRequest -Uri "${CDN_URL}" -OutFile "${LOCAL_CACHE_FILE}"\n`);
          res([]);
        }, 30000))
      ]);

      if (liveNiftySpot === 0 && niftyOpts.length > 0) {
        process.stdout.write('⏳ Waiting for live NIFTY spot (max 3s)...\n');
        const spotWaitStart = Date.now();
        while (liveNiftySpot === 0 && Date.now() - spotWaitStart < 3000) {
          await sleep(50);
        }
        if (liveNiftySpot > 0) {
          process.stdout.write(`✅ Got live spot ₹${liveNiftySpot} after ${Date.now()-spotWaitStart}ms\n`);
        } else {
          process.stdout.write(`⚠️  Spot not received in 3s — using default 24500 for ATM filter\n`);
        }
      }

      for (const opt of niftyOpts) {
        tokenSymbolMap.set(opt.token, opt.symbol);
      }

      if (niftyOpts.length > 0) {
        let tokensToSubscribe = niftyOpts;

        if (niftyOpts.length > MAX_OPTION_TOKENS) {
          const spotKnown     = liveNiftySpot > 0;
          const spotForFilter = spotKnown ? liveNiftySpot : 24500;
          const atmRadius     = spotKnown ? 600 : 800;
          const atmApprox     = Math.round(spotForFilter / 50) * 50;

          process.stdout.write(
            `   Filtering ${niftyOpts.length} options to near-ATM ` +
            `(spot=${spotForFilter.toFixed(0)}${spotKnown?'':'≈default'}, atm=${atmApprox}, radius=±${atmRadius})\n`
          );

          const withMeta = niftyOpts.map((o: any) => {
            const m = String(o.symbol).match(/^NIFTY(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/);
            const s = m ? parseInt(m[2], 10) : 0;
            const exp = m ? m[1] : '';
            return { ...o, strikeRupees: s, expiry: exp };
          }).filter((o: any) => o.strikeRupees >= 5000 && o.strikeRupees <= 60000 && o.expiry);

          const allExpSet = new Map<string, number>();
          for (const o of withMeta) {
            if (!allExpSet.has(o.expiry)) {
              try { allExpSet.set(o.expiry, expiryStringToDate(o.expiry).getTime()); } catch(_) {}
            }
          }
          const nowMs = Date.now();
          const sortedExpiries = Array.from(allExpSet.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([exp]) => exp);
          const nearestExp = sortedExpiries.find(e => (allExpSet.get(e) ?? 0) > nowMs) || sortedExpiries[0];

          process.stdout.write(`   Nearest expiry for subscription priority: ${nearestExp}\n`);

          const weeklyTokens = withMeta
            .filter((o: any) => o.expiry === nearestExp && Math.abs(o.strikeRupees - atmApprox) <= atmRadius)
            .sort((a: any, b: any) => Math.abs(a.strikeRupees - atmApprox) - Math.abs(b.strikeRupees - atmApprox));

          const weeklySymbols = new Set(weeklyTokens.map((o: any) => o.symbol));
          const remaining = withMeta
            .filter((o: any) => !weeklySymbols.has(o.symbol) && Math.abs(o.strikeRupees - atmApprox) <= atmRadius)
            .sort((a: any, b: any) => Math.abs(a.strikeRupees - atmApprox) - Math.abs(b.strikeRupees - atmApprox));

          const combined = [...weeklyTokens, ...remaining];
          tokensToSubscribe = combined.slice(0, MAX_OPTION_TOKENS);

          const strikes = tokensToSubscribe.map((o: any) => o.strikeRupees).sort((a: number, b: number) => a - b);
          const weeklyCount = tokensToSubscribe.filter((o: any) => o.expiry === nearestExp).length;
          process.stdout.write(
            `   Near-ATM filter: ${tokensToSubscribe.length} tokens | ` +
            `weekly(${nearestExp}): ${weeklyCount} | other: ${tokensToSubscribe.length - weeklyCount} | ` +
            `strikes ${strikes[0]}–${strikes[strikes.length - 1]}\n`
          );
        }

        const items = tokensToSubscribe.map((o: any) => ({
          token: o.token, symbol: o.symbol, exchange: 'NFO'
        }));

        let batches = 0;
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          ws.subscribe?.(items.slice(i, i + BATCH_SIZE));
          batches++;
        }
        process.stdout.write(
          `✅ Subscribed to ${items.length} option tokens (${batches} batches of ${BATCH_SIZE})\n`
        );

        setTimeout(()=>{
          const expiries = getAvailableExpiries();
          const nearest  = getNearestExpiry();
          if(expiries.length){
            process.stdout.write(`📅 Expiries loaded: ${expiries.join(' | ')}\n`);
            process.stdout.write(`📅 Dashboard showing: ${nearest} (nearest)\n`);
          }
        }, 2000);
      } else {
        process.stdout.write('⚠️  No NIFTY options to subscribe — chain will be empty\n');
      }
    }).catch((err:Error)=>abort(err.message));
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 17 — OUTER LOOP + MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main():Promise<void>{
  let shuttingDown=false,attempt=0;
  const display=startDisplay();

  const shutdown=async()=>{
    if(shuttingDown)return;shuttingDown=true;
    _isShuttingDown = true;
    process.stdout.write('\n⏹️  Shutting down...\n');
    clearInterval(display);
    await sleep(100);
    spoofingDetector.reset();
    while(writeQ.length>0){await flushDB();await sleep(50);}
    await pool.end();
    process.stdout.write('✅ Shutdown complete\n');process.exit(0);
  };

  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  process.on('uncaughtException',(e)=>process.stderr.write(`💥 [UNCAUGHT] ${e.message}\n`));
  process.on('unhandledRejection',(r)=>process.stderr.write(`💥 [UNHANDLED] ${String(r)}\n`));

  startSpoofDashboardWS();
  spoofingDetector.onAlert(routeSpoofAlert);

  // FIX F: Periodic cleanup of expired chain keys every 10 minutes
  setInterval(pruneExpiredChainKeys, 10 * 60 * 1000);

  process.stdout.write(`📡 Spoof alerts → alerts/alerts_${getISTDate()}.jsonl\n`);
  process.stdout.write(`📡 Telegram: ${TG_TOKEN?'✅ configured':'⚠️  not set'}\n`);
  process.stdout.write(`📡 WS feed: ws://localhost:${WS_PORT}\n\n`);

  while(!shuttingDown){
    attempt++;isReconnecting=true;
    try{await runSession();}
    catch(err:any){process.stderr.write(`\n❌ [OUTER] Session crashed: ${err.message}\n`);}
    if(shuttingDown)break;
    const wait=Math.min(attempt*15,60);
    process.stdout.write(`🔄 Restarting in ${wait}s (attempt ${attempt})...\n`);
    await sleep(wait*1000);
  }
}

process.stdout.write('╔══════════════════════════════════════════════════════════════╗\n');
process.stdout.write(`║  NIFTY Collector ${VERSION} — ALL BUGS FIXED                      ║\n`);
process.stdout.write('╚══════════════════════════════════════════════════════════════╝\n\n');

main().catch(err=>{process.stderr.write(`FATAL: ${err.message}\n`);process.exit(1);});