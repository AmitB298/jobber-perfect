import { useState, useEffect } from 'react';
import { useAppStore, selectUser } from '../store/appStore';
import { applyTheme } from '../hooks/useTheme';

const API_URL = 'https://web-production-8a8e1.up.railway.app/api';

const THEMES = [
  { id: 'dark', label: 'Midnight Dark', icon: '🌑', swatches: ['#0a0a0a','#111111','#f97316'] },
  { id: 'crimson',  label: 'Crimson',        icon: '🔴',  swatches: ['#0d0005','#130008','#f43f5e'] },
  { id: 'nord',     label: 'Nord',           icon: '🧊',  swatches: ['#191d2b','#232938','#88c0d0'] },
  { id: 'matrix',   label: 'Matrix Green',   icon: '💚',  swatches: ['#0d0d0d','#111','#00ff41'] },
  { id: 'ocean',    label: 'Ocean Blue',     icon: '🌊',  swatches: ['#060d1a','#0d1b2e','#38bdf8'] },
  { id: 'dusk',     label: 'Dusk',           icon: '🌆',  swatches: ['#13101e','#1e1530','#a78bfa'] },
];

const SECTIONS = [
  { id: 'overview',     label: 'Overview',     icon: '◈' },
  { id: 'subscription', label: 'Subscription', icon: '◆' },
  { id: 'security',     label: 'Security',     icon: '⬡' },
  { id: 'angelone',     label: 'Angel One',    icon: '📡' },
  { id: 'preferences',  label: 'Preferences',  icon: '◉' },
  { id: 'about',        label: 'About',        icon: '◎' },
];

function InputRow({ label, value, onChange, show, onToggleShow, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  show?: boolean; onToggleShow?: () => void; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          type={show !== undefined ? (show ? 'text' : 'password') : 'password'}
          placeholder={placeholder || ''}
          maxLength={6}
          style={{
            flex: 1, background: '#0d0d0d', border: '1px solid #222',
            borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
            fontSize: 14, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: show ? '0.12em' : '0.3em',
          }}
        />
        {onToggleShow && (
          <button onClick={onToggleShow} title={show ? 'Hide' : 'Show'} style={{
            background: '#111', border: '1px solid #222', borderRadius: 6,
            padding: '8px 10px', color: show ? '#f97316' : '#4b5563',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
          }}>{show ? '🙈' : '👁'}</button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ? '#f97316' : '#f1f5f9', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}

function Overview({ user }: { user: any }) {
  const initials = (user?.name || user?.mobile || 'U').slice(0, 2).toUpperCase();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'linear-gradient(135deg,#f97316,#dc2626)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 800, color: '#fff', flexShrink: 0,
          boxShadow: '0 0 0 3px #1a1a1a, 0 0 0 5px #f9731640',
        }}>{initials}</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>{user?.name || 'Trader'}</div>
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3 }}>+91 {user?.mobile || '—'}</div>
          <div style={{
            display: 'inline-block', marginTop: 6, padding: '2px 10px',
            background: '#f97316', borderRadius: 99, fontSize: 11,
            fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>Active</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Stat label="Plan" value="Jobber Pro" accent />
        <Stat label="Member since" value="Mar 2026" />
        <Stat label="Status" value="Verified" />
      </div>
    </div>
  );
}

function Subscription() {
  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg,#1a0f00,#0f0800)',
        border: '1px solid #f9731620', borderRadius: 10, padding: 20, marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Current Plan</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9' }}>Jobber Pro</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Full options analytics access</div>
          </div>
          <div style={{ background: '#f97316', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: '#000' }}>ACTIVE</div>
        </div>
        <div style={{ height: 1, background: '#1f1f1f', margin: '16px 0' }} />
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {['VPIN Signal','OBI-L1','Options Chain','Spoofing Detector','Live Greeks'].map(f => (
            <div key={f} style={{ fontSize: 12, color: '#9ca3af' }}>
              <span style={{ color: '#22c55e', marginRight: 5 }}>✓</span>{f}
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: '#6b7280' }}>For billing enquiries contact <span style={{ color: '#f97316' }}>support@optionslab.in</span></div>
      </div>
    </div>
  );
}

function Security({ user }: { user: any }) {
  const [cur, setCur]     = useState('');
  const [next, setNext]   = useState('');
  const [confirm, setCnf] = useState('');
  const [showCur, setSC]  = useState(false);
  const [showNxt, setSN]  = useState(false);
  const [showCnf, setSD]  = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    setStatus(null);
    if (!cur || !next || !confirm) return setStatus({ ok: false, msg: 'All fields are required.' });
    if (!/^\d{6}$/.test(next)) return setStatus({ ok: false, msg: 'New MPIN must be exactly 6 digits.' });
    if (next !== confirm) return setStatus({ ok: false, msg: 'New MPIN and confirm do not match.' });
    setLoading(true);
    try {
      const res = await fetch(API_URL + '/auth/change-mpin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: user?.mobile, currentMpin: cur, newMpin: next }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ ok: true, msg: 'MPIN updated successfully.' });
        setCur(''); setNext(''); setCnf('');
      } else {
        setStatus({ ok: false, msg: data.message || 'Update failed.' });
      }
    } catch {
      setStatus({ ok: false, msg: 'Cannot reach server.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Change your 6-digit MPIN used to log in to Jobber Pro.</div>
      <InputRow label="Current MPIN"     value={cur}     onChange={setCur}  show={showCur} onToggleShow={() => setSC(v => !v)} placeholder="------" />
      <InputRow label="New MPIN"         value={next}    onChange={setNext} show={showNxt} onToggleShow={() => setSN(v => !v)} placeholder="------" />
      <InputRow label="Confirm New MPIN" value={confirm} onChange={setCnf}  show={showCnf} onToggleShow={() => setSD(v => !v)} placeholder="------" />
      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 7, marginBottom: 14, fontSize: 13,
          background: status.ok ? '#052e16' : '#2d0a0a',
          border: '1px solid ' + (status.ok ? '#16a34a' : '#7f1d1d'),
          color: status.ok ? '#4ade80' : '#fca5a5',
        }}>{status.msg}</div>
      )}
      <button onClick={handleChange} disabled={loading} style={{
        background: loading ? '#333' : 'linear-gradient(90deg,#f97316,#dc2626)',
        border: 'none', borderRadius: 7, padding: '10px 22px',
        color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        letterSpacing: '0.05em',
      }}>{loading ? 'Updating…' : 'Update MPIN'}</button>
    </div>
  );
}

// ─── Angel One Settings ───────────────────────────────────────────────────────
function AngelOne({ user }: { user: any }) {
  const [apiKey,  setApiKey]  = useState('');
  const [totpKey, setTotpKey] = useState('');
  const [mpin,    setMpin]    = useState('');
  const [showApiKey, setSAK]  = useState(false);
  const [showTotp,   setST]   = useState(false);
  const [showMpin,   setSP]   = useState(false);
  const [status,   setStatus]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [savedAt,  setSavedAt]  = useState<string | null>(null);

  const token = (() => { try { return localStorage.getItem('optionlab_token') || ''; } catch { return ''; } })();

  // Load current config status on mount (masked — never exposes secrets)
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/angel/credentials`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setIsConfigured(d.data.isConfigured);
          setSavedAt(d.data.updated_at);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setStatus(null);
    if (!apiKey.trim() && !totpKey.trim() && !mpin.trim()) {
      return setStatus({ ok: false, msg: 'Enter at least one field to update.' });
    }
    if (mpin.trim() && !/^\d{4}$/.test(mpin.trim())) {
      return setStatus({ ok: false, msg: 'Angel One MPIN must be exactly 4 digits.' });
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/angel/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          api_key:     apiKey.trim()    || undefined,
          mpin:        mpin.trim()      || undefined,
          totp_secret: totpKey.trim()   || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsConfigured(true);
        setSavedAt(new Date().toISOString());
        setApiKey(''); setTotpKey(''); setMpin('');
        setStatus({ ok: true, msg: data.message });
      } else {
        setStatus({ ok: false, msg: data.message || 'Save failed.' });
      }
    } catch {
      setStatus({ ok: false, msg: 'Cannot reach server.' });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/angel/credentials`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setIsConfigured(false); setSavedAt(null);
        setApiKey(''); setTotpKey(''); setMpin('');
        setStatus({ ok: true, msg: 'Credentials cleared from server.' });
      }
    } catch {
      setStatus({ ok: false, msg: 'Cannot reach server.' });
    } finally {
      setLoading(false);
    }
  };

  const isConnected = isConfigured;

  return (
    <div>
      {/* Header info */}
      <div style={{
        background: 'linear-gradient(135deg,#00100a,#001a10)',
        border: '1px solid #00ff4120', borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 3 }}>Angel One Integration</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Live market data via Angel One SmartAPI WebSocket</div>
        </div>
        <div style={{
          padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
          background: isConnected ? '#052e16' : '#1a0a0a',
          border: '1px solid ' + (isConnected ? '#16a34a' : '#7f1d1d'),
          color: isConnected ? '#4ade80' : '#f87171',
        }}>{isConnected ? `● CONFIGURED${savedAt ? ' · ' + new Date(savedAt).toLocaleDateString('en-IN') : ''}` : '○ NOT SET'}</div>
      </div>

      {/* Locked: Client ID */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Client ID <span style={{ color: '#374151', fontSize: 10 }}>— cannot be changed</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={user?.angel_one_client_id || '—'}
            readOnly
            style={{
              flex: 1, background: '#080808', border: '1px solid #1a1a1a',
              borderRadius: 6, padding: '8px 10px', color: '#374151',
              fontSize: 14, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
              cursor: 'not-allowed',
            }}
          />
          <span style={{ fontSize: 16 }}>🔒</span>
        </div>
      </div>

      <div style={{ height: 1, background: '#111', margin: '18px 0' }} />
      <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        API Credentials — stored locally on this device
      </div>

      {/* API Key */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>API Key</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            type={showApiKey ? 'text' : 'password'}
            placeholder="Your Angel One API Key"
            maxLength={64}
            style={{
              flex: 1, background: '#0d0d0d', border: '1px solid #222',
              borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
              fontSize: 13, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
            }}
          />
          <button onClick={() => setSAK(v => !v)} style={{
            background: '#111', border: '1px solid #222', borderRadius: 6,
            padding: '8px 10px', color: showApiKey ? '#f97316' : '#4b5563',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
          }}>{showApiKey ? '🙈' : '👁'}</button>
        </div>
      </div>

      {/* TOTP Secret Key */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>TOTP Secret Key</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={totpKey}
            onChange={e => setTotpKey(e.target.value)}
            type={showTotp ? 'text' : 'password'}
            placeholder="TOTP secret for auto-login"
            maxLength={64}
            style={{
              flex: 1, background: '#0d0d0d', border: '1px solid #222',
              borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
              fontSize: 13, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
            }}
          />
          <button onClick={() => setST(v => !v)} style={{
            background: '#111', border: '1px solid #222', borderRadius: 6,
            padding: '8px 10px', color: showTotp ? '#f97316' : '#4b5563',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
          }}>{showTotp ? '🙈' : '👁'}</button>
        </div>
      </div>

      {/* Angel One MPIN (4-digit) */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Angel One MPIN <span style={{ color: '#4b5563', fontSize: 10 }}>— 4-digit login MPIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={mpin}
            onChange={e => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            type={showMpin ? 'text' : 'password'}
            placeholder="e.g. 1992"
            maxLength={4}
            style={{
              flex: 1, background: '#0d0d0d', border: '1px solid #222',
              borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
              fontSize: 13, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: showMpin ? '0.2em' : '0.4em',
            }}
          />
          <button onClick={() => setSP(v => !v)} style={{
            background: '#111', border: '1px solid #222', borderRadius: 6,
            padding: '8px 10px', color: showMpin ? '#f97316' : '#4b5563',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
          }}>{showMpin ? '🙈' : '👁'}</button>
        </div>
      </div>

      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 7, marginBottom: 14, fontSize: 13,
          background: status.ok ? '#052e16' : '#2d0a0a',
          border: '1px solid ' + (status.ok ? '#16a34a' : '#7f1d1d'),
          color: status.ok ? '#4ade80' : '#fca5a5',
        }}>{status.msg}</div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={loading} style={{
          background: loading ? '#333' : 'linear-gradient(90deg,#f97316,#dc2626)',
          border: 'none', borderRadius: 7, padding: '10px 22px',
          color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          letterSpacing: '0.05em',
        }}>{loading ? 'Saving…' : 'Save Credentials'}</button>
        <button onClick={handleClear} style={{
          background: 'transparent', border: '1px solid #333', borderRadius: 7, padding: '10px 18px',
          color: '#6b7280', fontSize: 13, cursor: 'pointer',
        }}>Clear</button>
      </div>

      <div style={{ marginTop: 18, padding: '10px 14px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 7 }}>
        <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
          🔐 Credentials are encrypted in the OptionLab database and synced to the server .env. They are never exposed in API responses — only masked previews are shown.
        </div>
      </div>
    </div>
  );
}

function Preferences() {
  const [active, setActive] = useState(localStorage.getItem('jp_theme') || 'dark');
  const handleTheme = (id: string) => { applyTheme(id); setActive(id); };
  return (
    <div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Choose a visual theme. Applied instantly and saved across sessions.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {THEMES.map(t => {
          const isActive = active === t.id;
          return (
            <button key={t.id} onClick={() => handleTheme(t.id)} style={{
              background: isActive ? '#0f0700' : '#0a0a0a',
              border: '1.5px solid ' + (isActive ? '#f97316' : '#1a1a1a'),
              borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
              textAlign: 'left', transition: 'all 0.15s ease',
              boxShadow: isActive ? '0 0 0 1px #f9731640' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#f97316' : '#d1d5db' }}>{t.label}</span>
                </div>
                {isActive && <span style={{ color: '#f97316', fontSize: 16 }}>✓</span>}
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {t.swatches.map((c, i) => (
                  <div key={i} style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid #2a2a2a' }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function About() {
  const rows: [string, string][] = [
    ['Version',   'v2.0.0'],
    ['Platform',  'Electron + React + Vite'],
    ['Backend',   'Railway — Express + PostgreSQL'],
    ['Data Feed', 'Angel One WebSocket (Live)'],
    ['Support',   'support@optionslab.in'],
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          background: 'linear-gradient(135deg,#f97316,#dc2626)', borderRadius: 10,
          padding: '10px 14px', fontSize: 20, fontWeight: 900, color: '#fff',
          fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.1em',
        }}>JP</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', fontFamily: 'Rajdhani, sans-serif' }}>JOBBER PRO</div>
          <div style={{ fontSize: 12, color: '#4b5563' }}>Professional NIFTY Options Analytics</div>
        </div>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #111', fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>{k}</span>
          <span style={{ color: '#d1d5db' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function Profile({ onClose }: { onClose: () => void }) {
  const user = useAppStore(selectUser);
  const setUser = useAppStore(s => s.setUser);
  const [section, setSection] = useState('overview');

  const handleLogout = () => {
    try { localStorage.removeItem('optionlab_token'); localStorage.removeItem('optionlab_user'); } catch {}
    setUser(null);
    onClose();
  };

  const renderSection = () => {
    switch (section) {
      case 'overview':     return <Overview user={user} />;
      case 'subscription': return <Subscription />;
      case 'security':     return <Security user={user} />;
      case 'angelone':     return <AngelOne user={user} />;
      case 'preferences':  return <Preferences />;
      case 'about':        return <About />;
      default:             return null;
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 640, maxWidth: '95vw', maxHeight: '88vh',
        background: '#050505', border: '1px solid #1a1a1a',
        borderRadius: 14, display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 80px rgba(0,0,0,0.9), 0 0 0 1px #f9731615',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px', borderBottom: '1px solid #111', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, color: '#f97316' }}>◈</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.05em' }}>ACCOUNT & PREFERENCES</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ width: 170, flexShrink: 0, borderRight: '1px solid #111', display: 'flex', flexDirection: 'column', padding: '12px 0' }}>
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)} style={{
                background: section === s.id ? '#0f0700' : 'transparent',
                border: 'none',
                borderLeft: section === s.id ? '2px solid #f97316' : '2px solid transparent',
                padding: '10px 18px', textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.1s',
              }}>
                <span style={{ fontSize: 14, color: section === s.id ? '#f97316' : '#374151' }}>{s.icon}</span>
                <span style={{ fontSize: 13, fontWeight: section === s.id ? 600 : 400, color: section === s.id ? '#f1f5f9' : '#6b7280' }}>{s.label}</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={handleLogout} style={{
              background: 'transparent', border: 'none', borderLeft: '2px solid transparent',
              padding: '10px 18px', textAlign: 'left', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444', fontSize: 13,
            }}>⏻ Log Out</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
            <div style={{ fontSize: 11, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 18 }}>
              {SECTIONS.find(s => s.id === section)?.label}
            </div>
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
}
