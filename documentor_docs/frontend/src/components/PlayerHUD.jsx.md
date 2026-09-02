# Technical Documentation: `PlayerHUD.jsx`

**File Path:** `frontend/src/components/PlayerHUD.jsx`

## Overview

The `PlayerHUD` component renders a Heads-Up Display (HUD) displaying player profile information, including player rank, stage progression, and currencies (`aether_dust` and `catalysts`). It supports both standard and compact render layouts.

---

## Dependencies

* **`AnimatedNumber`** (`./AnimatedNumber.jsx`): Used to render smooth numerical animations when rendering currency values (`aether_dust`, `catalysts`) and stage progression.

---

## Constants & Data Structures

### `RANKS`
An array of objects that defines player rank tiers based on campaign stage progression.

| Field | Type | Description |
| :--- | :--- | :--- |
| `minStage` | `number` | Minimum stage required for this rank tier. |
| `maxStage` | `number` | Maximum stage applicable for this rank tier. |
| `title` | `string` | Display name of the rank. |
| `badge` | `string` | Emoji icon representing the rank badge. |
| `color` | `string` | Tailwind CSS text color class associated with the rank. |
| `bar` | `string` | Tailwind CSS background color class for progress bars. |

#### Rank Tiers Configuration
1. **Acolyte**: Stages 1–2 (`🪨`, `text-slate-400`, `bg-slate-400`)
2. **Apprentice**: Stages 3–5 (`🔮`, `text-cyber-purple`, `bg-cyber-purple`)
3. **Alchemist**: Stages 6–9 (`⚗️`, `text-cyber-blue`, `bg-cyber-blue`)
4. **Forge Master**: Stages 10–14 (`🛡️`, `text-cyber-green`, `bg-cyber-green`)
5. **Grand Sage**: Stages 15–99 (`👑`, `text-cyber-yellow`, `bg-cyber-yellow`)

---

## Helper Functions

### `getRank(stage)`
Determines the player's rank object based on their current stage.

* **Parameters:** `stage` (`number`)
* **Returns:** Rank object matching `minStage <= stage <= maxStage`. If no rank matches, defaults to `RANKS[0]` (Acolyte).

### `getXpProgress(stage)`
Calculates the player's percentage progress within their current rank tier.

* **Parameters:** `stage` (`number`)
* **Logic:**
  1. Retrieves the rank object for the given stage via `getRank(stage)`.
  2. Calculates the stage span: `span = rank.maxStage - rank.minStage + 1`.
  3. Calculates stage progress within the rank: `progress = stage - rank.minStage`.
  4. Returns `100` if `span <= 1`; otherwise, returns `Math.round((progress / span) * 100)`.
* **Returns:** `number` (percentage rounded to the nearest integer).

---

## Component API: `PlayerHUD`

### Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `profile` | `object` \| `null` | *Required* | Player profile data object. If falsy, component renders `null`. |
| `compact` | `boolean` | `false` | Toggles between compact view (`true`) and standard detailed view (`false`). |

#### Profile Object Structure
The `profile` prop expects the following keys:
* `unlocked_campaign_stage` (`number`): The highest campaign stage unlocked by the player (defaults to `1` if undefined).
* `aether_dust` (`number`): Quantity of Aether Dust currency.
* `catalysts` (`number`): Quantity of Catalysts currency.

---

## Rendering Modes

### 1. Null Guard
If `profile` is undefined or `null`, the component returns `null` and renders nothing.

### 2. Compact View (`compact = true`)
A minimalist layout designed for tight spaces (e.g., headers or narrow navigation bars).

* **Structure:**
  * **Badge Icon:** Displayed using `rank.badge` with `rank.color`.
  * **Title & Currencies Column:**
    * Upper line: Rank title in uppercase (`rank.title`).
    * Lower line: Compact currency indicators using `<AnimatedNumber />` for `aether_dust` (✨) and `catalysts` (🧪).
  * **Progress Bar:** A small 48px width (`w-12`), 4px height (`h-1`) bar displaying progression percentage with CSS transition duration of 700ms.

### 3. Standard View (`compact = false`)
A full display container with a dark background (`bg-slate-950/80`) and rounded borders (`rounded-xl`).

* **Structure:**
  * **Rank Badge Column (Left):** Displays large badge emoji (`text-xl`) and uppercase rank title.
  * **XP & Currency Details (Right):**
    * **Stage & XP Bar Row:** Shows label "Stage", current stage number, a progress bar container filled to `${xp}%` with glow shadow effects (`shadow-[0_0_6px_currentColor]`), and numeric percentage (`xp%`).
    * **Currency Row:** Displays three metric indicators with animated counters:
      1. ✨ `aether_dust` labeled "dust"
      2. 🧪 `catalysts` labeled "catalysts"
      3. 🏰 `stage` labeled "stage"