/**
 * Tiny observable store + React hook. No external state library needed.
 */
import { useSyncExternalStore } from 'react';
import type { AppState, ChatMsg, FaceStateName, Settings } from './types';

type Listener = () => void;

const listeners = new Set<Listener>();

let state: AppState = {
  face: 'boot',
  view: 'dashboard',
  tab: 'telemetry',
  messages: [],
  thinking: false,
  speaking: false,
  micActive: false,
  voiceStatus: 'off',
  voiceError: null,
  netStatus: typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  settings: { provider: 'demo', apiKeys: {}, models: {}, autoSpeak: true, lowPower: false },
  settingsOpen: false,
  toast: null,
  booted: false,
};

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => subscribe(cb),
    () => selector(getState()),
  );
}

/* ---------- message helpers ---------- */

let counter = 0;

export function uid(): string {
  counter += 1;
  return `m${Date.now().toString(36)}${counter.toString(36)}`;
}

export function addMessage(msg: Omit<ChatMsg, 'id' | 'ts'>): ChatMsg {
  const full: ChatMsg = { ...msg, id: uid(), ts: Date.now() };
  setState({ messages: [...getState().messages, full] });
  // persist in background (fire and forget)
  void import('./idb').then((idb) => idb.msgAdd(full));
  return full;
}

/* ---------- settings ---------- */

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...getState().settings, ...patch };
  setState({ settings: next });
  void import('./idb').then((idb) => idb.kvSet('settings', next));
}

/* ---------- toast ---------- */

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, ms = 2600): void {
  setState({ toast: text });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), ms);
}

/* ---------- face state ---------- */

export function setFace(f: FaceStateName): void {
  if (getState().face !== f) setState({ face: f });
}
