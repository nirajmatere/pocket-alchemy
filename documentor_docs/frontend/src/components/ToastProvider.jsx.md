# Technical Documentation: `ToastProvider.jsx`

The `ToastProvider.jsx` module provides a React Context-based toast notification system. It manages state for temporary pop-up notifications (toasts), handles auto-dismissal, applies theme-specific styles, and exposes a custom hook (`useToast`) for triggering notifications anywhere within the component tree.

---

## Architecture Overview

```
                          +-------------------+
                          |   ToastProvider   |
                          | (Context Provider)|
                          +---------+---------+
                                    |
          +-------------------------+-------------------------+
          |                                                   |
  {children} Elements                                   Toast UI Overlay
(Can consume notifications                              (Fixed top-center
  via `useToast()` hook)                                flex container)
```

---

## Exported API

### 1. `ToastProvider`
A React component that wraps your application or sub-tree to provide toast notification context and render the notification overlay stack.

* **Props:**
  * `children` (`ReactNode`): The child components that will have access to the toast context.

### 2. `useToast()`
A custom React hook used by child components to trigger notifications.

* **Returns:** `toast` function (see API details below).
* **Throws:** An `Error` with the message `"useToast must be used inside ToastProvider"` if invoked outside a `<ToastProvider>`.

---

## Trigger Function API: `toast(options)`

When calling `useToast()`, the returned function accepts an options object with the following parameters:

```javascript
toast({
  type = 'info',     // Optional: 'success' | 'error' | 'info' | 'warn' (Default: 'info')
  title,             // Optional: String heading for the toast
  message,           // Optional: String detail body text
  duration = 3500    // Optional: Auto-dismiss delay in milliseconds (Default: 3500)
});
```

* **Return Value:** Returns a string representing the unique `id` generated for the toast instance.

---

## Internal Configuration & Constants

### `TYPE_STYLES`
A style definition object mapping each toast type (`success`, `error`, `info`, `warn`) to specific visual attributes:

| Type | Icon | Border Class | Text Color Class | Glow Class (`shadow-[...]`) |
| :--- | :--- | :--- | :--- | :--- |
| **`success`** | `✅` | `border-cyber-green/40` | `text-cyber-green` | `shadow-[0_0_15px_rgba(57,255,20,0.25)]` |
| **`error`** | `⚠️` | `border-red-500/40` | `text-red-400` | `shadow-[0_0_15px_rgba(239,68,68,0.25)]` |
| **`info`** | `🔮` | `border-cyber-blue/40` | `text-cyber-blue` | `shadow-[0_0_15px_rgba(0,240,255,0.2)]` |
| **`warn`** | `⚡` | `border-cyber-yellow/40` | `text-cyber-yellow` | `shadow-[0_0_15px_rgba(255,251,0,0.2)]` |

---

## Lifecycle & State Management

### 1. Toast State Schema
Toasts are stored in an array using the `toasts` state variable. Each toast object follows this structure:

```javascript
{
  id: string,       // Random base-36 string identifier
  type: string,     // Notification type
  title?: string,   // Optional title text
  message?: string, // Optional body text
  exiting: boolean  // Set to true during exit animation
}
```

### 2. Queue Control (Max Visible Limit)
When a new toast is created using `toast()`, the system limits the queue size by preserving only the last 4 existing toasts (`prev.slice(-4)`) before appending the new toast. This ensures a maximum of 5 toasts are present at the time a new one is added.

### 3. Dismissal and Animation Sequence
1. **Trigger:** Dismissal occurs automatically after `duration` ms via `setTimeout` or manually when the user clicks the close button (`✕`).
2. **Exit State:** Calling `dismiss(id)` updates the specific toast's state to `{ exiting: true }`. This replaces the `animate-toast-in` CSS class with `animate-toast-out`.
3. **Removal:** A `setTimeout` of `260ms` is scheduled during `dismiss(id)` to allow the exit animation to complete before removing the toast item from the `toasts` state array.

---

## UI Layout & CSS Structure

* **Overlay Container:**
  * Fixed positioning at `top-4`, horizontally centered (`left-1/2 -translate-x-1/2`).
  * High z-index (`z-[200]`).
  * Width: Responsive `w-[min(90vw,380px)]`.
  * Pointer Events: Container uses `pointer-events-none` so unhovered backdrop space stays click-throughable, while toast items re-enable `pointer-events-auto`.
* **Toast Card:**
  * Uses classes: `cyber-glass`, `border`, `rounded-xl`, `px-4`, `py-3`, `font-mono`, and dynamic type-based border/glow classes.
  * Conditional animation classes: `animate-toast-in` (when `exiting` is `false`) or `animate-toast-out` (when `exiting` is `true`).

---

## Usage Example

```jsx
import { ToastProvider, useToast } from './ToastProvider';

// 1. Wrap Provider
export default function App() {
  return (
    <ToastProvider>
      <MyComponent />
    </ToastProvider>
  );
}

// 2. Consume Hook in Child Component
function MyComponent() {
  const toast = useToast();

  const handleAction = () => {
    toast({
      type: 'success',
      title: 'Action Completed',
      message: 'Operation executed successfully.',
      duration: 4000
    });
  };

  return <button onClick={handleAction}>Trigger Toast</button>;
}
```