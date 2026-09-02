# Documentation: `backend/tests/test_tournament.py`

## Overview

The `backend/tests/test_tournament.py` file contains automated unit tests using `pytest` for validating the tournament and room session management functionality within the `BattleSession` class. The test suite verifies member registration, card assignments, dynamic room ownership transfer, round-robin tournament simulation, leaderboard logic, and session resets.

---

## Dependencies & Imports

* **`pytest`**: Python testing framework used for writing and executing tests.
* **`backend.transmute.GameCard`**: Data structure representing a playable card in the game.
* **`backend.transmute.CardStats`**: Data structure representing stats (health, attack, speed) associated with a `GameCard`.
* **`backend.battle.BattleSession`**: Core class managing battle room states, participant registration, room ownership, and tournament execution.

---

## Key Tested Functionality

### 1. Room Ownership and Participant Registration
**Test Function:** `test_tournament_owner_and_registration()`

#### Purpose
Verifies initial ownership assignment, member registration, default status settings, and participant card updates within a `BattleSession`.

#### Implementation Details
* **Setup**: Defines two `GameCard` instances (`card1`, `card2`) with explicit stats (`CardStats`) and abilities. Initializes a `BattleSession` with room ID `"ROOM-TEST"` and `is_pvp=True`.
* **Initial State**: Asserts that `session.owner_id` defaults to `None`.
* **First Registration (`client1`)**:
  * Calls `session.register_member("client1", None, None)`.
  * Verifies `client1` becomes the room owner (`session.owner_id == "client1"`).
  * Verifies `client1` starts with no assigned card and has the status `"spectating"`.
* **Second Registration (`client2`)**:
  * Calls `session.register_member("client2", card2, None)`.
  * Verifies `owner_id` remains `"client1"`.
  * Verifies `client2` has `card2` assigned and status set to `"spectating"`.
* **Card Update (`client1`)**:
  * Calls `session.register_member("client1", card1, None)` again.
  * Verifies that `client1`'s card is updated to `card1` and assigned to `session.player1.card`.

---

### 2. Room Ownership Transfer
**Test Function:** `test_tournament_owner_transfer()`

#### Purpose
Ensures room ownership transfers dynamically to the next available member when the active owner leaves the room.

#### Implementation Details
* **Setup**: Initializes a `BattleSession` and registers three consecutive members: `"client1"`, `"client2"`, and `"client3"`.
* **Initial Owner**: Verifies that `session.owner_id` is set to `"client1"`.
* **First Transfer**:
  * Removes `"client1"` via `session.remove_member("client1")`.
  * Asserts `session.owner_id` updates to `"client2"`.
* **Second Transfer**:
  * Removes `"client2"` via `session.remove_member("client2")`.
  * Asserts `session.owner_id` updates to `"client3"`.
* **Final Removal**:
  * Removes `"client3"` via `session.remove_member("client3")`.
  * Asserts `session.owner_id` resets back to `None`.

---

### 3. Round-Robin Tournament Simulation & Reset
**Test Function:** `test_tournament_simulation_round_robin()`

#### Purpose
Verifies round-robin tournament execution, match generation, score calculations, leaderboard sorting, and state resetting.

#### Implementation Details
* **Setup**: Creates three distinct cards (`c1` Fire Mage, `c2` Earth Golem, `c3` Lightning Sprite) and registers three players (`p1`, `p2`, `p3`) into a `BattleSession`.
* **Tournament Execution**:
  * Calls `session.start_tournament()`.
  * Asserts the method returns `True` and `session.tournament_active` becomes `True`.
* **Match & Leaderboard Integrity**:
  * Asserts that 3 total match combinations are generated for 3 players: `(p1, p2)`, `(p1, p3)`, and `(p2, p3)`.
  * Asserts `session.tournament_leaderboard` contains 3 player entries.
* **Leaderboard Validation**:
  * Confirms leaderboard entries are sorted in descending order of points (`leaderboard[0]["points"] >= leaderboard[1]["points"] >= leaderboard[2]["points"]`).
  * Verifies that total matches played per player equal 2 (`wins + losses + draws == 2`).
  * Validates point computation formula: $\text{points} = (\text{wins} \times 3) + (\text{draws} \times 1)$.
* **Tournament Reset**:
  * Calls `session.reset_tournament()`.
  * Asserts `session.tournament_active` is `False`.
  * Asserts `session.tournament_matches` and `session.tournament_leaderboard` are empty (length 0).
  * Confirms all member statuses are reverted to `"spectating"`.

---

## Data Structures and Interfaces Referenced

### `BattleSession` Methods Tested
* `register_member(client_id, card, websocket)`
* `remove_member(client_id)`
* `start_tournament()`
* `reset_tournament()`

### `BattleSession` Attributes Tested
* `owner_id`
* `members` (Dictionary containing client data including `"card"` and `"status"`)
* `player1.card`
* `tournament_active`
* `tournament_matches`
* `tournament_leaderboard` (List of dicts containing keys: `"wins"`, `"losses"`, `"draws"`, `"points"`)