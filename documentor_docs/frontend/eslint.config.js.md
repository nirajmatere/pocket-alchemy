# Technical Documentation: `frontend/eslint.config.js`

## Overview

The `frontend/eslint.config.js` file serves as the configuration file for **ESLint** using the flat configuration system. It defines linting rules, language options, target file extensions, and ignored directories for the JavaScript and React code in the `frontend` module.

---

## Imported Modules

The file imports the following dependencies:

*   **`js`** (`@eslint/js`): Provides standard, recommended JavaScript linting configurations (`js.configs.recommended`).
*   **`globals`** (`globals`): Provides predefined sets of global variables (specifically configured for browser environments).
*   **`reactHooks`** (`eslint-plugin-react-hooks`): Provides ESLint rules enforcing the Rules of React Hooks (`reactHooks.configs.flat.recommended`).
*   **`reactRefresh`** (`eslint-plugin-react-refresh`): Provides ESLint rules for supporting React Fast Refresh, using Vite-specific configurations (`reactRefresh.configs.vite`).
*   **`defineConfig`** (`eslint/config`): A helper function from ESLint used to wrap and define the flat configuration array.

---

## Configuration Structure

The configuration is exported as a default export using `defineConfig([...])`. It contains an array of two configuration objects:

### 1. Global Ignores Configuration
```javascript
{
  ignores: ['dist', 'node_modules', 'android']
}
```
*   **`ignores`**: Tells ESLint to exclude the following directories completely from linting operations:
    *   `dist`
    *   `node_modules`
    *   `android`

---

### 2. File-Specific Configuration (`js` and `jsx`)
```javascript
{
  files: ['**/*.{js,jsx}'],
  extends: [
    js.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
  ],
  languageOptions: {
    globals: globals.browser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}
```

#### Properties:
*   **`files`**: Applies this configuration block to all files ending in `.js` or `.jsx` across any directory level (`**/*.{js,jsx}`).
*   **`extends`**: Combines three pre-packaged rule configurations:
    1.  `js.configs.recommended`: Standard ESLint recommended rules for JavaScript.
    2.  `reactHooks.configs.flat.recommended`: Flat-config compatible recommended rules for React Hooks.
    3.  `reactRefresh.configs.vite`: Recommended rules for Vite-based React Refresh support.
*   **`languageOptions`**: Defines language parsing features and global variables.
    *   **`globals`**: Sets `globals.browser`, which registers standard browser global variables (such as `window`, `document`, etc.) so ESLint does not flag them as undefined variables.
    *   **`parserOptions`**: Includes `{ ecmaFeatures: { jsx: true } }`, enabling ESLint's parser to handle JSX syntax.

---

## How It Works

1.  **Directory Filtering**: ESLint evaluates the configuration top-down. Any file located within `dist`, `node_modules`, or `android` is ignored.
2.  **File Selection**: ESLint matches target files with `.js` or `.jsx` extensions.
3.  **Parsing Setup**: Target files are parsed with JSX syntax support enabled and browser globals pre-registered.
4.  **Rule Execution**: ESLint validates the code using the merged rule sets from standard JavaScript recommended practices, React Hooks best practices, and Vite React Refresh patterns.