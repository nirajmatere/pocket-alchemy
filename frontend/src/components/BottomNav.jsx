import { hapticLight } from '../lib/haptics.js';

// eslint-disable-next-line react-refresh/only-export-components
export const NAV_ITEMS = [
  { view: 'transmute',    label: 'TRANSMUTE',   short: 'Forge',   icon: '⚗️',  accent: '#9d4edd' },
  { view: 'inventory',   label: 'ALCHEMY VAULT',short: 'Vault',   icon: '🎒',  accent: '#00f0ff' },
  { view: 'leaderboard', label: 'LEADERBOARD',  short: 'Ranks',   icon: '🏆',  accent: '#39ff14' },
  { view: 'badges',      label: 'BADGES VAULT', short: 'Badges',  icon: '🎖️', accent: '#ff007f' },
  { view: 'feed',        label: "TODAY'S FEED", short: 'Feed',    icon: '🔥',  accent: '#fffb00' },
  { view: 'lobby_select',label: 'PVP ROOMS',    short: 'PvP',     icon: '⚔️',  accent: '#00f0ff' },
  { view: 'advisor',     label: 'ALCH. SAGE',   short: 'Sage',    icon: '🧙',  accent: '#9d4edd' },
];

export default function BottomNav({ activeView, onNavigate, onSettings, disabled }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#08090d]/95 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.view;
          return (
            <button
              key={item.view}
              disabled={disabled}
              onClick={() => {
                hapticLight();
                onNavigate(item.view);
              }}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-all duration-150 cursor-pointer min-h-[52px] disabled:opacity-30 ${isActive ? 'opacity-100' : 'opacity-50 hover:opacity-75'}`}
              style={isActive ? { color: item.accent } : { color: '#94a3b8' }}
            >
              <span className={`text-lg leading-none ${isActive ? 'animate-tab-pop animate-nav-glow' : ''}`}>
                {item.icon}
              </span>
              <span className={`text-[8px] font-mono font-bold uppercase leading-none ${isActive ? 'font-extrabold' : ''}`}>
                {item.short}
              </span>
              {isActive && (
                <div
                  className="absolute bottom-0 w-full h-0.5 rounded-t"
                  style={{ backgroundColor: item.accent, boxShadow: `0 0 8px ${item.accent}` }}
                />
              )}
            </button>
          );
        })}
        {/* Settings button */}
        <button
          onClick={() => { hapticLight(); onSettings(); }}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 opacity-50 hover:opacity-75 transition-all cursor-pointer min-h-[52px]"
          style={{ color: '#94a3b8' }}
        >
          <span className="text-lg leading-none">⚙️</span>
          <span className="text-[8px] font-mono font-bold uppercase leading-none">Config</span>
        </button>
      </div>
    </nav>
  );
}
