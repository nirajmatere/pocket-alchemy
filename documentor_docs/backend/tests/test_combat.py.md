# Technical Documentation: `backend/tests/test_combat.py`

## Overview

The `backend/tests/test_combat.py` file contains the unit testing suite for the combat system and stat normalization logic in the backend application. It uses the `pytest` framework to validate stat balancing algorithms, elemental advantage multipliers, individual fighter mechanics (shielding and healing), and battle session execution flows for both Player vs. Environment (PvE) and Player vs. Player (PvP) modes.

---

## Dependencies & Imports

The test file relies on external modules for testing functionality and internal application modules for game logic:

* **`pytest`**: Python testing framework used to structure and execute test cases.
* **`backend.transmute`**:
  * `balance_stats`: Function that normalizes/balances card stats.
  * `CardStats`: Data class representing a card's base numerical stats (`health`, `attack`, `speed`).
  * `GameCard`: Data structure representing a playable card instance.
* **`backend.battle`**:
  * `get_element_multiplier`: Function calculating elemental advantage/disadvantage multipliers.
  * `ActiveFighter`: Object managing state and mechanics (health, shielding) of a card during combat.
  * `BattleSession`: Class orchestrating the battle state, player actions, turn resolution, and rounds.

---

## Test Suite Structure

The test file is divided into two distinct logical categories:
1. **Stat Balancing Tests**
2. **Combat Logic Tests**

---

### 1. Stat Balancing Tests

These tests evaluate the `balance_stats` function to ensure stat totals sum to the target value of **250** and respect lower/upper stat boundaries.

#### `test_balance_stats_exact()`
* **Purpose**: Asserts that stats already summing to 250 and within acceptable bounds remain unaltered.
* **Scenario**:
  * Input: `health=100`, `attack=80`, `speed=70` (Sum: 250).
* **Assertions**:
  * `health` remains 100.
  * `attack` remains 80.
  * `speed` remains 70.
  * Total sum equals 250.

#### `test_balance_stats_scaling()`
* **Purpose**: Asserts that stats summing to more or less than 250 are scaled proportionally to hit the target sum of 250, while remaining within `[20, 150]`.
* **Scenarios Tested**:
  1. High Sum Input: `health=100`, `attack=100`, `speed=100` (Sum: 300).
     * Assertions: Sum is scaled to 250; all stats fall between 20 and 150 inclusive.
  2. Low Sum Input: `health=50`, `attack=50`, `speed=50` (Sum: 150).
     * Assertions: Sum is scaled to 250.

#### `test_balance_stats_boundaries()`
* **Purpose**: Verifies that individual stat values are strictly clamped within the `[20, 150]` range during balancing.
* **Scenarios Tested**:
  1. Extreme Low: `health=10`, `attack=15`, `speed=10`.
     * Assertions: `health`, `attack`, and `speed` are each $\ge 20$, and the sum equals 250.
  2. Extreme High: `health=500`, `attack=10`, `speed=10`.
     * Assertions: `health` is clamped $\le 160$, and the sum equals 250.

---

### 2. Combat Logic Tests

These tests check elemental interactions, combat abilities (`shield`, `heal`), and complete round execution dynamics.

#### `test_element_multipliers()`
* **Purpose**: Validates the output of `get_element_multiplier(attacker_element, defender_element)`.
* **Assertions**:
  * **Elemental Advantage (Multiplier: 1.5)**:
    * `Fire` vs. `Earth` $\rightarrow$ 1.5
    * `Earth` vs. `Lightning` $\rightarrow$ 1.5
    * `Lightning` vs. `Water` $\rightarrow$ 1.5
    * `Water` vs. `Fire` $\rightarrow$ 1.5
  * **Elemental Disadvantage / Neutral**:
    * `Fire` vs. `Water` $\rightarrow$ 0.7
    * `Neutral` vs. `Fire` $\rightarrow$ 1.0

#### `test_active_fighter_shielding()`
* **Purpose**: Confirms that active shields mitigate the entirety of the next incoming strike and expire upon consumption.
* **Flow**:
  1. Instantiates `ActiveFighter` with 100 base health and sets `shield_active = True`.
  2. Calls `apply_damage(50)`.
     * Asserts damage taken is `0`.
     * Asserts `current_health` remains `100`.
     * Asserts `shield_active` becomes `False`.
  3. Calls `apply_damage(30)` again without a shield.
     * Asserts damage taken is `30`.
     * Asserts `current_health` drops to `70`.

#### `test_active_fighter_healing()`
* **Purpose**: Verifies that healing restores lost health but does not exceed the fighter's maximum health capacity.
* **Flow**:
  1. Instantiates `ActiveFighter` with max health 100 and reduces `current_health` to 85.
  2. Executes `heal(30)`.
* **Assertions**:
  * Value returned by `heal()` is `15` (actual amount healed).
  * `current_health` is capped at `100`.

#### `test_battle_round_resolution_pve()`
* **Purpose**: Tests round resolution in a single-player (PvE) setting where opponent action selection occurs automatically.
* **Flow**:
  1. Constructs Player 1 card (`Fire`, 120 speed, 50 attack) and Boss card (`Earth`, 50 speed, 40 attack).
  2. Initializes `BattleSession("lobby_test", card1, is_pvp=False)`.
  3. Replaces `session.player2` with an `ActiveFighter` created from the Boss card.
  4. Calls `session.select_action(1, "attack")`.
     * Asserts return value is `True` (auto-readies round in PvE).
  5. Executes `session.execute_round()`.
* **Assertions**:
  * Player 1 strikes first due to higher speed (120 vs. 50).
  * Elemental advantage (`Fire` vs. `Earth`) is applied.
  * Boss `current_health` decreases below 100.
  * `session.round_number` increments to `2`.

#### `test_battle_round_resolution_pvp()`
* **Purpose**: Tests round resolution in a multiplayer (PvP) setting requiring both players to submit actions before resolution can occur.
* **Flow**:
  1. Instantiates P1 card and P2 card.
  2. Initializes `BattleSession("lobby_test", card1, is_pvp=True)` and joins opponent via `session.join_opponent(card2)`.
  3. Player 1 locks in action via `session.select_action(1, "attack")`.
     * Asserts return value is `False` (round is not ready).
     * Asserts `player1_action` is recorded and `player2_action` is `None`.
  4. Player 2 locks in action via `session.select_action(2, "attack")`.
     * Asserts return value is `True` (both players ready).
     * Asserts `player2_action` is recorded.
  5. Calls `session.execute_round()`.
* **Assertions**:
  * Damage is calculated and applied to Player 2's fighter (`current_health` < 100).
  * `round_number` increments to 2.
  * Both `player1_action` and `player2_action` are reset to `None` for the next round.

---

## Running the Tests

To execute this test module using `pytest`, run the following command from the project root:

```bash
pytest backend/tests/test_combat.py
```