# Technical Documentation: `frontend/src/lib/haptics.js`

## Overview

The `frontend/src/lib/haptics.js` module provides a set of utility functions for triggering haptic (vibration) feedback on supported user devices using the browser's native [Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API) (`navigator.vibrate`). 

It abstracts feature detection and error handling to safely execute vibration feedback without throwing unhandled exceptions if the environment or browser does not support vibration features.

---

## Key Components & Functions

### 1. `haptic(ms)`
The core function that handles the interaction with the Web Vibration API.

* **Parameters:**
  * `ms` (Number | Array of Numbers, optional): The vibration duration in milliseconds or a vibration pattern array. Defaults to `30`.
* **Behavior:**
  1. Wraps the call inside a `try...catch` block to suppress any runtime errors.
  2. Checks if `navigator.vibrate` is defined in the current browser/device environment.
  3. Executes `navigator.vibrate(ms)` if supported.
  4. Silently ignores any errors thrown (e.g., security restrictions or unsupported hardware).

```javascript
export const haptic = (ms = 30) => {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch { /* ignore */ }
};
```

---

### 2. Presets / Wrapper Functions

The file exports four helper functions representing standard haptic feedback patterns for different interaction types:

#### `hapticLight()`
* **Parameters:** None
* **Pattern:** Single pulse for `20ms` (`haptic(20)`).
* **Purpose:** Provides subtle, brief haptic feedback.

#### `hapticMedium()`
* **Parameters:** None
* **Pattern:** Single pulse for `50ms` (`haptic(50)`).
* **Purpose:** Provides moderate haptic feedback.

#### `hapticHeavy()`
* **Parameters:** None
* **Pattern:** Vibration pattern sequence `[60, 30, 60]` (`haptic([60, 30, 60])`).
  * 60ms vibration
  * 30ms pause
  * 60ms vibration
* **Purpose:** Provides strong or emphasized haptic feedback.

#### `hapticSuccess()`
* **Parameters:** None
* **Pattern:** Vibration pattern sequence `[30, 20, 60]` (`haptic([30, 20, 60])`).
  * 30ms vibration
  * 20ms pause
  * 60ms vibration
* **Purpose:** Provides a distinct pattern intended for indicating successful actions or state changes.

---

## Technical Details

### Array Patterns in `navigator.vibrate`
When an array of numbers is passed to `navigator.vibrate`, the browser interprets alternating values as duration of vibration and duration of pause:
* **Index 0, 2, 4...**: Duration to vibrate (ms).
* **Index 1, 3, 5...**: Duration to pause (ms).

### Resilience & Safe Degradation
* **Feature Detection:** `if (navigator.vibrate)` ensures `navigator.vibrate` is called only when available on the global `navigator` object.
* **Error Catching:** Browser security policies (e.g., requiring user interaction before vibrating) or unsupported device contexts can throw DOMExceptions. The empty `catch` block ensures these exceptions are suppressed and do not break the executing script.

---

## Usage Examples

```javascript
import { 
  haptic, 
  hapticLight, 
  hapticMedium, 
  hapticHeavy, 
  hapticSuccess 
} from './lib/haptics.js';

// Trigger default 30ms haptic pulse
haptic();

// Trigger a custom 100ms vibration
haptic(100);

// Trigger preset haptics
hapticLight();    // 20ms
hapticMedium();   // 50ms
hapticHeavy();    // Pattern: 60ms on, 30ms off, 60ms on
hapticSuccess();  // Pattern: 30ms on, 20ms off, 60ms on
```