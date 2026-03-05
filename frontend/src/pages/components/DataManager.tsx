/**
 * DataManager.tsx
 * Location: D:\jobber-perfect\frontend\src\components\DataManager.tsx
 *
 * HOW TO ADD THIS TO YOUR DASHBOARD (4 steps at the very bottom of this file)
 */

import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SnapshotMeta {
  id: number; label: string; captured_at: string;
  spot_price: number; atm_strike: number; atm_iv: number | null;
  pcr_oi: number; days_to_expiry: number; row_count: number;
  expiry_date: string; tags: string[]; notes: string;
}
interface OIChange {
  strike: number;
  ce_oi_before: number; ce_oi_after: number; ce_oi_delta: number; ce_oi_pct: number;
  pe_oi_before: number; pe_oi_after: number; pe_oi_delta: number; pe_oi_pct: number;
}
interface CompareResult {
  before: { id:number; label:string; captured_at:string; spot:number; pcr:number; atm_iv:number|null };
  after:  { id:number; label:string; captured_at:string; spot:number; pcr:number; atm_iv:number|null };
  summary: { elapsed_minutes:number; spot_change:number; pcr_change:number; atm_iv_change:number };
  biggest_ce_build: OIChange[]; biggest_pe_build: OIChange[];
  biggest_ce_unwind: OIChange[]; biggest_pe_unwind: OIChange[];
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const nv = (v: any, fb = 0): number => { const p = Number(v); return (isNaN(p)||!isFinite(p)) ? fb : p; };
const fmtK = (v: any) => { const n=nv(v,0); if(n>=1e7) return (n/1e7).toFixed(1)+'Cr'; if(n>=1e5) return (n/1e5).toFixed(1)+'L'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return n.toFixed(0); };
const fmtIST = (iso: string) => { try { return new Date(iso).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); } catch { return iso; }};
const pcrCls = (p:number) => p<0.7 ? 'text-red-400' : p>1.3 ? 'text-green-400' : 'text-yellow-400';
const BASE = 'http://localhost:3001/api/excel';

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || res.statusText);
  return body;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
const Input: React.FC<{ label:string; value:string; onChange:(v:string)=>void; placeholder?:string; type?:string; disabled?:boolean }> =
  ({ label, value, onChange, placeholder, type='text', disabled }) => (
  <div>
    <div className="text-xs text-gray-500 mb-1">{label}</div>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-40" />
  </div>
);

const Card: React.FC<{ title:string; accent?:string; children:React.ReactNode }> = ({ title, accent='border-gray-800', children }) => (
  <div className={`bg-gray-900/70 border ${accent} rounded-xl p-4 mb-3`}>
    <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
    {children}
  </div>
);

const Btn: React.FC<{ onClick:()=>void; color?:string; disabled?:boolean; children:React.ReactNode }> =
  ({ onClick, color='bg-blue-700 hover:bg-blue-600', disabled, children }) => (
  <button onClick={onClick} disabled={disabled}
    className={`px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all ${disabled ? 'bg-gray-700 cursor-not-allowed opacity-50' : color}`}>
    {children}
  </button>
);

// ─── Main component ───────────────────────────────────────────────────────────
type T = 'export'|'snapshots'|'delete'|'compare'|'auto';

const DataManager: React.FC = () => {
  const [tab, setTab]                   = useState<T>('export');
  const [toast, setToast]               = useState<{msg:string;ok:boolean}|null>(null);
  const [snapshots, setSnapshots]       = useState<SnapshotMeta[]>([]);
  const [total, setTotal]               = useState(0);
  const [loadingList, setLoadingList]   = useState(false);
  const [cmpResult, setCmpResult]       = useState<CompareResult|null>(null);
  const [autoStatus, setAutoStatus]     = useState({running:false,intervalMinutes:0});

  // Export
  const [eLabel,setELabel]=useState(''); const [eTags,setETags]=useState(''); const [eNotes,setENotes]=useState(''); const [eSave,setESave]=useState(false); const [eLoading,setELoading]=useState(false);
  // Save
  const [sLabel,setSLabel]=useState(''); const [sTags,setSTags]=useState(''); const [sNotes,setSNotes]=useState(''); const [sLoading,setSLoading]=useState(false);
  // Snapshots filter
  const [search,setSearch]=useState(''); const [fTag,setFTag]=useState('');
  // Delete
  const [dIds,setDIds]=useState(''); const [dBefore,setDBefore]=useState(''); const [dDays,setDDays]=useState(''); const [dTags,setDTags]=useState(''); const [dryRun,setDryRun]=useState(true); const [dResult,setDResult]=useState<any>(null); const [dLoading,setDLoading]=useState(false);
  // Compare
  const [c1,setC1]=useState(''); const [c2,setC2]=useState(''); const [cLoading,setCLoading]=useState(false);
  // Auto
  const [aMins,setAMins]=useState('15'); const [aTag,setATag]=useState('auto');

  const showToast = (msg:string,ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),4000); };

  const loadSnaps = useCallback(async () => {
    setLoadingList(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set('search',search); if (fTag) p.set('tags',fTag);
      const r = await apiFetch(`/snapshot/list?${p}`);
      setSnapshots(r.data||[]); setTotal(r.total||0);
    } catch(e:any) { showToast(e.message,false); }
    finally { setLoadingList(false); }
  }, [search, fTag]);

  const loadAutoStatus = async () => { try { const r=await apiFetch('/autosave/status'); setAutoStatus(r); } catch {} };

  useEffect(() => { if(tab==='snapshots') loadSnaps(); if(tab==='auto') loadAutoStatus(); }, [tab, loadSnaps]);

  // ── Actions ──
  const doExport = async () => {
    setELoading(true);
    try {
      const p=new URLSearchParams();
      if(eLabel) p.set('label',eLabel); if(eTags) p.set('tags',eTags);
      if(eNotes) p.set('notes',eNotes); if(eSave) p.set('saveSnapshot','true');
      const res = await fetch(`${BASE}/export?${p}`);
      if(!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||res.statusText); }
      const blob=await res.blob(), url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]||'NIFTY_Options.xlsx';
      a.click(); URL.revokeObjectURL(url);
      const sid=res.headers.get('X-Snapshot-Id');
      showToast(`Downloaded!${sid?` Snapshot #${sid} saved.`:''}`);
      setELabel(''); setETags(''); setENotes('');
    } catch(e:any) { showToast(e.message,false); } finally { setELoading(false); }
  };

  const doSave = async () => {
    setSLoading(true);
    try {
      const r=await apiFetch('/snapshot/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:sLabel||undefined,tags:sTags?sTags.split(',').map(t=>t.trim()):[],notes:sNotes})});
      showToast(`Snapshot #${r.id} saved: "${r.label}"`);
      setSLabel(''); setSTags(''); setSNotes('');
    } catch(e:any) { showToast(e.message,false); } finally { setSLoading(false); }
  };

  const doDelete = async (real:boolean) => {
    setDLoading(true);
    try {
      const body:any={dryRun:!real};
      if(dIds) body.ids=dIds.split(',').map(x=>Number(x.trim())).filter(x=>!isNaN(x));
      if(dBefore) body.beforeDate=dBefore;
      if(dDays) body.olderThanDays=Number(dDays);
      if(dTags) body.tags=dTags.split(',').map(t=>t.trim());
      const r=await apiFetch('/snapshot',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      setDResult(r);
      if(real&&r.deleted>0) showToast(`Deleted ${r.deleted} snapshot(s)`);
    } catch(e:any) { showToast(e.message,false); } finally { setDLoading(false); }
  };

  const doCompare = async () => {
    if(!c1||!c2) return showToast('Enter both IDs',false);
    setCLoading(true);
    try { const r=await apiFetch(`/snapshot/compare?id1=${c1}&id2=${c2}`); setCmpResult(r.data); }
    catch(e:any) { showToast(e.message,false); } finally { setCLoading(false); }
  };

  const exportSnap = async (id:number) => {
    try {
      const res=await fetch(`${BASE}/snapshot/${id}/export`);
      if(!res.ok) throw new Error(await res.text());
      const blob=await res.blob(),url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=`Snapshot_${id}.xlsx`; a.click(); URL.revokeObjectURL(url);
      showToast(`Snapshot #${id} downloaded as Excel`);
    } catch(e:any) { showToast(e.message,false); }
  };

  const deleteSingle = async (id:number,label:string) => {
    if(!confirm(`Delete snapshot #${id} "${label}"?`)) return;
    try {
      await apiFetch('/snapshot',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id],dryRun:false})});
      showToast(`Deleted #${id}`);
      setSnapshots(prev=>prev.filter(s=>s.id!==id));
    } catch(e:any) { showToast(e.message,false); }
  };

  const toggleAuto = async () => {
    try {
      if(autoStatus.running) {
        await apiFetch('/autosave/stop',{method:'POST'});
        setAutoStatus({running:false,intervalMinutes:0}); showToast('Auto-snapshot stopped');
      } else {
        await apiFetch('/autosave/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intervalMinutes:Number(aMins),tag:aTag})});
        setAutoStatus({running:true,intervalMinutes:Number(aMins)}); showToast(`Auto-snapshot started: every ${aMins} min`);
      }
    } catch(e:any) { showToast(e.message,false); }
  };

  const TABS:[T,string][] = [['export','📤 Export'],['snapshots','📋 Snapshots'],['delete','🗑️ Delete'],['compare','🔄 Compare'],['auto','⏱️ Auto']];

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-200 overflow-hidden">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border flex items-center gap-3 ${toast.ok?'bg-green-950 border-green-700 text-green-300':'bg-red-950 border-red-700 text-red-300'}`}>
          {toast.ok?'✅':'❌'} {toast.msg}
          <button onClick={()=>setToast(null)} className="text-gray-500 hover:text-white">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="text-sm font-bold text-yellow-400">⚡ Options Chain Data Manager</div>
        <div className="text-xs text-gray-500 mt-0.5">Angel One → PostgreSQL → Excel  ·  All exports use your live data</div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0 bg-gray-900/50">
        {TABS.map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${tab===id?'text-blue-400 border-blue-500':'text-gray-500 hover:text-gray-300 border-transparent'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* ══ EXPORT ══════════════════════════════════════════════════════ */}
        {tab==='export' && <>
          <Card title="📥 Download Live Chain as Excel" accent="border-green-900/40">
            <p className="text-xs text-gray-500 mb-4">
              Reads your live Angel One data from the database and generates a 5-sheet Excel workbook:
              <span className="text-gray-400"> Dashboard · Options Chain · IV Analysis · OI Profile · Raw Data</span>
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input label="Label (optional)" value={eLabel} onChange={setELabel} placeholder="e.g. Pre-market 9:15 AM" />
              <Input label="Tags (comma-separated)" value={eTags} onChange={setETags} placeholder="e.g. morning, weekly" />
            </div>
            <div className="mb-3">
              <Input label="Notes" value={eNotes} onChange={setENotes} placeholder="Any context about this export..." />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer mb-4">
              <input type="checkbox" checked={eSave} onChange={e=>setESave(e.target.checked)} className="rounded" />
              Also save a snapshot to DB at the same time
            </label>
            <Btn onClick={doExport} color="bg-green-700 hover:bg-green-600" disabled={eLoading}>
              {eLoading ? '⏳ Building Excel...' : '📥 Download Excel'}
            </Btn>
          </Card>

          <Card title="💾 Save Snapshot Only (no download)" accent="border-blue-900/40">
            <p className="text-xs text-gray-500 mb-4">
              Saves the current options chain to PostgreSQL. Retrieve it any time later to download as Excel or compare with another snapshot.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input label="Label" value={sLabel} onChange={setSLabel} placeholder="e.g. Before RBI meeting" />
              <Input label="Tags" value={sTags} onChange={setSTags} placeholder="e.g. event, rbi" />
            </div>
            <div className="mb-3">
              <Input label="Notes" value={sNotes} onChange={setSNotes} placeholder="Market context..." />
            </div>
            <Btn onClick={doSave} disabled={sLoading}>
              {sLoading ? '⏳ Saving...' : '💾 Save Snapshot'}
            </Btn>
          </Card>
        </>}

        {/* ══ SNAPSHOTS ═══════════════════════════════════════════════════ */}
        {tab==='snapshots' && <>
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search by label..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
            <input value={fTag} onChange={e=>setFTag(e.target.value)} placeholder="Filter tag"
              className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
            <button onClick={loadSnaps} className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg">Search</button>
          </div>
          <div className="text-xs text-gray-600 mb-2">{loadingList ? 'Loading...' : `${total} snapshot(s)`}</div>

          <div className="space-y-2">
            {snapshots.map(s => (
              <div key={s.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-3 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs text-gray-600 font-mono">#{s.id}</span>
                      <span className="text-sm font-semibold text-yellow-400 truncate">{s.label}</span>
                      {s.tags.map(t=><span key={t} className="text-xs px-1.5 py-0.5 bg-blue-950 text-blue-400 border border-blue-900 rounded">{t}</span>)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-gray-500">{fmtIST(s.captured_at)} IST</span>
                      <span className="text-blue-300 font-bold">₹{nv(s.spot_price).toFixed(0)}</span>
                      <span className={`font-bold ${pcrCls(nv(s.pcr_oi))}`}>PCR {nv(s.pcr_oi).toFixed(2)}</span>
                      {s.atm_iv && <span className="text-orange-400">IV {s.atm_iv.toFixed(1)}%</span>}
                      <span className="text-gray-600">{s.row_count} strikes · DTE {s.days_to_expiry}</span>
                    </div>
                    {s.notes && <div className="text-xs text-gray-600 mt-1 italic">{s.notes}</div>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={()=>exportSnap(s.id)} className="px-2 py-1 text-xs bg-green-900/50 hover:bg-green-800 text-green-400 border border-green-900 rounded-lg">📥 Excel</button>
                    <button onClick={()=>{setC1(String(s.id));setTab('compare');}} className="px-2 py-1 text-xs bg-purple-900/50 hover:bg-purple-800 text-purple-400 border border-purple-900 rounded-lg">🔄 Cmp</button>
                    <button onClick={()=>deleteSingle(s.id,s.label)} className="px-2 py-1 text-xs bg-red-900/40 hover:bg-red-900 text-red-400 border border-red-900 rounded-lg">🗑️</button>
                  </div>
                </div>
              </div>
            ))}
            {snapshots.length===0 && !loadingList && (
              <div className="text-center py-12 text-gray-600">
                <div className="text-3xl mb-2">💾</div>
                <div className="text-sm">No snapshots yet — save one from the Export tab</div>
              </div>
            )}
          </div>
        </>}

        {/* ══ DELETE ══════════════════════════════════════════════════════ */}
        {tab==='delete' && <>
          <Card title="🗑️ Delete Snapshots" accent="border-red-900/40">
            <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 mb-4">
              ⚠️ Always Preview first. Use filters below — you can combine them.
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Input label="By IDs (comma-separated)" value={dIds} onChange={setDIds} placeholder="e.g. 1, 3, 7" />
              <Input label="Older than (days)" value={dDays} onChange={setDDays} placeholder="e.g. 7" type="number" />
              <Input label="Before date" value={dBefore} onChange={setDBefore} type="date" />
              <Input label="By tags (comma-separated)" value={dTags} onChange={setDTags} placeholder="e.g. auto, test" />
            </div>
            <label className="flex items-center gap-2 text-xs text-yellow-400 cursor-pointer mb-4 font-semibold">
              <input type="checkbox" checked={dryRun} onChange={e=>setDryRun(e.target.checked)} className="rounded" />
              Dry Run — preview only, don't actually delete
            </label>
            <div className="flex gap-3">
              <Btn onClick={()=>doDelete(false)} disabled={dLoading}>🔍 Preview</Btn>
              <Btn onClick={()=>doDelete(true)} disabled={dLoading||dryRun} color={dryRun?'bg-gray-700 cursor-not-allowed':'bg-red-700 hover:bg-red-600'}>
                🗑️ Delete Now {dryRun&&'(uncheck Dry Run)'}
              </Btn>
            </div>
          </Card>
          {dResult && (
            <div className={`border rounded-xl p-4 ${dResult.dryRun?'bg-yellow-950/20 border-yellow-900/40':'bg-red-950/20 border-red-900/40'}`}>
              <div className={`font-bold text-sm mb-1 ${dResult.dryRun?'text-yellow-400':'text-red-400'}`}>
                {dResult.dryRun?'📋 Dry Run Preview':'🗑️ Deletion Complete'}
              </div>
              <div className="text-sm text-gray-300">{dResult.deleted} snapshot(s) {dResult.dryRun?'would be':'were'} deleted</div>
              {dResult.ids?.length>0 && <div className="text-xs text-gray-500 mt-1">IDs: {dResult.ids.join(', ')}</div>}
              {dResult.dryRun && dResult.deleted>0 && (
                <button onClick={()=>setDryRun(false)} className="mt-2 text-xs text-red-400 border border-red-800 px-3 py-1 rounded-lg hover:bg-red-900/20">
                  → Uncheck Dry Run above then click Delete Now
                </button>
              )}
            </div>
          )}
        </>}

        {/* ══ COMPARE ═════════════════════════════════════════════════════ */}
        {tab==='compare' && <>
          <Card title="🔄 Compare Two Snapshots" accent="border-purple-900/40">
            <p className="text-xs text-gray-500 mb-3">
              Shows exact OI change strike-by-strike between two snapshots — which strikes built/unwound calls or puts, spot move, PCR shift, IV change.
              <br/><span className="text-gray-400">Tip: In the Snapshots tab, click 🔄 Cmp on any row to pre-fill ID 1.</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Snapshot ID 1 (BEFORE)" value={c1} onChange={setC1} placeholder="e.g. 5" type="number" />
              <Input label="Snapshot ID 2 (AFTER)"  value={c2} onChange={setC2} placeholder="e.g. 12" type="number" />
              <div className="flex flex-col justify-end">
                <Btn onClick={doCompare} disabled={cLoading||!c1||!c2} color="bg-purple-700 hover:bg-purple-600">
                  {cLoading?'⏳ Comparing...':'🔄 Compare'}
                </Btn>
              </div>
            </div>
          </Card>

          {cmpResult && <>
            {/* Before / After cards */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              {([['BEFORE',cmpResult.before],['AFTER',cmpResult.after]] as const).map(([side,s])=>(
                <div key={side} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-0.5">{side} — #{s.id}</div>
                  <div className="text-sm font-semibold text-yellow-400 truncate mb-1">{s.label}</div>
                  <div className="text-xs text-gray-500 mb-2">{fmtIST(s.captured_at)} IST</div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-300 font-bold">₹{nv(s.spot).toFixed(0)}</span>
                    <span className={`font-bold ${pcrCls(nv(s.pcr))}`}>PCR {nv(s.pcr).toFixed(3)}</span>
                    {s.atm_iv!=null && <span className="text-orange-400">IV {nv(s.atm_iv).toFixed(1)}%</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary deltas */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                ['⏱️ Elapsed',`${cmpResult.summary.elapsed_minutes} min`,'text-gray-400'],
                ['📈 Spot Δ',`${cmpResult.summary.spot_change>=0?'+':''}${cmpResult.summary.spot_change.toFixed(0)} pts`,cmpResult.summary.spot_change>=0?'text-green-400':'text-red-400'],
                ['📊 PCR Δ',`${cmpResult.summary.pcr_change>=0?'+':''}${cmpResult.summary.pcr_change.toFixed(3)}`,cmpResult.summary.pcr_change>=0?'text-green-400':'text-red-400'],
                ['🌊 IV Δ',`${cmpResult.summary.atm_iv_change>=0?'+':''}${cmpResult.summary.atm_iv_change.toFixed(2)}%`,cmpResult.summary.atm_iv_change>=0?'text-orange-400':'text-blue-400'],
              ].map(([l,v,c])=>(
                <div key={l as string} className="bg-gray-900 border border-gray-800 rounded-lg p-2 text-center">
                  <div className="text-xs text-gray-600">{l}</div>
                  <div className={`text-sm font-bold mt-0.5 ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            {/* OI build/unwind sections */}
            {(['biggest_ce_build','biggest_pe_build','biggest_ce_unwind','biggest_pe_unwind'] as const).map(key=>{
              const items=cmpResult[key]; if(!items?.length) return null;
              const isCE=key.includes('ce'), isBuild=key.includes('build');
              return (
                <div key={key} className={`mb-3 border rounded-xl p-3 ${isCE?'border-green-900/40 bg-green-950/10':'border-red-900/40 bg-red-950/10'}`}>
                  <h4 className={`text-xs font-bold mb-2 ${isCE?'text-green-400':'text-red-400'}`}>
                    {isBuild?'📈 OI Build':'📉 OI Unwind'} — {isCE?'CALLS':'PUTS'}
                  </h4>
                  {items.map((c:OIChange)=>{
                    const before=isCE?c.ce_oi_before:c.pe_oi_before, after=isCE?c.ce_oi_after:c.pe_oi_after;
                    const delta=isCE?c.ce_oi_delta:c.pe_oi_delta, pct=isCE?c.ce_oi_pct:c.pe_oi_pct;
                    return (
                      <div key={c.strike} className="flex items-center gap-3 text-xs mb-1">
                        <span className="text-yellow-400 font-bold w-14 text-right">{c.strike}</span>
                        <span className="text-gray-500">{fmtK(before)} → {fmtK(after)}</span>
                        <span className={`font-bold ${isBuild?'text-green-400':'text-red-400'}`}>
                          {delta>=0?'+':''}{fmtK(delta)} ({pct>=0?'+':''}{pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>}
        </>}

        {/* ══ AUTO ════════════════════════════════════════════════════════ */}
        {tab==='auto' && <>
          <Card title="⏱️ Auto-Snapshot Scheduler" accent={autoStatus.running?'border-green-800':'border-gray-800'}>
            <p className="text-xs text-gray-500 mb-4">
              Runs on the backend server. Saves a full snapshot of the live Angel One options chain every N minutes automatically — no need to keep the browser open.
            </p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold mb-5 border ${autoStatus.running?'bg-green-950 border-green-800 text-green-400':'bg-gray-900 border-gray-700 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${autoStatus.running?'bg-green-400 animate-pulse':'bg-gray-600'}`} />
              {autoStatus.running?`RUNNING — every ${autoStatus.intervalMinutes} min`:'STOPPED'}
            </div>
            <div className={`grid grid-cols-2 gap-3 mb-4 ${autoStatus.running?'opacity-40 pointer-events-none':''}`}>
              <Input label="Interval (minutes)" value={aMins} onChange={setAMins} placeholder="15" type="number" />
              <Input label="Tag for saved snapshots" value={aTag} onChange={setATag} placeholder="auto" />
            </div>
            <Btn onClick={toggleAuto} color={autoStatus.running?'bg-red-700 hover:bg-red-600':'bg-green-700 hover:bg-green-600'}>
              {autoStatus.running?'⏹️ Stop Auto-Snapshot':`▶️ Start (every ${aMins} min)`}
            </Btn>
          </Card>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-500 space-y-1.5">
            <div className="font-semibold text-gray-400 mb-2">How it works:</div>
            <div>1. Click Start → backend saves a snapshot every {aMins} min</div>
            <div>2. Each snapshot has your live Angel One chain + Greeks + timestamp</div>
            <div>3. Snapshots get tagged "<span className="text-blue-400">{aTag}</span>" so you can filter them</div>
            <div>4. Go to Snapshots tab to browse them, Compare tab to diff any two</div>
            <div>5. Download any saved snapshot as Excel at any time</div>
            <div className="text-yellow-700 pt-1">⚠️ Scheduler stops if the backend server restarts</div>
          </div>
        </>}
      </div>
    </div>
  );
};

export default DataManager;

/*
 ════════════════════════════════════════════════════════════════════
  HOW TO ADD "⚡ Data" TAB TO YOUR DASHBOARD.TSX  (4 steps)
 ════════════════════════════════════════════════════════════════════

 STEP 1 — Copy this file to:
   D:\jobber-perfect\frontend\src\components\DataManager.tsx

 STEP 2 — Open Dashboard.tsx and add the import near the top:
   import DataManager from './components/DataManager';

 STEP 3 — Find this line in Dashboard.tsx (~line 49):
   type Tab = 'chain' | 'charts' | 'signals' | 'analytics';
   Change it to:
   type Tab = 'chain' | 'charts' | 'signals' | 'analytics' | 'data';

 STEP 4 — Find the tab button array (~line 774):
   (['chain','charts','signals','analytics'] as Tab[])
   Change it to:
   (['chain','charts','signals','analytics','data'] as Tab[])

   Then find the label for 'analytics' tab (~line 782):
   : '📐 Analytics'}
   Change it to:
   : tab === 'analytics' ? '📐 Analytics'
   : '⚡ Data'}

 STEP 5 — After the analytics tab content block, add:
   {activeTab === 'data' && (
     <div className="h-full overflow-hidden">
       <DataManager />
     </div>
   )}

 DONE! You will see "⚡ Data" as a new tab in your dashboard.
 ════════════════════════════════════════════════════════════════════
*/
