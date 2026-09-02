# Technical Documentation: `frontend/vite.config.js`

## Overview

The `frontend/vite.config.js` file serves as the main configuration file for Vite in the frontend application. It defines the plugins and settings required to build and serve the project using Vite, integrating support for **React** and **Tailwind CSS**.

---

## File Path
`frontend/vite.config.js`

---

## Key Components & Imports

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
```

### 1. `defineConfig` (from `'vite'`)
* **Purpose:** A helper utility provided by Vite to wrap the configuration object.
* **Function:** Enables auto-completion and type checking in supported IDEs without requiring explicit JSDoc annotations or TypeScript.

### 2. `react` (from `'@vitejs/plugin-react'`)
* **Purpose:** The official Vite plugin for React.
* **Function:** Handles JSX/TSX transformations and enables React Fast Refresh during development.

### 3. `tailwindcss` (from `'@tailwindcss/vite'`)
* **Purpose:** The official Vite plugin for Tailwind CSS.
* **Function:** Integrates Tailwind CSS directly into the Vite build pipeline for processing utility classes and styles.

---

## Configuration Breakdown

```javascript
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
})
```

* **`export default`**: Exports the configuration object as the default export so Vite can automatically load and apply it at runtime.
* **`plugins`**: An array that registers the plugins Vite will use during development and build processes:
  * `react()`: Activates React-specific compilation and development tools.
  * `tailwindcss()`: Activates Tailwind CSS processing.

---

## How It Works

1. **Initialization:** When Vite starts (either via a development server or a production build), it looks for `vite.config.js` at the root of the frontend directory.
2. **Configuration Loading:** Vite executes `defineConfig(...)` and receives the configuration object.
3. **Plugin Execution:** Vite registers the array of plugins in the specified order:
   * **React Plugin (`react()`):** Transforms React code/JSX and enables hot module replacement (HMR).
   * **Tailwind CSS Plugin (`tailwindcss()`):** Processes CSS files that import or use Tailwind directives within the application.