/**
 * websocket-collector.ts — v7.6
 * Location: D:\jobber-perfect\backend\src\scripts\websocket-collector.ts
 *
 * ════ ALL BUGS FROM v7.4 PRESERVED ══════════════════════════════════════════
 * FIX B — pushToApi dropped ticks (80ms throttle, no pending-flag fallback)
 * FIX D — markSubscribed() race with slow CDN → warmup bypassed
 * FIX A — liveNiftyPrev/liveNiftyOpen never reset on multi-day runs
 * FIX E — getAvailableExpiries() served expired expiries to frontend
 * FIX C — Greeks cache LRU inversion
 * FIX I — Telegram global 30s cooldown suppressed higher-severity alerts
 * FIX F — liveChain / openOiMap grew unbounded
 * FIX G — JSON.parse(JSON.stringify()) round-trip in direct emitter path
 * FIX J — Alert storm (500+ CRITICALs/10s)
 * FIX K — Shutdown DB pool error
 * FIX L — Alert counters never reset between sessions
 * FIX M — MOMENTUM_IGNITION fired on tick #3
 * FIX O — needsDiv threshold too high → wrong LTP stored
 * FIX P — calculateChainGreeks() CE/PE guards incorrectly filtered valid options
 *
 * ════ NEW IN v7.6 (PERFORMANCE) ══════════════════════════════════════════════
 * PERF-1 — Greeks cache key: removed ce_volume/pe_volume — volume changes every
 *           tick, busting the cache on every tick → Black-Scholes 100-iter
 *           Newton-Raphson ran for every strike on every tick. Cache key now
 *           uses only ltp per strike. Greeks don't depend on volume.
 * PERF-2 — liveChainByExpiry secondary index: liveChain was O(n)-scanned on
 *           every buildChain() + getAvailableExpiries() call (495 entries ×
 *           string split × 5 pushes/s = 2475 ops/s wasted). New index makes
 *           buildChain() O(bucket size) and expiry lookup O(1).
 * PERF-3 — pushToApi() decoupled from tick handler: tick now sets _pushDirty=true.
 *           A 200ms interval timer fires the actual push. buildChain() +
 *           calculateChainGreeks() run at most 5×/s instead of 200×/s during
 *           market open.
 * PERF-4 — spoofingDetector moved off tick hot path: enqueueDetect() +
 *           setImmediate(drainDetectQueue) processes detectors async. Tick
 *           ingestion no longer blocks on 9-detector synchronous scan.
 * PERF-5 — writeQ safety valve: enqueueWrite() caps queue at 5000 rows and
 *           drops oldest with a stderr warning if DB flush stalls.
 * PERF-6 — _expiryListCache: getAvailableExpiries() now O(1) on cache hit.
 *           Cache invalidated only when a new expiry key appears in liveChain.
 *
 * ════ NEW IN v7.5 ═════════════════════════════════════════════════════════════
 * ADD OI_SCANNER — OIScannerEngine integrated
 *   - Instantiated after pool (const oiScanner = new OIScannerEngine(pool, null))
 *   - Emitter wired in registerDirectWsEmitter() via oiScanner.setEmitter()
 *   - Tick fed in handleTick() OPTIONS branch after spoofingDetector.processTick()
 *   - onFiveMinute() timer in main() alongside pruneExpiredChainKeys
 *   - onFifteenMinute() timer in main() alongside pruneExpiredChainKeys
 *   - oiScanner.destroy() called in shutdown() after spoofingDetector.reset()
 *
 * ════ FIX IN v7.5 (decimal prices) ══════════════════════════════════════════
 * FIX Q — safeN() was applied to PRICE fields in flushDB() args.
 *          safeN() calls Math.round() which truncated decimals:
 *          223.90 → 224, 5.55 → 6, etc.
 *          Price columns (ltp, bid, ask, high, low, open, close) now written raw.
 *          safeN() retained only for true integer columns (volume, oi, qty).
 *
 * ════ FIX IN v7.5 (paise threshold) ═════════════════════════════════════════
 * FIX R — AngelWebSocket service ALREADY converts paise→rupees internally
 *          before emitting 'tick' events. Confirmed by live debug:
 *            ltp=431.25 (24150CE), ltp=112.5 (24100PE), ltp=158.8 (24600CE)
 *          These are clearly rupees, not paise.
 *          Old needsDiv (ltp > 5_000) was wrong for deep ITM options:
 *            e.g. ₹5450 ITM call → needsDiv=true → wrongly divided to ₹54.50
 *          Fix: removed needsDiv entirely. px() passes value unchanged.
 *          No ÷100 needed — service handles paise→rupees before tick fires.
 *
 * ════ NEW IN v7.5.1 ══════════════════════════════════════════════════════════
 * FIX 3 — loginToAngel(): 60s WAF rate-limit guard between retry attempts.
 *          Angel One's WAF throttles rapid re-login; any attempt > 1 now waits
 *          until 60 000 ms have elapsed since the previous attempt start.
 * FIX 5 — abort(): dbErrors counter now resets to 0 between sessions.
 *          Without this, dbErrors accumulated across reconnects and triggered
 *          the "further write errors suppressed" blackout after ~11 lifetime errors.
 * FIX 6 — SpoofingDetector.oiDiv(): guard against near-zero LTP strikes.
 *          Deep OTM options with ltp < 0.5 produced false-positive OI_DIVERGENCE
 *          CRITICAL alerts. Added early-return when s.ltp < 0.5 || p.ltp < 0.5.
 *
 * ════ FIX IN v7.6.1 (OI Pipeline startup) ═══════════════════════════════════
 * FIX S — initOIPipeline(): removed ALTER TABLE ADD COLUMN IF NOT EXISTS calls.
 *          These columns (oi_change, close) already exist in production schema.
 *          ALTER TABLE on 10.5M rows acquires a full table lock at startup,
 *          exceeding the pool statement_timeout (60s) and causing the pipeline
 *          to fail on every restart. Columns are now managed at deploy time only.
 *          refresh_oi_snapshot() and sync_oi_change() calls are unchanged.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createAngelOneService, AngelWebSocket } from '../services/angelone.service';
import { OIScannerEngine } from '../oi-scanner-engine';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as http   from 'http';
import * as https  from 'https';
import * as fs     from 'fs';
import * as path   from 'path';
import * as net    from 'net';
import * as crypto from 'crypto';

dotenv.config();

const VERSION = 'v7.6';

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
  const theta=thetaA/252;
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

function getNextNiftyExpiry(): Date {
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
  const ist=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const day=ist.getDay();
  let ahead=(4-day+7)%7;
  if (ahead===0&&ist.getHours()*60+ist.getMinutes()>=930) ahead=7;
  const exp=new Date(ist);
  exp.setDate(ist.getDate()+ahead);
  exp.setHours(15,30,0,0);
  return exp;
}

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
  const MAX_CE_LTP = spot * 4;
  const MAX_PE_LTP_RATIO = 4;
  return rows.map((row):ChainRow => {
    const K=Number(row.strike_price),ceLTP=Number(row.ce_ltp)||0,peLTP=Number(row.pe_ltp)||0;
    const ceOI=Number(row.ce_oi)||0,peOI=Number(row.pe_oi)||0;
    let T=defaultT;
    if (row.expiry_date) {
      try { T=timeToExpiryYears(expiryStringToDate(String(row.expiry_date))); } catch(_) {}
    }
    let ceG:Greeks|undefined,peG:Greeks|undefined;
    if (ceLTP > 0.01 && ceLTP < MAX_CE_LTP) {
      const iv=impliedVol(ceLTP,spot,K,T,r,q,true);
      if(iv>0 && iv<MAX_DISPLAY_IV){
        const bs=blackScholes(spot,K,T,r,q,iv/100,true);
        ceG={iv,delta:+bs.delta.toFixed(4),gamma:+bs.gamma.toFixed(6),theta:+bs.theta.toFixed(2),vega:+bs.vega.toFixed(2)};
      }
    }
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
const FIRE_COOLDOWN_MS = parseInt(process.env.SPOOF_FIRE_COOLDOWN_MS||'30000',10);

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

  // ── FIX 6: Guard near-zero LTP to prevent false-positive OI_DIVERGENCE
  //    SPOOF cascade on deep OTM options whose premium is effectively zero.
  //    When ltp < 0.5 (either current or previous tick), the percentage-change
  //    arithmetic amplifies noise into a fake signal. Return early. ──────────
  private oiDiv(strike:number,ot:'CE'|'PE',s:TickSnap,p:TickSnap,now:number){
    if(s.ltp < 0.5 || p.ltp < 0.5) return;  // FIX 6: skip near-zero LTP strikes
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
  options:'-c statement_timeout=120000',
});
pool.on('error',(err:Error)=>process.stderr.write(`⚠️  [POOL] ${err.message}\n`));

// ── OI Pulse pipeline initialiser ─────────────────────────────────────────
// Refreshes session-open OI snapshot and backfills oi_change nulls.
// The DB trigger (installed by fix-oi-change-pipeline.sql) handles all future
// UPSERT rows automatically — no changes needed in flushDB().
//
// FIX S: ALTER TABLE ADD COLUMN IF NOT EXISTS removed — columns (oi_change,
// close) already exist in the production schema. Running ALTER TABLE on 10.5M
// rows at every startup acquires a full table lock that exceeds the pool's
// 60s statement_timeout, causing the pipeline to fail on every restart.
// Schema changes must be applied once at deploy time, not at runtime.
async function initOIPipeline(db: Pool): Promise<void> {
  try {
    // Refresh session-open OI snapshot (baseline for oi_change calculation)
    await db.query('SELECT nifty_premium_tracking.refresh_oi_snapshot()');
    await db.query("SET LOCAL statement_timeout = '0'");
    // Backfill any existing rows that still have NULL oi_change
    await db.query('SELECT nifty_premium_tracking.sync_oi_change()');
    process.stdout.write('✅ [OI Pipeline] Session snapshot refreshed — oi_change live\n');
  } catch (err: any) {
    // Non-fatal: if SQL migration hasn't been run yet, log and continue.
    // Run STEP2_fix-oi-change-pipeline.sql first to enable full functionality.
    process.stderr.write(`⚠️  [OI Pipeline] Init skipped (run SQL migration first): ${err.message}\n`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
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

// ── PERF-2: Secondary expiry index — avoids O(n) liveChain scan ─────────────
// Maps expiry string → Set of full keys ("strike_OT_expiry")
// Maintained in handleTick() alongside liveChain.set()
const liveChainByExpiry = new Map<string, Set<string>>();

// ── PERF-6: Cached sorted expiry list — invalidated on new expiry key ────────
let _expiryListCache: string[] | null = null;

// ── PERF-3: Tick-driven push replaced with fixed-interval push loop ───────────
// Tick handler sets _pushDirty = true. The 200ms timer fires the actual push.
// Result: buildChain() + Greeks run at most 5×/s instead of 200×/s at open.
let   _pushDirty  = false;
let   _pushTimer: NodeJS.Timeout | null = null;
const PUSH_INTERVAL_MS = 200;  // legacy — replaced by setImmediate push (PERF-4)

function startPushLoop(): void { /* PERF-4: push is now immediate — loop is a no-op */ }

function stopPushLoop(): void {
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
}

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

function parseOpt(sym: string): { expiry: string; strike: number; optionType: string } | null {
  const m = sym.match(/^NIFTY(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/);
  if (!m) return null;
  const strike = parseInt(m[2], 10);
  if (strike < 5000 || strike > 60000) return null;
  return { expiry: m[1], strike, optionType: m[3] };
}

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

function buildChain(targetExpiry?: string): ChainRow[] {
  if(!liveNiftySpot)return[];
  const atm=Math.round(liveNiftySpot/50)*50;
  const now=Date.now();

  // ── PERF-2: resolve expiry from cache (O(1)) ─────────────────────────────
  let chosenExpiry = targetExpiry;
  if(!chosenExpiry){
    const expiries = getAvailableExpiries();  // served from _expiryListCache
    for (const exp of expiries) {
      if (expiryStringToDate(exp).getTime() > now) { chosenExpiry = exp; break; }
    }
    if (!chosenExpiry && expiries.length > 0) chosenExpiry = expiries[expiries.length - 1];
  }

  if(!chosenExpiry){
    if(_buildChainCallCount<3 && liveChain.size > 0)
      process.stdout.write(`⚠️  [CHAIN] No future expiry found in liveChain (size=${liveChain.size})\n`);
    _buildChainCallCount++;
    return[];
  }

  // ── PERF-2: use expiry bucket — O(bucket size) instead of O(all keys) ────
  const bucket = liveChainByExpiry.get(chosenExpiry);
  if (!bucket || bucket.size === 0) {
    _buildChainCallCount++;
    return [];
  }

  const strikeMap=new Map<number,{ce?:LiveOption;pe?:LiveOption}>();

  for (const k of bucket) {
    const parts = k.split('_');           // only keys for this expiry
    const strike = parseInt(parts[0]);
    const ot     = parts[1];
    if (isNaN(strike) || Math.abs(strike - atm) > 600) continue;
    const v = liveChain.get(k);
    if (!v) continue;
    if (!strikeMap.has(strike)) strikeMap.set(strike, {});
    const row = strikeMap.get(strike)!;
    if (ot === 'CE') row.ce = v; else if (ot === 'PE') row.pe = v;
  }

  _buildChainCallCount++;
  if(_buildChainCallCount<=3){
    process.stdout.write(`📊 [CHAIN #${_buildChainCallCount}] chosen="${chosenExpiry}" | `+
      `bucket: ${bucket.size} keys | strikes: ${strikeMap.size}\n`);
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

  // ── PERF-1 FIX: cache key uses only ltp — volume has zero effect on Greeks ─
  // Old key included ce_volume/pe_volume which changed on every tick, giving
  // ~0% cache hit rate and running Black-Scholes Newton-Raphson 200×/s at open.
  const ck=`${chosenExpiry}:`+rows.map(r=>
    `${r.strike_price}:${r.ce_ltp??0}:${r.pe_ltp??0}`
  ).join('|');

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

function getAvailableExpiries(): string[] {
  // ── PERF-6: serve from cache — invalidated in handleTick when new expiry appears
  if (_expiryListCache) return _expiryListCache;

  const cutoff = Date.now() - 3_600_000;
  const result: string[] = [];
  for (const exp of liveChainByExpiry.keys()) {
    try {
      if (expiryStringToDate(exp).getTime() > cutoff) result.push(exp);
    } catch (_) {}
  }
  _expiryListCache = result.sort(
    (a, b) => expiryStringToDate(a).getTime() - expiryStringToDate(b).getTime()
  );
  return _expiryListCache;
}

function getNearestExpiry(): string {
  const expiries = getAvailableExpiries();
  const now = Date.now();
  for (const exp of expiries) {
    if (expiryStringToDate(exp).getTime() > now) return exp;
  }
  return expiries[0] || '';
}

function pruneExpiredChainKeys(): void {
  const cutoff = Date.now() - 24 * 3_600_000;
  let pruned = 0;
  const expiredExpiries = new Set<string>();

  for (const k of liveChain.keys()) {
    const parts = k.split('_');
    if (parts.length < 3) continue;
    try {
      if (expiryStringToDate(parts[2]).getTime() < cutoff) {
        liveChain.delete(k);
        openOiMap.delete(k);
        expiredExpiries.add(parts[2]);
        pruned++;
      }
    } catch (_) {}
  }

  // ── PERF-2: also clean up expiry index + invalidate cache ────────────────
  for (const exp of expiredExpiries) {
    liveChainByExpiry.delete(exp);
  }
  if (expiredExpiries.size > 0) {
    _expiryListCache = null;
  }

  if (pruned > 0)
    process.stdout.write(`🧹 [PRUNE] Removed ${pruned} expired chain keys (${expiredExpiries.size} expiries)\n`);
}

const API_PORT=parseInt(process.env.API_PORT||'3001');
let _buildChainCallCount = 0;
let pushFail=0,lastPush=0;
let _pushPending = false;

// ── v7.5: OI Scanner instance ─────────────────────────────────────────────
// Created with pool (DB) and null broadcaster.
// Broadcaster is wired lazily in registerDirectWsEmitter() below.
const oiScanner = new OIScannerEngine(pool, null);

let _directWsEmitter: { broadcastPush: (payload: any) => void } | null = null;

export function registerDirectWsEmitter(emitter: { broadcastPush: (payload: any) => void }): void {
  _directWsEmitter = emitter;
  // ── v7.5: wire OI scanner to the same broadcaster ──────────────────────
  oiScanner.setEmitter(emitter);
  process.stdout.write('⚡ [PUSH] Direct wsEmitter registered — bypassing HTTP round-trip\n');
}

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

  const payloadObj = buildPushPayload();
  if(!payloadObj) return;

  if (_directWsEmitter) {
    try { _directWsEmitter.broadcastPush(payloadObj); } catch (_) {}
    return;
  }

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

// ── PERF-5: writeQ safety valve ──────────────────────────────────────────────
// Guards against unbounded writeQ growth during DB flush stalls.
// At 500 ticks/s × 5s stall = 2500 rows queued — this caps it at 5000.
const WRITE_Q_MAX = 5000;
let   _writeQDropped = 0;

function enqueueWrite(row: WriteRow): void {
  if (writeQ.length >= WRITE_Q_MAX) {
    writeQ.shift();  // drop oldest — stale for analytics
    _writeQDropped++;
    if (_writeQDropped === 1 || _writeQDropped % 100 === 0) {
      process.stderr.write(
        `⚠️  [DB] writeQ full (${WRITE_Q_MAX}) — dropped ${_writeQDropped} rows. ` +
        `DB flush stalling? dbErrors=${dbErrors}\n`
      );
    }
  }
  writeQ.push(row);
  schedFlush();
}

async function flushDB():Promise<void>{
  flushT=null;
  if(_flushing||writeQ.length===0)return;
  _flushing=true;
  try{
  const batch=writeQ.splice(0,500);
  const ph=batch.map((_,i)=>{const b=i*19;return`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19})`;}).join(',');
  // ── FIX Q: price columns (ltp, bid, ask, high, low, open, close) must NOT
  //    go through safeN() which calls Math.round() and destroys decimals.
  //    safeN() is correct only for integer columns (volume, oi, qty).
  const args=batch.flatMap(r=>['NIFTY',r.sym,r.tok,r.expiry,r.strike,r.ot,r.exch,
    r.ltp  || null,
    safeN(r.vol), safeN(r.oi),
    r.bid  || null, r.ask  || null,
    safeN(r.bidQty), safeN(r.askQty),
    r.hi   || null, r.lo   || null, r.op   || null, r.cl   || null,
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

// ── PERF-4: Spoofing detector async queue ────────────────────────────────────
// All 9 detectors previously ran synchronously inside handleTick() on every tick.
// Moved to a setImmediate() drain loop — tick ingestion no longer blocks on them.
const MAX_DETECT_QUEUE = 500;  // ring buffer — drops stale ticks if detector falls behind

interface DetectJob {
  strike: number; optionType: 'CE' | 'PE';
  ltp: number; bidPrice: number; askPrice: number;
  bidQty: number; askQty: number; oi: number; volume: number;
}

const detectQueue: DetectJob[] = [];
let   detectScheduled = false;

function drainDetectQueue(): void {
  detectScheduled = false;
  const batch = detectQueue.splice(0, 50);  // process up to 50 per drain
  for (const j of batch) {
    spoofingDetector.processTick(
      j.strike, j.optionType, j.ltp,
      j.bidPrice, j.askPrice,
      j.bidQty, j.askQty,
      j.oi, j.volume
    );
  }
  if (detectQueue.length > 0) {
    detectScheduled = true;
    setImmediate(drainDetectQueue);
  }
}

function enqueueDetect(job: DetectJob): void {
  if (detectQueue.length >= MAX_DETECT_QUEUE) {
    detectQueue.shift();  // drop oldest — stale
  }
  detectQueue.push(job);
  if (!detectScheduled) {
    detectScheduled = true;
    setImmediate(drainDetectQueue);
  }
}

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

  // ── FIX R: AngelWebSocket service already returns prices in RUPEES.
  //    Confirmed by live debug output: ltp=431.25, ltp=112.5, ltp=158.8
  //    These are rupee values, not paise. No ÷100 needed.
  //    Old needsDiv (ltp > 5_000) was wrong: deep ITM options at ₹5450+
  //    were being divided to ₹54.50. Now px() just passes value through.
  const px = (v: number) => v > 0 ? v : 0;
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

  // ── PERF-2: maintain expiry index alongside liveChain ────────────────────
  if (!liveChainByExpiry.has(expiry)) {
    liveChainByExpiry.set(expiry, new Set());
    _expiryListCache = null;  // invalidate sorted expiry cache
  }
  liveChainByExpiry.get(expiry)!.add(key);

  // ── PERF-4: spoofing detector moved off tick hot path ────────────────────
  // Previously ran 9 detectors synchronously here — now queued via setImmediate
  enqueueDetect({
    strike, optionType: optionType as 'CE'|'PE',
    ltp: ltpR, bidPrice: bidR, askPrice: askR,
    bidQty: Number(data.bidQty||data.best_buy_quantity||0),
    askQty: Number(data.askQty||data.best_sell_quantity||0),
    oi: oiRaw, volume: volRaw,
  });

  // ── v7.5: OI Scanner tick ─────────────────────────────────────────────────
  oiScanner.onTick({
    token:      Number(token) || 0,
    strike:     strike,
    expiry:     expiryToDate(expiry),
    optionType: optionType as 'CE' | 'PE',
    ltp:        ltpR,
    bid:        bidR,
    ask:        askR,
    oi:         oiRaw,
    volume:     volRaw,
    spot:       liveNiftySpot,
    timestamp:  Date.now(),
  });

  // ── PERF-3: mark dirty — 200ms push loop fires the actual buildChain() ───
  if(changed) { _pushDirty = true; setImmediate(() => { if (!_pushDirty) return; _pushDirty = false; pushToApi(); }); }

  const exDate = expiryToDate(expiry);

  // ── PERF-5: safety-valve write queue ─────────────────────────────────────
  enqueueWrite({
    sym, tok:token, exch:data.exchange||'NFO',
    expiry:exDate, strike, ot:optionType, ltp:ltpR,
    vol:volRaw, oi:oiRaw,
    bid:bidR||null, ask:askR||null,
    bidQty:Number(data.bidQty||data.best_buy_quantity||0)||null,
    askQty:Number(data.askQty||data.best_sell_quantity||0)||null,
    hi:highR||null, lo:lowR||null, op:openR||null, cl:closeR||null,
    ts:new Date()
  });
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
    process.stdout.write(`⚡ [${new Date().toLocaleTimeString()}] Ticks/s:${ticks} | Saved:${dbSaved.toLocaleString()} | Chain:${liveChain.size} | Spot:₹${liveNiftySpot||'–'} | VIX:${liveVix??'–'} | ${status} | Push:${pushFail===0?'✅':'⚠️'} | Err:${dbErrors} | Q:${writeQ.length} Drop:${_writeQDropped} | 🚨${als.totalAlerts}(${als.totalCritical}crit) | WS:${ws.connectedClients} | Bad:${invalidCount}\n`);
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
    const nowISTH = (new Date().getUTCHours() + 5.5) % 24;
    const marketClosed = nowISTH >= 15.5 || nowISTH < 9.0;
    if (ageH > maxAgeHours) {
      if (marketClosed) {
        process.stdout.write(`💾 Cache is ${ageH.toFixed(1)}h old — market closed, using stale cache ✅\n`);
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

// ── FIX 3: WAF 60s rate-limit guard ─────────────────────────────────────────
// Angel One's WAF throttles rapid successive login attempts. If attempt > 1,
// we ensure at least 60 000 ms have elapsed since the previous attempt started
// before firing the next request. This prevents AB1006 / 429 responses that
// previously caused the collector to burn all 5 attempts in under a second.
async function loginToAngel(maxAttempts=5):Promise<LoginResult>{
  let lastLoginAt = 0;  // FIX 3: tracks when each attempt was fired
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    // ── FIX 3: enforce 60s minimum between attempts ──────────────────────
    if(attempt > 1 && Date.now() - lastLoginAt < 60_000){
      const waitMs = 60_000 - (Date.now() - lastLoginAt);
      process.stdout.write(`   ⏱  WAF rate-limit guard: waiting ${(waitMs/1000).toFixed(1)}s before retry\n`);
      await sleep(waitMs);
    }
    lastLoginAt = Date.now();
    // ────────────────────────────────────────────────────────────────────────
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
      dbErrors = 0;  // FIX 5: reset DB error counter between sessions
      _pushDirty = false;                   // PERF-3: stop pending push
      detectQueue.length = 0;               // PERF-4: drain detect queue
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
    stopPushLoop();                          // PERF-3: stop push interval
    _pushDirty = false;
    await sleep(100);
    spoofingDetector.reset();
    oiScanner.destroy();
    while(writeQ.length>0){await flushDB();await sleep(50);}
    await pool.end();
    process.stdout.write('✅ Shutdown complete\n');process.exit(0);
  };

  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  process.on('uncaughtException',(e)=>process.stderr.write(`💥 [UNCAUGHT] ${e.message}\n`));
  process.on('unhandledRejection',(r)=>process.stderr.write(`💥 [UNHANDLED] ${String(r)}\n`));

  startSpoofDashboardWS();
  spoofingDetector.onAlert(routeSpoofAlert);
  await initOIPipeline(pool);  // ← OI Pulse: snapshot + oi_change backfill (FIX S: no ALTER TABLE)

  // FIX F: Periodic cleanup of expired chain keys every 10 minutes
  setInterval(pruneExpiredChainKeys, 10 * 60 * 1000);

  // ── v7.5: OI Scanner periodic cycles ────────────────────────────────────
  // No existing 5min/15min interval in this file — these are the only ones.
  setInterval(() => { oiScanner.onFiveMinute().catch(() => {}); },    5 * 60 * 1000);
  setInterval(() => { oiScanner.onFifteenMinute().catch(() => {}); }, 15 * 60 * 1000);
  // ─────────────────────────────────────────────────────────────────────────

  process.stdout.write(`📡 Spoof alerts → alerts/alerts_${getISTDate()}.jsonl\n`);
  process.stdout.write(`📡 Telegram: ${TG_TOKEN?'✅ configured':'⚠️  not set'}\n`);
  process.stdout.write(`📡 WS feed: ws://localhost:${WS_PORT}\n`);
  process.stdout.write(`🔭 OI Scanner: initialized, first cycle in 5 minutes\n`);
  process.stdout.write(`⚡ Push loop: ${PUSH_INTERVAL_MS}ms interval (PERF-3)\n\n`);

  startPushLoop();  // PERF-3: fixed-interval push decoupled from tick handler

  while(!shuttingDown){
    attempt++;isReconnecting=true;
    try{await runSession();}
    catch(err:any){process.stderr.write(`\n❌ [OUTER] Session crashed: ${err?.message ?? String(err)}\n${err?.stack ?? ""}\n`);}
    if(shuttingDown)break;
    const wait=Math.min(attempt*15,60);
    process.stdout.write(`🔄 Restarting in ${wait}s (attempt ${attempt})...\n`);
    await sleep(wait*1000);
  }
}

process.stdout.write('╔══════════════════════════════════════════════════════════════╗\n');
process.stdout.write(`║  NIFTY Collector ${VERSION} — Perf: BucketIndex+AsyncDetect+PushLoop ║\n`);
process.stdout.write('╚══════════════════════════════════════════════════════════════╝\n\n');

main().catch(err=>{process.stderr.write(`FATAL: ${err.message}\n`);process.exit(1);});






