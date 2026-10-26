/**
 * Voice presets — the tunable "sound" of the engine.
 *
 * Every number here is a STARTING POINT, not a universal truth. They are
 * meant to be adjusted with listening tests + the measurement tools in
 * `VoiceLab` (see src/voice/analysis.ts). Two presets ship:
 *
 *  - ULTRON_PRIME : deep, dark, metallic cinematic machine voice.
 *                   Uses the full offline FX render (EQ -> saturation ->
 *                   metallic layer -> compression -> reverb -> limiter).
 *  - BYPASS       : raw provider audio, no pitch shift, no FX chain.
 *                   Kept so you can always hear what the source actually is.
 *
 * Nothing in this file talks to the Web Audio API — values only.
 */

import type { TTSProviderId } from './tts';

export type PresetId = 'ultron_prime' | 'bypass';

export interface VoicePreset {
  id: PresetId;
  name: string;
  blurb: string;

  /* ---- generation (applied before the FX chain) ---- */
  /** speaking rate multiplier sent to the TTS provider (0.75 – 1.15) */
  rate: number;
  /** buffer pitch shift in semitones, duration-preserving (see dsp.ts) */
  pitchSemitones: number;
  /**
   * Formant-style correction, -1 (darker) .. +1 (brighter).
   * HONESTY: our pitch shifter moves formants together with pitch. This
   * control is an EQ tilt approximation of formant correction, NOT an
   * independent formant shifter. Reported as such in diagnostics.
   */
  formantTilt: number;

  /* ---- corrective EQ ---- */
  hpfHz: number;      // rumble removal
  lowBodyHz: number;  // body/resonance centre
  lowBodyDb: number;
  mudHz: number;      // boxiness centre
  mudDb: number;      // negative = cut
  presenceHz: number;
  presenceDb: number;
  airHz: number;      // high shelf — gentle, never a treble guillotine
  airDb: number;

  /* ---- colour ---- */
  saturation: number;   // 0..1
  metallic: number;     // 0..1 parallel resonant "machine" layer
  reverb: number;       // 0..1 wet mix
  reverbDecaySec: number;

  /* ---- dynamics ---- */
  compRatio: number;
  compThresholdDb: number;
  compAttackSec: number;
  compReleaseSec: number;
  limiterCeilingDb: number;
  gainDb: number;

  /** true = skip the whole FX chain and play provider audio raw */
  bypass: boolean;
}

/**
 * ULTRON_PRIME — initial values from the milestone spec.
 * Target voiced F0 ≈ 65–90 Hz after pitch shift (measure, don't assume).
 */
export const ULTRON_PRIME: VoicePreset = {
  id: 'ultron_prime',
  name: 'ULTRON_PRIME',
  blurb: 'Deep cinematic machine voice — full processing chain.',

  rate: 0.9,
  pitchSemitones: -3,
  formantTilt: -0.25,

  hpfHz: 52,
  lowBodyHz: 132,
  lowBodyDb: 2.5,
  mudHz: 300,
  mudDb: -2.5,
  presenceHz: 3000,
  presenceDb: 1.5,
  airHz: 9000,
  airDb: -1,

  saturation: 0.25,
  metallic: 0.1,
  reverb: 0.16,
  reverbDecaySec: 0.85,

  compRatio: 2.5,
  compThresholdDb: -22,
  compAttackSec: 0.015,
  compReleaseSec: 0.25,
  limiterCeilingDb: -2,
  gainDb: 0,

  bypass: false,
};

/** BYPASS — provider audio untouched: no shift, no EQ, no FX. */
export const BYPASS: VoicePreset = {
  ...ULTRON_PRIME,
  id: 'bypass',
  name: 'BYPASS',
  blurb: 'Raw provider audio — effects chain bypassed.',
  pitchSemitones: 0,
  formantTilt: 0,
  lowBodyDb: 0,
  mudDb: 0,
  presenceDb: 0,
  airDb: 0,
  saturation: 0,
  metallic: 0,
  reverb: 0,
  compRatio: 1,
  compThresholdDb: 0,
  gainDb: 0,
  bypass: true,
};

export const PRESETS: Record<PresetId, VoicePreset> = {
  ultron_prime: ULTRON_PRIME,
  bypass: BYPASS,
};

export const PRESET_ORDER: PresetId[] = ['ultron_prime', 'bypass'];

export function getPreset(id: string | undefined | null): VoicePreset {
  if (id && id in PRESETS) return PRESETS[id as PresetId];
  return ULTRON_PRIME;
}

/** Numeric range clamp used by the settings sliders. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Merge a stored preset id + user overrides from Settings into the concrete
 * preset that the engine renders with.
 *
 * `bypass: true` (either via the BYPASS preset or the explicit processing
 * bypass toggle) forces a neutral chain: no pitch shift, no FX.
 */
export interface PresetOverrides {
  preset: string;
  rate: number;
  pitchSemitones: number;
  formantTilt: number;
  metallic: number;
  reverb: number;
  bypass: boolean;
}

export function resolvePreset(o: PresetOverrides): VoicePreset {
  const base = getPreset(o.preset);
  const bypass = o.bypass || base.id === 'bypass';
  if (bypass) {
    return {
      ...base,
      rate: clamp(o.rate, 0.75, 1.15),
      pitchSemitones: 0,
      formantTilt: 0,
      lowBodyDb: 0,
      mudDb: 0,
      presenceDb: 0,
      airDb: 0,
      saturation: 0,
      metallic: 0,
      reverb: 0,
      compRatio: 1,
      gainDb: 0,
      bypass: true,
    };
  }
  return {
    ...base,
    rate: clamp(o.rate, 0.75, 1.15),
    pitchSemitones: clamp(o.pitchSemitones, -8, 4),
    formantTilt: clamp(o.formantTilt, -1, 1),
    metallic: clamp(o.metallic, 0, 1),
    reverb: clamp(o.reverb, 0, 1),
    bypass: false,
  };
}

/* ------------------------------------------------------------------ */
/* Settings shape for the voice engine (stored in IndexedDB like every */
/* other setting in this app).                                          */
/* ------------------------------------------------------------------ */

export interface VoiceSettings {
  /** TTS provider id — see src/voice/tts.ts */
  provider: TTSProviderId;
  /** preset id — 'ultron_prime' | 'bypass' */
  preset: PresetId;
  /** provider voice identifier (ElevenLabs voice_id, OpenAI voice name…) */
  voiceId: string;
  /** provider model id (eleven_multilingual_v2, tts-1, local model name) */
  model: string;
  /** base URL: direct provider API, your own gateway, or local TTS server */
  endpoint: string;
  /** optional on-device API key — never embedded in code; gateway preferred */
  apiKey: string;
  /** user overrides applied on top of the selected preset */
  rate: number;
  pitchSemitones: number;
  formantTilt: number;
  metallic: number;
  reverb: number;
  /** processing bypass (in addition to the neutral BYPASS preset) */
  bypass: boolean;
  /** currently selected reference clip id for cloning / A-B reference */
  refClipId: string | null;
  /** which shared test phrase the selected reference contains */
  testPhraseId: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  provider: 'browser',
  preset: 'ultron_prime',
  voiceId: '',
  model: '',
  endpoint: '',
  apiKey: '',
  rate: ULTRON_PRIME.rate,
  pitchSemitones: ULTRON_PRIME.pitchSemitones,
  formantTilt: ULTRON_PRIME.formantTilt,
  metallic: ULTRON_PRIME.metallic,
  reverb: ULTRON_PRIME.reverb,
  bypass: false,
  refClipId: null,
  testPhraseId: 'p1',
};

/** Fill in any fields missing from settings saved by an older build. */
export function normalizeVoiceSettings(raw: Partial<VoiceSettings> | undefined | null): VoiceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VOICE_SETTINGS };
  return { ...DEFAULT_VOICE_SETTINGS, ...raw };
}

