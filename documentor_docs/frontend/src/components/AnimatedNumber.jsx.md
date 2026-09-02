# Technical Documentation: `AnimatedNumber.jsx`

**File Path:** `frontend/src/components/AnimatedNumber.jsx`

## Overview

The `AnimatedNumber` component is a React functional component designed to render a number that smoothly interpolates (animates) whenever its target `value` prop changes. It uses JavaScript's `requestAnimationFrame` API with a cubic ease-out function for smooth visual counting and applies a temporary "pop" animation class whenever the value updates.

---

## Props

| Prop | Type | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `value` | `number` | *Required* | The target numeric value to be displayed and animated toward. |
| `className` | `string` | `''` | Optional CSS class name(s) to apply to the root `<span>` element. |

---

## Internal State & Hooks

### State Hooks

* **`display` (`number`)**: Holds the current rounded numeric value displayed in the UI during the animation sequence. Defaults to the initial `value`.
* **`popping` (`boolean`)**: Controls whether the pop animation CSS class (`animate-num-pop`) is active. Defaults to `false`.

### Ref Hooks

* **`prevRef` (`useRef`)**: Stores the previous `value` across renders to determine the starting point (`start`) for the next animation transition.
* **`rafRef` (`useRef`)**: Holds the active `requestAnimationFrame` ID, allowing running animation frame requests to be canceled when new value updates occur or when the component unmounts.

---

## Component Logic & Workflow

### Update Execution (`useEffect`)

The component relies on a single `useEffect` hook that triggers whenever the `value` prop changes:

1. **Change Detection:**
   * Reads `prevRef.current`. If the previous value equals the current `value`, the effect returns early without triggering an animation.
   * Updates `prevRef.current` to the new `value`.

2. **Animation Reset:**
   * Checks if an animation frame is already pending via `rafRef.current`. If present, cancels it using `cancelAnimationFrame(rafRef.current)`.

3. **Pop State Trigger:**
   * Sets `popping` state to `true`.
   * Sets a 400ms timer (`setTimeout`) to reset `popping` back to `false`.

4. **Frame Interpolation (`requestAnimationFrame`):**
   * Sets animation duration to `600` milliseconds.
   * Records the start time using `performance.now()`.
   * Defines a recursive `tick` callback:
     * Calculates `elapsed` time since start.
     * Calculates `progress` as a normalized ratio between `0` and `1` using `Math.min(elapsed / duration, 1)`.
     * Applies a cubic ease-out easing curve:
       $$\text{eased} = 1 - (1 - \text{progress})^3$$
     * Calculates the step value: `Math.round(start + (end - start) * eased)` and updates the `display` state.
     * If `progress < 1`, schedules the next frame via `requestAnimationFrame(tick)`.

5. **Cleanup:**
   * On component unmount or before re-running the effect, cancels any outstanding `requestAnimationFrame` instance using `cancelAnimationFrame`.

---

## Render Output

The component returns a single HTML `<span>` element containing the current `display` value:

```jsx
<span className={`${className} inline-block transition-colors ${popping ? 'animate-num-pop' : ''}`}>
  {display}
</span>
```

### CSS Classes Applied
* `${className}`: Any additional custom CSS classes passed via props.
* `inline-block`: Ensures inline-block layout positioning.
* `transition-colors`: Enables smooth transitions for color properties.
* `animate-num-pop`: Conditionally added when `popping` is `true` (active for 400ms following a value change).