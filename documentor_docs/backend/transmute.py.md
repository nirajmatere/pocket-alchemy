# Technical Documentation: `backend/transmute.py`

## 1. Overview

The `backend/transmute.py` module serves as the core game engine for **Pocket Alchemy**, a tactical localized TCG / rogue-lite game. It handles the core mechanics of converting real-world object images into playable alchemical trading cards and fusing existing cards into stronger hybrid cards.

The module relies heavily on the **Google GenAI SDK** (`google.genai`) to interact with Google Gemini and Imagen models. Its key operations include:

1. **Card Transmutation (`transmute_image_to_card`)**: Analyzes uploaded image bytes using `gemini-2.5-flash` with Structured Outputs, extracts visual/cultural/textual attributes, assigns stats and lore, generates custom card artwork with `imagen-3.0-generate-002`, and synthesizes a spoken audio battle cry using Gemini audio modalities.
2. **Card Fusion (`fuse_cards`)**: Synthesizes two existing `GameCard` objects into a single, higher-powered hybrid card (target stat sum of 270), generating new combined artwork and a dramatic hybrid voice line.
3. **Stat Balancing (`balance_stats`)**: Normalizes card stats (`health`, `attack`, `speed`) to ensure exact point budgets and hard boundary constraints.
4. **Offline / Fallback Resilience**: Provides pre-baked cards and fallback routines if GCP/Gemini credentials are missing or API calls fail.

---

## 2. Data Schemas (Pydantic Models)

The module defines three Pydantic models to enforce strict type constraints and schema validation during Gemini response parsing and application processing.

### 2.1 `GeminiGameCard`

This model defines the structured JSON output schema expected from the Gemini API model (`gemini-2.5-flash`).

| Field | Type | Description |
| :--- | :--- | :--- |
| `card_name` | `str` | Creative name based on the visual object. |
| `element` | `str` | Elemental affinity (`Fire`, `Water`, `Lightning`, `Earth`, `Neutral`). |
| `health` | `int` | Health points (Constraint: 20 to 160). |
| `attack` | `int` | Attack power (Constraint: 20 to 160). |
| `speed` | `int` | Speed rating (Constraint: 20 to 160). |
| `ability_name` | `str` | Name of the alchemical special ability. |
| `effect_type` | `str` | Combat effect type (`damage`, `heal`, `boost_speed`, `boost_attack`, `shield`). |
| `value` | `int` | Numeric magnitude of ability effect (Constraint: 10 to 50). |
| `lore` | `str` | 1–2 sentence narrative describing the object's alchemical backstory. |
| `uniqueness_score` | `int` | Visual rarity score from 0 to 100 (Default: `50`). |
| `uniqueness_reason`| `str` | 1-sentence rationale for the score (Default: `""`). |
| `sub_element` | `str` | Secondary affinity: `Plasma`, `Frost`, `Quartz`, `Vapor`, or `Aether` (Default: `"Aether"`). |
| `rarity` | `str` | Rarity tier: `Common`, `Rare`, `Epic`, or `Legendary` (Default: `"Common"`). |
| `imagen_prompt` | `str` | Detailed prompt generated for Imagen 3 art creation (Default: `""`). |

### 2.2 `CardStats`

Container for numerical combat statistics.

| Field | Type | Description |
| :--- | :--- | :--- |
| `health` | `int` | Health points (20 to 160). |
| `attack` | `int` | Attack power (20 to 160). |
| `speed` | `int` | Speed points (20 to 160). |

### 2.3 `GameCard`

The complete operational representation of a card used throughout the application runtime.

| Field | Type | Description |
| :--- | :--- | :--- |
| `card_name` | `str` | Name of the card. |
| `element` | `str` | Primary element. |
| `base_stats` | `CardStats` | Instance of `CardStats`. |
| `ability_name` | `str` | Ability title. |
| `effect_type` | `str` | Effect class (`damage`, `heal`, `boost_speed`, `boost_attack`, `shield`). |
| `value` | `int` | Magnitude of ability effect. |
| `lore` | `str` | Story snippet. |
| `image_url` | `str \| None` | Relative URL/path to raw captured image thumbnail (Default: `None`). |
| `uniqueness_score` | `int` | Rarity rating (0–100, Default: `50`). |
| `uniqueness_reason`| `str` | Explanation for uniqueness rating (Default: `""`). |
| `sub_element` | `str` | Secondary elemental type (Default: `"Aether"`). |
| `rarity` | `str` | Tier designation (Default: `"Common"`). |
| `image_art_url` | `str \| None` | Relative path to generated Imagen artwork (Default: `None`). |
| `imagen_prompt` | `str \| None` | Raw prompt used for art generation (Default: `None`). |
| `created_date` | `str \| None` | Timestamp placeholder (Default: `None`). |
| `audio_url` | `str \| None` | Relative path to synthesized WAV audio file (Default: `None`). |

---

## 3. Pre-Baked Fallback Dataset (`PRE_BAKED_CARDS`)

A hardcoded list of 5 `GameCard` instances used when credentials (`GCP_PROJECT_ID` / `GEMINI_API_KEY`) are missing, or when an API request fails:

1. **Boss Coffee Shogun** (Fire / Plasma, Rare)
2. **Suica Ninja** (Lightning / Aether, Epic)
3. **Famichiki Phoenix** (Fire / Vapor, Rare)
4. **Mechanical Overlord** (Earth / Quartz, Epic)
5. **The Hackathon Judge** (Neutral / Aether, Legendary)

---

## 4. Helper Functions

### 4.1 `balance_stats(stats: CardStats, target_sum: int = 250) -> CardStats`

Enforces game design balancing rules on stat distribution.

#### Logic Workflow:
1. Clamps `health`, `attack`, and `speed` values between `20` and `160`.
2. Checks if `health + attack + speed == target_sum`. If equal, returns the stats unchanged.
3. If not equal, calculates a scaling `factor = target_sum / total` and rescales each attribute proportionally using `round()`.
4. Corrects rounding drift by applying residual difference (`target_sum - sum`) to `health`.
5. Clamps all values back into the range `[20, 160]`.
6. Executes an iterative adjustments loop (up to 100 iterations) adding or subtracting `1` to non-boundary attributes until `current_sum == target_sum`.
7. Returns a new `CardStats` instance.

### 4.2 `save_pcm_as_wav(filename: str, pcm_bytes: bytes, channels: int = 1, rate: int = 24000, sample_width: int = 2)`

Writes raw Linear PCM audio byte stream output into a valid `.wav` file structure using Python's standard `wave` module.

* Default Configuration: 1 channel (mono), 24,000 Hz sample rate, 16-bit depth (`sample_width = 2`).

---

## 5. Core Operational Functions

### 5.1 `transmute_image_to_card`

```python
async def transmute_image_to_card(
    image_bytes: bytes, 
    filename: str, 
    mime_type: str = "image/jpeg"
) -> GameCard
```

Converts raw captured image bytes into a fully initialized `GameCard`.

#### Pipeline Execution:

1. **Credential & Offline Check**:
   * Reads `GCP_PROJECT_ID`, `GCP_LOCATION` (defaults to `"asia-northeast1"`), and `GEMINI_API_KEY`.
   * If both `GCP_PROJECT_ID` and `GEMINI_API_KEY` are empty:
     * Selects a card from `PRE_BAKED_CARDS`.
     * Prefixes name with `"Local "`, assigns a randomized uniqueness score (`30-95`), adjusts rarity, and returns immediately.

2. **Client Initialization**:
   * If `GCP_PROJECT_ID` exists: Initializes `genai.Client(vertexai=True, project=project_id, location=location)`.
   * Else: Initializes `genai.Client(api_key=api_key)`.

3. **Gemini Vision Analysis & Card Generation**:
   * Calls `client.models.generate_content` with model `"gemini-2.5-flash"`.
   * Pass multi-modal payload: raw image bytes + prompt `"Transmute this object into an alchemical game card."`
   * Configuration: `response_mime_type="application/json"`, schema set to `GeminiGameCard`, `temperature=0.2`.
   * Instructs model via detailed `system_instruction` enforcing object translation mechanics, Japanese localized context rules, uniqueness ratings, sub-element mappings, and explicit Imagen prompts.
   * Validates response via `GeminiGameCard.model_validate_json()`.

4. **Stat Balancing**:
   * Passes the raw parsed stats to `balance_stats(stats, target_sum=250)`.

5. **Imagen 3 Artwork Generation**:
   * If `card.imagen_prompt` exists, calls `client.models.generate_images` using model `'imagen-3.0-generate-002'`.
   * Configured for `1` image, `1:1` aspect ratio.
   * Saves generated artwork file to `./uploads/art_<filename_stem>.jpg`.
   * Updates `card.image_art_url` to `/uploads/art_<filename_stem>.jpg`.
   * If image generation fails, catches exception and logs error without failing card creation.

6. **Voice Line Audio Synthesis**:
   * Constructs a voice line prompt based on `card_name`, `element`, and `lore` (max 6 words).
   * Voice Selection Logic:
     * `Fire` $\rightarrow$ `"Fenrir"`
     * `Water` $\rightarrow$ `"Kore"`
     * `Lightning` $\rightarrow$ `"Puck"`
     * `Earth` $\rightarrow$ `"Aoede"`
     * Default/Neutral $\rightarrow$ `"Charon"`
   * Instantiates standard `GEMINI_API_KEY` client if available to bypass Vertex AI allowlist restrictions.
   * Invokes `client.models.generate_content` on `"gemini-2.5-flash"` with `response_modalities=["AUDIO"]` and `speech_config`.
   * Decodes PCM payload (handling optional Base64 encoding), writes file to `./uploads/voice_<filename_stem>.wav` via `save_pcm_as_wav()`.
   * Assigns `card.audio_url = "/uploads/voice_<filename_stem>.wav"`.
   * If audio generation fails, catches exception and logs error without failing card creation.

7. **Error Fallback**:
   * Catches `APIError` or general exceptions, logs the event, and returns a copied standard pre-baked fallback card.

---

### 5.2 `fuse_cards`

```python
async def fuse_cards(
    card1: GameCard, 
    card2: GameCard, 
    filename_seed: str
) -> GameCard
```

Synthesizes two parent cards (`card1`, `card2`) into a high-powered hybrid card.

#### Pipeline Execution:

1. **Credential & Offline Check**:
   * If credentials are missing, constructs a local mock card:
     * Sums attributes, applies `balance_stats(target_sum=270)`.
     * Blends names, selects element, calculates average uniqueness score + 10, sets rarity to `"Epic"`.

2. **Gemini Fusion Reasoning**:
   * Calls `"gemini-2.5-flash"` model via `client.models.generate_content`.
   * Provides details of both parent cards (Names, Elements, Stats, Abilities, Lore) within the `system_instruction`.
   * Strict constraints in system instruction:
     * Stat target sum: Exactly **270** points.
     * Ability magnitude value: **15 to 60**.
     * Rarity: Always **Epic** or **Legendary**.
     * Element fusion logic rules (e.g., Neutral + anything = Aether, Fire + Lightning = Plasma, Fire + Water = Vapor, Water + Earth = Frost, Earth + Lightning = Quartz).
     * Output format restricted to `GeminiGameCard` JSON schema (`temperature=0.4`).

3. **Stat Enforcement**:
   * Applies `balance_stats(fused_card.base_stats, target_sum=270)`.
   * Inherits image thumbnail from `card1.image_url` or `card2.image_url`.

4. **Imagen 3 Artwork Generation**:
   * Prompts `'imagen-3.0-generate-002'` with fused art prompt.
   * Writes output image to `./uploads/fuse_<filename_seed>.jpg`.
   * Sets `fused_card.image_art_url`. Fallback inherits primary art URL from source cards upon error.

5. **Fused Audio Voice Line Generation**:
   * Generates hybrid battle cry (max 6 words) referencing original components.
   * Maps voice using the elemental lookup table.
   * Saves output to `./uploads/voice_fuse_<filename_seed>.wav` and updates `fused_card.audio_url`.

6. **Error Fallback**:
   * Catches exceptions, logs warning, and constructs manual fallback hybrid card balancing stats to 270.

---

## 6. Directory and Asset Dependencies

* **Uploads Folder**: Output media files (generated JPG artworks and WAV audio recordings) are stored in the local `./uploads` directory relative to `transmute.py`.
* **Environment Variables**:
  * `GCP_PROJECT_ID`: Vertex AI Project ID.
  * `GCP_LOCATION`: Vertex AI region (Defaults to `asia-northeast1`).
  * `GEMINI_API_KEY`: Google GenAI Developer API Key.