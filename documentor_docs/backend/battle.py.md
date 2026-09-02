# Technical Documentation: `backend/battle.py`

## Overview

The `backend/battle.py` module contains the core turn-based combat system for the card game. It manages elemental interactions, dynamic fighter states, tactical stances, solo campaign bosses, multiplayer lobby sessions (PvP and spectating), turn/round execution logic, post-match summaries, reward calculations, WebSocket state broadcasting, and round-robin tournament simulations.

---

## 1. Constants and Configuration

### Elemental Multipliers (`MULTIPLIERS` & `get_element_multiplier`)

Combat interactions account for elemental advantages and weaknesses via the `MULTIPLIERS` dictionary.

* **Elemental Cycle:**
  * **Fire** deals 1.5x damage against **Earth**
  * **Earth** deals 1.5x damage against **Lightning**
  * **Lightning** deals 1.5x damage against **Water**
  * **Water** deals 1.5x damage against **Fire**
* **Elemental Disadvantages:**
  * Reversing the order above yields a multiplier of `0.7` (e.g., **Earth** against **Fire**).
* Default multiplier for non-matching or unlisted element pairs is `1.0`.

```python
def get_element_multiplier(attacker_element: str, defender_element: str) -> float
```
Returns the multiplier float for an attacking and defending pair, defaulting to `1.0` if no specific pair entry exists.

---

### Campaign Bosses (`CAMPAIGN_BOSSES` & `AI_BOSSES`)

A predefined list of 10 campaign stage bosses represented as `GameCard` objects:

1. **Akihabara Maid Golem** (Stage 1) - Lightning / Common
2. **Sumo Steam Roller** (Stage 2) - Earth / Common
3. **Shibuya Crossing Spirit** (Stage 3) - Neutral / Rare
4. **Suntory Shogun** (Stage 4) - Fire / Rare
5. **Asakusa Lantern Dragon** (Stage 5) - Fire / Rare
6. **Meiji Forest Tengu** (Stage 6) - Earth / Epic
7. **Tsukiji Kraken** (Stage 7) - Water / Epic
8. **Shinkansen Oni** (Stage 8) - Lightning / Epic
9. **Kabukicho Neon Drake** (Stage 9) - Water / Legendary
10. **The Ultimate Hackathon Judge** (Stage 10) - Neutral / Legendary

`AI_BOSSES` holds a fallback legacy reference containing the first 3 bosses (`CAMPAIGN_BOSSES[:3]`).

---

## 2. Classes

### `ActiveFighter`

Tracks temporary combat state, active shielding, dynamic stat buffs, ability cooldowns, and tactical stance for a specific `GameCard` during an ongoing match.

#### Attributes
* `card`: (`GameCard`) The underlying card object.
* `max_health`: (`int`) Initial max health derived from `card.base_stats.health`.
* `current_health`: (`int`) Remaining health points.
* `attack`: (`int`) Base attack value.
* `speed`: (`int`) Base speed value.
* `shield_active`: (`bool`) Indicates whether an alchemical shield is active to block incoming damage.
* `ability_cooldown`: (`int`) Turns remaining before special ability can be used.
* `attack_buff`: (`int`) Current temporary attack modifier.
* `speed_buff`: (`int`) Current temporary speed modifier.
* `stance`: (`Optional[str]`) Current chosen stance: `"aggressive"`, `"defensive"`, or `"focused"` (defaults to `"focused"`).

#### Methods

* `apply_damage(damage: int) -> int`
  * If `shield_active` is `True`, sets `shield_active = False` and returns `0` damage taken.
  * If stance is `"defensive"`, applies a flat damage reduction of 15.
  * Enforces a minimum damage threshold of `5`.
  * Reduces `current_health` (bounded at a minimum of `0`) and returns the actual damage dealt.

* `heal(amount: int) -> int`
  * Heals the unit up to `max_health`.
  * Returns the net HP restored.

* `reset_cooldown()`
  * Resets `ability_cooldown` to 3 rounds.

* `tick_cooldown()`
  * Decrements `ability_cooldown`.
  * If stance is `"focused"`, decrements by `2`; otherwise decrements by `1`.

* `to_dict() -> Dict[str, Any]`
  * Exports fighter properties, active stats (`attack + attack_buff`, `speed + speed_buff`), active shield, cooldowns, card metadata, and stance as a JSON-serializable dictionary.

---

### `BattleSession`

Manages a battle room instance, handling member registration, player status, WebSocket communication, solo/PvP match execution, reward calculation, and tournament auto-simulation.

#### Attributes
* `lobby_id`: (`str`) Unique room/lobby identifier.
* `is_pvp`: (`bool`) Flag indicating if the session is Player-vs-Player.
* `campaign_stage`: (`Optional[int]`) Active campaign stage index (1-10) if running solo campaign.
* `members`: (`Dict[str, Dict[str, Any]]`) Registry of all connected clients (`client_id` mapped to card, status, and WebSocket connection).
* `player1`: (`Optional[ActiveFighter]`) Active fighter for player 1.
* `player2`: (`Optional[ActiveFighter]`) Active fighter for player 2 / AI boss.
* `player1_id`: (`Optional[str]`) Client ID for player 1.
* `player2_id`: (`Optional[str]`) Client ID for player 2 / boss.
* `player1_action`: (`Optional[Dict[str, str]]`) Locked-in turn action and stance for player 1.
* `player2_action`: (`Optional[Dict[str, str]]`) Locked-in turn action and stance for player 2.
* `round_number`: (`int`) Current combat round count.
* `game_over`: (`bool`) Match completion flag.
* `winner`: (`str`) Label or ID of the match winner.
* `combat_logs`: (`List[str]`) Array of recent combat events.
* `post_match_summary`: (`str`) Generated match debrief output.
* `rewards`: (`Dict[str, Any]`) Match rewards dictionary (`aether_dust`, `catalysts`, `unlocked_stage`).
* `owner_id`: (`Optional[str]`) Room host/owner client ID.
* **Tournament Attributes**:
  * `tournament_active`: (`bool`) State flag for active round-robin tournament.
  * `tournament_leaderboard`: (`List[Dict]`) Ranked leaderboard records.
  * `tournament_matches`: (`List[Dict]`) Logs and stats of simulated tournament matches.
  * `tournament_winner_id`: (`Optional[str]`) Client ID of the overall tournament winner.
  * `tournament_rewards`: (`Dict[str, int]`) Distributed tournament rewards.

---

#### Methods: Session & Lobby Management

* `__init__(lobby_id, player1_card, is_pvp=False, opponent_card=None, campaign_stage=None)`
  * Configures session mode (PvP or Solo).
  * Registers player 1 if a card is supplied.
  * Sets up the opponent card if solo (loads stage boss from `CAMPAIGN_BOSSES` if `campaign_stage` is specified; otherwise picks `opponent_card` or a random boss from `AI_BOSSES`).

* `join_opponent(card: GameCard)`
  * Directly binds player 2 (`client_id = "2"`) with status `"fighting"`.

* `register_member(client_id: str, card: GameCard, ws: WebSocket)`
  * Adds or updates a client entry in `self.members`.
  * Sets `owner_id` to `client_id` if no room owner exists.
  * Updates `player1` when registered under PvP mode.

* `remove_member(client_id: str)`
  * Removes member from the room.
  * If the removed member is an active fighter (`player1_id` or `player2_id`), sets `game_over = True`, declares the disconnected opponent as winner, and logs a protocol termination alert.
  * Reassigns `owner_id` to the next remaining member if the owner leaves.

* `challenge_player(challenger_id: str, target_id: str) -> bool`
  * Sets status of `challenger_id` to `"challenging"` and `target_id` to `"challenged"`.

* `accept_challenge(host_id: str, challenger_id: str) -> bool`
  * Sets up `player1` (challenger) and `player2` (host).
  * Updates member statuses to `"fighting"`.
  * Initializes match states and combat logs.

---

#### Methods: Turn Resolution & Combat Rules

* `select_action(client_id: Any, action: str, stance: str = "focused") -> bool`
  * Locks in action (`"attack"` or `"ability"`) and stance (`"aggressive"`, `"defensive"`, or `"focused"`) for the player.
  * If solo, auto-generates AI action (`"attack"` or `"ability"` depending on cooldown and a 40% random threshold) and AI stance (random choice between aggressive, defensive, focused).
  * Returns `True` when actions for both player 1 and player 2 are locked in.

* `execute_round()`
  * Sets fighter stances from locked-in actions and ticks cooldowns.
  * Calculates initiative speed incorporating stance speed modifiers:
    * **Focused Stance**: Speed x1.25.
    * **Aggressive Stance**: Speed x0.9.
  * Resolves turn sequence based on initiative speed (random coin-flip on tied speed).
  * Calls `resolve_action` for the first strike.
  * If defender health drops to 0 or below, sets match as over, determines winner, generates debrief, awards match rewards, and resets member statuses to `"spectating"`.
  * If defender survives, executes second strike and re-checks health.
  * Increments `round_number` and resets turn actions if both fighters remain standing.

* `resolve_action(attacker: ActiveFighter, defender: ActiveFighter, action: str)`
  * **Attack Action**:
    * Base Damage = `attacker.attack + attacker.attack_buff`.
    * Stance Multipliers: **Aggressive** = x1.2 damage; **Defensive** = x0.8 damage.
    * Random damage variance factor: uniform random value between `0.9` and `1.1`.
    * Applies elemental multiplier from `get_element_multiplier`.
    * Applies damage to `defender` via `apply_damage()`.
  * **Ability Action**:
    * If `ability_cooldown > 0`, falls back automatically to a normal attack.
    * If stance is **Aggressive** and effect type is `"damage"`, base ability value is multiplied by `1.15`.
    * Executes logic based on `effect_type`:
      * `"damage"`: Deals direct damage using `defender.apply_damage()`.
      * `"heal"`: Restores health via `attacker.heal()`.
      * `"boost_attack"`: Increases `attacker.attack_buff`.
      * `"boost_speed"`: Increases `attacker.speed_buff`.
      * `"shield"`: Sets `attacker.shield_active = True`.
    * Calls `attacker.reset_cooldown()`.

---

#### Methods: Rewards, Post-Match & Networking

* `calculate_rewards(winner_label: str)`
  * Populates `self.rewards` if Player 1 wins.
  * Base Aether Dust: Random integer between 40 and 80.
  * **Campaign Bonus**: Dust is scaled by `1.0 + (stage * 0.2)`. Catalyst drop chance set to `0.3 + (stage * 0.05)`. Sets `unlocked_stage = campaign_stage + 1`.
  * **Non-Campaign/PvP**: Fixed 25% catalyst drop chance.

* `reset_lobby_status()`
  * Sets status of all participants in `members` back to `"spectating"` and clears pending actions.

* `async broadcast_state()`
  * Asynchronously broadcasts the current room state (JSON payload) over open WebSockets to all connected room members.
  * Includes active match details (top 10 combat logs, post-match summary, rewards), member roster, tournament metadata, and room ownership.

---

#### Methods: Tournaments

* `reset_tournament()`
  * Resets tournament flags, clear leaderboards/matches/rewards, and restores member statuses to `"spectating"`.

* `start_tournament() -> bool`
  * Initiates an auto-simulated Round Robin tournament among all room members with registered cards (requires minimum 2 players).
  * Resets current active match variables.
  * Uses `itertools.combinations` to pair all participants.
  * Evaluates paired matches in an automated turn-based simulation loop (up to a maximum limit of 50 rounds per match before forcing a draw).
  * Stance decisions in simulation:
    * Uses `get_ai_stance()` heuristics based on health threshold (< 30% forces defensive) and defender shield status.
  * Points structure: **Win** = 3 pts, **Draw** = 1 pt, **Loss** = 0 pts.
  * Sorts leaderboard by points and wins.
  * Top ranker receives 150 Aether Dust and 2 Catalysts. Attempts to immediately update user profile through `backend.main.db_client`.
  * Returns member statuses to `"spectating"`.

* `_sim_resolve_action(attacker: ActiveFighter, defender: ActiveFighter, action: str, match_logs: List[str])`
  * Helper method providing deterministic resolution of attacks and abilities specifically for simulated tournament rounds.

---

## 3. Helper Functions

### `generate_post_match_analysis(winner: ActiveFighter, loser: ActiveFighter) -> str`

Generates a formatted text summary debrief analyzing why the winner won, highlighting:
* Elemental advantage (if multiplier > 1.0)
* Turn initiative speed comparison
* Special ability usage
* Tactical stance application

---

## 4. Operational Summary Mechanics

### Tactical Stances Overview

| Stance | Speed Modifier | Offensive Output Modifier | Defensive / Cooldown Effect |
| :--- | :--- | :--- | :--- |
| **Focused** | +25% Speed (`x1.25`) | Normal | Cooldown tick decrements by 2 |
| **Aggressive**| -10% Speed (`x0.9`) | Basic Attack: x1.2<br>Damage Ability: x1.15 | None |
| **Defensive** | Normal | Basic Attack: x0.8 | Flat 15 damage reduction per incoming strike |