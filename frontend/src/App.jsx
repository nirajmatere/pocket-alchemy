/* eslint-disable no-unused-vars */
import { useState, useEffect, useRef } from 'react';
import BottomNav, { NAV_ITEMS } from './components/BottomNav.jsx';
import PlayerHUD from './components/PlayerHUD.jsx';
import { useToast } from './components/ToastProvider.jsx';
import { hapticLight, hapticMedium, hapticHeavy, hapticSuccess } from './lib/haptics.js';

const HOST_IP = 'https://pocket-alchemy-backend-440102621899.asia-northeast1.run.app'; // Live backend URL

const getHostIp = () => {
  return localStorage.getItem('pocket_alchemy_backend_ip') || HOST_IP;
};

const getApiBase = () => {
  const host = getHostIp();
  if (typeof window === 'undefined') return `http://${host}:8000`;

  const hn = window.location.hostname;
  // Dynamic live origin fallback for web deployments
  if (hn && hn !== 'localhost' && hn !== '127.0.0.1' && !window.Capacitor) {
    return window.location.origin;
  }

  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host;
  }

  if (localStorage.getItem('pocket_alchemy_backend_ip') || window.Capacitor) {
    return `http://${host}:8000`;
  }

  if (hn === '' || hn === 'localhost' && window.location.port === '') {
    return `http://${host}:8000`;
  }

  if (window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return window.location.origin;
};

const getWsBase = () => {
  const host = getHostIp();
  if (typeof window === 'undefined') return `ws://${host}:8000`;

  const hn = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Dynamic live WebSocket fallback for web deployments
  if (hn && hn !== 'localhost' && hn !== '127.0.0.1' && !window.Capacitor) {
    return `${protocol}//${window.location.host}`;
  }

  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host.replace('http://', 'ws://').replace('https://', 'wss://');
  }

  if (localStorage.getItem('pocket_alchemy_backend_ip') || window.Capacitor) {
    return `ws://${host}:8000`;
  }

  if (hn === '' || hn === 'localhost' && window.location.port === '') {
    return `ws://${host}:8000`;
  }

  if (window.location.port === '5173') {
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return `${protocol}//${window.location.host}`;
};

const API_BASE = getApiBase();
const WS_BASE = getWsBase();

const resolveImageUrl = (cardOrFighter) => {
  if (!cardOrFighter) return '';
  const url = cardOrFighter.image_art_url || cardOrFighter.image_url;
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${API_BASE}${url}`;
};

const playCardVoice = (card) => {
  if (!card || !card.audio_url) return;
  const url = card.audio_url.startsWith('http://') || card.audio_url.startsWith('https://')
    ? card.audio_url
    : `${API_BASE}${card.audio_url}`;
  const audio = new Audio(url);
  audio.play().catch(e => console.error("Audio playback blocked or failed:", e));
};
const SPARKS = [
  { left: '25%', delay: '0.2s', duration: '3.5s' },
  { left: '42%', delay: '1.5s', duration: '4.2s' },
  { left: '78%', delay: '0.8s', duration: '3.1s' },
  { left: '19%', delay: '2.1s', duration: '4.8s' },
  { left: '55%', delay: '1.1s', duration: '3.9s' },
  { left: '83%', delay: '2.7s', duration: '4.5s' },
  { left: '33%', delay: '0.4s', duration: '3.7s' },
  { left: '67%', delay: '1.9s', duration: '4.1s' },
  { left: '50%', delay: '0.9s', duration: '3.3s' },
  { left: '72%', delay: '2.3s', duration: '4.6s' },
  { left: '29%', delay: '1.2s', duration: '3.8s' },
  { left: '88%', delay: '0.6s', duration: '3.4s' }
];

const generateRoomCode = () => {
  return 'ROOM-' + Math.random().toString(36).slice(2, 6).toUpperCase();
};

export default function App() {
  const [clientId] = useState(() => {
    let id = sessionStorage.getItem('pocket_alchemy_client_id');
    if (!id) {
      id = 'player_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('pocket_alchemy_client_id', id);
    }
    return id;
  });

  const [activeView, setActiveView] = useState('transmute'); // 'transmute' | 'inventory' | 'battle' | 'lobby'
  const [cards, setCards] = useState([]);
  const [healthStatus, setHealthStatus] = useState({ status: 'unknown', gemini_api_configured: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [backendIpInput, setBackendIpInput] = useState(getHostIp());

  // Transmutation / Camera States
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [newlyTransmutedCard, setNewlyTransmutedCard] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState(false);

  // Lobby / Matchmaking States
  const [selectedCard, setSelectedCard] = useState(null);
  const [isPvp, setIsPvp] = useState(false);
  const [lobbyId, setLobbyId] = useState(null);
  const [playerNum, setPlayerNum] = useState(1); // 1 for room creator, 2 for room joiner
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [showMatchmakingModal, setShowMatchmakingModal] = useState(false);
  const [pvpWaiting, setPvpWaiting] = useState(false);

  // Room / Lobby States
  const [roomState, setRoomState] = useState(null);
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  const [isSpectatingActive, setIsSpectatingActive] = useState(false);

  // Battle States
  const [battleState, setBattleState] = useState(null);
  const [battleLogs, setBattleLogs] = useState([]);
  const [socket, setSocket] = useState(null);
  const [actionLocked, setActionLocked] = useState(false);

  // Animation & Visual Feedback States
  const [myAnimClass, setMyAnimClass] = useState('');
  const [oppAnimClass, setOppAnimClass] = useState('');
  const [popups, setPopups] = useState([]);

  // Enhanced Battle Animation States
  const [screenShake, setScreenShake] = useState(false);
  const [abilityFlash, setAbilityFlash] = useState(null); // { element, caster } or null
  const [healthFlash, setHealthFlash] = useState({ me: false, opp: false });
  const [cardOverlay, setCardOverlay] = useState({ me: null, opp: null }); // 'damage' | 'heal' | null
  const [roundIntro, setRoundIntro] = useState(null); // { round } or null
  const [confetti, setConfetti] = useState(false);
  const [defeatParticles, setDefeatParticles] = useState(false);
  const [stancePulse, setStancePulse] = useState(null); // stance id string
  const [mascotAnimation, setMascotAnimation] = useState('animate-mascot-referee');
  const [shieldShatter, setShieldShatter] = useState({ me: false, opp: false });

  // Stances, advice, global quest progression states
  const [selectedStance, setSelectedStance] = useState('focused'); // 'focused' | 'aggressive' | 'defensive'
  const [hintText, setHintText] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [profile, setProfile] = useState({ aether_dust: 0, catalysts: 0, unlocked_campaign_stage: 1, badges: [] });
  const prevProfileRef = useRef(null);

  // Reward popup state
  const [rewardPopups, setRewardPopups] = useState([]);
  const [impactBurst, setImpactBurst] = useState(false);

  const toast = useToast();

  const spawnReward = (text) => {
    const id = Math.random().toString(36).slice(2);
    setRewardPopups(prev => [...prev, { id, text }]);
    setTimeout(() => setRewardPopups(prev => prev.filter(r => r.id !== id)), 1900);
  };
  const [leaderboard, setLeaderboard] = useState([]);
  const [dailyQuest, setDailyQuest] = useState(null);
  const [battleHistory, setBattleHistory] = useState([]);

  // Detect profile currency increases and show reward popups
  useEffect(() => {
    const prev = prevProfileRef.current;
    if (prev) {
      const dustDiff = profile.aether_dust - prev.aether_dust;
      const catDiff = profile.catalysts - prev.catalysts;
      const stageDiff = profile.unlocked_campaign_stage - prev.unlocked_campaign_stage;
      if (dustDiff > 0) spawnReward(`✨ +${dustDiff} Aether Dust`);
      if (catDiff > 0) spawnReward(`🧪 +${catDiff} Catalysts`);
      if (stageDiff > 0) spawnReward(`🏰 Stage ${profile.unlocked_campaign_stage} Unlocked!`);
    }
    prevProfileRef.current = profile;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.aether_dust, profile.catalysts, profile.unlocked_campaign_stage]);

  // Alchemical Sage Advisor Chat States
  const [advisorHistory, setAdvisorHistory] = useState([
    { role: 'model', text: 'Greetings, apprentice. I am the Alchemical Sage, master of transmutations and tactical combat. Ask me how to combine your current inventory or optimize your battle stances.' }
  ]);
  const [advisorInput, setAdvisorInput] = useState('');
  const [advisorLoading, setAdvisorLoading] = useState(false);

  const sendAdvisorMessage = async (customMessage = null) => {
    const textToSend = customMessage || advisorInput;
    if (!textToSend.trim() || advisorLoading) return;
    
    const userMsg = { role: 'user', text: textToSend };
    setAdvisorHistory(prev => [...prev, userMsg]);
    if (!customMessage) setAdvisorInput('');
    setAdvisorLoading(true);
    
    try {
      const res = await fetch(`${API_BASE}/api/advisor/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          message: textToSend,
          chat_history: advisorHistory.slice(1).map(h => ({ role: h.role, text: h.text }))
        })
      });
      if (res.ok) {
        const data = await res.json();
        setAdvisorHistory(prev => [...prev, { role: 'model', text: data.response }]);
      } else {
        setAdvisorHistory(prev => [...prev, { role: 'model', text: 'Alchemical communications were disrupted. Please retry.' }]);
      }
    } catch (e) {
      console.error(e);
      setAdvisorHistory(prev => [...prev, { role: 'model', text: 'Failed to establish connection with the Sage.' }]);
    } finally {
      setAdvisorLoading(false);
    }
  };

  // Feed and custom duel setup states
  const [todayFeed, setTodayFeed] = useState([]);
  const [challengerTargetOpponent, setChallengerTargetOpponent] = useState(null);
  const [showFighterSelectorModal, setShowFighterSelectorModal] = useState(false);

  // Tournament View States
  const [tournamentMatchIndex, setTournamentMatchIndex] = useState(0);
  const [tournamentMatchLogs, setTournamentMatchLogs] = useState([]);
  const [tournamentMatchesCompleted, setTournamentMatchesCompleted] = useState([]);
  const [tournamentRunningLocal, setTournamentRunningLocal] = useState(false);
  const [showRoomCardSelectorModal, setShowRoomCardSelectorModal] = useState(false);

  // Element-to-color mapping for damage popups
  const getElementDamageColor = (element) => {
    if (!element) return 'text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.8)]';
    switch (element) {
      case 'Fire': return 'text-orange-500 drop-shadow-[0_0_15px_rgba(249,115,22,0.9)]';
      case 'Water': return 'text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.9)]';
      case 'Lightning': return 'text-fuchsia-400 drop-shadow-[0_0_15px_rgba(232,121,249,0.9)]';
      case 'Earth': return 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.9)]';
      default: return 'text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)]';
    }
  };

  const getElementGlowColor = (element) => {
    if (!element) return 'rgba(157,78,221,0.6)';
    switch (element) {
      case 'Fire': return 'rgba(249,115,22,0.6)';
      case 'Water': return 'rgba(34,211,238,0.6)';
      case 'Lightning': return 'rgba(232,121,249,0.6)';
      case 'Earth': return 'rgba(52,211,153,0.6)';
      default: return 'rgba(251,191,36,0.6)';
    }
  };

  const deriveMascotMood = (bs, myFighter, oppFighter) => {
    if (!bs || !myFighter) return 'animate-mascot-referee';
    if (bs.game_over) {
      const isWin = (bs.winner === 'Player 1' && bs.player1_id === clientId) ||
                    (bs.winner === 'Player 2' && bs.player2_id === clientId) ||
                    (bs.winner === `Player ${playerNum}`);
      return isWin ? 'animate-mascot-happy' : 'animate-mascot-sad';
    }
    if (oppFighter && oppFighter.current_health < oppFighter.max_health * 0.25) return 'animate-mascot-happy';
    if (myFighter.current_health < myFighter.max_health * 0.25) return 'animate-mascot-sad';
    return 'animate-mascot-dance';
  };

  const [animatedLogQueue, setAnimatedLogQueue] = useState([]);
  const [displayedLog, setDisplayedLog] = useState(null);
  const lastLogCountRef = useRef(0);

  // Animated Log Overlay - detect new logs and enqueue them
  useEffect(() => {
    if (battleLogs.length > lastLogCountRef.current) {
      const newLogs = battleLogs.slice(lastLogCountRef.current);
      const meaningfulLogs = newLogs.filter(l => !l.startsWith('[SYSTEM]') && !l.startsWith('[ERROR]') && l.trim().length > 0);
      if (meaningfulLogs.length > 0) {
        setAnimatedLogQueue(prev => [...prev, ...meaningfulLogs]);
      }
    }
    lastLogCountRef.current = battleLogs.length;
  }, [battleLogs]);

  // Sequential log overlays processing
  useEffect(() => {
    if (animatedLogQueue.length > 0 && !displayedLog) {
      const nextLog = animatedLogQueue[0];
      const timer = setTimeout(() => {
        setDisplayedLog(nextLog);
        setAnimatedLogQueue(prev => prev.slice(1));
      }, 0);
      const hideTimer = setTimeout(() => {
        setDisplayedLog(null);
      }, 2500);
      return () => {
        clearTimeout(timer);
        clearTimeout(hideTimer);
      };
    }
  }, [animatedLogQueue, displayedLog]);

  const getAbilityDescription = (effectType, value, element) => {
    if (!effectType) return 'Unleash special alchemical ability.';
    switch (effectType.toLowerCase()) {
      case 'damage':
        return `Deals ${value} ${element || ''} damage to target.`;
      case 'shield':
        return `Blocks next incoming attack completely.`;
      case 'heal':
        return `Restores ${value} Health Points.`;
      case 'boost_attack':
        return `Buffs card attack by +${value} permanently.`;
      case 'boost_speed':
        return `Buffs card speed by +${value} permanently.`;
      default:
        return `Unleash alchemical special force [power: ${value}].`;
    }
  };

  const fetchDashboardData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/uniqueness?client_id=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.leaderboard || []);
        setDailyQuest(data.daily_quest || null);
        setProfile(data.profile || { aether_dust: 0, catalysts: 0, unlocked_campaign_stage: 1, badges: [] });
        setBattleHistory(data.battle_history || []);
      }
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
    }
  };

  const fetchTodayFeed = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/feed/today`);
      if (res.ok) {
        const data = await res.json();
        setTodayFeed(data || []);
      }
    } catch (e) {
      console.error("Failed to fetch alchemical feed:", e);
    }
  };

  const requestHint = async () => {
    if (profile.aether_dust < 15) {
      toast({ type: 'warn', title: 'Insufficient Dust', message: 'Need 15 Aether Dust to consult Chronos.' });
      return;
    }
    setHintLoading(true);
    setHintText(null);
    try {
      const res = await fetch(`${API_BASE}/api/battle/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, lobby_id: lobbyId })
      });
      const data = await res.json();
      if (res.ok) {
        setHintText(data.hint);
        setProfile(p => ({ ...p, aether_dust: data.remaining_dust }));
      } else {
        toast({ type: 'error', title: 'Chronos Unavailable', message: data.detail || 'Failed to retrieve tactical advice.' });
      }
    } catch (e) {
      console.error("Hint error:", e);
      toast({ type: 'error', title: 'Connection Failed', message: 'Failed to communicate with Chronos.' });
    } finally {
      setHintLoading(false);
    }
  };

  const prevBattleStateRef = useRef(null);

  const spawnPopup = (text, type, target, element = null, isHeavy = false) => {
    const id = Math.random().toString(36).substring(2, 9);
    setPopups(prev => [...prev, { id, text, type, target, element, isHeavy }]);
    setTimeout(() => {
      setPopups(prev => prev.filter(p => p.id !== id));
    }, 1200);
  };

  useEffect(() => {
    let timerId;
    if (!battleState) {
      prevBattleStateRef.current = null;
      timerId = setTimeout(() => {
        setPopups([]);
        setScreenShake(false);
        setAbilityFlash(null);
        setRoundIntro(null);
        setConfetti(false);
        setDefeatParticles(false);
        setHealthFlash({ me: false, opp: false });
        setCardOverlay({ me: null, opp: null });
        setShieldShatter({ me: false, opp: false });
      }, 0);
    } else {
      const prev = prevBattleStateRef.current;
      prevBattleStateRef.current = battleState;

      if (prev) {
        const newRound = battleState.round_number !== prev.round_number;
        const gameOverState = battleState.game_over && !prev.game_over;

        // --- ROUND TRANSITION ---
        if (newRound && !gameOverState) {
          setRoundIntro({ round: battleState.round_number });
          timerId = setTimeout(() => setRoundIntro(null), 1500);
        }

        // --- GAME OVER EFFECTS ---
        if (gameOverState) {
          const isP1User = !roomState || !roomState.is_pvp || battleState.player1_id === clientId;
          const winnerIsUser = (battleState.winner === 'Player 1' && isP1User) ||
                                (battleState.winner === 'Player 2' && !isP1User);
          if (winnerIsUser) {
            setConfetti(true); // eslint-disable-line react-hooks/set-state-in-effect
            hapticSuccess();
          } else {
            setDefeatParticles(true); // eslint-disable-line react-hooks/set-state-in-effect
            hapticMedium();
          }
        }

        if (newRound || gameOverState) {
          timerId = setTimeout(() => {
            let prevMe;
            let prevOpp;
            let currMe;
            let currOpp;

            if (!roomState || !roomState.is_pvp) {
              prevMe = prev.player1;
              prevOpp = prev.player2;
              currMe = battleState.player1;
              currOpp = battleState.player2;
            } else {
              if (battleState.player1_id === clientId) {
                prevMe = prev.player1;
                prevOpp = prev.player2;
                currMe = battleState.player1;
                currOpp = battleState.player2;
              } else {
                prevMe = prev.player2;
                prevOpp = prev.player1;
                currMe = battleState.player2;
                currOpp = battleState.player1;
              }
            }

            if (!prevMe || !prevOpp || !currMe || !currOpp) return;

            // --- ABILITY CAST DETECTION (cooldown 0→>0) ---
            if ((prevMe.ability_cooldown || 0) === 0 && (currMe.ability_cooldown || 0) > 0) {
              setAbilityFlash({ element: currMe.element, caster: 'me' });
              setMyAnimClass('animate-ability-glow');
              setTimeout(() => { setAbilityFlash(null); setMyAnimClass(''); }, 1000);
            }
            if ((prevOpp.ability_cooldown || 0) === 0 && (currOpp.ability_cooldown || 0) > 0) {
              setAbilityFlash({ element: currOpp.element, caster: 'opp' });
              setOppAnimClass('animate-ability-glow');
              setTimeout(() => { setAbilityFlash(null); setOppAnimClass(''); }, 1000);
            }

            // --- STANCE CHANGE DETECTION ---
            if (prevMe.stance !== currMe.stance) {
              setStancePulse(currMe.stance);
              setTimeout(() => setStancePulse(null), 500);
            }

            // --- SHIELD BREAK DETECTION ---
            if (prevMe.shield_active && !currMe.shield_active) {
              setShieldShatter(prev => ({ ...prev, me: true }));
              setTimeout(() => setShieldShatter(prev => ({ ...prev, me: false })), 500);
            }
            if (prevOpp.shield_active && !currOpp.shield_active) {
              setShieldShatter(prev => ({ ...prev, opp: true }));
              setTimeout(() => setShieldShatter(prev => ({ ...prev, opp: false })), 500);
            }

            // Helper: update card art overlay
            const updateCardOverlay = (diff, target) => {
              if (diff < 0) {
                setCardOverlay(prev => ({ ...prev, [target]: 'damage' }));
                setTimeout(() => setCardOverlay(prev => ({ ...prev, [target]: null })), 500);
              } else if (diff > 0) {
                setCardOverlay(prev => ({ ...prev, [target]: 'heal' }));
                setTimeout(() => setCardOverlay(prev => ({ ...prev, [target]: null })), 600);
              }
            };

            // --- MY CARD EFFECTS ---
            const meHpDiff = currMe.current_health - prevMe.current_health;
            const meDamagePct = prevMe.max_health > 0 ? Math.abs(meHpDiff) / prevMe.max_health : 0;

            if (meHpDiff < 0) {
              const absDmg = Math.abs(meHpDiff);
              const isHeavy = meDamagePct > 0.15;

              setOppAnimClass('animate-strike-left');
              if (isHeavy) { setScreenShake(true); setImpactBurst(true); hapticHeavy(); setTimeout(() => setImpactBurst(false), 460); }
              else hapticMedium();

              setTimeout(() => {
                setMyAnimClass('animate-damage-shake');
                setHealthFlash(prevFlash => ({ ...prevFlash, me: true }));
                updateCardOverlay(meHpDiff, 'me');
                spawnPopup(`-${absDmg}`, 'damage', 'me', currOpp.element, isHeavy);
                if (isHeavy) setTimeout(() => setScreenShake(false), 400);
                setTimeout(() => setHealthFlash(prevFlash => ({ ...prevFlash, me: false })), 500);
              }, 150);
            } else if (meHpDiff > 0) {
              updateCardOverlay(meHpDiff, 'me');
              spawnPopup(`+${meHpDiff}`, 'heal', 'me', currMe.element);
            } else if (currMe.shield_active && !prevMe.shield_active) {
              spawnPopup('SHIELD', 'shield', 'me', currMe.element);
            }

            // --- OPPONENT CARD EFFECTS ---
            const oppHpDiff = currOpp.current_health - prevOpp.current_health;
            const oppDamagePct = prevOpp.max_health > 0 ? Math.abs(oppHpDiff) / prevOpp.max_health : 0;

            if (oppHpDiff < 0) {
              const absDmg = Math.abs(oppHpDiff);
              const isHeavy = oppDamagePct > 0.15;

              setMyAnimClass('animate-strike-right');
              if (isHeavy) { setScreenShake(true); setImpactBurst(true); hapticHeavy(); setTimeout(() => setImpactBurst(false), 460); }
              else hapticMedium();

              setTimeout(() => {
                setOppAnimClass('animate-damage-shake');
                setHealthFlash(prevFlash => ({ ...prevFlash, opp: true }));
                updateCardOverlay(oppHpDiff, 'opp');
                spawnPopup(`-${absDmg}`, 'damage', 'opp', currMe.element, isHeavy);
                if (isHeavy) setTimeout(() => setScreenShake(false), 400);
                setTimeout(() => setHealthFlash(prevFlash => ({ ...prevFlash, opp: false })), 500);
              }, 150);
            } else if (oppHpDiff > 0) {
              updateCardOverlay(oppHpDiff, 'opp');
              spawnPopup(`+${oppHpDiff}`, 'heal', 'opp', currOpp.element);
            } else if (currOpp.shield_active && !prevOpp.shield_active) {
              spawnPopup('SHIELD', 'shield', 'opp', currOpp.element);
            }

            // --- UPDATE MASCOT MOOD ---
            setMascotAnimation(deriveMascotMood(battleState, currMe, currOpp));

            setTimeout(() => {
              setMyAnimClass('');
              setOppAnimClass('');
            }, 700);
          }, 0);
        }
      }
    }
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleState]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const checkBackendHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setHealthStatus(data);
      }
    } catch (e) {
      console.error("Backend offline:", e);
      setHealthStatus({ status: 'offline', gemini_api_configured: false });
    }
  };

  const fetchInventory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cards?client_id=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setCards(data);
      }
    } catch (e) {
      console.error("Failed to load inventory:", e);
    }
  };

  // --- Live Video Capture Functions ---

  const startCamera = async () => {
    setCameraError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Prefer back camera on mobile
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("In-app camera failed to load. Falling back to native capture.", err);
      setCameraError(true);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  // Load inventory, health and alchemical leaderboard status on mount
  useEffect(() => {
    let timerId = setTimeout(() => {
      fetchInventory();
      checkBackendHealth();
      fetchDashboardData();
    }, 0);
    return () => clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Control HTML5 camera streaming
  useEffect(() => {
    let timerId = setTimeout(() => {
      if (activeView === 'transmute' && !isUploading) {
        startCamera();
      } else {
        stopCamera();
      }
    }, 0);
    return () => {
      clearTimeout(timerId);
      stopCamera();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, isUploading]);

  // Reset action locks when a new round starts
  useEffect(() => {
    if (battleState) {
      let timerId = setTimeout(() => {
        setActionLocked(false);
      }, 0);
      return () => clearTimeout(timerId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleState?.round_number]);

  // Local Tournament simulation animation sequence
  useEffect(() => {
    if (!tournamentRunningLocal || !roomState || !roomState.tournament_matches) return;
    
    const matches = roomState.tournament_matches;
    if (tournamentMatchIndex >= matches.length) {
      return;
    }
    
    const currentMatch = matches[tournamentMatchIndex];
    let logIdx = 0;
    
    setTimeout(() => {
      setTournamentMatchLogs([currentMatch.logs[0]]);
    }, 0);
    
    const logInterval = setInterval(() => {
      logIdx++;
      if (logIdx < currentMatch.logs.length) {
        setTournamentMatchLogs(prev => [...prev, currentMatch.logs[logIdx]]);
      } else {
        clearInterval(logInterval);
        
        setTimeout(() => {
          setTournamentMatchesCompleted(prev => [...prev, tournamentMatchIndex]);
          setTournamentMatchIndex(prev => prev + 1);
        }, 2000);
      }
    }, 400);
    
    return () => clearInterval(logInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentRunningLocal, tournamentMatchIndex, roomState?.tournament_matches]);

  // Auto-prompt to select card when entering lobby without a champion
  useEffect(() => {
    if (activeView === 'lobby' && roomState) {
      const myInfo = roomState.members?.find(m => m.client_id === clientId);
      if (myInfo && myInfo.card_name === 'Unregistered') {
        setTimeout(() => {
          setShowRoomCardSelectorModal(true);
        }, 0);
      }
    }
  }, [activeView, roomState, clientId]);

  const captureFrameAndTransmute = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    // Set canvas dimensions to video frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw active video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to image blob and upload
    canvas.toBlob(async (blob) => {
      if (blob) {
        const file = new File([blob], 'alchemical_capture.jpg', { type: 'image/jpeg' });
        await uploadAndTransmute(file);
      }
    }, 'image/jpeg');
  };

  const handleMobileCameraInput = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadAndTransmute(file);
    }
  };

  const uploadAndTransmute = async (file) => {
    setIsUploading(true);
    setNewlyTransmutedCard(null);
    setStatusMessage('Initiating alchemical extraction pipeline...');

    const stages = [
      'Reading visual metadata & color signatures...',
      'Synthesizing structural materials (checking density)...',
      'Piping object to Gemini 1.5 Flash Vision Matrix...',
      'Zero-shot alchemical balancing in progress...',
      'Forging card element and elemental abilities...',
      'Summoning card to inventory...'
    ];

    let stageIdx = 0;
    const interval = setInterval(() => {
      if (stageIdx < stages.length) {
        setStatusMessage(stages[stageIdx]);
        stageIdx++;
      }
    }, 1200);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('client_id', clientId);

    try {
      const res = await fetch(`${API_BASE}/api/transmute`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(interval);

      if (res.ok) {
        const card = await res.json();
        setNewlyTransmutedCard(card);
        setCards(prev => [card, ...prev]);
        setStatusMessage('Alchemical transmutation successful!');
        fetchDashboardData();
        if (card.audio_url) {
          setTimeout(() => playCardVoice(card), 1000);
        }
      } else {
        setStatusMessage('Transmutation failed. Check Gemini API configurations.');
      }
    } catch (err) {
      clearInterval(interval);
      console.error(err);
      setStatusMessage('Network error. Failed to reach the alchemical forge backend.');
    } finally {
      setIsUploading(false);
    }
  };

  // --- PvP and Room Lobby Handlers ---

  const selectCardForArena = (card) => {
    setSelectedCard(card);
    setShowMatchmakingModal(true);
  };

  const startSoloBattle = async () => {
    setShowMatchmakingModal(false);
    setIsPvp(false);
    setPlayerNum(1);
    try {
      const res = await fetch(`${API_BASE}/api/campaign/fight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          card_name: selectedCard.card_name,
          image_url: selectedCard.image_url || '',
          stage: profile?.unlocked_campaign_stage || 1
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, selectedCard);
        setActiveView('battle');
      } else {
        toast({ type: 'error', title: 'Battle Failed', message: 'Failed to initialize campaign match.' });
      }
    } catch (e) {
      console.error(e);
      toast({ type: 'error', title: 'Network Error', message: 'Failed to reach the battle server.' });
    }
  };

  const startRandomPvEBattle = async () => {
    setShowMatchmakingModal(false);
    setIsPvp(false);
    setPlayerNum(1);
    try {
      const res = await fetch(`${API_BASE}/api/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          card_name: selectedCard.card_name,
          is_pvp: false,
          image_url: selectedCard.image_url || ''
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, selectedCard);
        setActiveView('battle');
      } else {
        toast({ type: 'error', title: 'Duel Failed', message: 'Failed to initialize random duel.' });
      }
    } catch (e) {
      console.error(e);
      toast({ type: 'error', title: 'Network Error', message: 'Failed to reach the battle server.' });
    }
  };

  const startCustomPvEDuel = async (myCard, enemyCard) => {
    setShowMatchmakingModal(false);
    setIsPvp(false);
    setPlayerNum(1);
    try {
      const res = await fetch(`${API_BASE}/api/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          card_name: myCard.card_name,
          image_url: myCard.image_url || '',
          is_pvp: false,
          opponent_card: enemyCard
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, myCard);
        setActiveView('battle');
      } else {
        toast({ type: 'error', title: 'Duel Failed', message: 'Failed to initialize custom alchemical duel.' });
      }
    } catch (e) {
      console.error(e);
      toast({ type: 'error', title: 'Network Error', message: 'Failed to reach the battle server.' });
    }
  };

  const hostPvpBattle = async () => {
    setIsPvp(true);
    try {
      const res = await fetch(`${API_BASE}/api/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          card_name: selectedCard.card_name,
          is_pvp: true,
          image_url: selectedCard.image_url || ''
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, selectedCard);
        setShowMatchmakingModal(false);
        setActiveView('lobby');
      } else {
        toast({ type: 'error', title: 'Room Failed', message: 'Failed to create PvP room.' });
      }
    } catch (e) {
      console.error(e);
      toast({ type: 'error', title: 'Network Error', message: 'Failed to reach the battle server.' });
    }
  };

  const joinPvpBattle = async () => {
    if (!joinRoomCode.trim()) {
      toast({ type: 'warn', title: 'Missing Code', message: 'Please enter a Room Code to join.' });
      return;
    }
    const code = joinRoomCode.trim().toUpperCase();
    setIsPvp(true);
    setLobbyId(code);
    connectRoomWebSocket(code, selectedCard);
    setShowMatchmakingModal(false);
    setActiveView('lobby');
  };

  const connectRoomWebSocket = (roomCode, cardToRegister) => {
    if (socket) {
      socket.close();
    }

    const wsUrl = `${WS_BASE}/ws/room/${roomCode}/${clientId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`Connected to room WebSocket: ${roomCode}, client: ${clientId}`);
      setBattleLogs([`[SYSTEM] Connected to Room ${roomCode}.`]);
      // Register card
      ws.send(JSON.stringify({
        action: "register",
        card: cardToRegister || null
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'room_state') {
        setRoomState(data);
        
        if (data.tournament_active) {
          setActiveView('tournament');
          setTournamentRunningLocal(prevRunning => {
            if (!prevRunning) {
              setTournamentMatchIndex(0);
              setTournamentMatchesCompleted([]);
              setTournamentMatchLogs([]);
              return true;
            }
            return prevRunning;
          });
        } else {
          setTournamentRunningLocal(false);
          setActiveView(prev => prev === 'tournament' ? 'lobby' : prev);
        }

        if (data.active_match) {
          setBattleState(data.active_match);
          if (data.active_match.logs) {
            setBattleLogs(data.active_match.logs);
          }
          // If user is one of the fighters, transition to battle view automatically
          const isFighter = data.active_match.player1_id === clientId || data.active_match.player2_id === clientId;
          if (isFighter) {
            setActiveView('battle');
            setPvpWaiting(false);
            setShowMatchmakingModal(false);
          }
        } else {
          setBattleState(null);
          // If game is over and cleared on server, return to lobby dashboard
          setActiveView(prev => {
            if (prev === 'battle' && data.is_pvp) {
              return 'lobby';
            }
            return prev;
          });
        }
      } else if (data.type === 'challenge_received') {
        setIncomingChallenge({
          fromId: data.from_id,
          fromName: data.from_name
        });
      } else if (data.type === 'error') {
        setBattleLogs(prev => [...prev, `[ERROR] ${data.message}`]);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      toast({ type: 'error', title: 'Connection Error', message: 'WebSocket error. Verify backend is active and reachable.' });
    };

    ws.onclose = () => {
      console.log("WebSocket room disconnected");
      setSocket(null);
      setRoomState(null);
      setActiveView(prev => {
        if (prev === 'lobby' || prev === 'tournament' || prev === 'battle') {
          toast({ type: 'warn', title: 'Connection Lost', message: 'Disconnected from room. Returning to lobby selection.' });
          return 'lobby_select';
        }
        return prev;
      });
    };

    setSocket(ws);
  };

  const sendBattleAction = (combatMove) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      setActionLocked(true);
      socket.send(JSON.stringify({
        action: "battle_action",
        combat_move: combatMove,
        stance: selectedStance
      }));
    }
  };

  const quitBattle = () => {
    if (socket) {
      socket.close();
    }
    setSocket(null);
    setBattleState(null);
    setLobbyId(null);
    setSelectedCard(null);
    setJoinRoomCode('');
    setRoomState(null);
    setIsSpectatingActive(false);
    // Reset all animation states
    setScreenShake(false);
    setAbilityFlash(null);
    setHealthFlash({ me: false, opp: false });
    setCardOverlay({ me: null, opp: null });
    setRoundIntro(null);
    setConfetti(false);
    setDefeatParticles(false);
    setStancePulse(null);
    setMascotAnimation('animate-mascot-referee');
    setShieldShatter({ me: false, opp: false });
    setMyAnimClass('');
    setOppAnimClass('');
    setPopups([]);
    setActiveView('inventory');
    fetchInventory();
    fetchDashboardData();
  };

  // Align active fighters based on player index
  const getFightersForDisplay = () => {
    if (!battleState) return { me: null, opponent: null, isSpectator: false };

    if (!roomState || !roomState.is_pvp) {
      return {
        me: battleState.player1,
        opponent: battleState.player2,
        isSpectator: false
      };
    }

    if (battleState.player1_id === clientId) {
      return {
        me: battleState.player1,
        opponent: battleState.player2,
        isSpectator: false
      };
    } else if (battleState.player2_id === clientId) {
      return {
        me: battleState.player2,
        opponent: battleState.player1,
        isSpectator: false
      };
    } else {
      return {
        me: battleState.player1,
        opponent: battleState.player2,
        isSpectator: true
      };
    }
  };

  // UI styling classes based on elemental affinity
  const getElementStyles = (element) => {
    if (!element) return { bg: 'from-slate-900 to-zinc-900', border: 'border-slate-500', text: 'text-slate-400', badge: 'bg-slate-500/20 text-slate-300', symbol: '🔮' };
    switch (element) {
      case 'Fire':
        return {
          bg: 'from-red-950/80 to-orange-950/80',
          border: 'border-red-500/50 shadow-red-500/20',
          text: 'text-red-400',
          badge: 'bg-red-500/20 text-red-300 border-red-500/40',
          symbol: '🔥'
        };
      case 'Water':
        return {
          bg: 'from-blue-950/80 to-cyan-950/80',
          border: 'border-blue-500/50 shadow-blue-500/20',
          text: 'text-blue-400',
          badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          symbol: '💧'
        };
      case 'Lightning':
        return {
          bg: 'from-purple-950/80 to-fuchsia-950/80',
          border: 'border-purple-500/50 shadow-purple-500/20',
          text: 'text-purple-400',
          badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          symbol: '⚡'
        };
      case 'Earth':
        return {
          bg: 'from-emerald-950/80 to-green-950/80',
          border: 'border-green-500/50 shadow-green-500/20',
          text: 'text-green-400',
          badge: 'bg-green-500/20 text-green-300 border-green-500/40',
          symbol: '🌿'
        };
      default:
        return {
          bg: 'from-slate-900/80 to-zinc-900/80',
          border: 'border-slate-500/50 shadow-slate-500/20',
          text: 'text-slate-400',
          badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
          symbol: '🔮'
        };
    }
  };

  const getMascotComment = () => {
    if (!battleState) return '';
    if (battleState.game_over) {
      if (battleState.winner === `Player ${playerNum}`) {
        return "Fantastic victory! Alchemical transmutation complete!";
      }
      return "A tough loss... Revise your transmutation formula and try again!";
    }
    const { me, opponent } = getFightersForDisplay();
    if (!me || !opponent) return '';
    if (me.current_health < me.max_health * 0.3) {
      return "Critical status! Switch to Defensive Stance or use Shield!";
    }
    if (opponent.current_health < opponent.max_health * 0.3) {
      return "The opponent is faltering! Maximize damage with Aggressive Stance!";
    }
    if (me.shield_active) {
      return "Your shield is active! Perfect time to set up or attack!";
    }
    if (opponent.shield_active) {
      return "Caution: Opponent's shield is up. Do not waste big hits!";
    }
    return `Round ${battleState.round_number} is underway! Choose your stance and strike!`;
  };

  const getLocalLeaderboard = () => {
    if (!roomState || !roomState.tournament_matches) return [];
    const completedMatches = roomState.tournament_matches.slice(0, tournamentMatchesCompleted.length);
    
    const playerStats = {};
    roomState.members.filter(m => m.card_name !== 'Unregistered').forEach(m => {
      playerStats[m.client_id] = {
        client_id: m.client_id,
        card_name: m.card_name,
        wins: 0,
        losses: 0,
        draws: 0,
        points: 0
      };
    });
    
    completedMatches.forEach(m => {
      if (m.draw) {
        if (playerStats[m.player1_id]) {
          playerStats[m.player1_id].draws += 1;
          playerStats[m.player1_id].points += 1;
        }
        if (playerStats[m.player2_id]) {
          playerStats[m.player2_id].draws += 1;
          playerStats[m.player2_id].points += 1;
        }
      } else {
        const winnerId = m.winner_id;
        const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
        if (playerStats[winnerId]) {
          playerStats[winnerId].wins += 1;
          playerStats[winnerId].points += 3;
        }
        if (playerStats[loserId]) {
          playerStats[loserId].losses += 1;
        }
      }
    });
    
    const list = Object.values(playerStats);
    list.sort((a, b) => (b.points - a.points) || (b.wins - a.wins));
    return list;
  };

  const skipSimulation = () => {
    if (!roomState || !roomState.tournament_matches) return;
    const allCompleted = roomState.tournament_matches.map((_, i) => i);
    setTournamentMatchesCompleted(allCompleted);
    setTournamentMatchIndex(roomState.tournament_matches.length);
  };

  const { me, opponent, isSpectator } = getFightersForDisplay();

  return (
    <div className={`flex flex-col text-slate-100 w-full ${activeView === 'battle' ? 'h-dvh max-h-dvh overflow-hidden p-2' : 'min-h-dvh p-4 pb-28 md:pb-6 md:p-6 max-w-7xl mx-auto'}`}>
      {/* MOBILE BOTTOM NAV */}
      {activeView !== 'battle' && activeView !== 'tournament' && (
        <BottomNav
          activeView={activeView}
          disabled={activeView === 'lobby'}
          onSettings={() => setShowSettingsModal(true)}
          onNavigate={(view) => {
            if (activeView === 'battle' || activeView === 'lobby' || activeView === 'tournament') return;
            setActiveView(view);
            if (view === 'inventory') fetchInventory();
            else if (view === 'feed') fetchTodayFeed();
            else if (view === 'advisor') fetchInventory();
            else fetchDashboardData();
          }}
        />
      )}

      {/* FLOATING REWARD POPUPS */}
      <div className="fixed inset-x-0 top-1/3 z-[199] pointer-events-none flex flex-col items-center gap-3">
        {rewardPopups.map(r => (
          <div key={r.id} className="animate-reward-float font-mono font-extrabold text-xl text-cyber-yellow drop-shadow-[0_0_12px_rgba(255,251,0,0.8)] tracking-wider">
            {r.text}
          </div>
        ))}
      </div>

      {/* HEADER NAVBAR */}
      {(activeView !== 'battle' && activeView !== 'tournament') && (
        <header className="flex flex-col sm:flex-row items-center justify-between border-b border-white/10 pb-4 mb-4 gap-3">
          {/* Logo + compact HUD on mobile */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-tr from-cyber-purple to-cyber-blue flex items-center justify-center font-mono font-bold text-black text-xl shadow-[0_0_15px_rgba(157,78,221,0.6)] shrink-0">
                ☿
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-extrabold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyber-purple via-cyber-blue to-cyber-green font-mono uppercase animate-flicker">
                  POCKET ALCHEMY
                </h1>
                <p className="text-[8px] sm:text-xs text-slate-400 font-mono tracking-widest uppercase hidden sm:block">multimodal mobile card battler</p>
              </div>
            </div>
            {/* Compact HUD — mobile only */}
            <div className="md:hidden">
              <PlayerHUD profile={profile} compact />
            </div>
          </div>

          {/* Desktop: full HUD + desktop nav tabs */}
          <div className="hidden md:flex flex-col items-end gap-2 font-mono flex-1">
            <PlayerHUD profile={profile} />
            {/* Navigation Tabs */}
            <div className="flex gap-1.5 flex-wrap justify-end">
              {NAV_ITEMS.map((tab) => {
                const ACCENT_MAP = {
                  transmute: 'bg-cyber-purple text-black border-cyber-purple shadow-[0_0_10px_rgba(157,78,221,0.4)]',
                  inventory: 'bg-cyber-blue text-black border-cyber-blue shadow-[0_0_10px_rgba(0,240,255,0.4)]',
                  leaderboard: 'bg-cyber-green text-black border-cyber-green shadow-[0_0_10px_rgba(57,255,20,0.4)]',
                  badges: 'bg-cyber-pink text-black border-cyber-pink shadow-[0_0_10px_rgba(255,0,127,0.4)]',
                  feed: 'bg-cyber-yellow text-black border-cyber-yellow shadow-[0_0_10px_rgba(255,251,0,0.4)]',
                  lobby_select: 'bg-cyber-blue text-black border-cyber-blue shadow-[0_0_10px_rgba(0,240,255,0.4)]',
                  advisor: 'bg-cyber-purple text-black border-cyber-purple shadow-[0_0_10px_rgba(157,78,221,0.4)]',
                };
                const isActive = activeView === tab.view;
                return (
                  <button
                    key={tab.view}
                    onClick={() => {
                      if (activeView !== 'battle' && activeView !== 'lobby' && activeView !== 'tournament') {
                        setActiveView(tab.view);
                        if (tab.view === 'inventory') fetchInventory();
                        else if (tab.view === 'feed') fetchTodayFeed();
                        else if (tab.view === 'advisor') fetchInventory();
                        else fetchDashboardData();
                      }
                    }}
                    disabled={activeView === 'battle' || activeView === 'lobby' || activeView === 'tournament'}
                    className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-all border ${isActive ? (ACCENT_MAP[tab.view] || 'bg-cyber-purple text-black border-cyber-purple') : 'bg-transparent text-slate-400 border-white/10 hover:border-white/30 hover:text-slate-200 disabled:opacity-40'}`}
                  >
                    {tab.icon} {tab.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Connection status pills — desktop */}
          <div className="hidden sm:flex gap-2 text-xs font-mono">
            <button
              onClick={() => setShowSettingsModal(true)}
              className={`px-2 py-1 rounded border transition-all cursor-pointer hover:brightness-110 active:scale-95 ${healthStatus.status === 'healthy'
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                }`}
              title="Click to configure backend IP address"
            >
              CORE: {healthStatus.status === 'healthy' ? '✓ ONLINE' : 'OFFLINE ⚙️'}
            </button>
            <span className={`px-2 py-1 rounded border ${healthStatus.gemini_api_configured
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
              AI: {healthStatus.gemini_api_configured ? '✓' : '⚠'}
            </span>
          </div>
        </header>
      )}

      {/* VIEW 1: TRANSMUTATION MATRIX (LIVE CAMERA VIEWPORT) */}
      {activeView === 'transmute' && (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 items-stretch animate-screen-enter">
          {/* Live Camera Box */}
          <div className="flex-1 flex flex-col">
            <div
              className="flex-1 min-h-[350px] cyber-glass rounded-2xl border border-white/10 flex flex-col items-center justify-center p-4 relative overflow-hidden group shadow-2xl"
            >
              {/* Scanline Animation during upload */}
              {isUploading && <div className="animate-scan animate-pulse" />}

              {isUploading ? (
                /* WIZARD LOADING ANIMATION VIEWPORT */
                <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden bg-black/60 p-6 min-h-[350px]">
                  {/* Lightning overlay that flashes */}
                  <div className="absolute inset-0 animate-lightning-overlay pointer-events-none z-0" />

                  {/* Sparks rising */}
                  <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
                    {SPARKS.map((spark, i) => (
                      <div
                        key={i}
                        className="absolute bottom-0 w-1.5 h-1.5 rounded-full bg-cyber-blue animate-spark"
                        style={{
                          left: spark.left,
                          animationDelay: spark.delay,
                          animationDuration: spark.duration
                        }}
                      />
                    ))}
                  </div>

                  {/* SVG Alchemical Wizard and Circles */}
                  <div className="relative w-48 h-48 flex items-center justify-center z-10 animate-wizard">
                    {/* Inner Alchemy Circle */}
                    <svg className="absolute w-44 h-44 text-cyber-purple/40 animate-spin-slow-reverse" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
                      <polygon points="50,5 90,80 10,80" fill="none" stroke="currentColor" strokeWidth="0.75" />
                      <polygon points="50,95 90,20 10,20" fill="none" stroke="currentColor" strokeWidth="0.75" />
                    </svg>

                    {/* Outer Alchemy Circle */}
                    <svg className="absolute w-48 h-48 text-cyber-blue/50 animate-spin-slow" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="0.5" />
                      <path d="M 50 2 A 48 48 0 0 1 98 50" fill="none" stroke="currentColor" strokeWidth="2" />
                      <path d="M 50 98 A 48 48 0 0 1 2 50" fill="none" stroke="currentColor" strokeWidth="2" />
                    </svg>

                    {/* Wizard SVG Silhouette */}
                    <svg className="w-32 h-32 text-cyber-purple drop-shadow-[0_0_10px_rgba(157,78,221,0.6)]" viewBox="0 0 64 64" fill="currentColor">
                      <path d="M32 4 L22 28 L42 28 Z" />
                      <path d="M26 28 L14 58 L50 58 L38 28 Z" fillOpacity="0.8" />
                      <circle cx="32" cy="34" r="5" />
                      <rect x="44" y="16" width="2" height="42" transform="rotate(-10 44 16)" fill="#00f0ff" />
                      <circle cx="48" cy="14" r="4" fill="#00f0ff" className="animate-pulse" />
                    </svg>
                  </div>

                  {/* Alchemical logs ticker */}
                  <div className="z-10 mt-6 text-center">
                    <h4 className="font-mono text-sm font-bold text-cyber-blue tracking-widest uppercase animate-flicker mb-1">
                      ⚡ TRANSMUTING ELEMENTS ⚡
                    </h4>
                    <div className="font-mono text-xs text-[#39ff14] bg-black/80 px-4 py-2 border border-[#39ff14]/30 rounded shadow-[0_0_10px_rgba(57,255,20,0.1)]">
                      {statusMessage || '[FORGE] Initiating alchemical matrix...'}
                    </div>
                  </div>
                </div>
              ) : cameraError ? (
                // CAMERA FALLBACK: Trigger Mobile Native App Capture
                <div className="flex flex-col items-center justify-center text-center p-6 max-w-sm">
                  <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/30 mb-4 animate-pulse">
                    <span className="text-3xl">📷</span>
                  </div>
                  <h3 className="font-mono uppercase font-bold text-sm tracking-wider mb-2 text-amber-400">Viewfinder Locked</h3>
                  <p className="text-slate-400 text-xs leading-relaxed mb-6">
                    In-app browser stream requires SSL/HTTPS camera permissions. Launch your device's native alchemical lens instead.
                  </p>

                  <label className="px-6 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold font-mono text-sm uppercase hover:brightness-110 cursor-pointer transition-all">
                    Activate Mobile Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleMobileCameraInput}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                // LIVE HTML5 VIDEO VIEWPORT
                <div className="flex flex-col items-center justify-center relative z-10 w-full py-4">
                  {/* Viewfinder at 1.6x dimensions (w-[410px] h-[282px]) with absolute shutter overlay */}
                  <div className="w-[410px] h-[282px] max-w-full flex flex-col items-center justify-center relative rounded-xl border border-cyber-blue/40 bg-black overflow-hidden shadow-[0_0_15px_rgba(0,240,255,0.2)]">
                    {/* Glowing camera border reticle */}
                    <div className="absolute inset-3 border border-white/10 rounded-lg pointer-events-none z-10">
                      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-cyber-blue" />
                      <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-cyber-blue" />
                      <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-cyber-blue" />
                      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-cyber-blue" />
                    </div>

                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover rounded-lg bg-black"
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Shutter capture button overlay */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
                      <button
                        onClick={() => { hapticMedium(); captureFrameAndTransmute(); }}
                        disabled={isUploading}
                        className="w-14 h-14 rounded-full bg-white/20 hover:bg-white/40 border-4 border-white flex items-center justify-center transition-all cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 disabled:opacity-40"
                      >
                        <div className="w-8 h-8 rounded-full bg-cyber-purple animate-pulse" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Decorative alchemical matrix logs */}
              <div className="absolute top-4 left-4 font-mono text-[9px] text-cyber-purple/40">MATRIX_CAMERA_LENS</div>
              <div className="absolute bottom-4 right-4 font-mono text-[9px] text-cyber-blue/40">FOV_ENV_DYNAMIC</div>
            </div>

            {/* Transmutation Status Log */}
            {(isUploading || statusMessage) && (
              <div className="mt-4 cyber-glass border-l-4 border-cyber-purple p-4 rounded-xl font-mono text-sm">
                <div className="flex items-center gap-3">
                  {isUploading && (
                    <div className="w-3 h-3 rounded-full bg-cyber-purple animate-pulse" />
                  )}
                  <p className="text-slate-300 font-mono text-xs">{statusMessage}</p>
                </div>
              </div>
            )}
          </div>

          {/* Newly Forged Card Showcase */}
          <div className="w-full lg:w-96 flex flex-col items-center justify-center p-4">
            {newlyTransmutedCard ? (
              <div className="w-full animate-float">
                <h3 className="text-center font-mono text-xs text-cyber-purple tracking-widest uppercase mb-3">
                  ✦ Newly Transmuted Summon ✦
                </h3>
                <TradingCard card={newlyTransmutedCard} onAction={() => selectCardForArena(newlyTransmutedCard)} actionLabel="FIELD IN ARENA" />
              </div>
            ) : (
              <div className="w-full h-full min-h-[350px] cyber-glass border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center p-6">
                <span className="text-4xl text-slate-700 font-mono mb-4">⚛</span>
                <p className="text-slate-500 font-mono text-sm max-w-[200px]">
                  Take a photo of any object to forge a card in the alchemical crucible.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: ALCHEMY VAULT INVENTORY */}
      {activeView === 'inventory' && (
        <div className="flex-1 flex flex-col animate-screen-enter">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold tracking-wide font-mono uppercase flex items-center gap-2">
              <span>⚛</span> Forged Inventory ({cards.length})
            </h2>
            <button
              onClick={() => setActiveView('transmute')}
              className="px-4 py-2 rounded-lg bg-cyber-purple/10 border border-cyber-purple/30 text-cyber-purple hover:bg-cyber-purple/20 text-xs font-mono transition-all"
            >
              + FORGE NEW CARD
            </button>
          </div>

          {cards.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 cyber-glass rounded-2xl border border-white/5 min-h-[400px]">
              <span className="text-5xl text-slate-700 mb-4">🕳️</span>
              <h3 className="font-mono text-lg font-semibold uppercase mb-2">Vault is Empty</h3>
              <p className="text-slate-400 text-sm max-w-md mb-6 leading-relaxed">
                You haven't transmuted any physical objects into trading cards yet. Snap a picture with your alchemical lens to start!
              </p>
              <button
                onClick={() => setActiveView('transmute')}
                className="px-6 py-3 rounded-lg bg-cyber-purple text-black font-semibold font-mono text-sm uppercase hover:brightness-110 transition-all"
              >
                Open Alchemical Lens
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 justify-items-center">
              {cards.map((card, idx) => (
                <div key={idx} className="animate-card-deal w-full flex justify-center" style={{ animationDelay: `${idx * 60}ms` }}>
                  <TradingCard
                    card={card}
                    onAction={() => { hapticLight(); selectCardForArena(card); }}
                    actionLabel="SUMMON TO ARENA"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 6.5: ALCHEMICAL SAGE ADVISOR CHAT */}
      {activeView === 'advisor' && (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 items-stretch animate-screen-enter">
          {/* Chat Panel */}
          <div className="flex-1 flex flex-col cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40 min-h-[500px]">
            <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
              <h2 className="text-base font-bold font-mono text-cyber-purple uppercase tracking-wider flex items-center gap-2">
                <span>🧙‍♂️</span> Alchemical Sage Advisor
              </h2>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-white/5 px-2 py-0.5 rounded">
                MANAGED AGENT V2.6
              </span>
            </div>

            {/* Chat History */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 max-h-[380px] min-h-[300px]">
              {advisorHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl p-3 font-mono text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-cyber-purple/20 text-white border border-cyber-purple/30 rounded-tr-none'
                      : 'bg-slate-950/80 text-cyber-green border border-white/5 rounded-tl-none'
                  }`}>
                    <span className="text-[9px] block text-slate-500 mb-1">
                      {msg.role === 'user' ? 'APPRENTICE' : 'ALCHEMICAL SAGE'}
                    </span>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))}
              {advisorLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-950/80 text-slate-500 border border-white/5 rounded-xl rounded-tl-none p-3 font-mono text-xs">
                    <span className="text-[9px] block mb-1">ALCHEMICAL SAGE</span>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-cyber-green rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-cyber-green rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-cyber-green rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Suggestions */}
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-thin select-none">
              {[
                "Suggest a fusion recipe from my vault",
                "Explain the element matchup chart",
                "Give me combat stance advice",
                "Tell me some ancient alchemical lore"
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => sendAdvisorMessage(suggestion)}
                  disabled={advisorLoading}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-cyber-purple/10 border border-white/10 hover:border-cyber-purple/30 text-slate-300 hover:text-white font-mono text-[9px] uppercase transition-all"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="mt-4 flex gap-2 border-t border-white/5 pt-4">
              <input
                type="text"
                value={advisorInput}
                onChange={(e) => setAdvisorInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendAdvisorMessage()}
                disabled={advisorLoading}
                placeholder="Ask the Sage for deck advice..."
                className="flex-1 bg-black/60 border border-white/10 focus:border-cyber-purple rounded-lg px-3 py-2 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyber-purple"
              />
              <button
                onClick={() => sendAdvisorMessage()}
                disabled={advisorLoading}
                className="px-4 py-2 rounded-lg bg-cyber-purple text-black font-mono font-bold text-xs uppercase hover:brightness-110 active:scale-95 transition-all cursor-pointer"
              >
                Send
              </button>
            </div>
          </div>

          {/* Sidebar: Card Overview */}
          <div className="w-full lg:w-80 flex flex-col cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40">
            <h3 className="text-sm font-bold font-mono text-cyber-blue uppercase tracking-wider mb-3 pb-2 border-b border-white/5">
              🔮 Deck Catalog ({cards.length})
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 max-h-[380px] lg:max-h-none">
              {cards.length === 0 ? (
                <p className="text-xs font-mono text-slate-500 italic text-center py-8">No cards forged yet.</p>
              ) : (
                cards.map((card, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      sendAdvisorMessage(`Analyze my card: ${card.card_name}`);
                      playCardVoice(card);
                    }}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/5 hover:border-cyber-blue/30 cursor-pointer transition-all select-none group"
                  >
                    <div className="w-10 h-10 rounded bg-black/60 overflow-hidden border border-white/5 flex-shrink-0">
                      {resolveImageUrl(card) ? (
                        <img src={resolveImageUrl(card)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <div className="w-full h-full bg-slate-900 flex items-center justify-center text-[10px]">⚛</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 font-mono">
                      <h4 className="text-[10px] font-bold text-white uppercase truncate">{card.card_name}</h4>
                      <p className="text-[8px] text-slate-400 mt-0.5">{card.element.toUpperCase()} | HP:{card.base_stats.health}</p>
                    </div>
                    {card.audio_url && (
                      <span className="text-xs opacity-60 group-hover:opacity-100 group-hover:text-cyber-purple transition-all">🔊</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2.5: LEADERBOARD & SCOREBOARD */}
      {activeView === 'leaderboard' && (
        <div className="flex-1 flex flex-col gap-6 font-mono animate-screen-enter">
          {/* Daily Quest */}
          {dailyQuest && (
            <div className="cyber-glass border border-cyber-green/30 bg-cyber-green/5 p-4 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-[10px] text-cyber-green font-mono uppercase font-bold tracking-wider">🎯 Active Daily Alchemical Quest</span>
                <p className="text-sm font-semibold font-mono text-slate-100 mt-0.5">{dailyQuest.description}</p>
              </div>
              <div className="text-2xl animate-bounce-slow">
                {dailyQuest.element === 'Fire' ? '🔥' :
                  dailyQuest.element === 'Water' ? '💧' :
                    dailyQuest.element === 'Lightning' ? '⚡' :
                      dailyQuest.element === 'Earth' ? '🌿' : '🔮'}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Global Uniqueness Leaderboard */}
            <div className="cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40 flex flex-col">
              <h2 className="text-base font-bold font-mono text-cyber-blue uppercase tracking-wider mb-4 pb-2 border-b border-white/5">
                ⚛️ Global Uniqueness Leaderboard
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs text-slate-300">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5 uppercase text-[10px] tracking-wider">
                      <th className="py-2 pl-2">Rank</th>
                      <th className="py-2">Card Name</th>
                      <th className="py-2">Element</th>
                      <th className="py-2 text-right">Uniqueness</th>
                      <th className="py-2 pr-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="py-8 text-center text-slate-500 italic">No legendary cards forged yet.</td>
                      </tr>
                    ) : (
                      leaderboard.map((item, idx) => (
                        <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-all">
                          <td className="py-2.5 pl-2 font-bold text-cyber-purple">{idx + 1}</td>
                          <td className="py-2.5 font-semibold text-slate-100">{item.card_name}</td>
                          <td className="py-2.5">
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${item.element === 'Fire' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                                item.element === 'Water' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                                  item.element === 'Lightning' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
                                    item.element === 'Earth' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                                      'bg-slate-500/10 text-slate-400 border-slate-500/30'
                              }`}>
                              {item.element.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-bold text-cyber-blue">{item.uniqueness_score?.toFixed(1)}%</td>
                          <td className="py-2.5 pr-2 text-right">
                            <button
                              onClick={() => {
                                setChallengerTargetOpponent(item);
                                setShowFighterSelectorModal(true);
                              }}
                              className="px-2 py-0.5 rounded bg-cyber-pink/20 border border-cyber-pink/40 hover:bg-cyber-pink/30 text-cyber-pink text-[10px] font-bold uppercase transition-all cursor-pointer"
                            >
                              ⚔️ Battle
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Battles Scoreboard */}
            <div className="cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40 flex flex-col">
              <h2 className="text-base font-bold font-mono text-cyber-pink uppercase tracking-wider mb-4 pb-2 border-b border-white/5">
                ⚔️ Recent Battles Scoreboard
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs text-slate-300">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5 uppercase text-[10px] tracking-wider">
                      <th className="py-2 pl-2">Winner</th>
                      <th className="py-2">Loser</th>
                      <th className="py-2">Mode</th>
                      <th className="py-2 pr-2 text-right">Rounds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {battleHistory.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="py-8 text-center text-slate-500 italic">No arena battles recorded yet.</td>
                      </tr>
                    ) : (
                      battleHistory.map((item, idx) => (
                        <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-all">
                          <td className="py-2.5 pl-2 font-bold text-cyber-green">🏆 {item.winner}</td>
                          <td className="py-2.5 text-slate-400">{item.loser}</td>
                          <td className="py-2.5 font-semibold text-cyber-blue">{item.mode}</td>
                          <td className="py-2.5 pr-2 text-right text-slate-200">{item.rounds} rounds</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2.6: BADGES VAULT */}
      {activeView === 'badges' && (
        <div className="flex-1 flex flex-col gap-6 font-mono animate-screen-enter">
          <div className="cyber-glass rounded-xl p-5 border border-white/10 bg-black/40">
            <h2 className="text-xl font-bold font-mono text-amber-400 uppercase tracking-wider">🏆 Badges Vault</h2>
            <p className="text-xs text-slate-400 mt-1">Unlock prestigious titles by progressing through solo campaign boss nodes.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { id: 'acolyte', name: 'Acolyte Alchemist', description: 'Reach Campaign Stage 3.', icon: '🎖️', color: 'text-cyber-purple', glow: 'shadow-[0_0_15px_rgba(157,78,221,0.4)]' },
              { id: 'master', name: 'Forge Master', description: 'Reach Campaign Stage 6.', icon: '🛡️', color: 'text-cyber-blue', glow: 'shadow-[0_0_15px_rgba(0,240,255,0.4)]' },
              { id: 'adept', name: 'Divine Adept', description: 'Reach Campaign Stage 10.', icon: '👑', color: 'text-cyber-yellow', glow: 'shadow-[0_0_15px_rgba(255,251,0,0.4)]' }
            ].map((badge) => {
              const isUnlocked = profile?.badges?.includes(badge.name) ||
                (badge.id === 'acolyte' && profile?.unlocked_campaign_stage > 3) ||
                (badge.id === 'master' && profile?.unlocked_campaign_stage > 6) ||
                (badge.id === 'adept' && profile?.unlocked_campaign_stage > 10);

              return (
                <div
                  key={badge.id}
                  className={`cyber-glass border rounded-2xl p-6 flex flex-col items-center text-center transition-all duration-300 ${isUnlocked
                      ? `border-white/20 bg-black/60 ${badge.glow}`
                      : 'border-white/5 bg-black/20 opacity-40 grayscale'
                    }`}
                >
                  <span className="text-5xl">{badge.icon}</span>
                  <h3 className={`font-mono text-base font-bold uppercase mt-3 ${isUnlocked ? badge.color : 'text-slate-500'}`}>
                    {badge.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-2">{badge.description}</p>
                  <span className={`text-[9px] font-bold mt-4 px-2 py-0.5 rounded ${isUnlocked ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-500'}`}>
                    {isUnlocked ? 'UNLOCKED' : 'LOCKED'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2.7: TODAY'S FEED */}
      {activeView === 'feed' && (
        <div className="flex-1 flex flex-col font-mono animate-screen-enter">
          <div className="cyber-glass rounded-xl p-5 border border-white/10 bg-black/40 mb-6">
            <h2 className="text-xl font-bold font-mono text-cyber-yellow uppercase tracking-wider">🔥 Today's Alchemical Feed</h2>
            <p className="text-xs text-slate-400 mt-1">Discover the latest cards forged in the crucible today. Challenge any card using your vault summons!</p>
          </div>

          {todayFeed.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 cyber-glass rounded-2xl border border-white/5 min-h-[400px]">
              <span className="text-5xl text-slate-700 mb-4">🌪️</span>
              <h3 className="font-mono text-lg font-semibold uppercase mb-2">No Transmutations Today</h3>
              <p className="text-slate-400 text-sm max-w-md mb-6 leading-relaxed">
                No new cards have been forged today. Be the first to transmute a card, or return later!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 justify-items-center">
              {todayFeed.map((card, idx) => (
                <div key={idx} className="animate-card-deal w-full flex justify-center" style={{ animationDelay: `${idx * 60}ms` }}>
                  <TradingCard
                    card={card}
                    onAction={() => {
                      hapticLight();
                      setChallengerTargetOpponent(card);
                      setShowFighterSelectorModal(true);
                    }}
                    actionLabel="⚔️ CHALLENGE SUMMON"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: BATTLE ARENA */}
      {activeView === 'battle' && battleState && me && (
        <div className={`flex-1 flex flex-col gap-2 justify-between overflow-hidden relative ${screenShake ? 'animate-screen-shake' : ''}`}>

          {/* Ability Cast Screen Flash Overlay */}
          {abilityFlash && (
            <div
              className="absolute inset-0 z-35 pointer-events-none animate-ability-flash rounded-xl"
              style={{
                background: `radial-gradient(circle at center, ${getElementGlowColor(abilityFlash.element)}, transparent 70%)`
              }}
            />
          )}

          {/* Heavy Hit Impact Burst */}
          {impactBurst && (
            <div className="absolute inset-0 z-36 pointer-events-none flex items-center justify-center">
              <div className="w-32 h-32 rounded-full border-4 border-white/60 animate-impact-burst" />
            </div>
          )}

          {/* Round Intro Announcement Overlay */}
          {roundIntro && (
            <div className="absolute inset-0 z-45 pointer-events-none flex items-center justify-center">
              <div className="animate-round-intro text-center">
                <span className="text-[10px] font-mono text-cyber-blue font-extrabold uppercase tracking-widest block mb-2">
                  ARENA COMBAT
                </span>
                <span className="text-5xl md:text-7xl font-black font-mono text-white tracking-[0.3em] drop-shadow-[0_0_30px_rgba(0,240,255,0.8)]">
                  ROUND {roundIntro.round}
                </span>
              </div>
            </div>
          )}

          {/* Sequential Animated Battle Log Overlay */}
          {displayedLog && (
            <div className="absolute inset-x-4 top-1/3 z-40 pointer-events-none flex justify-center items-center">
              <div className="animate-log-overlay text-center px-6 py-4 bg-black/90 border-2 border-cyber-green rounded-2xl shadow-[0_0_25px_rgba(57,255,20,0.4)] backdrop-blur-md max-w-lg">
                <span className="text-[10px] font-mono text-cyber-green font-extrabold uppercase tracking-widest block mb-1">
                  COMBAT LOG
                </span>
                <p className={`font-mono text-xs md:text-sm font-bold tracking-wide uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] leading-relaxed ${
                  displayedLog.includes('⚔️') || displayedLog.includes('💥') ? 'text-red-300' :
                  displayedLog.includes('✨') ? 'text-fuchsia-300' :
                  displayedLog.includes('🛡️') ? 'text-cyan-300' :
                  displayedLog.includes('❤️') || displayedLog.includes('💪') || displayedLog.includes('⚡') ? 'text-green-300' :
                  displayedLog.includes('🏆') ? 'text-yellow-300' :
                  'text-white'
                }`}>
                  {displayedLog}
                </p>
              </div>
            </div>
          )}

          {/* Compact Arena Header */}
          <div className="flex justify-between items-center bg-black/60 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
            <div>
              <span className="text-slate-400">ROOM:</span> <b className="text-cyber-blue mr-3">{lobbyId}</b>
              <span className="text-slate-400">ROUND:</span> <b className="text-cyber-green">{battleState.round_number}</b>
            </div>
            <button
              onClick={() => {
                if (roomState && roomState.is_pvp) {
                  setIsSpectatingActive(false);
                  setActiveView('lobby');
                } else {
                  quitBattle();
                }
              }}
              className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] hover:bg-red-500/20 font-bold uppercase transition-all"
            >
              Exit Arena
            </button>
          </div>

          {/* Combatants 3-Column Arena Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 items-stretch flex-1 min-h-0 overflow-y-auto md:overflow-hidden">

            {/* COLUMN 1: Player Card Details */}
            <div
              className={`cyber-glass border border-white/10 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${myAnimClass}`}
              style={myAnimClass === 'animate-ability-glow' ? { '--glow-color': getElementGlowColor(me.element) } : {}}
            >
              <div className="flex justify-between items-center mb-2 text-xs text-cyber-purple font-mono uppercase tracking-wider">
                <span>{isSpectator ? "Fighter 1" : "Player (You)"}</span>
                <span className="px-2 py-0.5 rounded bg-cyber-purple/10 border border-cyber-purple/30 text-cyber-purple text-[10px] font-bold">
                  {me.element.toUpperCase()} {getElementStyles(me.element).symbol}
                </span>
              </div>

              {/* Floating Popups Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
                {popups.filter(p => p.target === 'me').map(p => (
                  <span
                    key={p.id}
                    className={`damage-popup absolute font-extrabold font-mono tracking-wider ${p.isHeavy ? 'damage-popup-critical text-5xl' : 'text-4xl'} ${
                      p.type === 'damage' ? getElementDamageColor(p.element) :
                      p.type === 'heal' ? 'text-green-400 drop-shadow-[0_0_12px_rgba(74,222,128,0.8)]' :
                      'text-cyber-blue drop-shadow-[0_0_12px_rgba(0,240,255,0.8)]'
                    }`}
                  >
                    {p.text}
                  </span>
                ))}
              </div>

              {/* Shield Active / Shatter Overlay */}
              {me.shield_active ? (
                <div className="absolute inset-0 border-2 border-cyber-blue rounded-xl pointer-events-none z-10" style={{ animation: 'pulse-neon 1.5s infinite' }} />
              ) : shieldShatter.me && (
                <div className="absolute inset-0 border-2 border-cyber-blue/50 rounded-xl pointer-events-none z-10 animate-shield-shatter" />
              )}

              {/* Card Art Image Frame */}
              <div className="w-full h-28 sm:h-36 md:h-44 rounded-lg bg-black/60 flex items-center justify-center overflow-hidden border border-white/5 relative mb-2 md:mb-3">
                {/* Damage/Heal overlay on card art */}
                {cardOverlay.me && (
                  <div className={`absolute inset-0 z-20 pointer-events-none rounded-lg ${cardOverlay.me === 'damage' ? 'animate-damage-overlay' : 'animate-heal-overlay'}`} />
                )}
                {resolveImageUrl(me) ? (
                  <img
                    src={resolveImageUrl(me)}
                    alt={me.card_name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <AlchemicalPlaceholder element={me.element} className="border-none bg-transparent" />
                )}
              </div>

              <h3 className="font-bold text-sm truncate mb-1 font-mono uppercase border-b border-white/5 pb-1 text-white" title={me.card_name}>
                {me.card_name}
              </h3>

              {/* Health Pool Bar */}
              <div className="mb-3">
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
                  <span>HEALTH POOL</span>
                  <span className="font-bold text-white">{me.current_health}/{me.max_health} HP</span>
                </div>
                <div className="w-full bg-slate-950/80 h-3 rounded-full overflow-hidden border border-white/5 p-[2px] relative">
                  <div
                    style={{ width: `${(me.current_health / me.max_health) * 100}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-cyber-purple to-cyber-blue transition-all duration-500 shadow-[0_0_8px_#9d4edd]"
                  />
                  {healthFlash.me && (
                    <div className="absolute inset-0 rounded-full animate-health-bar-flash z-10 pointer-events-none" />
                  )}
                </div>
              </div>

              {/* Fighter Stance Badge */}
              <div className="flex items-center justify-between bg-black/40 p-2 rounded-lg border border-white/5 font-mono text-xs">
                <span className="text-slate-400 text-[10px] uppercase font-bold">Active Stance:</span>
                <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${me.stance === 'aggressive' ? 'bg-cyber-pink/20 text-cyber-pink border border-cyber-pink/40 shadow-[0_0_8px_rgba(255,0,127,0.3)]' :
                    me.stance === 'defensive' ? 'bg-cyber-green/20 text-cyber-green border border-cyber-green/40 shadow-[0_0_8px_rgba(57,255,20,0.3)]' :
                      'bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/40 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                  }`}>
                  {me.stance || 'FOCUSED'}
                </span>
              </div>
            </div>

            {/* COLUMN 2: Comparative metrics & Mascot Comments & Chronos hint */}
            <div className="col-span-2 md:col-span-1 order-last md:order-none flex flex-col gap-2 md:gap-3 justify-between flex-1 min-h-0 bg-slate-950/30 border border-white/5 rounded-xl p-2 md:p-3 overflow-y-auto retro-scroll">

              {/* Referee Mascot */}
              <div className="flex items-start gap-3 bg-black/60 border border-white/10 p-3 rounded-xl relative shadow-[inset_0_0_10px_rgba(255,255,255,0.05)]">
                <div className={`w-12 h-12 rounded-lg bg-cyber-purple/20 border border-cyber-purple/40 flex items-center justify-center text-2xl shrink-0 overflow-hidden ${mascotAnimation}`}>
                  <img
                    src="/mascot.png"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                    alt="Mascot"
                    className="w-full h-full object-cover"
                  />
                  <span style={{ display: 'none' }}>🐹</span>
                </div>
                <div className="flex-1 font-mono text-[11px] leading-relaxed">
                  <span className="text-cyber-purple font-bold block mb-0.5">REFEREE MASCOT:</span>
                  <p className="text-slate-200">{getMascotComment()}</p>
                </div>
              </div>

              {/* ATK/SPD Comparative Gauges */}
              <div className="flex-1 flex flex-col justify-center gap-4 py-2">
                {/* ATK Gauge */}
                <div className="bg-black/40 border border-white/5 p-3 rounded-xl flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>PLAYER ATK: <b className="text-cyber-purple">{me.attack}</b></span>
                    <span className="font-bold text-white uppercase tracking-wider text-[9px]">ATTACK COMPARISON</span>
                    <span>OPPONENT ATK: <b className="text-red-400">{opponent.attack}</b></span>
                  </div>

                  <div className="flex h-5 w-full bg-slate-950 rounded-lg overflow-hidden border border-white/5 p-0.5 relative">
                    <div
                      style={{ width: `${(me.attack / (me.attack + opponent.attack || 1)) * 100}%` }}
                      className="h-full bg-gradient-to-r from-cyber-purple to-cyber-blue rounded-l shadow-[0_0_8px_rgba(157,78,221,0.5)] transition-all duration-500"
                    />
                    <div className="w-[2px] bg-white z-10 h-full absolute left-1/2 transform -translate-x-1/2" />
                    <div
                      style={{ width: `${(opponent.attack / (me.attack + opponent.attack || 1)) * 100}%` }}
                      className="h-full bg-gradient-to-r from-amber-500 to-red-500 rounded-r shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-500 ml-auto"
                    />
                  </div>
                </div>

                {/* SPD Gauge */}
                <div className="bg-black/40 border border-white/5 p-3 rounded-xl flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>PLAYER SPD: <b className="text-cyber-blue">{me.speed}</b></span>
                    <span className="font-bold text-white uppercase tracking-wider text-[9px]">SPEED COMPARISON</span>
                    <span>OPPONENT SPD: <b className="text-amber-400">{opponent.speed}</b></span>
                  </div>

                  <div className="flex h-5 w-full bg-slate-950 rounded-lg overflow-hidden border border-white/5 p-0.5 relative">
                    <div
                      style={{ width: `${(me.speed / (me.speed + opponent.speed || 1)) * 100}%` }}
                      className="h-full bg-gradient-to-r from-cyber-blue to-teal-400 rounded-l shadow-[0_0_8px_rgba(0,240,255,0.5)] transition-all duration-500"
                    />
                    <div className="w-[2px] bg-white z-10 h-full absolute left-1/2 transform -translate-x-1/2" />
                    <div
                      style={{ width: `${(opponent.speed / (me.speed + opponent.speed || 1)) * 100}%` }}
                      className="h-full bg-gradient-to-r from-amber-400 to-red-400 rounded-r shadow-[0_0_8px_rgba(245,158,11,0.5)] transition-all duration-500 ml-auto"
                    />
                  </div>
                </div>
              </div>

              {/* Chronos Hint System */}
              <div className="flex flex-col gap-2 bg-black/60 border border-cyber-blue/20 p-3 rounded-xl relative shadow-[inset_0_0_10px_rgba(0,240,255,0.05)]">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">⏳</span>
                    <span className="font-mono text-xs font-bold text-cyber-blue">CHRONOS STRATEGIST</span>
                  </div>
                  <button
                    disabled={hintLoading || profile.aether_dust < 15 || battleState.game_over}
                    onClick={requestHint}
                    className="px-2 py-1 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue text-[10px] hover:bg-cyber-blue/20 font-bold uppercase transition-all disabled:opacity-40"
                  >
                    {hintLoading ? 'Consulting...' : 'Ask Chronos (Cost: 15 Dust)'}
                  </button>
                </div>
                {hintText ? (
                  <p className="text-slate-200 font-mono text-[10px] leading-relaxed border-t border-white/5 pt-2 mt-1">
                    <span className="text-cyber-blue font-bold">TACTICAL ADVICE:</span> {hintText}
                  </p>
                ) : (
                  <p className="text-slate-500 font-mono text-[9px] italic border-t border-white/5 pt-2 mt-1">
                    Chronos is awaiting your query. Transmute Aether Dust for temporal insight.
                  </p>
                )}
              </div>
            </div>

            {/* COLUMN 3: Opponent Card Details */}
            <div
              className={`cyber-glass border border-white/10 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${oppAnimClass}`}
              style={oppAnimClass === 'animate-ability-glow' ? { '--glow-color': getElementGlowColor(opponent.element) } : {}}
            >
              <div className="flex justify-between items-center mb-2 text-xs text-red-400 font-mono uppercase tracking-wider">
                <span>{isSpectator ? "Fighter 2" : "Opponent"}</span>
                <span className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold">
                  {opponent.element.toUpperCase()} {getElementStyles(opponent.element).symbol}
                </span>
              </div>

              {/* Floating Popups Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
                {popups.filter(p => p.target === 'opp').map(p => (
                  <span
                    key={p.id}
                    className={`damage-popup absolute font-extrabold font-mono tracking-wider ${p.isHeavy ? 'damage-popup-critical text-5xl' : 'text-4xl'} ${
                      p.type === 'damage' ? getElementDamageColor(p.element) :
                      p.type === 'heal' ? 'text-green-400 drop-shadow-[0_0_12px_rgba(74,222,128,0.8)]' :
                      'text-cyber-blue drop-shadow-[0_0_12px_rgba(0,240,255,0.8)]'
                    }`}
                  >
                    {p.text}
                  </span>
                ))}
              </div>

              {/* Shield Active / Shatter Overlay */}
              {opponent.shield_active ? (
                <div className="absolute inset-0 border-2 border-red-500 rounded-xl pointer-events-none z-10" style={{ animation: 'pulse-neon 1.5s infinite' }} />
              ) : shieldShatter.opp && (
                <div className="absolute inset-0 border-2 border-red-500/50 rounded-xl pointer-events-none z-10 animate-shield-shatter" />
              )}

              {/* Card Art Image Frame */}
              <div className="w-full h-28 sm:h-36 md:h-44 rounded-lg bg-black/60 flex items-center justify-center overflow-hidden border border-white/5 relative mb-2 md:mb-3">
                {/* Damage/Heal overlay on card art */}
                {cardOverlay.opp && (
                  <div className={`absolute inset-0 z-20 pointer-events-none rounded-lg ${cardOverlay.opp === 'damage' ? 'animate-damage-overlay' : 'animate-heal-overlay'}`} />
                )}
                {resolveImageUrl(opponent) ? (
                  <img
                    src={resolveImageUrl(opponent)}
                    alt={opponent.card_name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <AlchemicalPlaceholder element={opponent.element} className="border-none bg-transparent" />
                )}
              </div>

              <h3 className="font-bold text-sm truncate mb-1 font-mono uppercase border-b border-white/5 pb-1 text-white" title={opponent.card_name}>
                {opponent.card_name}
              </h3>

              {/* Health Pool Bar */}
              <div className="mb-3">
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
                  <span>HEALTH POOL</span>
                  <span className="font-bold text-white">{opponent.current_health}/{opponent.max_health} HP</span>
                </div>
                <div className="w-full bg-slate-950/80 h-3 rounded-full overflow-hidden border border-white/5 p-[2px] relative">
                  <div
                    style={{ width: `${(opponent.current_health / opponent.max_health) * 100}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-500 transition-all duration-500 shadow-[0_0_8px_#ef4444]"
                  />
                  {healthFlash.opp && (
                    <div className="absolute inset-0 rounded-full animate-health-bar-flash z-10 pointer-events-none" />
                  )}
                </div>
              </div>

              {/* Fighter Stance Badge */}
              <div className="flex items-center justify-between bg-black/40 p-2 rounded-lg border border-white/5 font-mono text-xs">
                <span className="text-slate-400 text-[10px] uppercase font-bold">Active Stance:</span>
                <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${opponent.stance === 'aggressive' ? 'bg-cyber-pink/20 text-cyber-pink border border-cyber-pink/40 shadow-[0_0_8px_rgba(255,0,127,0.3)]' :
                    opponent.stance === 'defensive' ? 'bg-cyber-green/20 text-cyber-green border border-cyber-green/40 shadow-[0_0_8px_rgba(57,255,20,0.3)]' :
                      'bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/40 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                  }`}>
                  {opponent.stance || 'FOCUSED'}
                </span>
              </div>
            </div>

          </div>

          {/* Unified Action Buttons Row */}
          {!isSpectator ? (
            <div className="flex flex-col gap-1.5 shrink-0 sticky bottom-0 bg-[#08090d]/90 backdrop-blur-sm pt-1 pb-1 md:pb-0 md:static md:bg-transparent md:backdrop-blur-none rounded-t-xl md:rounded-none border-t border-white/5 md:border-0">

              {/* Stance Selector Panel */}
              <div className="bg-black/60 border border-white/10 rounded-xl p-2 md:p-3 flex flex-col gap-1.5 md:gap-2 font-mono">
                <div className="hidden md:flex justify-between items-center text-[10px] text-slate-400">
                  <span>TACTICAL STANCE SETTING:</span>
                  <span className="text-slate-500 font-bold uppercase">Influences Speed & Combat Power</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 md:gap-2">
                  {[
                    { id: 'focused', name: 'Focus', desc: 'CDR x2 | SPD x1.25', color: 'border-cyber-blue text-cyber-blue shadow-[0_0_10px_rgba(0,240,255,0.2)] bg-cyber-blue/10', inactive: 'border-white/5 hover:border-cyber-blue/30 text-slate-400' },
                    { id: 'aggressive', name: 'Aggro', desc: 'DMG x1.2 | SPD x0.9', color: 'border-cyber-pink text-cyber-pink shadow-[0_0_10px_rgba(255,0,127,0.2)] bg-cyber-pink/10', inactive: 'border-white/5 hover:border-cyber-pink/30 text-slate-400' },
                    { id: 'defensive', name: 'Guard', desc: '-15 dmg | DMG x0.8', color: 'border-cyber-green text-cyber-green shadow-[0_0_10px_rgba(57,255,20,0.2)] bg-cyber-green/10', inactive: 'border-white/5 hover:border-cyber-green/30 text-slate-400' }
                  ].map((st) => (
                    <button
                      key={st.id}
                      disabled={battleState.game_over || actionLocked}
                      onClick={() => { hapticLight(); setSelectedStance(st.id); }}
                      className={`py-2.5 md:py-2 px-1 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${selectedStance === st.id ? st.color : st.inactive
                        } ${selectedStance === st.id && stancePulse === st.id ? 'animate-stance-change' : ''}`}
                    >
                      <span className="text-[11px] font-bold uppercase">{st.name}</span>
                      <span className="text-[7px] text-slate-500 font-semibold hidden sm:block">{st.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions row */}
              <div className="grid grid-cols-2 gap-1.5 md:gap-2">
                <button
                  disabled={battleState.game_over || actionLocked}
                  onClick={() => { hapticMedium(); sendBattleAction('attack'); }}
                  className="py-3 md:py-2.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 font-bold font-mono text-xs uppercase border border-white/20 disabled:opacity-30 cursor-pointer text-center text-white min-h-[48px]"
                >
                  ⚔️ Strike Attack
                </button>
                <div className="flex flex-col">
                  <button
                    disabled={battleState.game_over || actionLocked || me.ability_cooldown > 0}
                    onClick={() => { hapticMedium(); sendBattleAction('ability'); }}
                    className={`py-3 md:py-2.5 rounded-lg font-bold font-mono text-xs uppercase border disabled:opacity-30 cursor-pointer text-center transition-all duration-300 min-h-[48px] active:scale-95 ${me.ability_cooldown > 0
                        ? 'bg-slate-900 border-white/5 text-slate-500'
                        : me.ability_cooldown === 0 && !battleState.game_over && !actionLocked
                          ? 'bg-gradient-to-r from-cyber-purple to-cyber-blue text-black border-cyber-purple shadow-[0_0_18px_rgba(157,78,221,0.6)] animate-pulse'
                          : 'bg-gradient-to-r from-cyber-purple to-cyber-blue text-black border-cyber-purple'
                      }`}
                  >
                    {actionLocked ? 'Locked' : `✨ Ability ${me.ability_cooldown > 0 ? `(${me.ability_cooldown})` : ''}`}
                  </button>
                  <div className="text-[9px] text-slate-400 text-center font-mono mt-1 leading-relaxed border-t border-white/5 pt-1">
                    EFFECT: <span className="text-cyber-blue font-bold uppercase">{me.effect_type || 'NONE'}</span> | POWER: <span className="font-bold text-cyber-green">{me.value || 0}</span> | COOLDOWN: <span className="font-bold text-cyber-purple">{me.ability_cooldown > 0 ? me.ability_cooldown : 'READY'}</span>
                  </div>
                </div>
              </div>

              {/* Managed Agent Play Button */}
              <button
                disabled={battleState.game_over || actionLocked}
                onClick={async () => {
                  setActionLocked(true);
                  try {
                    const res = await fetch(`${API_BASE}/api/battle/agent_play`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ client_id: clientId, lobby_id: lobbyId })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setSelectedStance(data.stance);
                    } else {
                      const errData = await res.json();
                      toast({ type: 'error', title: 'Agent Failed', message: errData.detail || 'Managed Agent failed to deploy.' });
                      setActionLocked(false);
                    }
                  } catch (e) {
                    console.error("Managed Agent deployment error:", e);
                    toast({ type: 'error', title: 'Agent Error', message: 'Failed to communicate with Managed Agent server.' });
                    setActionLocked(false);
                  }
                }}
                className="py-2.5 rounded-lg bg-cyber-pink/20 hover:bg-cyber-pink/30 text-cyber-pink font-bold font-mono text-xs uppercase border border-cyber-pink/40 disabled:opacity-30 cursor-pointer text-center mt-2 flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(255,0,127,0.15)] hover:shadow-[0_0_15px_rgba(255,0,127,0.3)] transition-all"
              >
                🤖 Deploy Managed Agent (AI Play)
              </button>
            </div>
          ) : (
            <div className="bg-cyber-blue/15 border border-cyber-blue/30 rounded-lg py-2 text-center text-[10px] font-mono text-cyber-blue uppercase tracking-wider animate-pulse">
              🔮 SPECTATOR ACCESS ACTIVE
            </div>
          )}

          {/* Battle End Modal Overlay */}
          {battleState.game_over && (
            <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
              <div className="max-w-md w-full cyber-glass border border-white/20 p-6 rounded-2xl text-center shadow-2xl relative overflow-hidden">
                {isSpectator ? (
                  <>
                    <div className="text-5xl mb-3">🏆</div>
                    <h2 className="text-2xl font-extrabold tracking-wider text-cyber-blue font-mono uppercase mb-1 animate-pulse">
                      MATCH RESOLVED!
                    </h2>
                    <p className="text-slate-300 font-sans text-xs mb-4 leading-relaxed">
                      The arena combat session has terminated. Review the combat debrief diagnostics below.
                    </p>
                  </>
                ) : (battleState.winner === 'Player 1' && battleState.player1_id === clientId) || (battleState.winner === 'Player 2' && battleState.player2_id === clientId) || (battleState.winner === `Player ${playerNum}`) ? (
                  <>
                    {/* Victory Confetti */}
                    {confetti && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        {Array.from({ length: 30 }).map((_, i) => (
                          <div
                            key={i}
                            className="absolute top-0 w-2 h-3 rounded-sm animate-confetti"
                            style={{
                              left: `${((i * 37 + 13) % 100)}%`,
                              backgroundColor: ['#ff007f', '#00f0ff', '#39ff14', '#fffb00', '#9d4edd'][i % 5],
                              '--confetti-duration': `${2 + ((i * 17) % 30) / 10}s`,
                              '--confetti-delay': `${((i * 23) % 20) / 10}s`,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <div className="text-5xl mb-3">🏆</div>
                    <h2 className="text-2xl font-extrabold tracking-wider text-cyber-blue font-mono uppercase mb-1 animate-pulse">
                      ALCHEMICAL VICTORY!
                    </h2>
                    <p className="text-slate-300 font-sans text-xs mb-4 leading-relaxed">
                      Your card fended off the challenger using alchemical elemental calculations.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Defeat Particles */}
                    {defeatParticles && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        {Array.from({ length: 20 }).map((_, i) => (
                          <div
                            key={i}
                            className="absolute top-0 w-1.5 h-1.5 rounded-full animate-defeat-particle"
                            style={{
                              left: `${((i * 41 + 19) % 100)}%`,
                              backgroundColor: ['#ef4444', '#6b7280', '#991b1b', '#374151'][i % 4],
                              '--particle-duration': `${3 + ((i * 13) % 40) / 10}s`,
                              '--particle-delay': `${((i * 29) % 20) / 10}s`,
                              '--drift': `${((i * 31 - 15) % 60)}px`,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <div className="text-5xl mb-3">💀</div>
                    <h2 className="text-2xl font-extrabold tracking-wider text-red-500 font-mono uppercase mb-1 animate-pulse">
                      SUMMON DEFEATED
                    </h2>
                    <p className="text-slate-300 font-sans text-xs mb-4 leading-relaxed">
                      Your card fainted in combat. Forge new cards or adapt your alchemical strategy!
                    </p>
                  </>
                )}

                {/* Alchemical Diagnostic Logs */}
                {battleState.post_match_summary && (
                  <div className="mt-2 mb-4 bg-black/85 p-3 rounded-xl border border-cyber-purple/35 text-left font-mono text-[9px] max-h-36 overflow-y-auto whitespace-pre-line leading-relaxed retro-scroll">
                    {battleState.post_match_summary.split('\n').map((line, i) => {
                      let lineColor = 'text-[#39ff14]';
                      if (line.startsWith('🏆')) lineColor = 'text-cyber-yellow font-bold';
                      else if (line.startsWith('===')) lineColor = 'text-cyber-blue';
                      else if (line.startsWith(' •')) lineColor = 'text-slate-300';
                      return <div key={i} className={lineColor}>{line}</div>;
                    })}
                  </div>
                )}

                <button
                  onClick={() => {
                    if (roomState && roomState.is_pvp) {
                      setIsSpectatingActive(false);
                      setActiveView('lobby');
                    } else {
                      quitBattle();
                    }
                  }}
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyber-purple to-cyber-blue text-black font-bold font-mono text-xs uppercase hover:brightness-110 transition-all cursor-pointer"
                >
                  {roomState && roomState.is_pvp ? 'Return to Lobby' : 'Return to Vault'}
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* VIEW 4: ROOM LOBBY DASHBOARD */}
      {activeView === 'lobby' && !roomState && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 font-mono">
          <div className="w-12 h-12 rounded-full border-2 border-t-transparent border-cyber-blue animate-spin mb-4" />
          <p className="text-sm text-slate-300 uppercase tracking-widest animate-pulse">
            Synchronizing Alchemical Matrix...
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Connecting to room socket {lobbyId}
          </p>
          <button
            onClick={quitBattle}
            className="mt-6 px-4 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-all cursor-pointer"
          >
            Cancel Connection
          </button>
        </div>
      )}

      {activeView === 'lobby' && roomState && (
        <div className="flex-1 flex flex-col gap-6">
          <div className="cyber-glass rounded-xl p-4 border border-white/10 flex flex-col md:flex-row justify-between items-center bg-black/40 gap-4">
            <div>
              <h2 className="text-xl font-bold font-mono text-cyber-blue uppercase tracking-wider">
                Alchemical Room Lobby
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-1">
                LOBBY CODE: <span className="text-cyber-green font-bold tracking-widest">{lobbyId}</span>
              </p>
            </div>

            <div className="flex gap-3">
              {clientId === roomState.owner_id && (
                <button
                  onClick={() => {
                    const activeParticipants = roomState.members.filter(m => m.card_name !== 'Unregistered');
                    if (activeParticipants.length < 2) {
                      toast({ type: 'warn', title: 'Not Enough Players', message: 'Tournament requires at least 2 players with registered champion cards.' });
                      return;
                    }
                    if (socket && socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify({
                        action: "start_tournament"
                      }));
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-cyber-green text-black font-mono font-bold text-xs uppercase hover:brightness-110 transition-all shadow-[0_0_10px_rgba(57,255,20,0.3)] cursor-pointer"
                >
                  🏆 START TOURNAMENT
                </button>
              )}
              <button
                onClick={quitBattle}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-all cursor-pointer"
              >
                LEAVE ROOM
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch flex-1">
            {/* Members / Challengers List */}
            <div className="lg:col-span-2 cyber-glass border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider mb-4 pb-2 border-b border-white/5 flex items-center justify-between">
                  <span>Connected Alchemists</span>
                  <span className="text-xs text-slate-500 normal-case font-normal">{roomState.members.length} active</span>
                </h3>

                <div className="space-y-4">
                  {roomState.members.map((member) => {
                    const isSelf = member.client_id === clientId;
                    const myInfo = roomState.members.find(m => m.client_id === clientId);
                    const myCardSelected = myInfo && myInfo.card_name !== 'Unregistered';
                    const isCurrentSpectating = myInfo?.status === 'spectating';
                    const targetHasCard = member.card_name !== 'Unregistered';
                    const canChallenge = !isSelf && member.status === 'spectating' && isCurrentSpectating && targetHasCard && myCardSelected;

                    return (
                      <div
                        key={member.client_id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-950/60 p-4 rounded-xl border border-white/5 gap-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">🔮</span>
                          <div>
                            <p className="font-mono text-sm font-bold uppercase text-slate-200 flex items-center gap-1.5">
                              {roomState.owner_id === member.client_id && <span title="Room Owner" className="text-yellow-400">👑</span>}
                              {member.card_name === 'Unregistered' ? 'No Champion Selected' : member.card_name} {isSelf && <span className="text-xs text-cyber-purple font-normal lowercase">(you)</span>}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono tracking-wider">
                              ID: {member.client_id}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 justify-end">
                          <span className={`px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border ${member.status === 'fighting'
                              ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse'
                              : member.status === 'challenging'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : member.status === 'challenged'
                                  ? 'bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20'
                                  : 'bg-green-500/10 text-green-400 border-green-500/20'
                            }`}>
                            {member.status}
                          </span>

                          {isSelf && (
                            <button
                              onClick={() => setShowRoomCardSelectorModal(true)}
                              className="px-3 py-1.5 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue hover:bg-cyber-blue/20 font-mono text-[10px] font-bold uppercase transition-all cursor-pointer"
                            >
                              {member.card_name === 'Unregistered' ? 'Choose Champion' : 'Change Card'}
                            </button>
                          )}

                          {canChallenge && (
                            <button
                              onClick={() => {
                                if (socket && socket.readyState === WebSocket.OPEN) {
                                  socket.send(JSON.stringify({
                                    action: "challenge",
                                    target_id: member.client_id
                                  }));
                                }
                              }}
                              className="px-4 py-1.5 rounded bg-cyber-purple text-black font-mono font-bold text-xs uppercase hover:brightness-110 transition-all cursor-pointer"
                            >
                              CHALLENGE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 text-xs text-slate-500 font-mono leading-relaxed bg-black/30 p-3 rounded-lg border border-white/5">
                💡 <b>How PvP Works:</b> Challenge any <i>spectating</i> player. Once they accept, you will both enter the combat arena. Other players can watch the match.
              </div>
            </div>

            {/* Arena Matches / Spectating Box */}
            <div className="cyber-glass border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider mb-4 pb-2 border-b border-white/5">
                  Live Arena Spectating
                </h3>

                {roomState.active_match ? (
                  <div className="bg-slate-950/60 p-4 rounded-xl border border-white/5 text-center">
                    <span className="text-3xl mb-2 block animate-bounce">⚔️</span>
                    <h4 className="font-mono text-sm font-bold text-red-400 uppercase mb-1">
                      Active Arena Battle!
                    </h4>
                    <p className="text-xs text-slate-300 font-mono mb-4 leading-relaxed">
                      {roomState.active_match.player1.card_name} <span className="text-slate-500">vs</span> {roomState.active_match.player2.card_name}
                    </p>

                    <button
                      onClick={() => {
                        setIsSpectatingActive(true);
                        setActiveView('battle');
                      }}
                      className="w-full py-2.5 rounded bg-cyber-blue text-black font-mono font-bold text-xs uppercase hover:brightness-110 transition-all cursor-pointer"
                    >
                      SPECTATE MATCH
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500 font-mono text-xs">
                    <span className="text-4xl block mb-3 opacity-30">🧘</span>
                    No active match in progress.<br />
                    Lobby is peaceful.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Incoming Challenge Popup Modal */}
          {incomingChallenge && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="max-w-md w-full cyber-glass border border-white/20 p-6 rounded-2xl text-center shadow-2xl relative">
                <span className="text-4xl mb-3 block animate-bounce">⚡</span>
                <h3 className="text-lg font-bold font-mono text-cyber-blue uppercase tracking-wider mb-1">
                  CHALLENGE RECEIVED!
                </h3>
                <p className="text-xs text-slate-400 font-mono mb-4">
                  Incoming match request inside room lobby
                </p>

                <p className="text-sm font-semibold text-slate-200 mb-6 font-mono bg-slate-950 p-3 rounded-lg border border-white/5">
                  {incomingChallenge.fromName} challenges you to duel!
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                          action: "accept_challenge",
                          from_id: incomingChallenge.fromId
                        }));
                        setIncomingChallenge(null);
                      }
                    }}
                    className="py-2.5 rounded bg-cyber-green text-black font-mono font-bold text-xs uppercase hover:brightness-110 transition-all cursor-pointer"
                  >
                    ACCEPT
                  </button>
                  <button
                    onClick={() => {
                      if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                          action: "decline_challenge"
                        }));
                        setIncomingChallenge(null);
                      }
                    }}
                    className="py-2.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-mono font-bold text-xs uppercase hover:bg-red-500/30 transition-all cursor-pointer"
                  >
                    DECLINE
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 4.2: PVP ROOMS SELECTION */}
      {activeView === 'lobby_select' && (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full cyber-glass border border-white/10 p-8 rounded-2xl shadow-2xl relative">
            <h2 className="text-xl font-bold font-mono uppercase tracking-wider mb-6 text-center text-cyber-blue">
              🔮 PvP Arenas & Lobbies
            </h2>
            <p className="text-xs text-slate-400 font-mono text-center mb-8 leading-relaxed">
              Create a custom alchemical battlefield, invite friends using a room code, or auto-run tournaments.
            </p>

            <div className="space-y-6">
              <button
                onClick={() => {
                  const code = generateRoomCode();
                  setIsPvp(true);
                  setLobbyId(code);
                  connectRoomWebSocket(code, null);
                  setActiveView('lobby');
                }}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-cyber-purple to-cyber-blue hover:brightness-110 active:scale-98 font-bold font-mono text-sm uppercase tracking-wider text-black transition-all cursor-pointer shadow-[0_0_15px_rgba(0,240,255,0.3)] text-center"
              >
                Host New PvP Lobby
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-white/5"></div>
                <span className="flex-shrink mx-4 text-slate-500 text-[10px] font-mono uppercase">OR</span>
                <div className="flex-grow border-t border-white/5"></div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-slate-400 font-mono uppercase">Enter Lobby Room Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="LOBBY CODE (e.g. ROOM-ABCD)"
                    value={joinRoomCode}
                    onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                    className="flex-1 bg-slate-950 border border-white/15 rounded-lg px-4 py-3 text-center font-mono tracking-wider font-semibold placeholder:text-slate-700 focus:outline-none focus:border-cyber-blue text-sm"
                  />
                  <button
                    onClick={() => {
                      if (!joinRoomCode.trim()) {
                        toast({ type: 'warn', title: 'Missing Code', message: 'Please enter a Room Code to join.' });
                        return;
                      }
                      const code = joinRoomCode.trim().toUpperCase();
                      setIsPvp(true);
                      setLobbyId(code);
                      connectRoomWebSocket(code, null);
                      setActiveView('lobby');
                    }}
                    className="px-6 rounded-lg bg-cyber-blue hover:brightness-110 active:scale-95 text-black font-mono font-bold text-xs uppercase transition-all cursor-pointer"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4.5: TOURNAMENT ARENA */}
      {activeView === 'tournament' && roomState && roomState.tournament_matches && (
        <div className="flex-1 flex flex-col gap-4 font-mono select-none overflow-hidden h-dvh max-h-dvh p-2">
          {/* Header */}
          <div className="flex justify-between items-center bg-black/60 border border-white/10 px-4 py-2 rounded-xl text-xs shrink-0">
            <div>
              <span className="text-slate-400">TOURNAMENT ROOM:</span> <b className="text-cyber-blue mr-3">{lobbyId}</b>
              <span className="text-slate-400">STATUS:</span> <b className="text-cyber-green uppercase">{tournamentMatchIndex < roomState.tournament_matches.length ? 'Matches In Progress' : 'Completed'}</b>
            </div>
            {tournamentMatchIndex < roomState.tournament_matches.length && (
              <button
                onClick={skipSimulation}
                className="px-3 py-1 rounded bg-cyber-pink/20 border border-cyber-pink/40 text-cyber-pink text-[10px] hover:bg-cyber-pink/30 font-bold uppercase transition-all cursor-pointer"
              >
                ⏩ Skip Simulation
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch flex-1 min-h-0">
            {/* Leaderboard Column */}
            <div className="cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40 flex flex-col min-h-0">
              <h3 className="text-sm font-bold text-cyber-blue uppercase tracking-wider mb-4 pb-2 border-b border-white/5 shrink-0 flex items-center justify-between">
                <span>🏆 Room Leaderboard</span>
                <span className="text-[10px] text-slate-500 normal-case font-normal">Round Robin</span>
              </h3>
              <div className="overflow-y-auto flex-1 retro-scroll pr-1">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5 uppercase text-[9px] tracking-wider">
                      <th className="py-2 pl-2">Rank</th>
                      <th className="py-2">Card</th>
                      <th className="py-2 text-center">W/L/D</th>
                      <th className="py-2 text-right pr-2">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getLocalLeaderboard().map((player, idx) => {
                      const isWinner = tournamentMatchIndex >= roomState.tournament_matches.length && idx === 0;
                      return (
                        <tr key={idx} className={`border-b border-white/5 hover:bg-white/5 transition-all ${isWinner ? 'bg-cyber-green/5 border-cyber-green/30' : ''}`}>
                          <td className="py-3 pl-2 font-bold text-cyber-purple flex items-center gap-1">
                            {isWinner && <span>👑</span>}
                            {idx + 1}
                          </td>
                          <td className="py-3 font-semibold text-slate-100 truncate max-w-[120px]">{player.card_name}</td>
                          <td className="py-3 text-center text-slate-400">{player.wins}/{player.losses}/{player.draws}</td>
                          <td className={`py-3 text-right pr-2 font-bold ${isWinner ? 'text-cyber-green' : 'text-cyber-blue'}`}>{player.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Active Simulation Arena / Winner Column */}
            <div className="lg:col-span-2 cyber-glass border border-white/10 rounded-2xl p-5 bg-black/40 flex flex-col justify-between min-h-0 relative">
              {tournamentMatchIndex < roomState.tournament_matches.length ? (
                // ACTIVE FIGHT SIMULATION
                <div className="flex-1 flex flex-col justify-between min-h-0 gap-4">
                  {/* Duel Visuals */}
                  <div className="flex flex-col items-center justify-center py-2 shrink-0">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest block mb-2">
                      Simulating Match {tournamentMatchIndex + 1} of {roomState.tournament_matches.length}
                    </span>
                    <div className="flex items-center gap-6 md:gap-12 justify-center w-full">
                      {/* Player 1 */}
                      <div className="flex flex-col items-center text-center w-28 md:w-36">
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-950 border border-white/10 flex items-center justify-center overflow-hidden mb-2">
                          {roomState.tournament_matches[tournamentMatchIndex].player1_image ? (
                            <img
                              src={roomState.tournament_matches[tournamentMatchIndex].player1_image}
                              alt={roomState.tournament_matches[tournamentMatchIndex].player1_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xl">🔮</span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-white truncate w-full">
                          {roomState.tournament_matches[tournamentMatchIndex].player1_name}
                        </span>
                      </div>

                      {/* VS Divider */}
                      <div className="flex flex-col items-center justify-center shrink-0">
                        <div className="relative flex items-center justify-center">
                          <div className="absolute w-10 h-10 md:w-12 md:h-12 rounded-full border border-cyber-pink/20 animate-vs-pulse" />
                          <div className="w-10 h-10 md:w-12 md:h-12 rounded-full border border-cyber-pink/55 flex items-center justify-center font-bold text-cyber-pink text-xs md:text-sm shadow-[0_0_15px_rgba(255,0,127,0.3)] z-10">
                            VS
                          </div>
                        </div>
                      </div>

                      {/* Player 2 */}
                      <div className="flex flex-col items-center text-center w-28 md:w-36">
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-950 border border-white/10 flex items-center justify-center overflow-hidden mb-2">
                          {roomState.tournament_matches[tournamentMatchIndex].player2_image ? (
                            <img
                              src={roomState.tournament_matches[tournamentMatchIndex].player2_image}
                              alt={roomState.tournament_matches[tournamentMatchIndex].player2_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xl">🔮</span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-white truncate w-full">
                          {roomState.tournament_matches[tournamentMatchIndex].player2_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Scrolling Combat Terminal Logs */}
                  <div className="flex-1 min-h-0 bg-slate-950 border border-cyber-purple/30 rounded-xl p-4 font-mono text-[10px] text-[#39ff14] overflow-y-auto flex flex-col gap-1.5 retro-scroll select-text leading-relaxed">
                    {tournamentMatchLogs.map((log, lIdx) => (
                      <div key={lIdx} className="border-l border-[#39ff14]/20 pl-2">
                        {log}
                      </div>
                    ))}
                    {/* Dummy div to scroll to */}
                    <div ref={(el) => { if (el) el.scrollIntoView({ behavior: 'smooth' }); }} />
                  </div>
                </div>
              ) : (
                // TOURNAMENT RESOLVED / CROWN CHAMPION
                <div className="flex-1 flex flex-col justify-between items-center text-center py-6 min-h-0 gap-6">
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="text-6xl md:text-7xl mb-4 animate-bounce-slow" style={{ filter: 'drop-shadow(0 0 30px rgba(255,251,0,0.6)) drop-shadow(0 0 60px rgba(255,251,0,0.3))' }}>🏆</div>
                    
                    <h2 className="text-2xl md:text-3xl font-extrabold tracking-widest text-cyber-yellow font-mono uppercase mb-1 animate-pulse">
                      CHAMPION CROWNED!
                    </h2>
                    
                    <p className="text-slate-300 font-sans text-xs max-w-sm mb-6 leading-relaxed">
                      The round-robin battles have concluded. All matches simulated successfully.
                    </p>

                    <div className="bg-slate-950/80 p-5 rounded-2xl border border-cyber-green/40 shadow-[0_0_20px_rgba(57,255,20,0.15)] max-w-sm w-full font-mono text-center">
                      <span className="text-[10px] text-cyber-green block mb-1 tracking-widest font-extrabold uppercase">
                        👑 TOURNAMENT WINNER 👑
                      </span>
                      <span className="text-lg md:text-xl font-black text-white uppercase block">
                        {getLocalLeaderboard()[0]?.card_name}
                      </span>
                      <span className="text-[10px] text-slate-500 font-sans italic block mt-1">
                        Creator ID: {roomState.tournament_winner_id}
                      </span>
                    </div>

                    {/* Reward Notification for the local player */}
                    {roomState.tournament_winner_id === clientId && (
                      <div className="mt-4 bg-cyber-green/10 border border-cyber-green/30 px-6 py-3 rounded-xl max-w-sm w-full font-mono text-center shadow-[0_0_15px_rgba(57,255,20,0.1)]">
                        <span className="text-cyber-green font-bold text-xs uppercase block animate-pulse">
                          🎉 YOU WON THE TOURNAMENT! 🎉
                        </span>
                        <span className="text-white text-[10px] uppercase mt-1 block">
                          Claimed: <b className="text-cyber-yellow">+150 Aether Dust</b> & <b className="text-cyber-blue">+2 Catalysts</b>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-sm shrink-0">
                    {clientId === roomState.owner_id ? (
                      <button
                        onClick={() => {
                          if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                              action: "reset_tournament"
                            }));
                          }
                        }}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-cyber-purple to-cyber-blue text-black font-bold font-mono text-xs uppercase hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-[0_0_15px_rgba(157,78,221,0.3)] text-center"
                      >
                        Reset Lobby & Return
                      </button>
                    ) : (
                      <div className="text-xs text-slate-500 italic bg-black/30 py-3 px-4 rounded-xl border border-white/5 w-full">
                        Awaiting host to reset the lobby...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ROOM CARD SELECTOR MODAL */}
      {showRoomCardSelectorModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
          <div className="max-w-2xl w-full cyber-glass border border-white/20 p-6 rounded-2xl shadow-2xl relative flex flex-col max-h-[85vh]">
            <button
              onClick={() => setShowRoomCardSelectorModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-mono text-xs uppercase cursor-pointer"
            >
              [Close X]
            </button>

            <h3 className="text-lg font-bold font-mono uppercase tracking-wider mb-2 text-cyber-blue border-b border-white/5 pb-2">
              Select Your Alchemical Champion
            </h3>
            <p className="text-xs text-slate-400 font-mono mb-4">
              Select a card from your inventory to represent you in the multiplayer lobby and tournaments.
            </p>

            <div className="flex-1 overflow-y-auto retro-scroll pr-2 mb-4">
              {cards.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-mono italic text-xs">
                  Your vault is empty! Go forge some cards from real world objects first.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {cards.map((myCard, idx) => (
                    <div
                      key={idx}
                      className="bg-black/60 border border-white/10 rounded-xl p-3 flex justify-between items-center hover:border-cyber-blue/40 hover:bg-cyber-blue/5 transition-all group font-mono"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getElementStyles(myCard.element).symbol}</span>
                        <div className="text-left">
                          <p className="font-bold text-xs uppercase text-slate-200">{myCard.card_name}</p>
                          <p className="text-[9px] text-slate-400">
                            ATK: <b className="text-cyber-pink">{myCard.base_stats.attack}</b> |
                            SPD: <b className="text-cyber-blue">{myCard.base_stats.speed}</b> |
                            HP: <b className="text-cyber-purple">{myCard.base_stats.health}</b>
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                              action: "register",
                              card: myCard
                            }));
                          }
                          setSelectedCard(myCard);
                          setShowRoomCardSelectorModal(false);
                        }}
                        className="px-3 py-1.5 rounded bg-cyber-blue text-black font-bold text-[10px] uppercase hover:brightness-110 cursor-pointer animate-pulse"
                      >
                        Summon
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MULTIPLAYER / MATCHMAKING MODAL */}
      {showMatchmakingModal && selectedCard && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-40 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full cyber-glass border border-white/10 p-6 rounded-2xl shadow-2xl relative">

            <h3 className="text-lg font-bold font-mono uppercase tracking-wider mb-4 border-b border-white/10 pb-2 text-cyber-blue">
              Summon Arena Setup
            </h3>

            {pvpWaiting ? (
              // HOSTING / WAITING PROTOCOL
              <div className="text-center py-6 font-mono">
                <div className="w-12 h-12 rounded-full border-2 border-cyber-purple border-t-transparent animate-spin mx-auto mb-4" />
                <h4 className="font-bold text-slate-200 mb-2 uppercase">Awaiting Challenger</h4>
                <p className="text-slate-400 text-xs mb-6">
                  Share this lobby room code with your friend:
                </p>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/10 font-bold text-2xl tracking-widest text-cyber-blue mb-6">
                  {lobbyId}
                </div>
                <button
                  onClick={quitBattle}
                  className="px-6 py-2 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-xs uppercase"
                >
                  Cancel Host
                </button>
              </div>
            ) : (
              // MULTIPLAYER MODE SELECT
              <div className="space-y-6">
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block mb-2 uppercase">Selected Fighter</span>
                  <div className="flex items-center gap-4 bg-slate-950/60 p-3 rounded-lg border border-white/5">
                    <span className="text-2xl">{getElementStyles(selectedCard.element).symbol}</span>
                    <div className="font-mono text-xs">
                      <p className="font-bold uppercase text-slate-100">{selectedCard.card_name}</p>
                      <p className="text-slate-400 font-sans italic truncate max-w-[250px]">{selectedCard.lore}</p>
                    </div>
                  </div>
                </div>

                {/* Mode Select Buttons */}
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={startSoloBattle}
                    className="py-4 rounded-xl cyber-glass border border-white/10 hover:border-cyber-green/40 hover:bg-cyber-green/5 text-center flex flex-col items-center gap-2 cursor-pointer transition-all"
                  >
                    <span className="text-2xl">🏰</span>
                    <span className="font-mono text-[10px] font-bold uppercase text-slate-200">Campaign (Stage {profile?.unlocked_campaign_stage || 1})</span>
                  </button>
                  <button
                    onClick={startRandomPvEBattle}
                    className="py-4 rounded-xl cyber-glass border border-white/10 hover:border-cyber-yellow/40 hover:bg-cyber-yellow/5 text-center flex flex-col items-center gap-2 cursor-pointer transition-all"
                  >
                    <span className="text-2xl">👹</span>
                    <span className="font-mono text-[10px] font-bold uppercase text-slate-200">Random PvE Duel</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <button
                    onClick={hostPvpBattle}
                    className="py-3 rounded-xl cyber-glass border border-white/10 hover:border-cyber-purple/40 hover:bg-cyber-purple/5 text-center flex flex-col items-center gap-1 cursor-pointer transition-all"
                  >
                    <span className="text-xl">🌐</span>
                    <span className="font-mono text-[10px] font-bold uppercase text-slate-200">Host PvP Arena</span>
                  </button>
                  <button
                    onClick={() => {
                      setChallengerTargetOpponent(selectedCard);
                      setShowMatchmakingModal(false);
                      setShowFighterSelectorModal(true);
                    }}
                    className="py-3 rounded-xl cyber-glass border border-white/10 hover:border-cyber-pink/40 hover:bg-cyber-pink/5 text-center flex flex-col items-center gap-1 cursor-pointer transition-all"
                  >
                    <span className="text-xl">⚔️</span>
                    <span className="font-mono text-[10px] font-bold uppercase text-slate-200">Duel Vault Card</span>
                  </button>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <span className="text-[10px] text-slate-400 font-mono block mb-2 uppercase">Join Friend's Lobby</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="ENTER ROOM CODE"
                      value={joinRoomCode}
                      onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                      className="flex-1 bg-slate-950 border border-white/15 rounded-lg px-4 py-2 text-center font-mono tracking-wider font-semibold placeholder:text-slate-600 focus:outline-none focus:border-cyber-blue"
                    />
                    <button
                      onClick={joinPvpBattle}
                      className="px-6 py-2 rounded-lg bg-cyber-blue text-black font-mono font-bold text-xs uppercase hover:brightness-110 cursor-pointer"
                    >
                      JOIN
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setShowMatchmakingModal(false)}
                  className="w-full py-2 border border-white/5 hover:bg-white/5 rounded-lg font-mono text-[10px] uppercase text-slate-400"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showFighterSelectorModal && challengerTargetOpponent && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
          <div className="max-w-2xl w-full cyber-glass border border-white/20 p-6 rounded-2xl shadow-2xl relative flex flex-col max-h-[85vh]">
            <button
              onClick={() => {
                setShowFighterSelectorModal(false);
                setChallengerTargetOpponent(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-mono text-xs uppercase"
            >
              [Cancel X]
            </button>

            <h3 className="text-lg font-bold font-mono uppercase tracking-wider mb-2 text-cyber-purple border-b border-white/5 pb-2">
              Select Your Arena Fighter
            </h3>

            <p className="text-[11px] text-slate-400 font-mono mb-4">
              CHALLENGING OPPONENT: <span className="text-cyber-pink font-bold">{challengerTargetOpponent.card_name}</span> ({challengerTargetOpponent.element.toUpperCase()})
            </p>

            <div className="flex-1 overflow-y-auto retro-scroll pr-2 mb-4">
              {cards.filter(c => c.card_name !== challengerTargetOpponent.card_name || (c.image_url && c.image_url !== challengerTargetOpponent.image_url)).length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-mono italic text-xs">
                  No other cards available to select as a fighter! Transmute more cards.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {cards
                    .filter(c => c.card_name !== challengerTargetOpponent.card_name || (c.image_url && c.image_url !== challengerTargetOpponent.image_url))
                    .map((myCard, idx) => (
                      <div
                        key={idx}
                        className="bg-black/60 border border-white/10 rounded-xl p-3 flex justify-between items-center hover:border-cyber-purple/40 hover:bg-cyber-purple/5 transition-all group font-mono"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{getElementStyles(myCard.element).symbol}</span>
                          <div className="text-left">
                            <p className="font-bold text-xs uppercase text-slate-200">{myCard.card_name}</p>
                            <p className="text-[9px] text-slate-400">
                              ATK: <b className="text-cyber-pink">{myCard.base_stats.attack}</b> |
                              SPD: <b className="text-cyber-blue">{myCard.base_stats.speed}</b> |
                              HP: <b className="text-cyber-purple">{myCard.base_stats.health}</b>
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setShowFighterSelectorModal(false);
                            startCustomPvEDuel(myCard, challengerTargetOpponent);
                            setChallengerTargetOpponent(null);
                          }}
                          className="px-3 py-1.5 rounded bg-cyber-purple text-black font-bold text-[10px] uppercase hover:brightness-110 cursor-pointer"
                        >
                          Select
                        </button>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONNECTION SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full cyber-glass border border-white/10 p-6 rounded-2xl shadow-2xl relative">
            <h3 className="text-lg font-bold font-mono uppercase tracking-wider mb-4 border-b border-white/10 pb-2 text-cyber-purple">
              ⚔️ Alchemical Grid Sync ⚔️
            </h3>

            <p className="text-slate-400 text-xs font-mono mb-4 leading-relaxed">
              Configure the network IP address of your developer host PC so this mobile app can connect to the alchemy forge backend.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-slate-400 font-mono block mb-1 uppercase">Dev Host IP Address</label>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.15"
                  value={backendIpInput}
                  onChange={(e) => setBackendIpInput(e.target.value)}
                  className="w-full bg-slate-950 border border-white/15 rounded-lg px-4 py-2 text-center font-mono tracking-wider font-semibold placeholder:text-slate-600 focus:outline-none focus:border-cyber-purple"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    const cleanIp = backendIpInput.trim();
                    if (cleanIp) {
                      localStorage.setItem('pocket_alchemy_backend_ip', cleanIp);
                      window.location.reload();
                    } else {
                      localStorage.removeItem('pocket_alchemy_backend_ip');
                      window.location.reload();
                    }
                  }}
                  className="flex-1 py-2.5 rounded-lg bg-cyber-purple text-black font-mono font-bold text-xs uppercase hover:brightness-110 cursor-pointer"
                >
                  Sync Matrix
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem('pocket_alchemy_backend_ip');
                    window.location.reload();
                  }}
                  className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-mono text-xs uppercase hover:bg-white/10 cursor-pointer"
                >
                  Reset
                </button>
              </div>

              <button
                onClick={() => setShowSettingsModal(false)}
                className="w-full py-2 border border-white/5 hover:bg-white/5 rounded-lg font-mono text-[10px] uppercase text-slate-400 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUBCOMPONENT: NEON ALCHEMICAL PLACEHOLDER ---

function AlchemicalPlaceholder({ element, className = "" }) {
  const getRuneSvg = (el) => {
    const normEl = el ? el.toLowerCase() : 'neutral';
    switch (normEl) {
      case 'fire':
        return (
          <svg className="w-14 h-14 text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.8)] animate-pulse" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4">
            <polygon points="50,15 85,75 15,75" />
            <circle cx="50" cy="52" r="8" fill="currentColor" />
          </svg>
        );
      case 'water':
        return (
          <svg className="w-14 h-14 text-blue-500 drop-shadow-[0_0_12px_rgba(59,130,246,0.8)] animate-pulse" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4">
            <polygon points="50,85 85,25 15,25" />
            <circle cx="50" cy="48" r="8" fill="currentColor" />
          </svg>
        );
      case 'earth':
        return (
          <svg className="w-14 h-14 text-green-500 drop-shadow-[0_0_12px_rgba(34,197,94,0.8)] animate-pulse" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4">
            <polygon points="50,85 85,25 15,25" />
            <line x1="28" y1="58" x2="72" y2="58" />
            <circle cx="50" cy="42" r="6" fill="currentColor" />
          </svg>
        );
      case 'lightning':
        return (
          <svg className="w-14 h-14 text-purple-500 drop-shadow-[0_0_12px_rgba(168,85,247,0.8)] animate-pulse" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4">
            <polygon points="50,15 85,75 15,75" />
            <line x1="28" y1="42" x2="72" y2="42" />
            <circle cx="50" cy="58" r="6" fill="currentColor" />
          </svg>
        );
      default:
        return (
          <svg className="w-14 h-14 text-amber-500 drop-shadow-[0_0_12px_rgba(245,158,11,0.8)] animate-pulse" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4">
            <circle cx="50" cy="50" r="32" />
            <circle cx="50" cy="50" r="7" fill="currentColor" />
            <rect x="34" y="34" width="32" height="32" rx="3" />
          </svg>
        );
    }
  };

  return (
    <div className={`relative flex items-center justify-center border border-white/10 rounded-xl bg-slate-950/80 shadow-[inset_0_0_20px_rgba(0,0,0,0.8)] overflow-hidden w-full h-full min-h-[120px] ${className}`}>
      <svg className="absolute w-full h-full text-slate-800/20 animate-spin-slow pointer-events-none" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="0.5" />
        <polygon points="50,8 86,70 14,70" fill="none" stroke="currentColor" strokeWidth="0.25" />
        <polygon points="50,92 86,30 14,30" fill="none" stroke="currentColor" strokeWidth="0.25" />
      </svg>
      {getRuneSvg(element)}
    </div>
  );
}

// --- SUBCOMPONENT: TRADING CARD VIEW ---

function TradingCard({ card, onAction, actionLabel }) {
  const cardRef = useRef(null);

  const getElementStyles = (element) => {
    switch (element) {
      case 'Fire':
        return {
          gradient: 'from-red-950/90 via-red-900/40 to-slate-950/90',
          border: 'border-red-500/60 shadow-red-500/20 hover:border-red-400 hover:shadow-red-500/40',
          badge: 'bg-red-500/20 text-red-300 border-red-500/40',
          icon: '🔥',
          textColor: 'text-red-400'
        };
      case 'Water':
        return {
          gradient: 'from-blue-950/90 via-blue-900/40 to-slate-950/90',
          border: 'border-blue-500/60 shadow-blue-500/20 hover:border-blue-400 hover:shadow-blue-500/40',
          badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          icon: '💧',
          textColor: 'text-blue-400'
        };
      case 'Lightning':
        return {
          gradient: 'from-purple-950/90 via-purple-900/40 to-slate-950/90',
          border: 'border-purple-500/60 shadow-purple-500/20 hover:border-purple-400 hover:shadow-purple-500/40',
          badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          icon: '⚡',
          textColor: 'text-purple-400'
        };
      case 'Earth':
        return {
          gradient: 'from-emerald-950/90 via-green-900/40 to-slate-950/90',
          border: 'border-green-500/60 shadow-green-500/20 hover:border-green-400 hover:shadow-green-500/40',
          badge: 'bg-green-500/20 text-green-300 border-green-500/40',
          icon: '🌿',
          textColor: 'text-green-400'
        };
      default:
        return {
          gradient: 'from-slate-900/90 via-slate-800/40 to-slate-950/90',
          border: 'border-slate-500/60 shadow-slate-500/20 hover:border-slate-400 hover:shadow-slate-500/40',
          badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
          icon: '🔮',
          textColor: 'text-slate-400'
        };
    }
  };

  const style = getElementStyles(card.element);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const cardEl = cardRef.current;
    const rect = cardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    const angleX = (yc - y) / 15;
    const angleY = (x - xc) / 15;
    cardEl.style.transform = `perspective(800px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.02)`;
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.transform = `perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)`;
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`alchemical-card relative rounded-2xl bg-gradient-to-b ${style.gradient} border ${style.border} transition-all duration-150 flex flex-col p-4 justify-between shadow-xl overflow-hidden group select-none cursor-pointer`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:15px_15px] pointer-events-none" />

      {/* Header Info */}
      <div className="card-rarity-row flex items-center justify-between border-b border-white/5 pb-2 relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-wider text-slate-400">ALCHEM_ASSET</span>
          {card.audio_url && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                playCardVoice(card);
              }}
              className="text-[10px] text-cyber-purple hover:text-white cursor-pointer transition-all animate-pulse"
              title="Play battle cry"
            >
              🔊
            </button>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-full border text-[8px] font-mono font-bold tracking-wider ${style.badge}`}>
          {card.element.toUpperCase()} {style.icon}
        </span>
      </div>

      {/* Card Visual & Name */}
      <div className="card-title-row my-2 relative z-10 flex flex-col gap-2">
        <div className="card-img-frame w-full h-44 rounded-lg bg-black/70 flex items-center justify-center overflow-hidden border border-white/5 relative">
          {resolveImageUrl(card) ? (
            <img
              src={resolveImageUrl(card)}
              alt={card.card_name}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <AlchemicalPlaceholder element={card.element} className="border-none bg-transparent" />
          )}
        </div>
        <h4 className="font-bold text-xs truncate uppercase text-white font-mono">{card.card_name}</h4>
      </div>

      {/* Card Stats Grid */}
      <div className="card-stats-row space-y-1.5 font-mono text-[9px] relative z-10">
        {/* HP */}
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="text-slate-400">HEALTH</span>
            <span className="text-white font-bold">{card.base_stats.health}</span>
          </div>
          <div className="stat-bar-container w-full bg-black/60 h-1 rounded-full overflow-hidden">
            <div
              style={{ width: `${(card.base_stats.health / 150) * 100}%` }}
              className="h-full rounded-full bg-cyber-purple"
            />
          </div>
        </div>
        {/* ATK */}
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="text-slate-400">ATTACK</span>
            <span className="text-white font-bold">{card.base_stats.attack}</span>
          </div>
          <div className="stat-bar-container w-full bg-black/60 h-1 rounded-full overflow-hidden">
            <div
              style={{ width: `${(card.base_stats.attack / 150) * 100}%` }}
              className="h-full rounded-full bg-cyber-pink"
            />
          </div>
        </div>
        {/* SPD */}
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="text-slate-400">SPEED</span>
            <span className="text-white font-bold">{card.base_stats.speed}</span>
          </div>
          <div className="stat-bar-container w-full bg-black/60 h-1 rounded-full overflow-hidden">
            <div
              style={{ width: `${(card.base_stats.speed / 150) * 100}%` }}
              className="h-full rounded-full bg-cyber-blue"
            />
          </div>
        </div>
      </div>

      {/* Card Ability Lore */}
      <div className="card-lore-row mt-2 text-[8px] text-slate-400 line-clamp-2 border-t border-white/5 pt-2 italic relative z-10 leading-relaxed font-sans">
        {card.lore}
      </div>

      {/* Field / Action Button */}
      {onAction && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="card-action-btn mt-3 w-full py-2 bg-white/5 hover:bg-cyber-purple hover:text-black transition-all border border-white/10 rounded-lg font-mono font-bold text-[9px] tracking-wider relative z-10 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
