Based strictly on the provided context, here is the generated `QUICKSTART.md` file.

---

# Quickstart Guide

## Overview & Tech Stack

Based on the repository snippets, the project utilizes the following setup:
* **Frontend:** Vite with React (`@vitejs/plugin-react`) and Tailwind CSS (`@tailwindcss/vite`).
* **Mobile Platform:** Capacitor (`com.getcapacitor.app`).
* **Backend / Agents:** Python-based services supporting Gemini-powered Managed Battle Agents (default base agent: `antigravity-preview-05-2026`).

---

## Configuration Files

### Frontend Configuration (`vite.config.js` / `vite.config.ts`)
Ensure your Vite setup includes React and Tailwind CSS plugins:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
})
```

---

## Agent Setup Details

* **Default Base Agent:** `antigravity-preview-05-2026`
* **Agent Creation Function:** Managed agents are retrieved or created via `get_or_create_agent(client, agent_id, system_instruction, base_agent)`. If creation fails, the system falls back to direct prompt interaction.

---

## API Endpoints

The backend provides the following HTTP endpoints for battle sessions:

### 1. Create Battle Session
* **Endpoint:** `POST /api/battle/create`
* **Payload Examples:**
  * Standard session:
    ```json
    {
      "client_id": "local_user",
      "card_name": "<CARD_NAME>",
      "is_pvp": false
    }
    ```
  * Custom opponent session:
    ```json
    {
      "client_id": "local_user",
      "card_name": "<CARD_NAME>",
      "is_pvp": false,
      "opponent_card": {
        "card_name": "Dark Alchemist",
        "element": "Fire",
        "base_stats": {
          "health": 120,
          "attack": 60,
          "speed": 70
        },
        "ability_name": "Pyro Blast",
        "effect_type": "damage",
        "value": 30,
        "lore": "A dark shadow opponent."
      }
    }
    ```

### 2. Trigger Agent Play Turn
* **Endpoint:** `POST /api/battle/agent_play`
* **Payload Example:**
  ```json
  {
    "client_id": "local_user",
    "lobby_id": "<LOBBY_ID>"
  }
  ```

---

## Missing Information

> **Note:** The provided code snippets do not explicitly specify:
> * Environment variables (e.g., API keys, port numbers, database URLs).
> * Command-line installation steps (e.g., `npm install`, `pip install`).
> * Command-line commands to start the frontend or backend servers.
> * Specific framework dependencies (e.g., FastAPI, Flask, pytest) or package manager requirements beyond what is listed in the Vite configuration and tests.