# Technical Documentation: `BottomNav.jsx`

**File Path:** `frontend/src/components/BottomNav.jsx`

---

## Overview

The `BottomNav` component provides a fixed bottom navigation bar designed specifically for mobile screens (`md:hidden`). It renders a set of primary application navigation tabs defined in the `NAV_ITEMS` constant, along with a dedicated settings button. The component handles tactile user feedback via a haptic library and applies dynamic visual states (accent colors, glow effects, indicator lines, and animations) based on the currently active view.

---

## Dependencies & Imports

* **`hapticLight`** (from `../lib/haptics.js`): A utility function triggered on button click to provide light haptic feedback on supported devices.

---

## Exported Constants

### `NAV_ITEMS`

An array of configuration objects defining each navigation tab item in the navigation bar.

```javascript
export const NAV_ITEMS = [
  { view: 'transmute',    label: 'TRANSMUTE',   short: 'Forge',   icon: '⚗️',  accent: '#9d4edd' },
  { view: 'inventory',   label: 'ALCHEMY VAULT',short: 'Vault',   icon: '🎒',  accent: '#00f0ff' },
  { view: 'leaderboard', label: 'LEADERBOARD',  short: 'Ranks',   icon: '🏆',  accent: '#39ff14' },
  { view: 'badges',      label: 'BADGES VAULT', short: 'Badges',  icon: '🎖️', accent: '#ff007f' },
  { view: 'feed',        label: "TODAY'S FEED", short: 'Feed',    icon: '🔥',  accent: '#fffb00' },
  { view: 'lobby_select',label: 'PVP ROOMS',    short: 'PvP',     icon: '⚔️',  accent: '#00f0ff' },
  { view: 'advisor',     label: 'ALCH. SAGE',   short: 'Sage',    icon: '🧙',  accent: '#9d4edd' },
];
```

#### Object Properties
* **`view`**: `string` - Unique identifier for the target view or route.
* **`label`**: `string` - Full text description of the view.
* **`short`**: `string` - Short label displayed directly beneath the icon in the navigation bar.
* **`icon`**: `string` - Emoji character representing the view visually.
* **`accent`**: `string` - Hex color code used to highlight active state elements (icon color, text color, and indicator line box-shadow).

---

## Component Interface (Props)

### `BottomNav({ activeView, onNavigate, onSettings, disabled })`

| Prop | Type | Description |
| :--- | :--- | :--- |
| `activeView` | `string` | Represents the key of the view currently being displayed. Used to compute active state styles. |
| `onNavigate` | `function` | Callback function invoked when a navigation item is clicked. Receives `item.view` as an argument. |
| `onSettings` | `function` | Callback function invoked when the settings/config button is clicked. |
| `disabled` | `boolean` | When `true`, disables interaction on navigation tab buttons. |

---

## Structure & Layout Details

### Outer Container
* Rendered as an HTML `<nav>` element fixed to the bottom of the viewport (`fixed bottom-0 inset-x-0 z-40`).
* Visible only on small screens (`md:hidden`).
* Dark background styling with translucency and blur (`bg-[#08090d]/95 backdrop-blur-xl`).
* Includes a subtle top border (`border-t border-white/10`).
* Uses CSS `env(safe-area-inset-bottom)` via inline styles to ensure proper padding on mobile devices with hardware safe areas (e.g., modern smartphone home indicator bars).

### Inner Layout
* A flex container (`flex items-stretch`) housing all `NAV_ITEMS` buttons followed by a static Settings button.

---

## Element Behavior & Interaction Logic

### Navigation Items
Each item in `NAV_ITEMS` renders as a `<button>`:
* **Disabled State**: Controlled by the `disabled` prop. Sets opacity to 30% (`disabled:opacity-30`).
* **Click Handling**:
  1. Calls `hapticLight()` to trigger haptic feedback.
  2. Calls `onNavigate(item.view)` to request a view change.
* **Active State vs. Inactive State Styling**:
  * **Active (`activeView === item.view`)**:
    * Text color set to `item.accent` via inline styles.
    * Full opacity (`opacity-100`).
    * Icon gets keyframe animation classes: `animate-tab-pop animate-nav-glow`.
    * Label text weight increases (`font-extrabold`).
    * Renders an absolute-positioned bottom indicator bar (`h-0.5 rounded-t`) colored with `item.accent` and a glow effect using `boxShadow: 0 0 8px ${item.accent}`.
  * **Inactive (`activeView !== item.view`)**:
    * Text color defaults to slate-400 (`#94a3b8`).
    * Reduced opacity with hover transition (`opacity-50 hover:opacity-75`).
    * No bottom indicator line or active animations.

### Settings Button
Positioned at the end of the navigation list:
* Rendered with icon `⚙️` and short label `Config`.
* Fixed default text color `#94a3b8` with opacity transition (`opacity-50 hover:opacity-75`).
* **Click Handling**:
  1. Calls `hapticLight()`.
  2. Calls `onSettings()`.