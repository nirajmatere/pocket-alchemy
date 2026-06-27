import React, { useState, useEffect, useRef } from 'react';

const HOST_IP = '10.234.56.215'; // Fallback for native Capacitor wrappers

const getApiBase = () => {
  if (typeof window === 'undefined') return `http://${HOST_IP}:8000`;
  const hn = window.location.hostname;
  if (hn === '' || hn === 'localhost' && window.location.port === '') {
    return `http://${HOST_IP}:8000`;
  }
  return `${window.location.protocol}//${window.location.hostname}:8000`;
};

const getWsBase = () => {
  if (typeof window === 'undefined') return `ws://${HOST_IP}:8000`;
  const hn = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (hn === '' || hn === 'localhost' && window.location.port === '') {
    return `ws://${HOST_IP}:8000`;
  }
  return `${protocol}//${window.location.hostname}:8000`;
};

const API_BASE = getApiBase();
const WS_BASE = getWsBase();

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
  const prevBattleStateRef = useRef(null);

  const spawnPopup = (text, type, target) => {
    const id = Math.random().toString(36).substring(2, 9);
    setPopups(prev => [...prev, { id, text, type, target }]);
    setTimeout(() => {
      setPopups(prev => prev.filter(p => p.id !== id));
    }, 1200);
  };

  useEffect(() => {
    if (!battleState) {
      prevBattleStateRef.current = null;
      setPopups([]);
      return;
    }
    const prev = prevBattleStateRef.current;
    prevBattleStateRef.current = battleState;

    if (!prev) return;

    const newRound = battleState.round_number !== prev.round_number;
    const gameOverState = battleState.game_over && !prev.game_over;

    if (newRound || gameOverState) {
      let prevMe = null;
      let prevOpp = null;
      let currMe = null;
      let currOpp = null;

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

      // Check damage / heal / shield for Me
      const meHpDiff = currMe.current_health - prevMe.current_health;
      if (meHpDiff < 0) {
        setOppAnimClass('animate-strike-left');
        setTimeout(() => {
          setMyAnimClass('animate-damage-shake');
          spawnPopup(`-${Math.abs(meHpDiff)}`, 'damage', 'me');
        }, 150);
      } else if (meHpDiff > 0) {
        spawnPopup(`+${meHpDiff}`, 'heal', 'me');
      } else if (currMe.shield_active && !prevMe.shield_active) {
        spawnPopup('SHIELD', 'shield', 'me');
      }

      // Check damage / heal / shield for Opponent
      const oppHpDiff = currOpp.current_health - prevOpp.current_health;
      if (oppHpDiff < 0) {
        setMyAnimClass('animate-strike-right');
        setTimeout(() => {
          setOppAnimClass('animate-damage-shake');
          spawnPopup(`-${Math.abs(oppHpDiff)}`, 'damage', 'opp');
        }, 150);
      } else if (oppHpDiff > 0) {
        spawnPopup(`+${oppHpDiff}`, 'heal', 'opp');
      } else if (currOpp.shield_active && !prevOpp.shield_active) {
        spawnPopup('SHIELD', 'shield', 'opp');
      }

      setTimeout(() => {
        setMyAnimClass('');
        setOppAnimClass('');
      }, 700);
    }
  }, [battleState]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const consoleEndRef = useRef(null);

  // Load inventory and health status on mount
  useEffect(() => {
    fetchInventory();
    checkBackendHealth();
  }, []);

  // Control HTML5 camera streaming
  useEffect(() => {
    if (activeView === 'transmute') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeView]);

  // Auto-scroll combat console logs
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [battleLogs]);

  // Reset action locks when a new round starts
  useEffect(() => {
    if (battleState) {
      setActionLocked(false);
    }
  }, [battleState?.round_number]);

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
      const res = await fetch(`${API_BASE}/api/cards`);
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
      const res = await fetch(`${API_BASE}/api/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_name: selectedCard.card_name, is_pvp: false, image_url: selectedCard.image_url || '' }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, selectedCard);
        setActiveView('battle');
      } else {
        alert("Failed to initialize solo match.");
      }
    } catch (e) {
      console.error(e);
      alert("Error reaching battle server.");
    }
  };

  const hostPvpBattle = async () => {
    setIsPvp(true);
    try {
      const res = await fetch(`${API_BASE}/api/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_name: selectedCard.card_name, is_pvp: true, image_url: selectedCard.image_url || '' }),
      });

      if (res.ok) {
        const data = await res.json();
        setLobbyId(data.lobby_id);
        connectRoomWebSocket(data.lobby_id, selectedCard);
        setShowMatchmakingModal(false);
        setActiveView('lobby');
      } else {
        alert("Failed to create PvP room.");
      }
    } catch (e) {
      console.error(e);
      alert("Error reaching battle server.");
    }
  };

  const joinPvpBattle = async () => {
    if (!joinRoomCode.trim()) {
      alert("Please enter a Room Code");
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
        card: cardToRegister
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'room_state') {
        setRoomState(data);
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
          if (activeView === 'battle' && data.is_pvp) {
            setActiveView('lobby');
          }
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

    ws.onclose = () => {
      console.log("WebSocket room disconnected");
    };

    setSocket(ws);
  };

  const sendBattleAction = (combatMove) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      setActionLocked(true);
      socket.send(JSON.stringify({ 
        action: "battle_action", 
        combat_move: combatMove 
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
    setActiveView('inventory');
    fetchInventory();
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

  const { me, opponent, isSpectator } = getFightersForDisplay();

  return (
    <div className={`flex flex-col text-slate-100 w-full ${activeView === 'battle' ? 'h-screen max-h-screen overflow-hidden p-2' : 'min-h-screen p-4 md:p-6 max-w-7xl mx-auto'}`}>
      {/* HEADER NAVBAR */}
      {activeView !== 'battle' && (
        <header className="flex flex-col sm:flex-row items-center justify-between border-b border-white/10 pb-4 mb-6 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-cyber-purple to-cyber-blue flex items-center justify-center font-mono font-bold text-black text-xl shadow-[0_0_15px_rgba(157,78,221,0.6)]">
              ☿
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyber-purple via-cyber-blue to-cyber-green font-mono uppercase animate-flicker">
                POCKET ALCHEMY
              </h1>
              <p className="text-xs text-slate-400 font-mono tracking-widest uppercase">multimodal mobile card battler</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { if (activeView !== 'battle') setActiveView('transmute'); }}
              disabled={activeView === 'battle'}
              className={`px-4 py-2 rounded-lg font-mono text-sm font-semibold transition-all border ${
                activeView === 'transmute'
                  ? 'bg-cyber-purple text-black border-cyber-purple shadow-[0_0_10px_rgba(157,78,221,0.4)]'
                  : 'bg-transparent text-slate-400 border-white/10 hover:border-cyber-purple/40 hover:text-slate-200 disabled:opacity-40'
              }`}
            >
              [1. TRANSMUTE]
            </button>
            <button
              onClick={() => { if (activeView !== 'battle') { setActiveView('inventory'); fetchInventory(); } }}
              disabled={activeView === 'battle'}
              className={`px-4 py-2 rounded-lg font-mono text-sm font-semibold transition-all border ${
                activeView === 'inventory'
                  ? 'bg-cyber-blue text-black border-cyber-blue shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                  : 'bg-transparent text-slate-400 border-white/10 hover:border-cyber-blue/40 hover:text-slate-200 disabled:opacity-40'
              }`}
            >
              [2. ALCHEMY VAULT]
            </button>
          </div>

          {/* Connection status pills */}
          <div className="flex gap-2 text-xs font-mono">
            <span className={`px-2 py-1 rounded border ${
              healthStatus.status === 'healthy' 
                ? 'bg-green-500/10 text-green-400 border-green-500/30' 
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              CORE: {healthStatus.status === 'healthy' ? 'ONLINE' : 'OFFLINE'}
            </span>
            <span className={`px-2 py-1 rounded border ${
              healthStatus.gemini_api_configured 
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}>
              GEMINI API: {healthStatus.gemini_api_configured ? 'CONNECTED' : 'LOCAL FALLBACK'}
            </span>
          </div>
        </header>
      )}

      {/* VIEW 1: TRANSMUTATION MATRIX (LIVE CAMERA VIEWPORT) */}
      {activeView === 'transmute' && (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 items-stretch">
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
                    {[...Array(12)].map((_, i) => (
                      <div 
                        key={i} 
                        className="absolute bottom-0 w-1.5 h-1.5 rounded-full bg-cyber-blue animate-spark" 
                        style={{
                          left: `${15 + Math.random() * 70}%`,
                          animationDelay: `${Math.random() * 3}s`,
                          animationDuration: `${3 + Math.random() * 2}s`
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
                <div className="w-full h-full flex flex-col items-center justify-between relative">
                  {/* Glowing camera border reticle */}
                  <div className="absolute inset-4 border border-white/10 rounded-xl pointer-events-none z-10">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-cyber-blue" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-cyber-blue" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-cyber-blue" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-cyber-blue" />
                  </div>

                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover rounded-xl bg-black"
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Shutter capture controls */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
                    <button
                      onClick={captureFrameAndTransmute}
                      disabled={isUploading}
                      className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/40 border-4 border-white flex items-center justify-center transition-all cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 disabled:opacity-40"
                    >
                      <div className="w-10 h-10 rounded-full bg-cyber-purple animate-pulse" />
                    </button>
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
        <div className="flex-1 flex flex-col">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 justify-items-center">
              {cards.map((card, idx) => (
                <TradingCard 
                  key={idx} 
                  card={card} 
                  onAction={() => selectCardForArena(card)} 
                  actionLabel="SUMMON TO ARENA" 
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: BATTLE ARENA */}
      {activeView === 'battle' && battleState && me && (
        <div className="flex-1 flex flex-col gap-1.5 justify-between overflow-hidden">
          
          {/* Compact Arena Header */}
          <div className="flex justify-between items-center bg-black/60 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
            <div>
              <span className="text-slate-400">ROOM:</span> <b className="text-cyber-blue mr-3">{lobbyId}</b>
              <span className="text-slate-400">ROUND:</span> <b className="text-cyber-green">{battleState.round_number}</b>
            </div>
            {(
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
                Exit
              </button>
            )}
          </div>

          {/* Combatants Grid - Side by Side Always */}
          <div className="grid grid-cols-2 gap-2 items-stretch flex-1 min-h-0">
            
            {/* Player Side (Me) */}
            <div className={`cyber-glass border border-white/10 rounded-lg p-2 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${myAnimClass}`}>
              <div className="flex justify-between items-center mb-1 text-[10px] text-cyber-purple font-mono uppercase tracking-wider">
                <span>{isSpectator ? "Fighter 1" : "You"}</span>
                <span>{me.element.toUpperCase()} {getElementStyles(me.element).symbol}</span>
              </div>

              {/* Floating Popups Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
                {popups.filter(p => p.target === 'me').map(p => (
                  <span 
                    key={p.id} 
                    className={`damage-popup absolute text-3xl font-extrabold font-mono tracking-wider ${
                      p.type === 'damage' ? 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]' :
                      p.type === 'heal' ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]' :
                      'text-cyber-blue drop-shadow-[0_0_10px_rgba(0,240,255,0.8)]'
                    }`}
                  >
                    {p.text}
                  </span>
                ))}
              </div>
              
              {me.shield_active && (
                <div className="absolute inset-0 border-2 border-cyber-blue animate-pulse rounded-xl pointer-events-none" />
              )}

              <h4 className="font-bold text-xs truncate mb-1" title={me.card_name}>{me.card_name}</h4>

              {/* Health Indicator bar */}
              <div className="mb-1">
                <div className="w-full bg-slate-950/80 h-2.5 rounded-full overflow-hidden border border-white/5 p-[2px]">
                  <div 
                    style={{ width: `${(me.current_health / me.max_health) * 100}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-cyber-purple to-cyber-blue transition-all duration-500 shadow-[0_0_8px_#9d4edd]"
                  />
                </div>
                <div className="text-[10px] text-right font-mono mt-0.5">{me.current_health}/{me.max_health} HP</div>
              </div>

              {/* Mini visual + Stats Showcase */}
              <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded border border-white/5">
                <div className="w-10 h-10 rounded bg-slate-950 flex items-center justify-center overflow-hidden border border-white/10 shrink-0">
                  {me.image_url ? (
                    <img 
                      src={`${API_BASE}${me.image_url}`} 
                      alt="" 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <span className="text-xl">🔮</span>
                  )}
                </div>

                <div className="flex-1 font-mono text-[9px] grid grid-cols-3 gap-0.5 text-center">
                  <div>
                    <span className="text-slate-500 block">ATK</span>
                    <span className="font-bold text-cyber-purple">{me.attack}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">SPD</span>
                    <span className="font-bold text-cyber-blue">{me.speed}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">SHD</span>
                    <span className="font-bold text-cyber-green">{me.shield_active ? 'Y' : 'N'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Opponent Side (Boss or Player 2) */}
            <div className={`cyber-glass border border-white/10 rounded-lg p-2 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${oppAnimClass}`}>
              <div className="flex justify-between items-center mb-1 text-[10px] text-red-400 font-mono uppercase tracking-wider">
                <span>{isSpectator ? "Fighter 2" : "Opponent"}</span>
                <span>{opponent.element.toUpperCase()} {getElementStyles(opponent.element).symbol}</span>
              </div>

              {/* Floating Popups Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
                {popups.filter(p => p.target === 'opp').map(p => (
                  <span 
                    key={p.id} 
                    className={`damage-popup absolute text-3xl font-extrabold font-mono tracking-wider ${
                      p.type === 'damage' ? 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]' :
                      p.type === 'heal' ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]' :
                      'text-cyber-blue drop-shadow-[0_0_10px_rgba(0,240,255,0.8)]'
                    }`}
                  >
                    {p.text}
                  </span>
                ))}
              </div>

              {opponent.shield_active && (
                <div className="absolute inset-0 border-2 border-cyber-blue animate-pulse rounded-xl pointer-events-none" />
              )}

              <h4 className="font-bold text-xs truncate mb-1" title={opponent.card_name}>{opponent.card_name}</h4>

              {/* Health Indicator bar */}
              <div className="mb-1">
                <div className="w-full bg-slate-950/80 h-2.5 rounded-full overflow-hidden border border-white/5 p-[2px]">
                  <div 
                    style={{ width: `${(opponent.current_health / opponent.max_health) * 100}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-500 transition-all duration-500 shadow-[0_0_8px_#ef4444]"
                  />
                </div>
                <div className="text-[10px] text-right font-mono mt-0.5">{opponent.current_health}/{opponent.max_health} HP</div>
              </div>

              {/* Mini visual + Stats Showcase */}
              <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded border border-white/5">
                <div className="w-10 h-10 rounded bg-slate-950 flex items-center justify-center overflow-hidden border border-white/10 shrink-0">
                  {opponent.image_url ? (
                    <img 
                      src={`${API_BASE}${opponent.image_url}`} 
                      alt="" 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <span className="text-xl">{!battleState.is_pvp ? '👹' : '🛡️'}</span>
                  )}
                </div>

                <div className="flex-1 font-mono text-[9px] grid grid-cols-3 gap-0.5 text-center">
                  <div>
                    <span className="text-slate-500 block">ATK</span>
                    <span className="font-bold text-red-400">{opponent.attack}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">SPD</span>
                    <span className="font-bold text-amber-400">{opponent.speed}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">SHD</span>
                    <span className="font-bold text-green-400">{opponent.shield_active ? 'Y' : 'N'}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Unified Action Buttons Row */}
          {!isSpectator ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={battleState.game_over || actionLocked}
                onClick={() => sendBattleAction('attack')}
                className="py-2.5 rounded-lg bg-white/10 hover:bg-white/20 font-bold font-mono text-xs uppercase border border-white/20 disabled:opacity-30 cursor-pointer text-center"
              >
                ⚔️ Strike Attack
              </button>
              <button
                disabled={battleState.game_over || actionLocked || me.ability_cooldown > 0}
                onClick={() => sendBattleAction('ability')}
                className={`py-2.5 rounded-lg font-bold font-mono text-xs uppercase border disabled:opacity-30 cursor-pointer text-center ${
                  me.ability_cooldown > 0 
                    ? 'bg-slate-900 border-white/5 text-slate-500' 
                    : 'bg-gradient-to-r from-cyber-purple to-cyber-blue text-black border-cyber-purple'
                }`}
              >
                {actionLocked ? 'Locked' : `✨ Ability ${me.ability_cooldown > 0 ? `(${me.ability_cooldown})` : ''}`}
              </button>
            </div>
          ) : (
            <div className="bg-cyber-blue/15 border border-cyber-blue/30 rounded-lg py-2 text-center text-[10px] font-mono text-cyber-blue uppercase tracking-wider animate-pulse">
              🔮 SPECTATOR ACCESS ACTIVE
            </div>
          )}

          {/* Compact Retro Combat Logging Console */}
          <div className="h-20 bg-black/90 border border-[#39ff14]/30 rounded-lg p-2 font-mono text-[10px] flex flex-col justify-between relative shadow-[inset_0_0_10px_rgba(57,255,20,0.1)]">
            <div className="overflow-y-auto retro-scroll flex-1 pr-2">
              {battleLogs.map((log, idx) => (
                <div key={idx} className="mb-0.5 text-[#39ff14] opacity-90">
                  {log}
                </div>
              ))}
              <div ref={consoleEndRef} />
            </div>
          </div>

          {/* Battle End Modal Overlay */}
          {battleState.game_over && (
            <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
              <div className="max-w-md w-full cyber-glass border border-white/20 p-6 rounded-2xl text-center shadow-2xl relative">
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
                  <div className="mt-2 mb-4 bg-black/85 p-3 rounded-xl border border-cyber-purple/35 text-left font-mono text-[9px] text-[#39ff14] max-h-36 overflow-y-auto whitespace-pre-line leading-relaxed retro-scroll">
                    {battleState.post_match_summary}
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
              <button
                onClick={quitBattle}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-all"
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
                    const isCurrentSpectating = roomState.members.find(m => m.client_id === clientId)?.status === 'spectating';
                    const canChallenge = !isSelf && member.status === 'spectating' && isCurrentSpectating;
                    
                    return (
                      <div 
                        key={member.client_id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-950/60 p-4 rounded-xl border border-white/5 gap-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">🔮</span>
                          <div>
                            <p className="font-mono text-sm font-bold uppercase text-slate-200">
                              {member.card_name} {isSelf && <span className="text-xs text-cyber-purple font-normal lowercase">(you)</span>}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono tracking-wider">
                              ID: {member.client_id}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 justify-end">
                          <span className={`px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border ${
                            member.status === 'fighting' 
                              ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse'
                              : member.status === 'challenging'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : member.status === 'challenged'
                              ? 'bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20'
                              : 'bg-green-500/10 text-green-400 border-green-500/20'
                          }`}>
                            {member.status}
                          </span>
                          
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
                    className="py-4 rounded-xl cyber-glass border border-white/10 hover:border-cyber-yellow/40 hover:bg-cyber-yellow/5 text-center flex flex-col items-center gap-2 cursor-pointer transition-all"
                  >
                    <span className="text-2xl">👹</span>
                    <span className="font-mono text-xs font-bold uppercase text-slate-200">Solo Match</span>
                  </button>
                  <button
                    onClick={hostPvpBattle}
                    className="py-4 rounded-xl cyber-glass border border-white/10 hover:border-cyber-purple/40 hover:bg-cyber-purple/5 text-center flex flex-col items-center gap-2 cursor-pointer transition-all"
                  >
                    <span className="text-2xl">🌐</span>
                    <span className="font-mono text-xs font-bold uppercase text-slate-200">Host PvP</span>
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
      className={`relative w-full max-w-[280px] h-[390px] rounded-2xl bg-gradient-to-b ${style.gradient} border ${style.border} transition-all duration-150 flex flex-col p-4 justify-between shadow-xl overflow-hidden group select-none cursor-pointer`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:15px_15px] pointer-events-none" />

      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2 relative z-10">
        <span className="font-mono text-[10px] tracking-widest text-slate-400">ALCHEM_ASSET</span>
        <span className={`px-2 py-0.5 rounded-full border text-[9px] font-mono font-bold tracking-wider ${style.badge}`}>
          {card.element.toUpperCase()} {style.icon}
        </span>
      </div>

      {/* Card Visual & Name */}
      <div className="my-2 relative z-10">
        <div className="w-full h-32 rounded-lg bg-black/70 flex items-center justify-center overflow-hidden border border-white/5 mb-2 relative">
          {card.image_url ? (
            <img 
              src={`${API_BASE}${card.image_url}`} 
              alt={card.card_name} 
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
            />
          ) : (
            <span className="text-4xl">🔮</span>
          )}
        </div>
        <h4 className="font-bold text-sm tracking-wide truncate uppercase text-white font-mono">{card.card_name}</h4>
      </div>

      {/* Card Stats Grid */}
      <div className="space-y-1.5 font-mono text-[10px] relative z-10">
        {/* HP */}
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="text-slate-400">HEALTH</span>
            <span className="text-white font-bold">{card.base_stats.health}</span>
          </div>
          <div className="w-full bg-black/60 h-1.5 rounded-full overflow-hidden">
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
          <div className="w-full bg-black/60 h-1.5 rounded-full overflow-hidden">
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
          <div className="w-full bg-black/60 h-1.5 rounded-full overflow-hidden">
            <div 
              style={{ width: `${(card.base_stats.speed / 150) * 100}%` }}
              className="h-full rounded-full bg-cyber-blue"
            />
          </div>
        </div>
      </div>

      {/* Card Ability Lore */}
      <div className="mt-2 text-[9px] text-slate-400 line-clamp-2 border-t border-white/5 pt-2 italic relative z-10 leading-relaxed font-sans">
        {card.lore}
      </div>

      {/* Field / Action Button */}
      {onAction && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="mt-3 w-full py-2 bg-white/5 hover:bg-gradient-to-r hover:from-cyber-purple hover:to-cyber-blue hover:text-black hover:border-transparent transition-all border border-white/10 rounded-lg font-mono font-bold text-[10px] tracking-wider relative z-10 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
