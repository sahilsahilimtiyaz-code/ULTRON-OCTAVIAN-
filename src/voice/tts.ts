/**
 * tts.ts — the TTS abstraction layer.
 *
 * One interface, interchangeable providers:
 *   A. 'browser'     — SpeechSynthesis fallback (always available offline).
 *                      Plays audio itself; exposes NO buffer, so the FX chain,
 *                      analysis and cloning are unavailable with it.
 *   B. 'elevenlabs'  — external neural TTS (buffer audio + cloning workflow).
 *   C. 'openai'      — external neural TTS (buffer audio, fixed voices).
 *   D. 'local'       — locally hosted / self-hosted OpenAI-compatible server
 *                      (piper, openedai-speech, XTTS, Kokoro…), buffer audio.
 *
 * Credential policy: no key is ever embedded in this code. The key (if you
 * use one) lives in this device's IndexedDB like every other key in the app,
 * or — recommended — on your own gateway: point ENDPOINT at a small server
 * that holds the secret and this app will call it without a key.
 *
 * CORS honesty: ElevenLabs and OpenAI do NOT document browser CORS for their
 * speech endpoints, so direct browser calls are UNVERIFIED. Expect to need a
 * gateway. Failures surface as readable errors instead of silent nothing.
 */

export type TTSProviderId = 'browser' | 'elevenlabs' | 'openai' | 'local';

export interface TTSCaps {
  id: TTSProviderId;
  label: string;
  /** returns a decodable AudioBuffer -> pitch shift, FX chain, analysis, A/B */
  bufferAudio: boolean;
  /** provider supports audio streaming; this app currently buffers (not streamed) */
  providerStreaming: boolean;
  cloning: boolean;
  voiceSelection: boolean;
  needsKey: boolean;
  /** 'yes' | 'unknown' | 'no' for direct browser (no gateway) access */
  cors: 'yes' | 'unknown' | 'no';
  /** true only after a real end-to-end test with real credentials */
  verified: boolean;
  defaultEndpoint: string;
  defaultVoice: string;
  defaultModel: string;
  notes: string[];
}

export interface TTSConfig {
  provider: TTSProviderId;
  voiceId: string;
  model: string;
  endpoint: string;
  apiKey: string;
  rate: number;
}

export type SynthStage =
  | 'requesting'
  | 'receiving'
  | 'decoding'
  | 'processing'
  | 'playing'
  | 'done';

export interface SynthProgress {
  stage: SynthStage;
  detail?: string;
}

export interface SynthHandlers {
  onProgress?: (p: SynthProgress) => void;
  /** browser-only: speech events used for jaw/pulse when no buffer exists */
  onBoundary?: (strength: number) => void;
  signal?: AbortSignal;
}

export type SynthResult =
  | { kind: 'buffer'; buffer: AudioBuffer }
  /** provider produced the playback itself; no measurable audio available */
  | { kind: 'handled'; durationSec: number };

export interface TTSProvider {
  id: TTSProviderId;
  caps(): TTSCaps;
  synthesize(text: string, cfg: TTSConfig, handlers: SynthHandlers): Promise<SynthResult>;
  cancel(): void;
}

export type TtsErrorCode =
  | 'no_key'
  | 'auth'
  | 'payment'
  | 'rate_limited'
  | 'bad_request'
  | 'not_found'
  | 'network'
  | 'unsupported'
  | 'bad_response';

export class TtsError extends Error {
  code: TtsErrorCode;
  status?: number;
  constructor(code: TtsErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
  }
}

/** Human-readable message for any thrown TTS error. */
export function ttsErrorMessage(err: unknown): string {
  if (err instanceof TtsError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function httpError(status: number, body: string, provider: string): TtsError {
  const snippet = body.slice(0, 220).replace(/\s+/g, ' ').trim();
  if (status === 401 || status === 403) {
    return new TtsError('auth', `${provider}: key rejected (HTTP ${status}). Check the API key or gateway credentials.`, status);
  }
  if (status === 402) {
    return new TtsError('payment', `${provider}: HTTP 402 — this account/plan does not include this feature (voice cloning or TTS quota).`, status);
  }
  if (status === 404) {
    return new TtsError('not_found', `${provider}: HTTP 404 — voice/model not found, or the endpoint path is wrong.`, status);
  }
  if (status === 429) {
    return new TtsError('rate_limited', `${provider}: rate limited (HTTP 429). Try again shortly.`, status);
  }
  if (status === 400 || status === 422) {
    return new TtsError('bad_request', `${provider}: rejected the request (HTTP ${status})${snippet ? ` — ${snippet}` : ''}`, status);
  }
  return new TtsError('bad_response', `${provider}: HTTP ${status}${snippet ? ` — ${snippet}` : ''}`, status);
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** fetch wrapper that turns CORS/network failures into a readable error. */
async function httpFetch(url: string, init: RequestInit, provider: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new TtsError(
      'network',
      `${provider}: request failed. This is usually no network, or the provider blocking browser (CORS) calls — use a gateway endpoint.`,
    );
  }
}

export function defaultEndpoint(id: TTSProviderId): string {
  switch (id) {
    case 'elevenlabs':
      return 'https://api.elevenlabs.io';
    case 'openai':
      return 'https://api.openai.com';
    case 'local':
      return 'http://localhost:8000';
    default:
      return '';
  }
}

const CAPS: Record<TTSProviderId, TTSCaps> = {
  browser: {
    id: 'browser',
    label: 'Browser SpeechSynthesis (fallback)',
    bufferAudio: false,
    providerStreaming: false,
    cloning: false,
    voiceSelection: true,
    needsKey: false,
    cors: 'yes',
    verified: true,
    defaultEndpoint: '',
    defaultVoice: '',
    defaultModel: '',
    notes: [
      'Works offline with no key.',
      'Cannot be routed through the audio FX chain — the browser gives no access to its output.',
      'No pitch/formant control, no cloning, no measurement. Pitch is approximated with utterance.pitch.',
      'This fallback is verified working; everything else on this list needs credentials.',
    ],
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs (neural, cloning)',
    bufferAudio: true,
    providerStreaming: true,
    cloning: true,
    voiceSelection: true,
    needsKey: true,
    cors: 'unknown',
    verified: false,
    defaultEndpoint: 'https://api.elevenlabs.io',
    defaultVoice: '',
    defaultModel: 'eleven_multilingual_v2',
    notes: [
      'Documented cloning workflow: POST /v1/voices/add (multipart), returns voice_id.',
      'CORS for the speech endpoints is not documented by the vendor — direct browser calls are UNVERIFIED, a gateway is recommended.',
      'Not yet tested end-to-end from this app (no credentials available here).',
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI TTS (neural)',
    bufferAudio: true,
    providerStreaming: true,
    cloning: false,
    voiceSelection: true,
    needsKey: true,
    cors: 'unknown',
    verified: false,
    defaultEndpoint: 'https://api.openai.com',
    defaultVoice: 'onyx',
    defaultModel: 'tts-1',
    notes: [
      'POST /v1/audio/speech, fixed stock voices — voice cloning is NOT offered here.',
      'CORS for this endpoint is undocumented/UNVERIFIED from browsers; a gateway is recommended.',
      'Not yet tested end-to-end from this app (no credentials available here).',
    ],
  },
  local: {
    id: 'local',
    label: 'Local / self-hosted TTS server',
    bufferAudio: true,
    providerStreaming: false,
    cloning: false,
    voiceSelection: true,
    needsKey: false,
    cors: 'unknown',
    verified: false,
    defaultEndpoint: 'http://localhost:8000',
    defaultVoice: '',
    defaultModel: '',
    notes: [
      'Speaks the OpenAI-compatible POST {endpoint}/v1/audio/speech protocol (piper, openedai-speech, XTTS, Kokoro wrappers).',
      'Point ENDPOINT at your server. A phone cannot reach localhost on your computer — use your machine\'s LAN IP.',
      'Cloning depends on your server; this app implements only the documented ElevenLabs cloning workflow.',
      'Not yet tested end-to-end (no local server available in this environment).',
    ],
  },
};

export function capsOf(id: TTSProviderId): TTSCaps {
  return CAPS[id] ?? CAPS.browser;
}

/* ------------------------------------------------------------------ */
/* A. browser fallback                                                 */
/* ------------------------------------------------------------------ */

/** Robotic-ish voice pick: prefer deeper male en voice, else default. */
function pickSpeechVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => /male/i.test(v.name)) ??
    en.find((v) => /google uk english male/i.test(v.name)) ??
    en.find((v) => /daniel|fred|george|david/i.test(v.name)) ??
    en[0] ??
    voices[0] ??
    null
  );
}

export const browserProvider: TTSProvider = {
  id: 'browser',
  caps: () => CAPS.browser,
  cancel() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  },
  synthesize(text, cfg, handlers): Promise<SynthResult> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return Promise.reject(new TtsError('unsupported', 'This browser has no speech synthesis.'));
    }
    return new Promise<SynthResult>((resolve, reject) => {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickSpeechVoice();
      if (v) u.voice = v;
      // HONESTY: utterance.pitch is a coarse engine control, not a formant or
      // semitone control. It only approximates the ULTRON_PRIME character.
      u.rate = Math.min(2, Math.max(0.1, cfg.rate));
      u.pitch = 0.55;
      u.volume = 1;
      let timer: ReturnType<typeof setInterval> | null = null;
      let settled = false;

      const clear = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clear();
        resolve({ kind: 'handled', durationSec: Math.max(1200, (text.length / 14) * 1000) / 1000 });
      };
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clear();
        reject(new TtsError('unsupported', msg));
      };

      u.onstart = () => {
        handlers.onProgress?.({ stage: 'playing', detail: 'browser synthesis' });
        // some engines never fire onboundary: keep a gentle pulse as a floor
        timer = setInterval(() => handlers.onBoundary?.(0.35), 140);
      };
      u.onboundary = () => handlers.onBoundary?.(0.7);
      u.onend = finish;
      u.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') finish();
        else fail(`Speech synthesis error: ${e.error ?? 'unknown'}`);
      };

      const onAbort = () => {
        synth.cancel();
        finish();
      };
      handlers.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        synth.speak(u);
        handlers.onProgress?.({ stage: 'playing', detail: 'browser synthesis' });
      } catch {
        fail('Speech synthesis could not start.');
      }
      // safety net: Android engines occasionally swallow onend
      window.setTimeout(finish, Math.min(120000, 4000 + (text.length / 12) * 1000));
    });
  },
};

/* ------------------------------------------------------------------ */
/* B/C/D. HTTP providers                                               */
/* ------------------------------------------------------------------ */

let activeAbort: AbortController | null = null;

function beginRequest(): AbortController {
  activeAbort?.abort();
  const c = new AbortController();
  activeAbort = c;
  return c;
}

function authHeaders(cfg: TTSConfig, provider: string): Record<string, string> {
  if (!cfg.apiKey) return {};
  if (provider === 'elevenlabs') return { 'xi-api-key': cfg.apiKey };
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

async function requestAudio(
  cfg: TTSConfig,
  provider: string,
  path: string,
  body: BodyInit,
  headers: Record<string, string>,
  handlers: SynthHandlers,
): Promise<ArrayBuffer> {
  const base = (cfg.endpoint || defaultEndpoint(cfg.provider)).replace(/\/+$/, '');
  if (!base) throw new TtsError('bad_request', `${provider}: no endpoint configured.`);

  // A key-less call is only expected to work when the endpoint is your own
  // gateway (which injects the provider credential server-side).
  if (capsOf(cfg.provider).needsKey && !cfg.apiKey && !isCustomEndpoint(cfg)) {
    throw new TtsError(
      'no_key',
      `${provider}: no API key and no gateway endpoint configured. Add a key, or point ENDPOINT at your own gateway.`,
    );
  }

  handlers.onProgress?.({ stage: 'requesting', detail: provider });
  const res = await httpFetch(
    `${base}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg, provider), ...headers },
      body,
    },
    provider,
    handlers.signal,
  );
  if (!res.ok) throw httpError(res.status, await readBody(res), provider);

  handlers.onProgress?.({ stage: 'receiving', detail: provider });
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new TtsError('bad_response', `${provider}: returned an empty audio body.`);
  return buf;
}

/** true when the user pointed the app at their own endpoint (gateway/local). */
function isCustomEndpoint(cfg: TTSConfig): boolean {
  const ep = cfg.endpoint.replace(/\/+$/, '').toLowerCase();
  if (!ep) return false;
  return ep !== defaultEndpoint(cfg.provider).toLowerCase();
}

async function decode(buf: ArrayBuffer, handlers: SynthHandlers): Promise<AudioBuffer> {
  handlers.onProgress?.({ stage: 'decoding' });
  const ctx = await getDecodeContext();
  try {
    return await ctx.decodeAudioData(buf.slice(0));
  } catch {
    throw new TtsError('bad_response', 'The provider returned audio this browser could not decode (unexpected format).');
  }
}

/* decode/playback context (created lazily, resumed on first user gesture) */
let sharedCtx: AudioContext | null = null;
let gestureHooked = false;

export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new TtsError('unsupported', 'Web Audio is not available in this browser.');
    sharedCtx = new Ctor();
  }
  if (!gestureHooked) {
    gestureHooked = true;
    const resume = () => {
      void sharedCtx?.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume);
  }
  if (sharedCtx.state === 'suspended') void sharedCtx.resume().catch(() => undefined);
  return sharedCtx;
}

async function getDecodeContext(): Promise<BaseAudioContext> {
  try {
    return getAudioContext();
  } catch {
    // last resort: decoding does not need a running (or even resumable) context
    return new OfflineAudioContext(1, 1, 44100);
  }
}

async function synthesizeHttp(
  cfg: TTSConfig,
  handlers: SynthHandlers,
  build: () => { path: string; body: BodyInit; headers: Record<string, string> },
): Promise<SynthResult> {
  const ctrl = beginRequest();
  const onOuterAbort = () => ctrl.abort();
  handlers.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const { path, body, headers } = build();
    const audio = await requestAudio(cfg, capsOf(cfg.provider).label.split(' (')[0], path, body, headers, handlers);
    const buffer = await decode(audio, handlers);
    return { kind: 'buffer', buffer };
  } finally {
    handlers.signal?.removeEventListener('abort', onOuterAbort);
    if (activeAbort === ctrl) activeAbort = null;
  }
}

export const elevenLabsProvider: TTSProvider = {
  id: 'elevenlabs',
  caps: () => CAPS.elevenlabs,
  cancel() {
    activeAbort?.abort();
  },
  async synthesize(text, cfg, handlers) {
    const voice = cfg.voiceId.trim();
    if (!voice) throw new TtsError('bad_request', 'ElevenLabs: no voice id set. Create/clone a voice and select it.');
    const model = cfg.model.trim() || CAPS.elevenlabs.defaultModel;
    return synthesizeHttp(cfg, handlers, () => ({
      path: `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, speed: cfg.rate },
      }),
      headers: {},
    }));
  },
};

export const openAiProvider: TTSProvider = {
  id: 'openai',
  caps: () => CAPS.openai,
  cancel() {
    activeAbort?.abort();
  },
  async synthesize(text, cfg, handlers) {
    const voice = cfg.voiceId.trim() || CAPS.openai.defaultVoice;
    return synthesizeHttp(cfg, handlers, () => ({
      path: '/v1/audio/speech',
      body: JSON.stringify({
        model: cfg.model.trim() || CAPS.openai.defaultModel,
        voice,
        input: text,
        response_format: 'mp3',
        speed: cfg.rate,
      }),
      headers: {},
    }));
  },
};

export const localProvider: TTSProvider = {
  id: 'local',
  caps: () => CAPS.local,
  cancel() {
    activeAbort?.abort();
  },
  async synthesize(text, cfg, handlers) {
    const voice = cfg.voiceId.trim();
    const model = cfg.model.trim();
    return synthesizeHttp(cfg, handlers, () => ({
      path: '/v1/audio/speech',
      body: JSON.stringify({
        ...(model ? { model } : {}),
        ...(voice ? { voice } : {}),
        input: text,
        response_format: 'mp3',
        speed: cfg.rate,
      }),
      headers: {},
    }));
  },
};

const PROVIDERS: Record<TTSProviderId, TTSProvider> = {
  browser: browserProvider,
  elevenlabs: elevenLabsProvider,
  openai: openAiProvider,
  local: localProvider,
};

export function getTtsProvider(id: TTSProviderId | string | undefined | null): TTSProvider {
  return (id && PROVIDERS[id as TTSProviderId]) || browserProvider;
}
