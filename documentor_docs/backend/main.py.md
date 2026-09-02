# Technical Documentation: `backend/main.py`

## 1. Overview

The `backend/main.py` file serves as the main entry point and core FastAPI application server for **Pocket Alchemy**. It exposes RESTful API endpoints and WebSocket channels that orchestrate card transmutation, fusion, AI-guided advisory and combat agents, game state persistence, player profiles, and real-time battle multiplayer sessions.

---

## 2. Environment Configuration and Setup

Upon importing, `backend/main.py` executes initial startup configuration logic:

1. **Custom `.env` Parser**: Parses a local `.env` file located in the same directory, populating `os.environ` with environment variables (ignoring comment lines beginning with `#`).
2. **`GOOGLE_APPLICATION_CREDENTIALS` Resolution**: Checks if `GOOGLE_APPLICATION_CREDENTIALS` is set as a relative path and resolves it against valid absolute paths relative to the script directory.
3. **CORS Middleware**: Initializes `CORSMiddleware` with `allow_origins=["*"]`, enabling cross-origin API calls.
4. **Directory Preparation**: Ensures the local upload directory (`backend/uploads`) exists on startup.

---

## 3. Data Models (Pydantic Schemas)

The file defines several Pydantic request and response schemas to validate incoming JSON payloads and format AI outputs:

| Schema Model | Purpose | Fields |
| :--- | :--- | :--- |
| `BattleCreateRequest` | Payload to create a solo or PvP battle session. | `client_id`, `card_name`, `is_pvp`, `image_url`, `opponent_card` |
| `BattleJoinRequest` | Payload to join an existing PvP lobby. | `client_id`, `lobby_id`, `card_name`, `image_url` |
| `CampaignFightRequest` | Payload to initiate a campaign PvE boss fight. | `client_id`, `card_name`, `image_url`, `stage` |
| `FuseRequest` | Payload to merge two cards. | `client_id`, `card1_name`, `card1_image_url`, `card2_name`, `card2_image_url` |
| `HintRequest` | Request for a tactical combat hint. | `client_id`, `lobby_id` |
| `AgentPlayRequest` | Request to trigger an AI agent battle decision. | `client_id`, `lobby_id` |
| `GeminiAgentDecision` | Schema for structured decision outputs from Gemini. | `action` ('attack' or 'ability'), `stance` ('aggressive', 'defensive', or 'focused'), `reasoning` |
| `AdvisorChatRequest` | Chat payload for talking with the Alchemical Sage. | `client_id`, `message`, `chat_history` |

---

## 4. Hybrid Database Architecture (`AlchemicalDB`)

`AlchemicalDB` provides a resilient data access layer that attempts to communicate with **Google Cloud Firestore**, falling back seamlessly to local JSON files if GCP credentials or project IDs are unavailable.

### Fallback Storage Files
- **Inventory**: `cards_inventory.json`
- **Profiles**: `player_profile.json`
- **Leaderboard**: `uniqueness_leaderboard.json`
- **Battle History**: `battle_history.json`

### Key Methods

- **`get_inventory(client_id: str) -> List[Dict]`**: Reads user's forged cards from Firestore (`users/{client_id}`) or filters `cards_inventory.json` where `creator_id == client_id`.
- **`save_card(client_id: str, card: GameCard)`**: Appends a card object to the user's `inventory` array in Firestore or appends to `cards_inventory.json`.
- **`get_profile(client_id: str) -> Dict`**: Fetches user profile stats (`level`, `experience`, `aether_dust`, `catalysts`, `unlocked_campaign_stage`, `badges`). Sets up default stats if absent.
- **`update_profile(client_id: str, updates: Dict)`**: Merges and saves profile property updates.
- **`get_leaderboard() -> List[Dict]`**: Returns top 20 cards ordered descending by `uniqueness_score`.
- **`submit_to_leaderboard(card: GameCard, client_id: str)`**: Saves or updates a card entry in the uniqueness leaderboard collection/JSON file.
- **`get_battle_history() -> List[Dict]`**: Obtains up to 10 most recent logged battles.
- **`log_battle(winner: str, loser: str, mode: str, rounds: int)`**: Adds a record of a finished match containing winner, loser, game mode, round count, and ISO timestamp.

---

## 5. Helper Functions

### `get_or_create_agent(client, agent_id, system_instruction, base_agent)`
Attempts to fetch an existing Managed Agent from the Google GenAI SDK by `agent_id`. If not found, attempts creation. If creation fails, returns `None` to signal fallback to direct model generation calls (`generate_content`).

### `upload_to_gcs(content: bytes, filename: str) -> str | None`
Uploads raw file bytes to Google Cloud Storage (GCS) if `GCS_BUCKET_NAME` is configured. Sets the blob public where possible and returns its public URL.

### `check_safe_search(image_bytes: bytes) -> bool`
Sends image content to the Google Cloud Vision API for content safety moderation. Returns `False` if any safe search category (`adult`, `medical`, `violence`, `racy`) is evaluated as `"LIKELY"` or `"VERY_LIKELY"`.

### `get_current_daily_quest() -> Dict`
Calculates a daily element/sub-element quest deterministically by taking an MD5 hash of today's date (`YYYY-MM-DD`). Cards matching today's quest receive a 1.5x multiplier to their `uniqueness_score`.

---

## 6. REST API Endpoints

### System & Inventory

*   **`GET /api/health`**
    *   *Description*: Health check endpoint.
    *   *Returns*: Backend health status and boolean indicator if `GEMINI_API_KEY` is present.
*   **`GET /api/cards`**
    *   *Parameters*: `client_id` (default: `"local_user"`)
    *   *Returns*: List of `GameCard` objects in the user's inventory, ordered newest first.

### Transmutation & Fusion

*   **`POST /api/transmute`**
    *   *Form Data*: `file` (`UploadFile`), `client_id` (`str`)
    *   *Logic*:
        1. Validates image via Vision API SafeSearch (`check_safe_search`).
        2. Saves image locally to `/uploads` and uploads to GCS if configured.
        3. Calls `transmute_image_to_card` to convert image bytes into a `GameCard`.
        4. Uploads locally generated Imagen artwork to GCS if present.
        5. Checks `get_currentdaily_quest()` and applies 1.5x uniqueness bonus if elemental criteria are met.
        6. Submits card to leaderboard and saves to `AlchemicalDB`.

*   **`POST /api/cards/fuse`**
    *   *Payload*: `FuseRequest`
    *   *Logic*: Checks user profile for at least 1 `catalysts`. Retrieves the two parent cards from inventory, performs card fusion via `fuse_cards`, updates image paths, saves the fused card, and deducts 1 catalyst from the player profile.

### Campaign & Dashboard

*   **`GET /api/campaign/status`**
    *   *Parameters*: `client_id`
    *   *Returns*: Profile data detailing stage unlock progress, currencies, and badges.
*   **`POST /api/campaign/fight`**
    *   *Payload*: `CampaignFightRequest`
    *   *Logic*: Validates selected player card, creates a new PvE `BattleSession` tagged with the requested campaign stage, and adds it to the global `battle_sessions` dictionary.
*   **`GET /api/dashboard/uniqueness`**
    *   *Parameters*: `client_id`
    *   *Returns*: Aggregated payload containing global leaderboard, active daily quest, user profile, and recent battle history.
*   **`GET /api/feed/today`**
    *   *Returns*: Cards created on today's UTC date, or falls back to top 12 leaderboard entries if no cards have been created today.

### AI Assistance & Combat Agents

*   **`POST /api/battle/hint`**
    *   *Payload*: `HintRequest`
    *   *Logic*: Deducts 15 Aether Dust from the player's profile. Constructs a prompt detailing player/opponent stats and calls Gemini (`gemini-2.5-flash`) to generate a tactical response under 20 words. Includes random fallback hints if Gemini generation fails.
*   **`POST /api/battle/agent_play`**
    *   *Payload*: `AgentPlayRequest`
    *   *Logic*: Invokes Managed Agent `combat-tactician-agent` (or falls back to `gemini-2.5-flash` or local rules heuristic) to evaluate battle state, stances, and elemental matchups. Automatically locks in combat choice (`attack` or `ability`) and stance (`aggressive`, `defensive`, `focused`) for the requesting player.
*   **`POST /api/advisor/chat`**
    *   *Payload*: `AdvisorChatRequest`
    *   *Logic*: Collects user's inventory as context and communicates with Managed Agent `alchemical-sage-advisor` (or falls back to structured `gemini-2.5-flash` dialogue) to advise on deck building, fusions, and game strategy.

### Battle Session Setup

*   **`POST /api/battle/create`**
    *   *Payload*: `BattleCreateRequest`
    *   *Logic*: Creates a solo or PvP lobby ID (`lobby_id`), builds a `BattleSession`, and returns session parameters.
*   **`POST /api/battle/join`**
    *   *Payload*: `BattleJoinRequest`
    *   *Logic*: Adds Player 2 (`opponent_card`) to an existing PvP battle lobby.

---

## 7. WebSockets Real-Time Battle Engine

*   **Endpoint**: `/ws/room/{lobby_id}/{client_id}?host={0|1}`
*   **Purpose**: Manages real-time lobby state, player actions, tournament hosting, and turn execution.

### Action Routing

The WebSocket endpoint receives JSON payloads containing an `action` key:

1. **`register`**: Registers a member and their selected `GameCard` within the session.
2. **`challenge`**: Issues a direct duel challenge to another registered user in the room.
3. **`accept_challenge`**: Accepts a challenge, initializing combat between the two players.
4. **`decline_challenge`**: Resets lobby challenge state.
5. **`start_tournament`**: Owner command to trigger tournament progression logic.
6. **`reset_tournament`**: Owner command to reset tournament state.
7. **`battle_action`**: Receives combat choices (`combat_move` and `stance`) from players. When both actions are ready (`ready == True`), delays briefly, triggers `session.execute_round()`, and broadcasts updated battle state.
    * *End of Match Handling*: Upon match completion (`game_over == True`), logs match results via `db_client.log_battle()`. For PvE/campaign victories, adds Aether Dust/Catalysts, unlocks new stages, and grants threshold badges (`Acolyte Alchemist`, `Forge Master`, `Divine Adept`).
8. **`exit_battle`**: Resets battle state and returns players to lobby view.

---

## 8. Static File Hosting

*   **`/uploads`**: Serves local files from the `backend/uploads` directory.
*   **`/assets`**: Serves frontend static assets from `frontend/dist/assets` if present.
*   **`/` (Root)**: Serves `index.html` from `frontend/dist` if built, or returns a placeholder backend active JSON message.