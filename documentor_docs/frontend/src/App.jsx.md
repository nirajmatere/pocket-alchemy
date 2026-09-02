# Technical Documentation Guide: `frontend/src/App.jsx`

## Overview

The `frontend/src/App.jsx` file is the core component and main orchestration layer for the **Pocket Alchemy** frontend application. It manages:
- Real-time WebSocket room connections and HTTP API integrations.
- View navigation and lifecycle management across ten distinct views.
- Camera access and image capture for the card transmutation process.
- Real-time combat state processing, stance controls, and visual/haptic feedback.
- Alchemical Sage AI chat advisor integration.
- Daily quests, leaderboards, battle history, feed, and campaign progression.
- Subcomponents for elemental placeholders (`AlchemicalPlaceholder`) and 3D tilting card displays (`TradingCard`).

---

## Technical Constants & Network Configurations

The file contains network utility functions to dynamically resolve backend HTTP and WebSocket endpoints depending on the environment (local host, custom IP override, dynamic browser origin, or Capacitor mobile wrapper).

| Constant / Helper | Type | Description |
| :--- | :--- | :--- |
| `HOST_IP` | `string` | Default fallback backend URL (`https://pocket-alchemy-backend-440102621899.asia-northeast1.run.app`). |
| `getHostIp()` | `Function` | Resolves the host IP/URL from `localStorage` (`pocket_alchemy_backend_ip`) or returns `HOST_IP`. |
| `getApiBase()` | `Function` | Resolves the HTTP base URL (`API_BASE`) based on window location, Capacitor status, and port configuration. |
| `getWsBase()` | `Function` | Resolves the WebSocket base URL (`WS_BASE`), automatically switching between `ws://` and `wss://`. |
| `API_BASE` | `string` | Resolved HTTP API root URL. |
| `WS_BASE` | `string` | Resolved WebSocket API root URL. |
| `SPARKS` | `Array<Object>`| Pre-configured animation positions and timings for the transmutation wizard particle effects. |

### Helper Functions

*   **`resolveImageUrl(cardOrFighter)`**: Takes a card or fighter object and returns a complete, absolute image URL (`image_art_url` or `image_url`), prefixing with `API_BASE` if relative.
*   **`playCardVoice(card)`**: Plays the card's voice audio using HTML5 `Audio`, resolving relative URLs to `API_BASE`.
*   **`generateRoomCode()`**: Generates a random uppercase room code prefixed with `ROOM-` (e.g., `ROOM-X9A2`).

---

## State Management Architecture

`App.jsx` relies heavily on React state (`useState`), side-effects (`useEffect`), and references (`useRef`).

### Primary Application States

#### 1. Identity & Navigation
*   `clientId`: Unique player ID saved in `localStorage` (`pocket_alchemy_client_id`). Auto-generated on first load (`player_XXXXXXX`).
*   `activeView`: Current active screen view (`transmute` | `inventory` | `advisor` | `leaderboard` | `badges` | `feed` | `battle` | `lobby` | `lobby_select` | `tournament`).
*   `cards`: Array of transmuted cards owned by the client.
*   `healthStatus`: Object storing backend status (`status`, `gemini_api_configured`).
*   `showSettingsModal`: Boolean controlling visibility of the IP sync configuration modal.
*   `backendIpInput`: Controlled string input for custom backend IP setting.

#### 2. Transmutation & Camera
*   `isUploading`: Boolean indicating active API upload during card forge.
*   `statusMessage`: Text description of the current transmutation stage.
*   `newlyTransmutedCard`: Holds the card object returned from a successful transmutation.
*   `cameraStream`: Holds the active `MediaStream` object from `navigator.mediaDevices.getUserMedia`.
*   `cameraError`: Boolean flag set to `true` when WebRTC camera access fails (triggers fallback native file upload).

#### 3. Lobby & Matchmaking
*   `selectedCard`: Holds the card chosen for combat or room registration.
*   `isPvp`: Boolean indicating if the current match is PvP or PvE.
*   `lobbyId`: Active room or lobby identifier string.
*   `playerNum`: Integer (1 or 2) assigned based on creation order in room setups.
*   `joinRoomCode`: Controlled string input for joining an existing room.
*   `showMatchmakingModal`: Boolean controlling the arena mode selection popup.
*   `pvpWaiting`: Boolean tracking if the host is waiting for a challenger.
*   `roomState`: Complete synchronized state object received from the room WebSocket.
*   `incomingChallenge`: Stores object (`fromId`, `fromName`) when challenged by another player in a room.
*   `isSpectatingActive`: Boolean tracking if the user is currently spectating an active room match.

#### 4. Combat & Real-time WebSocket
*   `battleState`: Object containing active combat metrics (`player1`, `player2`, `round_number`, `winner`, `game_over`, etc.).
*   `battleLogs`: Array of system and combat log strings.
*   `socket`: Holds the active `WebSocket` connection instance.
*   `actionLocked`: Boolean preventing double-submitting actions within a turn.

#### 5. Animation & Feedback States
*   `myAnimClass` / `oppAnimClass`: CSS animation strings applied to card cards during attacks or hits.
*   `popups`: Array of damage/heal floaters (`id`, `text`, `type`, `target`, `element`, `isHeavy`).
*   `screenShake`: Boolean triggering screen shake on heavy impacts.
*   `abilityFlash`: Flash overlay state (`{ element, caster }`).
*   `healthFlash`: Object (`{ me: boolean, opp: boolean }`) triggering health bar flashes.
*   `cardOverlay`: Object (`{ me: 'damage' | 'heal' | null, opp: ... }`) triggering card art overlays.
*   `roundIntro`: Overlay state (`{ round }`) displaying round start banners.
*   `confetti` / `defeatParticles`: Visual particle flags triggered at match end.
*   `stancePulse`: Triggers pulse animation when changing combat stances.
*   `mascotAnimation`: Controls the referee mascot animation class (`animate-mascot-happy`, `animate-mascot-sad`, etc.).
*   `shieldShatter`: Object (`{ me: boolean, opp: boolean }`) controlling shield break animations.
*   `rewardPopups`: Array of floating text rewards (e.g., `✨ +10 Aether Dust`).
*   `impactBurst`: Boolean controlling heavy impact visual burst ring.

#### 6. Dashboard, Badges, and Advisor States
*   `selectedStance`: Active stance (`focused` | `aggressive` | `defensive`).
*   `hintText` / `hintLoading`: Holds AI tactical advice string and loading status from Chronos.
*   `profile`: Player progression profile object (`aether_dust`, `catalysts`, `unlocked_campaign_stage`, `badges`).
*   `leaderboard`: Global card uniqueness leaderboard list.
*   `dailyQuest`: Active daily quest details object.
*   `battleHistory`: History log of past arena duels.
*   `advisorHistory`: Array of message objects (`role`, `text`) for the Alchemical Sage chat.
*   `advisorInput` / `advisorLoading`: Input state and loading indicator for the advisor chat.
*   `todayFeed`: Array of cards forged globally today.
*   `challengerTargetOpponent`: Holds target card object when setting up custom duels.
*   `showFighterSelectorModal`: Controls modal to pick a card when challenging another card.
*   `tournamentMatchIndex`, `tournamentMatchLogs`, `tournamentMatchesCompleted`, `tournamentRunningLocal`: State variables tracking automated tournament simulation.
*   `showRoomCardSelectorModal`: Controls the modal for selecting a champion card within a lobby.

---

## Primary Functions & Event Handlers

### Camera & Transmutation
*   `startCamera()`: Requests access to `navigator.mediaDevices.getUserMedia` with back camera preference (`facingMode: 'environment'`) and attaches it to `videoRef`.
*   `stopCamera()`: Stops all video tracks on `cameraStream`.
*   `captureFrameAndTransmute()`: Draws the current frame from `videoRef` onto `canvasRef`, converts it to a JPEG blob, and initiates upload via `uploadAndTransmute()`.
*   `handleMobileCameraInput(e)`: Fallback handler for native file inputs (`capture="environment"`).
*   `uploadAndTransmute(file)`: Sends a `multipart/form-data` POST request to `${API_BASE}/api/transmute`. Displays animated status messages and plays the audio voiceover on success.

### WebSocket Room & Battle Pipeline
*   `connectRoomWebSocket(roomCode, cardToRegister, isHost)`: Establishes a WebSocket connection to `${WS_BASE}/ws/room/${roomCode}/${clientId}`. Listens for incoming message types:
    *   `room_state`: Updates `roomState`, checks for active tournaments or active matches, and updates `battleState` and `activeView`.
    *   `challenge_received`: Sets `incomingChallenge`.
    *   `error`: Logs error and displays toast alert.
*   `sendBattleAction(combatMove)`: Sends JSON action payload (`action: "battle_action"`, `combat_move`, `stance`) over the active WebSocket.
*   `quitBattle()`: Clears active WebSocket connection, resets combat/animation states, and redirects user to `inventory`.

### AI Advisor & Chronos Strategic Systems
*   `sendAdvisorMessage(customMessage)`: Posts chat payload to `${API_BASE}/api/advisor/chat` containing message text and recent history, updating `advisorHistory` with the response.
*   `requestHint()`: Consumes 15 Aether Dust to query `${API_BASE}/api/battle/hint` for real-time tactical combat guidance.

---

## Application Views (`activeView`)

```
                         [App Load]
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
[transmute]             [inventory]              [advisor]
 Camera / Forge         Card Vault               Alchemical Sage Chat
     │                       │                       │
     ├───────────────┬───────┴───────┬───────────────┤
     ▼               ▼               ▼               ▼
[leaderboard]     [badges]        [feed]      [lobby_select]
 Uniqueness Vault  Milestones    Daily Feed    Host / Join Setup
                                                     │
                                                     ▼
                                                  [lobby]
                                              Room Waiting Room
                                                     │
                                     ┌───────────────┴───────────────┐
                                     ▼                               ▼
                                 [battle]                       [tournament]
                             Combat Arena                       Round Robin
```

### 1. Transmutation Matrix (`transmute`)
*   **Viewport**: HTML5 `<video>` stream inside a reticle overlay, or fallback mobile file picker.
*   **Upload State**: Displays a spinning alchemical wizard SVG, floating sparks (`SPARKS`), and rotating transmutation log text.
*   **Output**: Displays the newly forged `TradingCard` with action button options.

### 2. Alchemy Vault Inventory (`inventory`)
*   Displays a responsive grid of `TradingCard` components representing all user-owned cards.
*   Empty state provides a direct link to open the Transmutation view.

### 3. Alchemical Sage Advisor (`advisor`)
*   Provides a chat interface to converse with the AI Sage via `${API_BASE}/api/advisor/chat`.
*   Includes quick suggestion buttons and a sidebar deck catalog displaying card images and audio playback controls.

### 4. Leaderboard & Scoreboard (`leaderboard`)
*   Displays active Daily Alchemical Quests.
*   Features two data tables fetched from `${API_BASE}/api/dashboard/uniqueness`:
    1. Global Uniqueness Leaderboard (with challenge buttons).
    2. Recent Battles Scoreboard.

### 5. Badges Vault (`badges`)
*   Displays campaign milestone badges (*Acolyte Alchemist*, *Forge Master*, *Divine Adept*).
*   Visual indicators (glowing borders vs. grayscaled locked cards) denote unlock status derived from `profile.unlocked_campaign_stage`.

### 6. Today's Feed (`feed`)
*   Displays a responsive grid of cards forged by all users globally today, fetched from `${API_BASE}/api/feed/today`.

### 7. Battle Arena (`battle`)
*   **Grid Layout**:
    *   **Left Column**: Player Fighter card art, element badge, shield overlay, animated health bar, damage popups, and stance indicator.
    *   **Center Column**: Referee Mascot (dynamically animated based on HP and game status via `deriveMascotMood`), ATK and SPD comparison bars, and Chronos Strategist advice box.
    *   **Right Column**: Opponent Fighter card art and stats.
*   **Control Panel**: Stance selectors (*Focus*, *Aggro*, *Guard*), *Strike Attack*, *Ability*, and *Deploy Managed Agent (AI Play)*.
*   **Log Overlays**: Sequentially dequeued combat messages rendered over the battle grid via `animatedLogQueue`.
*   **Match End Overlay**: Displays Victory (with confetti) or Defeat (with particle drift) screens and diagnostic summaries.

### 8. Room Lobby (`lobby`)
*   Displays room code, list of connected alchemists, status badges (*fighting*, *challenging*, *challenged*, *spectating*), champion select options, and challenge triggers.
*   Hosts can initiate round-robin tournaments from this view.

### 9. PvP Room Selection (`lobby_select`)
*   Interface to host a new PvP room (generates code via `generateRoomCode()`) or join an existing room via input text code.

### 10. Tournament Arena (`tournament`)
*   Renders local/server round-robin tournament simulations.
*   Features a live room leaderboard table, match vs. preview, scrolling terminal logs, a skip simulation button, and a crowned champion summary screen.

---

## Modals & Overlays

1.  **Connection Settings Modal (`showSettingsModal`)**: Form to override default backend IP address, saving to `localStorage` (`pocket_alchemy_backend_ip`).
2.  **Matchmaking Modal (`showMatchmakingModal`)**: Triggered when a card is selected. Offers options for Campaign Stage, Random PvE Duel, Host PvP Arena, Duel Vault Card, or Join Friend's Lobby.
3.  **Room Card Selector Modal (`showRoomCardSelectorModal`)**: Allows users to select or switch their active champion card within a multiplayer room.
4.  **Fighter Selector Modal (`showFighterSelectorModal`)**: Allows users to pick an arena fighter from their vault when challenging a specific card.
5.  **Incoming Challenge Modal (`incomingChallenge`)**: Popup overlay prompting users to accept or decline duels from lobby members.

---

## Subcomponents

### 1. `AlchemicalPlaceholder`
Renders an SVG elemental rune placeholder when card artwork is unavailable.

*   **Props**:
    *   `element` (`string`): Target element (`Fire`, `Water`, `Earth`, `Lightning`, or default).
    *   `className` (`string`): Additional CSS class overrides.
*   **Internal Functions**:
    *   `getRuneSvg(el)`: Returns element-specific SVG paths with glow and pulse effects.

### 2. `TradingCard`
Renders a trading card with 3D perspective tilt calculations on mouse move.

*   **Props**:
    *   `card` (`Object`): Full card object (`card_name`, `element`, `base_stats`, `lore`, `image_url`, `audio_url`).
    *   `onAction` (`Function`): Callback function triggered when clicking the card's main action button.
    *   `actionLabel` (`string`): Text displayed inside the card action button.
*   **Features**:
    *   Calculates 3D rotation (`rotateX`, `rotateY`) on `onMouseMove` relative to mouse position.
    *   Applies dynamic color gradients and elemental badges based on `card.element`.
    *   Renders animated stat bars for Health, Attack, and Speed.
    *   Triggers voice audio playback via `playCardVoice(card)` when clicking the audio button.

---

## Audio & Haptic System Integration

The file imports haptic triggers from `./lib/haptics.js`:
*   `hapticLight()`: Triggered on stance selection and card navigation clicks.
*   `hapticMedium()`: Triggered on camera capture, standard attacks, and defeat screens.
*   `hapticHeavy()`: Triggered on heavy damage hits (`damagePct > 0.15`).
*   `hapticSuccess()`: Triggered on match victory.

Sound effects are powered by standard Web Audio / HTML5 `Audio` instances created inside `playCardVoice()`.