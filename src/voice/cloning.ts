/**
 * cloning.ts — reference-audio handling + the voice-cloning workflow.
 *
 * What is REAL here:
 *   - upload/validation (format, size, decoded duration), storage of the
 *     clips on this device (IndexedDB), playback of the reference,
 *   - the documented ElevenLabs workflow: POST /v1/voices/add (multipart,
 *     one or more files) -> { voice_id }.
 *
 * What is NOT claimed here:
 *   - that cloning works end-to-end from this app. It has not been tested
 *     with real credentials or real reference files in this environment, so
 *     diagnostics report it as unverified until someone runs it (caps().verified).
 *   - that two minutes of your MP3s will produce a great voice: material
 *     limits are reported honestly instead of faking a good result.
 *
 * Credentials: never embedded. Either an on-device key (same storage model as
 * the rest of the app) or, recommended, a gateway endpoint that holds the
 * secret server-side.
 */
import type { TTSProviderId } from './tts';
import { TtsError, defaultEndpoint } from './tts';
import { kvGet, kvSet } from '../core/idb';

export interface RefClip {
  id: string;
  name: string;
  mime: string;
  size: number;
  durationSec: number;
  sampleRate: number;
  addedAt: number;
  /** original file bytes (kept so the clone upload uses the real file) */
  bytes: ArrayBuffer | null;
  /** true when bytes were lost (no IndexedDB) — playback/cloning unavailable */
  bytesLost?: boolean;
}

export interface CloneLimits {
  maxBytes: number;
  minSec: number;
  maxSec: number;
  /** recommended minimum for a usable clone */
  recommendedSec: number;
  extensions: string[];
  mimeTypes: string[];
  multipleClips: boolean;
}

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac', 'mp4', 'caf'];
const AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/opus',
];

const GENERIC_LIMITS: CloneLimits = {
  maxBytes: 20 * 1024 * 1024,
  minSec: 10,
  maxSec: 600,
  recommendedSec: 60,
  extensions: AUDIO_EXTS,
  mimeTypes: AUDIO_MIMES,
  multipleClips: false,
};

export const CLONE_LIMITS: Record<TTSProviderId, CloneLimits> = {
  browser: GENERIC_LIMITS,
  elevenlabs: {
    ...GENERIC_LIMITS,
    maxBytes: 20 * 1024 * 1024,
    minSec: 10,
    maxSec: 600,
    recommendedSec: 60,
    multipleClips: true, // one request can carry several files
  },
  openai: { ...GENERIC_LIMITS, minSec: 0 },
  local: GENERIC_LIMITS,
};

export function cloneLimits(id: TTSProviderId): CloneLimits {
  return CLONE_LIMITS[id] ?? GENERIC_LIMITS;
}

export function cloningSupported(id: TTSProviderId): boolean {
  return id === 'elevenlabs';
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  clip?: RefClip;
  warnings: string[];
}

export async function validateRefFile(file: File, limits: CloneLimits): Promise<ValidationResult> {
  const warnings: string[] = [];
  const ext = extOf(file.name);
  const mime = (file.type || '').toLowerCase();

  if (!limits.extensions.includes(ext) && (mime === '' || !limits.mimeTypes.includes(mime))) {
    return {
      ok: false,
      warnings,
      reason: `Unsupported format "${mime || ext || 'unknown'}". Supported: ${limits.extensions.join(', ')}.`,
    };
  }
  if (file.size > limits.maxBytes) {
    return {
      ok: false,
      warnings,
      reason: `File is ${(file.size / 1048576).toFixed(1)} MB — over the ${(limits.maxBytes / 1048576).toFixed(0)} MB limit.`,
    };
  }
  if (file.size === 0) return { ok: false, warnings, reason: 'File is empty.' };

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, warnings, reason: 'Could not read the file.' };
  }

  let decoded: AudioBuffer;
  try {
    const ctx = getDecodeCtx();
    decoded = await ctx.decodeAudioData(buffer.slice(0));
  } catch {
    return {
      ok: false,
      warnings,
      reason: 'The browser could not decode this file. Re-export it as MP3 or WAV.',
    };
  }

  const durationSec = decoded.duration;
  if (durationSec > limits.maxSec) {
    return {
      ok: false,
      warnings,
      reason: `${durationSec.toFixed(0)} s exceeds the ${limits.maxSec} s limit. Trim the clip.`,
    };
  }
  if (durationSec < limits.minSec) {
    warnings.push(
      `Only ${durationSec.toFixed(1)} s — usable for A/B listening and measurement, but below the ${limits.minSec} s minimum for cloning.`,
    );
  } else if (durationSec < limits.recommendedSec) {
    warnings.push(
      `${durationSec.toFixed(0)} s of material is below the recommended ${limits.recommendedSec} s — a clone made from this alone will be noticeably weaker.`,
    );
  }

  return {
    ok: true,
    warnings,
    clip: {
      id: `ref${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: file.name,
      mime: mime || (ext ? `audio/${ext}` : 'audio/*'),
      size: file.size,
      durationSec,
      sampleRate: decoded.sampleRate,
      addedAt: Date.now(),
      bytes: buffer,
    },
  };
}

let decodeCtx: BaseAudioContext | null = null;
function getDecodeCtx(): BaseAudioContext {
  if (decodeCtx) return decodeCtx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    decodeCtx = new Ctor();
  } catch {
    decodeCtx = new OfflineAudioContext(1, 1, 44100);
  }
  return decodeCtx;
}

/* ------------------------------------------------------------------ */
/* material assessment                                                 */
/* ------------------------------------------------------------------ */

export interface MaterialReport {
  clips: number;
  totalSec: number;
  sufficient: boolean;
  warnings: string[];
}

/**
 * Honest assessment of how much usable material there is. Short material is
 * reported as a limitation, never dressed up as a good clone.
 */
export function assessMaterial(clips: RefClip[], limits: CloneLimits): MaterialReport {
  const warnings: string[] = [];
  const totalSec = clips.reduce((s, c) => s + c.durationSec, 0);
  if (clips.length === 0) warnings.push('No reference clips selected.');
  const lost = clips.filter((c) => c.bytesLost).length;
  if (lost) warnings.push(`${lost} clip(s) lost their audio data (storage fallback) — re-upload them.`);

  let sufficient = clips.length > 0 && totalSec >= limits.minSec && lost < clips.length;
  if (clips.length && totalSec >= limits.minSec && totalSec < limits.recommendedSec) {
    warnings.push(
      `${totalSec.toFixed(0)} s total vs ${limits.recommendedSec} s recommended — expect a thin or unstable clone.`,
    );
  }
  return { clips: clips.length, totalSec, sufficient, warnings };
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

const REFS_KEY = 'voiceRefs';
const decodedCache = new Map<string, AudioBuffer>();

export async function refsList(): Promise<RefClip[]> {
  const raw = await kvGet<RefClip[]>(REFS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const bytes = c.bytes;
    const ok = bytes instanceof ArrayBuffer && bytes.byteLength > 0;
    return { ...c, bytes: ok ? bytes : null, bytesLost: !ok };
  });
}

export async function refsSave(clips: RefClip[]): Promise<void> {
  await kvSet(REFS_KEY, clips);
}

export async function refsAdd(clip: RefClip): Promise<RefClip[]> {
  const all = await refsList();
  all.push(clip);
  await refsSave(all);
  return all;
}

export async function refsRemove(id: string): Promise<RefClip[]> {
  const all = (await refsList()).filter((c) => c.id !== id);
  decodedCache.delete(id);
  await refsSave(all);
  return all;
}

/** Decode a stored clip for playback / analysis (cached by id). */
export async function decodeClip(clip: RefClip): Promise<AudioBuffer> {
  const hit = decodedCache.get(clip.id);
  if (hit) return hit;
  if (!clip.bytes || clip.bytesLost) {
    throw new TtsError('bad_request', `"${clip.name}" has no audio data on this device — upload it again.`);
  }
  const ctx = getDecodeCtx();
  const buffer = await ctx.decodeAudioData((clip.bytes as ArrayBuffer).slice(0));
  decodedCache.set(clip.id, buffer);
  return buffer;
}

/* ------------------------------------------------------------------ */
/* cloning                                                             */
/* ------------------------------------------------------------------ */

export interface CloneParams {
  provider: TTSProviderId;
  endpoint: string;
  apiKey: string;
  name: string;
  clips: RefClip[];
  description?: string;
}

export interface CloneResult {
  voiceId: string;
  /** raw provider payload, shown verbatim in diagnostics */
  raw: unknown;
}

/**
 * Runs the provider's documented cloning workflow.
 * Throws TtsError with a clear reason when unsupported, unauthorized,
 * paid-only, or when the material is insufficient.
 */
export async function cloneVoice(params: CloneParams): Promise<CloneResult> {
  const limits = cloneLimits(params.provider);
  const material = assessMaterial(params.clips, limits);
  if (!material.sufficient) {
    throw new TtsError(
      'bad_request',
      material.warnings[0] ?? 'Not enough usable reference material for a clone.',
    );
  }
  if (params.provider !== 'elevenlabs') {
    const capsNote =
      params.provider === 'openai'
        ? 'OpenAI TTS offers fixed stock voices only — cloning is not part of that API.'
        : 'This app implements only the documented ElevenLabs cloning workflow. Your local server may support cloning, but it needs its own client.';
    throw new TtsError('unsupported', `Voice cloning is not available for this provider. ${capsNote}`);
  }

  const missing = params.clips.filter((c) => !c.bytes || c.bytesLost);
  if (missing.length) {
    throw new TtsError('bad_request', `${missing.length} reference clip(s) have no audio data left — re-upload them.`);
  }

  const base = (params.endpoint || defaultEndpoint('elevenlabs')).replace(/\/+$/, '');
  if (!base) throw new TtsError('bad_request', 'No endpoint configured for cloning.');
  if (!params.apiKey && base === defaultEndpoint('elevenlabs').replace(/\/+$/, '')) {
    throw new TtsError(
      'no_key',
      'Cloning needs an ElevenLabs API key (or your own gateway endpoint that holds one). Keys are never stored in this code — add yours in Settings, or point ENDPOINT at your gateway.',
    );
  }

  const form = new FormData();
  form.append('name', params.name || `ULTRON ref ${new Date().toISOString().slice(0, 10)}`);
  form.append('description', params.description ?? 'ULTRON AI reference material (user supplied, authorized).');
  for (const c of params.clips) {
    form.append('files', new File([c.bytes as ArrayBuffer], c.name, { type: c.mime }));
  }

  let res: Response;
  try {
    res = await fetch(`${base}/v1/voices/add`, {
      method: 'POST',
      headers: params.apiKey ? { 'xi-api-key': params.apiKey } : undefined,
      body: form,
    });
  } catch {
    throw new TtsError(
      'network',
      'Cloning request failed — no network, or the provider blocked this browser (CORS). Use a gateway endpoint.',
    );
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new TtsError('auth', `Cloning rejected (HTTP ${res.status}) — the API key is not valid for this account.`, res.status);
    }
    if (res.status === 402) {
      throw new TtsError('payment', 'HTTP 402 — voice cloning requires a paid plan on this account.', res.status);
    }
    if (res.status === 413) {
      throw new TtsError('bad_request', 'Reference files too large for the provider.', res.status);
    }
    if (res.status === 422 || res.status === 400) {
      throw new TtsError('bad_request', `Provider rejected the reference material (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    if (res.status === 429) {
      throw new TtsError('rate_limited', 'Provider rate limit reached while creating the voice.', res.status);
    }
    throw new TtsError('bad_response', `Cloning failed (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new TtsError('bad_response', 'Provider returned an unreadable response while creating the voice.');
  }
  const obj = payload as { voice_id?: string; voiceId?: string };
  const voiceId = obj.voice_id ?? obj.voiceId;
  if (!voiceId) {
    throw new TtsError('bad_response', 'Provider did not return a voice_id — no voice was created.');
  }
  return { voiceId, raw: payload };
}
