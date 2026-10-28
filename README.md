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

## Interface

Mission-control aesthetic: graphite glass surfaces, hairline borders, crimson
instrumentation and cold-steel data type. Everything derives from the tokens at
the top of `src/theme.css` (colour, spacing, radii, elevation, easing), so a
retheme is one block of variables.

- **Type** — Michroma (display), Rajdhani (UI), Share Tech Mono (data).
- **Chrome** — status strip, brand header, floating dock with labelled tabs,
  slide-up configuration sheet, card/panel system with corner ticks.
- **Depth** — layered background (aurora, technical grid, film grain, vignette),
  glass panels with top hairline highlight, one-pixel focus rings.
- **Motion** — short eased entrances, live energy meters, and a full
  `prefers-reduced-motion` path that stops ambient animation.
- **Responsive** — single column below 560px, side-by-side linkage stage and
  wider gutters above it; checked for no horizontal overflow at 360px.

## What is real vs. demo (honesty notes)

- **3D robot face** — REAL: live Three.js render, 7 facial states, blinking,
  jaw articulation, drag-to-rotate. Original procedural design.
- **Planetary uplink globe** — REAL WebGL render: a custom-shader Earth (warped
  noise continents, ice caps, drifting cloud layer, day/night terminator, city
  lights, ocean specular, fresnel atmosphere, graticule), a starfield, two orbit
  tracks with satellites, and dashed-arc data flows with travelling packets.
  Drag the globe to orbit it; rotation pauses off-screen and when the tab hides.
- **Waveform / gauges** — REAL animated renderings of the app's own state
  (decorative telemetry numbers are simulated HUD flavour, exactly like the mockup).
- **Chat brain** — DEMO by default (scripted answers, clearly labelled
  `DEMO RESPONSE`). Selecting a provider in Settings makes REAL network calls:
  - Verified working from a browser: **OpenCode Zen** (free models, no key),
    **OpenRouter**, **Mistral AI**, **Google AI (Gemini)**, **Groq**.
  - **NVIDIA NIM**: server reachable but blocks direct browser calls (no CORS);
    needs the small backend proxy planned for Milestone 6.
- **Voice input** — REAL where the browser supports `SpeechRecognition`
  (Chrome on Android): **live continuous dictation**. Tap the mic and keep
  talking — words land in the composer as you speak and the session stays
  live until you tap the mic again (a pause only restarts recognition, it
  does not end the session). Nothing is auto-sent; you read it, then send.
  Falls back to clear error text where the browser has no recognition.
- **Speech output** — the **cinematic voice engine** (see `src/voice/`):
  - browser `SpeechSynthesis` as the always-available, offline fallback,
  - neural / local TTS providers (ElevenLabs, Fish Audio, OpenAI-compatible,
    self-hosted) when you add an endpoint and (optionally) a key,
  - a **real, connected Web Audio chain** rendered offline per utterance:
    pitch shift → HPF → EQ → saturation → metallic layer → compressor →
    short reverb → limiter,
  - the jaw and the waveform are driven by **measured RMS from an
    AnalyserNode** while buffer audio plays. With browser `SpeechSynthesis`
    the browser gives no access to its output, so the pulse is a synthetic
    envelope — and diagnostics labels it SYNTHETIC instead of pretending.
  - NOT phoneme-level lip sync.
- **Keys** — stored only in this device's local IndexedDB, sent only to the
  chosen provider. Nothing is hardcoded.## Settings
Gear button (top right) or **CONFIG** in the bottom dock:
choose provider, paste key, pick model, toggle spoken replies,
configure the **voice engine** (provider, preset, rate/pitch/formant/metallic/
reverb, processing bypass, reference audio + cloning), wipe all local data.

OpenCode Zen free models need **no key**: `mimo-v2.6-flash-free`,
`flint-40b-free`, `beam-free`, `big-pickle`, …## Voice engine — what works, what needs credentials

| Capability | State |
| --- | --- |
| ULTRON_PRIME preset (deep, metallic, cinematic) | REAL — offline Web Audio render, values tunable in `src/voice/presets.ts` and in Settings |
| BYPASS preset | REAL — raw provider audio, chain and pitch shift skipped |
| Duration-preserving pitch shift (WSOLA) | REAL — verified numerically by `npm run check:dsp` (±0.05 semitone error, length preserved exactly) |
| Reference upload, validation, playback, A/B, measurements | REAL — DIAGNOSTICS → VOICE REFERENCE LAB |
| Browser SpeechSynthesis fallback | REAL — works offline, no key, no FX chain (impossible by design) |
| ElevenLabs TTS + voice cloning | CODED, **UNTESTED** — needs your API key or gateway; direct browser CORS is undocumented by the vendor |
| Fish Audio TTS + voice cloning | CODED, **UNTESTED** — documented `POST /v1/tts` (Bearer key, `model` header, `reference_id`) and `POST /model` cloning; needs your API key; fish.audio does not document browser CORS |
| OpenAI TTS | CODED, **UNTESTED** — needs your API key or gateway; no cloning (stock voices only) |
| Local OpenAI-compatible TTS server | CODED, **UNTESTED** — point ENDPOINT at piper/openedai-speech/XTTS |

Credentials are never embedded in the code. A key typed in Settings stays in
this device's IndexedDB; the safer option is to point ENDPOINT at your own
gateway that holds the secret server-side.

## Diagnostics view
Bottom nav → gauge icon: buttons to trigger every facial state
(idle / listening / thinking / speaking / coding / success / error), a
subsystem + voice-engine report, and the **Voice Reference Lab** (measure a
reference clip, generate the same phrase, compare F0 / spectrum / loudness /
true peak / pacing, and A/B listen raw vs processed).

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
- M4 partial ✔ real mic energy (AnalyserNode, best effort) + voice-engine
  reference lab; viseme research still open
- M5 coding workspace: file tree, editor, diffs, export (IndexedDB-backed FS)
- M6 secure backend: NVIDIA proxy, workspace file ops, real test runs
- M7 Capacitor Android packaging (after core is stable)

## File layout

```
src/
  core/       config, store, idb, providers, chat flow, voice facade, pulse
  voice/      presets, dsp (pitch shift), chain (Web Audio FX), tts (provider
              abstraction), cloning, engine, analysis (measurements)
  robot/      headBuilder (geometry), FaceController (states), FaceCanvas
  widgets/    Waveform (measured-energy canvas), Gauge (SVG instrument),
              GlobeCanvas (shader Earth + orbits + data arcs)
  components/ StatusBar, Header, HudPanel (+PanelHead), RobotPanel,
              LinkagePanel, ChatTerminal, BottomTabs, BottomNav,
              SettingsSheet, VoiceEnginePanel, VoiceLab, Views
  theme.css   design system: tokens, chrome, panels, terminal, dock, views,
              sheet controls, voice panels, responsive + reduced-motion rules
```
