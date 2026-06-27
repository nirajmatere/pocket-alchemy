# 🔮 Pocket Alchemy: Developer & Setup Guide

A complete, step-by-step walkthrough to start the backend and frontend services, stop them, and access the game on a mobile device over the same Wi-Fi network.

---

## 📋 Table of Contents
1. [Prerequisites](#-prerequisites)
2. [Step 1: Start the Backend Service](#-step-1-start-the-backend-service)
3. [Step 2: Start the Frontend Service](#-step-2-start-the-frontend-service)
4. [Step 3: Finding Your Computer's Local IP](#-step-3-finding-your-computers-local-ip)
5. [Step 4: Accessing on Mobile (Same Wi-Fi)](#-step-4-accessing-on-mobile-same-wi-fi)
6. [Step 5: Stopping the Services](#-step-5-stopping-the-services)
7. [Debugging & Troubleshooting](#%EF%B8%8F-debugging--troubleshooting)

---

## 🛠️ Prerequisites
Before starting, ensure that:
1. Both your computer and your mobile device are connected to the **exact same Wi-Fi network**.
2. Node.js (v22+) and Python (v3.12+) are installed. If not, you can run the bootstrap script from the root:
   ```bash
   bash scripts/bootstrap.sh
   ```
3. A Gemini API key is configured in `backend/.env`. Check that it contains:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

---

## 🚀 Step 1: Start the Backend Service
The backend is a FastAPI application that handles card transmutation, inventory management, and real-time battle WebSocket connections.

1. Navigate to the project root directory.
2. Run the FastAPI application using `uvicorn` and bind it to all network interfaces (`0.0.0.0`) so that other devices on the Wi-Fi network can connect:
   ```bash
   uvicorn backend.main:app --host 0.0.0.0 --port 8000
   ```
   *(Alternatively, if uvicorn is not in your global path: `python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`)*
3. Verify the backend is running by visiting:
   `http://localhost:8000/api/health`

---

## 💻 Step 2: Start the Frontend Service
The frontend is built with React, Vite, and Tailwind CSS. By default, Vite only listens on `localhost`. To expose it to your local Wi-Fi network, you must start it with the `--host` flag.

1. Open a new terminal window/tab.
2. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
3. Install dependencies (if you haven't already):
   ```bash
   npm install
   ```
4. Start the Vite development server with the host exposure flag:
   ```bash
   npm run dev -- --host
   ```
   *(Alternatively: `npx vite --host`)*
5. The terminal will output two URLs:
   - **Local:** `http://localhost:5173/`
   - **Network:** `http://<YOUR_COMPUTER_IP>:5173/` (e.g., `http://192.168.1.15:5173/`)

---

## 🔍 Step 3: Finding Your Computer's Local IP
To connect your mobile device, you need to know your computer's local IP address on the Wi-Fi network.

### 🐧 Linux
Run the following command:
```bash
hostname -I | awk '{print $1}'
```
*Or:*
```bash
ip route show | grep default | awk '{print $9}'
```

### 🍏 macOS
1. Hold `Option` and click the **Wi-Fi icon** in the menu bar.
2. Find the IP Address listed under your current Wi-Fi network (typically starts with `192.168.` or `10.`).
*Or run in Terminal:*
```bash
ipconfig getifaddr en0
```

### 🪟 Windows
1. Open Command Prompt (`cmd`).
2. Run:
   ```cmd
   ipconfig
   ```
3. Look for **Wireless LAN adapter Wi-Fi** and find the **IPv4 Address** (e.g., `192.168.1.15`).

---

## 📱 Step 4: Accessing on Mobile (Same Wi-Fi)

You can access the app on mobile using either the **Web Browser** (recommended for instant testing) or as a **Native Android App** using Capacitor.

### Method A: Mobile Web Browser (Recommended & Quickest)
1. Ensure your mobile device is on the **same Wi-Fi network** as your computer.
2. Open Chrome (Android) or Safari (iOS) on your mobile device.
3. Navigate to:
   `http://<YOUR_COMPUTER_IP>:5173` (replace `<YOUR_COMPUTER_IP>` with the IP found in Step 3).
4. **Camera Context Note:**
   > [!IMPORTANT]
   > Modern mobile browsers block raw camera stream access (`getUserMedia`) on non-HTTPS origins (which includes `http://192.168.x.x`). 
   > - You will see a **"Viewfinder Locked"** message. **This is normal and expected.**
   > - Simply tap the **"Activate Mobile Camera"** button. This leverages the designed fallback input (`capture="environment"`), which opens your device's native camera or file gallery to let you snap photos and forge cards flawlessly!

---

### Method B: Capacitor Native Android App
If you want to compile and run the native Android wrapper:
1. Open `frontend/src/App.jsx` in your code editor.
2. Find the `HOST_IP` constant at the top of the file:
   ```javascript
   // line 3
   const HOST_IP = '10.234.56.215'; // Change this to your computer's actual local IP address!
   ```
   Update it to your computer's local IP (e.g., `192.168.1.15`).
3. In your terminal, navigate to the `frontend` directory and rebuild/sync the application:
   ```bash
   cd frontend
   npm run build
   npx cap sync
   ```
4. Run the app on a connected physical Android device or emulator:
   ```bash
   npx cap run android
   ```
   *Or open in Android Studio to build and debug:*
   ```bash
   npx cap open android
   ```

---

## 🛑 Step 5: Stopping the Services
To safely stop the services:

1. **Stop the Frontend:**
   Go to the terminal running the frontend Vite server and press `Ctrl + C`.
2. **Stop the Backend:**
   Go to the terminal running the FastAPI backend and press `Ctrl + C`.

---

## 🛠️ Debugging & Troubleshooting

### ❌ Cannot access the URL on my mobile device
* **Double-check Wi-Fi:** Ensure both devices are on the exact same SSID (e.g., if one is on a guest network or 5G cellular, they cannot communicate).
* **Check firewall settings:** Your host machine's firewall might be blocking incoming connections on ports `5173` and `8000`.
  - **Linux (ufw):** `sudo ufw allow 5173/tcp` and `sudo ufw allow 8000/tcp`
  - **macOS:** Check *System Settings > Network > Firewall* and ensure it is not blocking incoming connections.
  - **Windows:** Allow Node.js and Python through Windows Defender Firewall.

### ❌ Backend shows Offline on the mobile screen
* Make sure your backend was launched with the `--host 0.0.0.0` flag. Running with just `uvicorn backend.main:app` defaults to `127.0.0.1`, which blocks local network access.

### ❌ Card transmutation fails / Gemini API errors
* Check if `GEMINI_API_KEY` is set correctly in `backend/.env`.
* If you do not have a Gemini API key or are offline, the system will fall back to local card mocks so the battle logic can still be fully demoed.
