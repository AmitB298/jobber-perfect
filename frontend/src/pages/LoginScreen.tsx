// frontend/src/pages/LoginScreen.tsx
// ============================================================================
// Login + Register screen for JOBBER PRO
// Uses useAuth hook — no direct IPC calls in this component.
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// ── Electron runtime detection ────────────────────────────────────────────────
const isElectron = typeof window !== 'undefined' && !!window.electron;

// ============================================================================
// TYPES
// ============================================================================

type Mode = 'login' | 'register';

// ============================================================================
// ANIMATED BACKGROUND — subtle moving particles
// ============================================================================

function AnimatedBg() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <style>{`
        @keyframes float1 { 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(30px,-40px) scale(1.1); } }
        @keyframes float2 { 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-25px,35px) scale(0.9); } }
        @keyframes float3 { 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(40px,20px) scale(1.05); } }
      `}</style>
      <div style={{ position:'absolute', top:'15%', left:'10%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(234,179,8,0.06) 0%, transparent 70%)', animation:'float1 12s ease-in-out infinite' }} />
      <div style={{ position:'absolute', bottom:'20%', right:'12%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%)', animation:'float2 15s ease-in-out infinite' }} />
      <div style={{ position:'absolute', top:'55%', left:'55%', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(168,85,247,0.04) 0%, transparent 70%)', animation:'float3 10s ease-in-out infinite' }} />
      {/* Grid overlay */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)', backgroundSize:'40px 40px' }} />
    </div>
  );
}

// ============================================================================
// TRIAL BANNER
// ============================================================================

function TrialBanner({ daysRemaining }: { daysRemaining: number }) {
  const urgent = daysRemaining <= 5;
  return (
    <div style={{
      background: urgent ? 'rgba(127,29,29,0.7)' : 'rgba(6,78,59,0.6)',
      border: `1px solid ${urgent ? '#dc2626' : '#059669'}`,
      borderRadius: 8, padding: '8px 14px', marginBottom: 16, textAlign: 'center', fontSize: 12,
    }}>
      <span style={{ color: urgent ? '#fca5a5' : '#6ee7b7', fontWeight: 700 }}>
        {urgent ? '⚠️' : '🎁'}{' '}
        {daysRemaining > 0
          ? `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining in your free trial`
          : 'Your trial has expired — contact support to upgrade'}
      </span>
    </div>
  );
}

// ============================================================================
// INPUT COMPONENT
// ============================================================================

interface InputProps {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
}

function FormInput({ label, id, type = 'text', value, onChange, placeholder, error, autoComplete, autoFocus }: InputProps) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, fontWeight: 600 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={isPassword && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(15,23,42,0.8)',
            border: `1px solid ${error ? '#dc2626' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 8, padding: isPassword ? '10px 40px 10px 14px' : '10px 14px',
            fontSize: 14, color: '#f1f5f9', outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = error ? '#dc2626' : '#eab308'; }}
          onBlur={e => { e.currentTarget.style.borderColor = error ? '#dc2626' : 'rgba(255,255,255,0.12)'; }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 16, padding: 0 }}>
            {show ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// LOGIN FORM
// ============================================================================

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const { login, loading, error, clearError } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password,   setPassword]   = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login({ identifier, password });
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <FormInput
        label="Email or Mobile"
        id="identifier"
        value={identifier}
        onChange={v => { setIdentifier(v); clearError(); }}
        placeholder="user@example.com or 9876543210"
        autoComplete="username"
        autoFocus
        error={error?.field === 'identifier'}
      />
      <FormInput
        label="Password"
        id="password"
        type="password"
        value={password}
        onChange={v => { setPassword(v); clearError(); }}
        placeholder="Your password"
        autoComplete="current-password"
        error={error?.field === 'password'}
      />

      {error && (
        <div style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #dc2626', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠️</span><span>{error.message}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? 'rgba(234,179,8,0.3)' : 'linear-gradient(135deg, #eab308, #ca8a04)',
          border: 'none', color: loading ? '#92400e' : '#000',
          transition: 'all 0.2s', marginBottom: 12,
        }}>
        {loading ? '⟳ Signing in…' : '⚡ Sign In'}
      </button>

      <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
        Don't have an account?{' '}
        <button type="button" onClick={onSwitch} style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: 0 }}>
          Create one
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// REGISTER FORM
// ============================================================================

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const { register: registerUser, loading, error, clearError } = useAuth();

  const [email,           setEmail]           = useState('');
  const [mobile,          setMobile]          = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await registerUser({ email, mobile, password, confirmPassword });
  };

  const pwStrength = (() => {
    if (password.length === 0) return null;
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return score <= 1 ? 'weak' : score <= 3 ? 'medium' : 'strong';
  })();

  const pwColor = pwStrength === 'strong' ? '#22c55e' : pwStrength === 'medium' ? '#eab308' : '#ef4444';

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <FormInput
        label="Email Address"
        id="email"
        type="email"
        value={email}
        onChange={v => { setEmail(v); clearError(); }}
        placeholder="you@example.com"
        autoComplete="email"
        autoFocus
        error={error?.field === 'email'}
      />
      <FormInput
        label="Mobile Number (India)"
        id="mobile"
        value={mobile}
        onChange={v => { setMobile(v.replace(/\D/g, '').slice(0, 10)); clearError(); }}
        placeholder="9876543210"
        autoComplete="tel"
        error={error?.field === 'mobile'}
      />
      <FormInput
        label="Password"
        id="reg-password"
        type="password"
        value={password}
        onChange={v => { setPassword(v); clearError(); }}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        error={error?.field === 'password'}
      />
      {/* Password strength bar */}
      {pwStrength && (
        <div style={{ marginTop: -8, marginBottom: 14 }}>
          <div style={{ height: 3, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: pwStrength === 'strong' ? '100%' : pwStrength === 'medium' ? '60%' : '25%', height: '100%', background: pwColor, transition: 'width 0.3s, background 0.3s' }} />
          </div>
          <div style={{ fontSize: 10, color: pwColor, marginTop: 3, textTransform: 'capitalize', fontWeight: 600 }}>{pwStrength} password</div>
        </div>
      )}
      <FormInput
        label="Confirm Password"
        id="confirm-password"
        type="password"
        value={confirmPassword}
        onChange={v => { setConfirmPassword(v); clearError(); }}
        placeholder="Repeat password"
        autoComplete="new-password"
        error={error?.field === 'password' && confirmPassword.length > 0}
      />

      {error && (
        <div style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #dc2626', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠️</span><span>{error.message}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg, #16a34a, #15803d)',
          border: 'none', color: loading ? '#14532d' : '#fff',
          transition: 'all 0.2s', marginBottom: 12,
        }}>
        {loading ? '⟳ Creating account…' : '🚀 Start Free Trial (30 days)'}
      </button>

      <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: 0 }}>
          Sign in
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// MAIN SCREEN COMPONENT
// ============================================================================

export default function LoginScreen() {
  const navigate     = useNavigate();
  const { isAuthenticated, initialized, trialDaysRemaining, user } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const cardRef = useRef<HTMLDivElement>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (initialized && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [initialized, isAuthenticated, navigate]);

  // Animate card on mode switch
  const handleModeSwitch = (newMode: Mode) => {
    if (cardRef.current) {
      cardRef.current.style.transform = 'scale(0.97)';
      cardRef.current.style.opacity   = '0.7';
      setTimeout(() => {
        setMode(newMode);
        if (cardRef.current) {
          cardRef.current.style.transform = 'scale(1)';
          cardRef.current.style.opacity   = '1';
        }
      }, 150);
    } else {
      setMode(newMode);
    }
  };

  if (!initialized) {
    return (
      <div style={{ minHeight: '100vh', background: '#030712', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 14 }}>Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#030712', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <AnimatedBg />

      <div ref={cardRef} style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 420,
        background: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: '32px 36px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        transition: 'transform 0.15s ease, opacity 0.15s ease',
      }}>

        {/* Logo & title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>⚡</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>JOBBER PRO</div>
          <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 3 }}>NIFTY Options Analytics</div>
        </div>

        {/* Trial banner — only shown for existing user with expiry info */}
        {user?.plan === 'TRIAL' && trialDaysRemaining > 0 && trialDaysRemaining <= 7 && (
          <TrialBanner daysRemaining={trialDaysRemaining} />
        )}

        {/* Expired plan banner */}
        {user?.plan === 'EXPIRED' && (
          <div style={{ background: 'rgba(127,29,29,0.6)', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 16, textAlign: 'center', fontSize: 12, color: '#fca5a5', fontWeight: 700 }}>
            ⚠️ Your subscription has expired. Please contact support.
          </div>
        )}

        {/* Mode tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3, marginBottom: 24 }}>
          {(['login', 'register'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeSwitch(m)}
              style={{
                flex: 1, padding: '7px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: mode === m ? 'rgba(234,179,8,0.15)' : 'transparent',
                color: mode === m ? '#eab308' : '#6b7280',
                fontWeight: mode === m ? 700 : 400, fontSize: 13,
                transition: 'all 0.2s',
                boxShadow: mode === m ? '0 0 0 1px rgba(234,179,8,0.3)' : 'none',
              }}>
              {m === 'login' ? '🔑 Sign In' : '🚀 Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        {mode === 'login'
          ? <LoginForm onSwitch={() => handleModeSwitch('register')} />
          : <RegisterForm onSwitch={() => handleModeSwitch('login')} />
        }

        {/* Non-Electron warning */}
        {!isElectron && (
          <div style={{ marginTop: 20, padding: '8px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, fontSize: 11, color: '#93c5fd', textAlign: 'center' }}>
            ℹ️ Running in browser dev mode — auth is bypassed
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: '#374151', letterSpacing: '0.5px' }}>
          JOBBER PRO · NSE/BSE market data for educational use only
        </div>
      </div>
    </div>
  );
}