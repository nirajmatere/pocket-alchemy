# Technical Documentation: `backend/tests/test_feed_and_custom.py`

## Overview

The `backend/tests/test_feed_and_custom.py` file contains integration and unit tests for the FastAPI application backend. It tests key functionalities including:
1. Retrieval of daily feed card data (`/api/feed/today`).
2. Initialization of PvE battle sessions against custom opponent cards (`/api/battle/create`).
3. Client inventory isolation and data segregation within the local database client (`db_client`).
4. Managed AI battle agent execution using the Gemini agent integration endpoint (`/api/battle/agent_play`).

---

## Dependencies & Imports

* **`os`**: Standard library module used to check environment variables for API credentials.
* **`pytest`**: Testing framework used for test conditions and conditional skip markers (`@pytest.mark.skipif`).
* **`fastapi.testclient.TestClient`**: Test client framework used to make HTTP requests against the FastAPI `app`.
* **`backend.main`**: Imports `app` (FastAPI instance) and `db_client` (database management client).
* **`backend.transmute`**: Imports `GameCard` and `CardStats` model classes for defining player and opponent card schemas.

---

## Global Setup

```python
client = TestClient(app)
```
Instantiates a synchronous `TestClient` using the FastAPI `app` instance to simulate HTTP requests during test execution.

---

## Test Functions

### 1. `test_today_feed_endpoint()`

**Purpose:**  
Verifies that the daily feed endpoint returns a HTTP 200 response containing a JSON list of cards structured according to the expected card schema.

**Execution Flow:**
1. Issues a `GET` request to `/api/feed/today`.
2. Asserts that the response HTTP status code is `200`.
3. Asserts that the returned JSON response is of type `list`.
4. If the list contains one or more items, inspects the first item (`data[0]`) to ensure the following required keys exist:
   * `"card_name"`
   * `"element"`
   * `"base_stats"`

---

### 2. `test_create_battle_with_custom_opponent()`

**Purpose:**  
Validates that a player can create a non-PvP (PvE) battle session specifying a custom opponent card (`"opponent_card"`).

**Execution Flow:**
1. Checks the existing inventory for `"local_user"` via `db_client.get_inventory("local_user")`.
2. If no inventory exists, seeds a dummy card into the database:
   * **Card Name:** `"Dummy Card"`
   * **Element:** `"Neutral"`
   * **Base Stats:** `health=100`, `attack=50`, `speed=100`
   * **Ability Name:** `"Dummy Shield"`
   * **Effect Type:** `"shield"`
   * **Value:** `0`
   * **Lore:** `"Dummy lore"`
   * Saves to `db_client` under user `"local_user"`, then re-fetches the inventory.
3. Selects the card name from index `0` of the inventory (`player_card_name`).
4. Defines a custom opponent using the `GameCard` model:
   * **Card Name:** `"Dark Alchemist"`
   * **Element:** `"Fire"`
   * **Base Stats:** `health=120`, `attack=60`, `speed=70`
   * **Ability Name:** `"Pyro Blast"`
   * **Effect Type:** `"damage"`
   * **Value:** `30`
   * **Lore:** `"A dark shadow opponent."`
5. Sends a `POST` request to `/api/battle/create` with payload:
   ```json
   {
     "client_id": "local_user",
     "card_name": "<player_card_name>",
     "is_pvp": false,
     "opponent_card": { ... }
   }
   ```
6. Asserts:
   * Status code is `200`.
   * Response contains key `"lobby_id"`.
   * Response contains key `"boss_name"`.
   * `res_data["boss_name"]` equals `"Dark Alchemist"`.

---

### 3. `test_user_segregation_local_db()`

**Purpose:**  
Ensures that inventory records stored in the database client (`db_client`) are correctly segregated by user identifier (`client_id`).

**Execution Flow:**
1. Instantiates `card_a` (`"User A Card"`, Fire, 100/50/100, ability `"A Blast"`) and saves it under `client_id="user_a"`.
2. Instantiates `card_b` (`"User B Card"`, Water, 100/50/100, ability `"B Splash"`) and saves it under `client_id="user_b"`.
3. Fetches the inventories for `"user_a"` and `"user_b"`.
4. Extracts list of card names for both users (`names_a` and `names_b`).
5. Asserts:
   * `"User A Card"` is present in `names_a`.
   * `"User B Card"` is **not** present in `names_a`.
   * `"User B Card"` is present in `names_b`.
   * `"User A Card"` is **not** present in `names_b`.

---

### 4. `test_battle_agent_play_endpoint()`

**Purpose:**  
Tests the Gemini-powered Managed Battle Agent API endpoint (`/api/battle/agent_play`), verifying that the agent can evaluate a battle state and execute a valid action turn.

**Pre-conditions & Decorators:**
* `@pytest.mark.skipif`: Evaluates if environment variables `GEMINI_API_KEY` or `GCP_PROJECT_ID` are set. If neither environment variable is configured, the test is skipped with the reason `"Skipping because Gemini API credentials are not configured in the environment"`.

**Execution Flow:**
1. Checks or populates inventory for `"local_user"` (creates dummy card if inventory is empty).
2. Sends a `POST` request to `/api/battle/create` to establish a battle lobby (`is_pvp=False`).
3. Verifies status code `200` and extracts `lobby_id`.
4. Sends a `POST` request to `/api/battle/agent_play` with payload:
   ```json
   {
     "client_id": "local_user",
     "lobby_id": "<lobby_id>"
   }
   ```
5. Asserts:
   * Status code is `200`.
   * Response JSON contains keys: `"action"`, `"stance"`, and `"reasoning"`.
   * `agent_data["action"]` is contained within `["attack", "ability"]`.
   * `agent_data["stance"]` is contained within `["aggressive", "defensive", "focused"]`.