import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import Sidebar from './Sidebar';
import Header from './Header';
import MarketWatch from './MarketWatch';
import SignalsPanel from './SignalsPanel';
import Analytics from './Analytics';
import Settings from './Settings';
import AngelLoginModal from './AngelLoginModal';

export default function Dashboard() {
  const { activeView, user, angelProfile } = useAppStore();
  const [showAngelLogin, setShowAngelLogin] = useState(false);

  useEffect(() => {
    // Show Angel login if not connected
    if (user && !angelProfile) {
      setShowAngelLogin(true);
    }
  }, [user, angelProfile]);

  const renderContent = () => {
    switch (activeView) {
      case 'market':
        return <MarketWatch />;
      case 'signals':
        return <SignalsPanel />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings />;
      default:
        return <MarketWatch />;
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar />
      
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        
        <main className="flex-1 overflow-auto p-6">
          {renderContent()}
        </main>
      </div>

      {showAngelLogin && (
        <AngelLoginModal onClose={() => setShowAngelLogin(false)} />
      )}
    </div>
  );
}
