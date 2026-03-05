import { useState } from 'react';
const AngelLoginModal: React.FC<{ [key: string]: any }> = ({ isOpen = false, onClose, onLogin, loading = false, error }) => {
  const [clientId, setClientId] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [localError, setLocalError] = useState('');
  if (!isOpen) return null;
  const handleSubmit = async () => {
    setLocalError('');
    if (!clientId.trim() || !password.trim() || !totp.trim()) { setLocalError('All fields required'); return; }
    try { await onLogin?.({ clientId: clientId.trim(), password, totp: totp.trim() }); }
    catch (err: any) { setLocalError(err?.message ?? 'Login failed'); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between mb-5">
          <div><h2 className="text-white text-lg font-bold">Connect Angel One</h2><p className="text-gray-400 text-sm">Enter SmartAPI credentials</p></div>
          {onClose && <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>}
        </div>
        {(error || localError) && <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 mb-4 text-red-400 text-sm">⚠️ {error || localError}</div>}
        <div className="space-y-4">
          {[
            { label: 'Client ID', val: clientId, setter: setClientId, type: 'text', ph: 'e.g. A123456' },
            { label: 'Password', val: password, setter: setPassword, type: 'password', ph: 'Password' },
            { label: 'TOTP', val: totp, setter: (v: string) => setTotp(v.replace(/\D/g,'').slice(0,6)), type: 'text', ph: '6-digit code' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-gray-400 text-xs block mb-1">{f.label}</label>
              <input type={f.type} value={f.val} onChange={e => f.setter(e.target.value)} placeholder={f.ph} disabled={loading}
                className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg">
            {loading ? '⏳ Connecting...' : '🔗 Connect'}
          </button>
          {onClose && <button onClick={onClose} disabled={loading} className="px-4 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700">Cancel</button>}
        </div>
      </div>
    </div>
  );
};
export default AngelLoginModal;

