# ULTRON AI

A cinematic, voice-enabled AI coding assistant for mobile browsers.
Milestone 1 build: original 3D robotic face, HUD interface, demo brain,
multi-provider settings, speech input/output.

> **Product name**: `ULTRON AI` is a temporary placeholder name kept in a single
> constant (`src/core/config.ts` → `APP_NAME`). Rename it there any time.

## Run it

Requires Node.js 18+ (built and tested with Node 24 on this device).

```bash
npm install        # first time only
npm run dev        # starts http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173** in your phone's browser (same device).

Production check:

```bash
npm run build      # typechecks (tsc) + bundles into dist/
npm run preview    # serves dist/ at http://127.0.0.1:4173
```

## What is real vs. demo (honesty notes)

- **3D robot face** — REAL: live Three.js render, 7 facial states, blinking,
  jaw articulation, drag-to-rotate. Original procedural design.
- **Waveform / gauges / globe** — REAL animated renderings (decorative telemetry
  numbers are simulated HUD flavour, exactly like the mockup).
- **Chat brain** — DEMO by default (scripted answers, clearly labelled
  `DEMO RESPONSE`). Selecting a provider in Settings makes REAL network calls:
  - Verified working from a browser: **OpenCode Zen** (free models, no key),
    **OpenRouter**, **Mistral AI**, **Google AI (Gemini)**, **Groq**.
  - **NVIDIA NIM**: server reachable but blocks direct browser calls (no CORS);
    needs the small backend proxy planned for Milestone 6.
- **Voice input** — REAL where the browser supports `SpeechRecognition`
  (Chrome on Android). Falls back to clear error text elsewhere.
- **Speech output** — REAL `SpeechSynthesis` with robotic-ish pitch; the jaw is
  driven by an energy pulse (boundary events + fallback timer), NOT phoneme
  lip-sync.
- **Keys** — stored only in this device's local IndexedDB, sent only to the
  chosen provider. Nothing is hardcoded.

## Settings

Hamburger icon (top right) or the gear in the bottom nav:
choose provider, paste key, pick model, toggle spoken replies,
wipe all local data.

OpenCode Zen free models need **no key**: `mimo-v2.6-flash-free`,
`flint-40b-free`, `beam-free`, `big-pickle`, …

## Diagnostics view

Bottom nav → gauge icon: buttons to trigger every facial state
(idle / listening / thinking / speaking / coding / success / error) and a
subsystem report. Use this to verify animation states.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Blank page | Check the browser console; requires a modern browser (ES2020). |
| No 3D face | WebGL unavailable → app switches to a 2D HUD head; the rest still works. Try Chrome, or enable hardware acceleration. |
| Mic does nothing | Some browsers need mic permission per-site; also Android may block it inside in-app browsers. |
| Voice sounds wrong | Speech engines vary per device; disable "speak replies" in settings if undesired. |
| Provider error | Read the message in chat: it reports the real HTTP error from the provider. NVIDIA will fail until the M6 proxy exists. |

## Roadmap

- M2 ✔ facial state machine + performance fallbacks (this build)
- M3 streaming responses + per-provider model fetching
- M4 better mic energy (AnalyserNode) + viseme research
- M5 coding workspace: file tree, editor, diffs, export (IndexedDB-backed FS)
- M6 secure backend: NVIDIA proxy, workspace file ops, real test runs
- M7 Capacitor Android packaging (after core is stable)

## File layout

```
src/
  core/       config, store, idb, providers, chat flow, voice, pulse
  robot/      headBuilder (geometry), FaceController (states), FaceCanvas
  widgets/    Waveform, Gauge, GlobeCanvas
  components/ StatusBar, Header, HudPanel, RobotPanel, LinkagePanel,
              ChatTerminal, BottomTabs, BottomNav, SettingsSheet, Views
  theme.css   full HUD design system
```
