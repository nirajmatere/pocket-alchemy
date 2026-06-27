import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext(null);

const TYPE_STYLES = {
  success: { border: 'border-cyber-green/40', icon: '✅', text: 'text-cyber-green', glow: 'shadow-[0_0_15px_rgba(57,255,20,0.25)]' },
  error:   { border: 'border-red-500/40',     icon: '⚠️', text: 'text-red-400',     glow: 'shadow-[0_0_15px_rgba(239,68,68,0.25)]' },
  info:    { border: 'border-cyber-blue/40',  icon: '🔮', text: 'text-cyber-blue',   glow: 'shadow-[0_0_15px_rgba(0,240,255,0.2)]' },
  warn:    { border: 'border-cyber-yellow/40',icon: '⚡', text: 'text-cyber-yellow', glow: 'shadow-[0_0_15px_rgba(255,251,0,0.2)]' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timerRefs = useRef({});

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 260);
  }, []);

  const toast = useCallback(({ type = 'info', title, message, duration = 3500 }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-4), { id, type, title, message, exiting: false }]);
    timerRefs.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {/* Toast stack — top-center, above everything */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none w-[min(90vw,380px)]">
        {toasts.map(t => {
          const s = TYPE_STYLES[t.type] || TYPE_STYLES.info;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-full cyber-glass border ${s.border} ${s.glow} rounded-xl px-4 py-3 flex items-start gap-3 font-mono ${t.exiting ? 'animate-toast-out' : 'animate-toast-in'}`}
            >
              <span className="text-lg shrink-0 mt-0.5">{s.icon}</span>
              <div className="flex-1 min-w-0">
                {t.title && <p className={`text-xs font-bold uppercase tracking-wider ${s.text}`}>{t.title}</p>}
                {t.message && <p className="text-xs text-slate-300 leading-relaxed mt-0.5">{t.message}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-slate-500 hover:text-white text-xs shrink-0 cursor-pointer mt-0.5"
              >✕</button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};
