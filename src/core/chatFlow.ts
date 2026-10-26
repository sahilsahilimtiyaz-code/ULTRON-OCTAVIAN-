/**
 * Chat flow orchestrator: user message -> thinking -> brain (demo or live)
 * -> assistant message -> speaking (TTS + face) -> idle.
 * Keeps state transitions in ONE place so the face controller simply follows.
 */
import { addMessage, getState, setFace, setState, toast } from './store';
import { demoReply } from './demoBrain';
import { sendLiveChat } from './liveProvider';
import { speak, stopSpeaking } from './voice';
import { setPulseMode, bumpPulse } from './pulse';
import type { FaceStateName } from './types';

let demoTimer: ReturnType<typeof setTimeout> | null = null;
let abort: AbortController | null = null;

export function isBusy(): boolean {
  const s = getState();
  return s.thinking || s.speaking;
}

/** Show a quick positive reaction on the face (also used for test buttons). */
export function flashFace(state: FaceStateName, ms = 1600): void {
  setFace(state);
  window.setTimeout(() => {
    if (getState().face === state) setFace('idle');
  }, ms);
}

export function stopAll(): void {
  if (demoTimer) {
    clearTimeout(demoTimer);
    demoTimer = null;
  }
  if (abort) {
    abort.abort();
    abort = null;
  }
  stopSpeaking();
  setPulseMode('off');
  setState({ thinking: false, speaking: false, micActive: false, ttsStatus: null });
  setFace('idle');
}

export async function sendUserMessage(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean || isBusy()) return;

  addMessage({ role: 'user', text: clean, demo: false });
  setState({ thinking: true });
  setPulseMode('thinking');
  setFace('thinking');

  const settings = getState().settings;
  // Only 'demo' provider runs offline; everything else is a real network call
  // so a missing key surfaces as an honest, visible error.
  const isDemo = settings.provider === 'demo';

  let reply: string;
  let demo = isDemo;
  try {
    if (isDemo) {
      // small artificial delay so the thinking state is visible
      await new Promise<void>((res, rej) => {
        demoTimer = setTimeout(res, 900 + Math.random() * 700);
        abort = { abort: () => rej(new Error('cancelled')) } as AbortController;
      });
      reply = demoReply(getState().messages, clean);
    } else {
      abort = new AbortController();
      reply = await sendLiveChat({ settings, history: getState().messages, userText: clean, signal: abort.signal });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'cancelled') {
      stopAll();
      return;
    }
    abort = null;
    setState({ thinking: false });
    setPulseMode('off');
    addMessage({ role: 'system', text: `⚠ ${msg}`, demo: false, error: true });
    setFace('error');
    setTimeout(() => setFace('idle'), 2000);
    return;
  }

  demoTimer = null;
  abort = null;
  setState({ thinking: false });
  addMessage({ role: 'assistant', text: reply, demo });

  // speak + animate
  const wantSpeak = settings.autoSpeak;
  if (!wantSpeak) {
    flashFace('success', 1200);
    setPulseMode('off');
    return;
  }

  setState({ speaking: true, ttsStatus: null });
  setPulseMode('speaking');
  setFace('speaking');
  speak(reply, {
    // synthetic bumps: only used when no measurable audio exists
    onPulse: (s) => bumpPulse(s),
    onProgress: (stage, detail) =>
      setState({ ttsStatus: detail ? `${stage.toUpperCase()} // ${detail.toUpperCase()}` : stage.toUpperCase() }),
    onFallback: (msg) => toast(`VOICE FALLBACK // ${msg}`),
    onEnd: () => {
      setState({ speaking: false, ttsStatus: null });
      setPulseMode('off');
      setFace('idle');
    },
  });
  // safety: if the engine never fires onEnd (Android quirk), recover after 60s
  window.setTimeout(() => {
    if (getState().speaking) {
      setState({ speaking: false, ttsStatus: null });
      setPulseMode('off');
      setFace('idle');
    }
  }, 60000);
}
