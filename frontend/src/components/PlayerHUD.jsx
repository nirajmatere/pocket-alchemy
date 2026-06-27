import AnimatedNumber from './AnimatedNumber.jsx';

const RANKS = [
  { minStage: 1,  maxStage: 2,  title: 'Acolyte',      badge: '🪨', color: 'text-slate-400',      bar: 'bg-slate-400' },
  { minStage: 3,  maxStage: 5,  title: 'Apprentice',   badge: '🔮', color: 'text-cyber-purple',    bar: 'bg-cyber-purple' },
  { minStage: 6,  maxStage: 9,  title: 'Alchemist',    badge: '⚗️', color: 'text-cyber-blue',      bar: 'bg-cyber-blue' },
  { minStage: 10, maxStage: 14, title: 'Forge Master', badge: '🛡️', color: 'text-cyber-green',     bar: 'bg-cyber-green' },
  { minStage: 15, maxStage: 99, title: 'Grand Sage',   badge: '👑', color: 'text-cyber-yellow',    bar: 'bg-cyber-yellow' },
];

function getRank(stage) {
  return RANKS.find(r => stage >= r.minStage && stage <= r.maxStage) || RANKS[0];
}

function getXpProgress(stage) {
  const rank = getRank(stage);
  const span = rank.maxStage - rank.minStage + 1;
  const progress = stage - rank.minStage;
  return span <= 1 ? 100 : Math.round((progress / span) * 100);
}

export default function PlayerHUD({ profile, compact = false }) {
  if (!profile) return null;
  const stage = profile.unlocked_campaign_stage || 1;
  const rank = getRank(stage);
  const xp = getXpProgress(stage);

  if (compact) {
    return (
      <div className="flex items-center gap-2 font-mono">
        <span className={`text-sm ${rank.color}`}>{rank.badge}</span>
        <div className="flex flex-col leading-none">
          <span className={`text-[9px] font-bold uppercase tracking-wider ${rank.color}`}>{rank.title}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[8px] text-cyber-purple">✨<AnimatedNumber value={profile.aether_dust} className="ml-0.5 text-white font-bold" /></span>
            <span className="text-[8px] text-cyber-blue">🧪<AnimatedNumber value={profile.catalysts} className="ml-0.5 text-white font-bold" /></span>
          </div>
        </div>
        <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden ml-1">
          <div className={`h-full rounded-full ${rank.bar} transition-all duration-700`} style={{ width: `${xp}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-slate-950/80 border border-white/5 px-3 py-2 rounded-xl font-mono select-none">
      {/* Rank badge */}
      <div className="flex flex-col items-center shrink-0">
        <span className="text-xl">{rank.badge}</span>
        <span className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 ${rank.color}`}>{rank.title}</span>
      </div>

      {/* XP + currency */}
      <div className="flex-1 min-w-0">
        {/* XP bar */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] text-slate-500 uppercase">Stage</span>
          <span className={`text-[9px] font-bold ${rank.color}`}>{stage}</span>
          <div className="flex-1 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-white/5">
            <div
              className={`h-full rounded-full ${rank.bar} animate-xp-fill shadow-[0_0_6px_currentColor]`}
              style={{ width: `${xp}%` }}
            />
          </div>
          <span className="text-[9px] text-slate-600">{xp}%</span>
        </div>
        {/* Currency row */}
        <div className="flex gap-3">
          <span className="text-[10px] text-cyber-purple font-bold flex items-center gap-0.5">
            ✨ <AnimatedNumber value={profile.aether_dust} className="text-white" />
            <span className="text-[8px] text-slate-500 font-normal ml-0.5">dust</span>
          </span>
          <span className="text-[10px] text-cyber-blue font-bold flex items-center gap-0.5">
            🧪 <AnimatedNumber value={profile.catalysts} className="text-white" />
            <span className="text-[8px] text-slate-500 font-normal ml-0.5">catalysts</span>
          </span>
          <span className="text-[10px] text-cyber-green font-bold flex items-center gap-0.5">
            🏰 <AnimatedNumber value={stage} className="text-white" />
            <span className="text-[8px] text-slate-500 font-normal ml-0.5">stage</span>
          </span>
        </div>
      </div>
    </div>
  );
}
