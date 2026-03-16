// src/components/Auth/Login.tsx
import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { optionlabLogin } from '../../services/optionlabApi';

type Step = 'mobile' | 'mpin';

export default function Login() {
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [mpin, setMpin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setUser = useAppStore((state) => state.setUser);

  const handleMobileSubmit = () => {
    setError('');
    const cleaned = mobile.trim().replace(/\D/g, '');
    if (cleaned.length !== 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setMobile(cleaned);
    setStep('mpin');
  };

  const handleMpinSubmit = async () => {
    setError('');
    if (mpin.length !== 6) {
      setError('MPIN must be 6 digits');
      return;
    }
    setLoading(true);
    try {
      const result = await optionlabLogin(mobile, mpin);
      if (result.success) {
        localStorage.setItem('optionlab_token', result.token);
        localStorage.setItem('optionlab_user', JSON.stringify(result.user));
        // Map to existing User shape — email not used in this auth flow
        setUser({
          id: result.user.id,
          email: '',
          mobile: result.user.mobile,
          name: result.user.name,
          angel_one_client_id: result.user.angel_one_client_id,
          plan: result.user.plan,
          status: 'ACTIVE',
          permissions: [],
        } as any);
      } else {
        setError(result.message || 'Login failed. Check your mobile number and MPIN.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection error. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm mx-4">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">⚡</div>
          <h1 className="text-2xl font-bold text-white">JOBBER PRO</h1>
          <p className="text-gray-400 text-sm mt-1">NIFTY Options Tracker</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl">

          {step === 'mobile' ? (
            <>
              <h2 className="text-white font-semibold text-lg mb-1">Welcome back</h2>
              <p className="text-gray-400 text-sm mb-5">Enter your registered mobile number</p>

              <div className="mb-4">
                <label className="text-gray-400 text-xs block mb-1.5">Mobile Number</label>
                <div className="flex items-center bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 focus-within:border-blue-500 transition-colors">
                  <span className="text-gray-400 text-sm mr-2">+91</span>
                  <input
                    type="tel"
                    value={mobile}
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={e => e.key === 'Enter' && handleMobileSubmit()}
                    placeholder="10-digit number"
                    className="bg-transparent text-white text-sm flex-1 outline-none placeholder-gray-600"
                    autoFocus
                    maxLength={10}
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleMobileSubmit}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep('mobile'); setMpin(''); setError(''); }}
                className="text-gray-400 hover:text-white text-xs mb-4 flex items-center gap-1 transition-colors"
              >
                ← Back
              </button>

              <h2 className="text-white font-semibold text-lg mb-1">Enter MPIN</h2>
              <p className="text-gray-400 text-sm mb-5">
                Logging in as <span className="text-blue-400">+91 {mobile}</span>
              </p>

              <div className="mb-4">
                <label className="text-gray-400 text-xs block mb-1.5">6-Digit MPIN</label>
                <input
                  type="password"
                  value={mpin}
                  onChange={e => setMpin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && !loading && handleMpinSubmit()}
                  placeholder="••••••"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors tracking-widest placeholder-gray-600 text-center text-lg"
                  autoFocus
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleMpinSubmit}
                disabled={loading || mpin.length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-4">
          Not registered?{' '}
          <span className="text-blue-400">Visit optionlab.in to create an account</span>
        </p>
      </div>
    </div>
  );
}
