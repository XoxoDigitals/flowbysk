# Google Flow Web Studio

A creative, web-based studio application modeled after **Google Flow** (`flow.google.com` / Google Labs) that interacts directly with the **Google Flow API using session cookies**.

Powered by **Veo 3.1** (for cinematic video generation with native audio and camera choreography) and **Imagen 4 / Nano Banana 2** (for photorealistic image generation).

---

## ✨ Features

- **Generative Video Studio (Veo 3.1 & Veo 2)**:
  - Text-to-Video generation with customizable aspect ratios (`16:9`, `9:16`, `1:1`).
  - Duration picker (`5s`, `8s`) and custom seed control.
  - Video extension and continuation support.
- **Generative Image Studio (Imagen 4 / Nano Banana 2 & Gem Pix 2)**:
  - High-fidelity text-to-image synthesis.
  - Multiple aspect ratios (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`).
  - Multi-image output batches (1 to 4 images).
- **AI Prompt Enhancer (Creative Director)**:
  - Expands brief concepts using Google Flow's 5-component prompt formulation: `[Subject] + [Setting] + [Lighting] + [Camera Motion] + [Style/Texture]`.
- **Cookie Authentication & Session Center**:
  - Live status indicator showing the connected Google Account email and token expiration countdown.
  - One-click sync with local saved credentials (`~/.gflow/env`).
  - Raw cookie input supporting standard cookie headers, JSON arrays (Cookie-Editor extension), and Netscape formats.
  - Interactive Chrome sign-in launcher.
- **Visual Storyboard & Timeline**:
  - Sequence generated scenes chronologically.
  - Seamless clip inspection and timeline manifest export.
- **Asset Gallery & Media Inspector**:
  - Filterable asset library (All, Videos, Images).
  - Hover playback, fullscreen lightbox viewer, and direct MP4/PNG downloads.
- **Simulation / Demo Mode**:
  - Built-in sandbox mode allowing full testing of the creative interface without burning real generation credits.

---

## 🚀 Quick Start

### 1. Launch the Studio

Run the launcher script from the workspace directory:

```bash
python run.py
```

This starts the FastAPI backend server on `http://127.0.0.1:8000` and automatically opens the studio in your browser.

---

## 🔑 Connecting Google Flow Cookies

You have two convenient ways to connect your cookies:

### Option A: Using the included Chrome Extension (Recommended · 1-Click Sync)
1. In Chrome, go to `chrome://extensions` and enable **Developer mode** (top right).
2. Click **Load unpacked** and select the `extension` folder:
   ```text
   c:\Users\Saboo\Desktop\Google Flow\extension
   ```
3. Open [flow.google.com](https://flow.google.com), click the **Google Flow Session Sync** extension icon, and hit **"⚡ Sync to Local Studio (1-Click)"**!

### Option B: Manual Copy & Paste
1. In your browser, log in to **[labs.google/fx/tools/flow](https://labs.google/fx/tools/flow)** or **[flow.google.com](https://flow.google.com)**.
2. Open Developer Tools (<kbd>F12</kbd> > **Application** > **Cookies** > `https://labs.google`).
3. Copy the cookie string (or use the extension's **"Copy Formatted Cookies"** button).
4. In the Web Studio, click the **Account Chip** at the top right > paste your cookies > click **Save & Test Connection**.

> **Note**: If you already logged in previously using the `gflow` CLI on this machine, simply click **"Sync from Local (~/.gflow/env)"** in the modal for instant 1-click authentication!

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Google Flow Web Studio                      │
│     (Frontend: HTML5, Modern Vanilla CSS, Vanilla JS)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST API
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend Server                   │
│                    (backend/app.py)                         │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│  Google Flow Cloud Services  │ │     Flow Service Bridge     │
│  - labs.google/fx/api        │ │  (backend/flow_service.py)  │
│  - aisandbox-pa.googleapis   │ │  - Session token refresh    │
└──────────────────────────────┘ │  - Local history storage    │
                                 │  - Simulation mode engine   │
                                 └─────────────────────────────┘
```

---

## 📂 Project Structure

```
Google Flow/
├── backend/
│   ├── app.py              # FastAPI REST endpoints & static file hosting
│   └── flow_service.py     # Google Flow API client, cookie validator, & history
├── frontend/
│   ├── index.html          # Web Studio UI layout & components
│   ├── style.css           # Modern dark design system & responsive layout
│   └── app.js              # Client logic, generation polling, & media controls
├── data/
│   ├── history.json        # Persisted generation records
│   └── settings.json       # Persisted cookies & simulation settings
├── run.py                  # Single-command launcher script
└── README.md               # Documentation
```
