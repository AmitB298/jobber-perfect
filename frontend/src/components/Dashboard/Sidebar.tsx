const Sidebar: React.FC<{ [key: string]: any }> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'marketwatch', label: 'Market Watch', icon: '📈' },
    { id: 'signals',     label: 'Signals',      icon: '⚡' },
    { id: 'analytics',   label: 'Analytics',    icon: '🔬' },
    { id: 'settings',    label: 'Settings',     icon: '⚙️' },
  ];
  return (
    <div className="w-16 bg-gray-900 border-r border-gray-700 flex flex-col items-center py-4 gap-1" style={{ minHeight: '100vh' }}>
      <div className="mb-4 text-xl">⚡</div>
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => onTabChange?.(tab.id)} title={tab.label}
          className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg transition-all ${
            activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
          }`}>
          {tab.icon}
        </button>
      ))}
    </div>
  );
};
export default Sidebar;


