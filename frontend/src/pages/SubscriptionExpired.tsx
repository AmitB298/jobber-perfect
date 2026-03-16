// src/pages/SubscriptionExpired.tsx
import { useAppStore } from '../store/appStore';
import { clearAuth } from '../services/optionlabApi';

export default function SubscriptionExpired() {
  const reset = useAppStore((state) => state.reset);

  const handleLogout = () => {
    clearAuth();
    reset();
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-md mx-4 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-white mb-2">Subscription Expired</h1>
        <p className="text-gray-400 mb-6">
          Your subscription has expired or is not active.<br />
          Please renew to continue using JOBBER PRO.
        </p>

        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 mb-6">
          <p className="text-gray-300 text-sm mb-4">
            Visit our website to purchase or renew your subscription:
          </p>
          <a
            href="https://optionlab.in"
            target="_blank"
            rel="noreferrer"
            className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors text-sm mb-3"
          >
            Go to optionlab.in →
          </a>
          <button
            onClick={handleLogout}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            Logout
          </button>
        </div>

        <p className="text-gray-600 text-xs">
          Already renewed? Logout and login again to refresh your status.
        </p>
      </div>
    </div>
  );
}