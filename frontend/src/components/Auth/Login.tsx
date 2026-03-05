import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setUser = useAppStore((state) => state.setUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = mode === 'login'
        ? await window.electronAPI.auth.login(email, password)
        : await window.electronAPI.auth.register(email, mobile, password);

      if (result.success && result.data) {
        setUser(result.data.user);
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-jobber-bg via-jobber-surface to-jobber-bg">
      <div className="w-full max-w-md p-8">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-jobber-primary">JOBBER Pro</h1>
          <p className="mt-2 text-sm text-jobber-text-secondary">
            Professional NIFTY 50 Options Analysis
          </p>
        </div>

        {/* Form */}
        <div className="rounded-lg bg-jobber-surface p-8 shadow-2xl border border-jobber-border">
          <div className="mb-6 flex gap-4">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-md transition-colors ${
                mode === 'login'
                  ? 'bg-jobber-primary text-white'
                  : 'bg-jobber-hover text-jobber-text-secondary'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-md transition-colors ${
                mode === 'register'
                  ? 'bg-jobber-primary text-white'
                  : 'bg-jobber-hover text-jobber-text-secondary'
              }`}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-jobber-danger/10 border border-jobber-danger/20 p-3 text-sm text-jobber-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-jobber-text-secondary mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md bg-jobber-hover border border-jobber-border px-4 py-2 text-white placeholder-jobber-text-muted focus:border-jobber-primary focus:outline-none focus:ring-1 focus:ring-jobber-primary"
                placeholder="you@example.com"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-jobber-text-secondary mb-1">
                  Mobile
                </label>
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                  className="w-full rounded-md bg-jobber-hover border border-jobber-border px-4 py-2 text-white placeholder-jobber-text-muted focus:border-jobber-primary focus:outline-none focus:ring-1 focus:ring-jobber-primary"
                  placeholder="+91 9876543210"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-jobber-text-secondary mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-md bg-jobber-hover border border-jobber-border px-4 py-2 text-white placeholder-jobber-text-muted focus:border-jobber-primary focus:outline-none focus:ring-1 focus:ring-jobber-primary"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-jobber-primary py-2.5 font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>

          {mode === 'register' && (
            <div className="mt-6 rounded-md bg-jobber-primary/10 border border-jobber-primary/20 p-4">
              <h3 className="font-medium text-jobber-primary mb-2">30-Day Free Trial</h3>
              <ul className="text-sm text-jobber-text-secondary space-y-1">
                <li>✓ Full access to all features</li>
                <li>✓ All signal engines enabled</li>
                <li>✓ Real-time market data</li>
                <li>✓ No credit card required</li>
              </ul>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-jobber-text-muted">
          By continuing, you agree to our Terms & Privacy Policy
        </p>
      </div>
    </div>
  );
}
