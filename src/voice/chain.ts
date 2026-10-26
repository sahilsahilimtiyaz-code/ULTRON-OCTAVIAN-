/**
 * chain.ts — the real, connected Web Audio processing chain.
 *
 * It is rendered OFFLINE (OfflineAudioContext) into a finished AudioBuffer.
 * That has three practical advantages over a live graph:
 *   1. the exact processed audio can be replayed, A/B'd and measured later;
 *   2. output true-peak is measured on the finished buffer, so the limiter
 *      result can be verified and corrected before anything is heard;
 *   3. it needs no user gesture and no running AudioContext (Android Chrome
 *      autoplay policy friendly).
 *
 * Signal flow (Phase 4 order):
 *   source -> HPF -> low body -> mud -> presence -> tilt -> air
 *          -> saturation -> [ metallic resonant layer (parallel) ]
 *          -> compressor -> dry/wet reverb -> limiter -> master -> out
 *
 * Every node created here is wired to something. There are no decorative nodes.
 */
import type { VoicePreset } from './presets';
import { truePeakDb, linearFromDb } from './dsp';

export interface RenderResult {
  buffer: AudioBuffer;
  /** measured 4x-oversampled true peak of the rendered buffer (dBTP) */
  truePeakDb: number;
  /** gain applied to bring true peak under the limiter ceiling */
  trimDb: number;
  /** false when OfflineAudioContext is unavailable (raw audio returned) */
  rendered: boolean;
}

function getOfflineCtor(): typeof OfflineAudioContext | null {
  if (typeof OfflineAudioContext !== 'undefined') return OfflineAudioContext;
  const w = window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext };
  return w.webkitOfflineAudioContext ?? null;
}

/** Dark, short room — restrained cinematic space, not a cathedral. */
function makeImpulse(ctx: BaseAudioContext, decaySec: number, sampleRate: number): AudioBuffer {
  const len = Math.max(64, Math.floor(sampleRate * Math.min(3, decaySec)));
  const buf = ctx.createBuffer(2, len, sampleRate);
  const predelay = Math.floor(sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = predelay; i < len; i++) {
      const t = (i - predelay) / (len - predelay);
      const env = Math.pow(1 - t, 2.4) * Math.exp(-3.4 * t);
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * 0.25; // one-pole darkening so the tail stays smooth
      d[i] = lp * env;
    }
  }
  return buf;
}

/** tanh soft-clip curve, normalised so small signals keep their level. */
function satCurve(drive: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

export function offlineRenderSupported(): boolean {
  return getOfflineCtor() !== null;
}

/**
 * Render `input` through the preset chain. Returns a NEW buffer; the input is
 * untouched (so before/after playback always works).
 */
export async function renderFx(input: AudioBuffer, preset: VoicePreset): Promise<RenderResult> {
  const Offline = getOfflineCtor();
  if (!Offline || preset.bypass || input.length < 2) {
    return { buffer: input, truePeakDb: truePeakDb([input.getChannelData(0)]), trimDb: 0, rendered: false };
  }

  const sr = input.sampleRate;
  const ctx = new Offline(2, input.length, sr);

  const src = ctx.createBufferSource();
  src.buffer = input;

  /* --- corrective EQ --- */
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = preset.hpfHz;
  hpf.Q.value = 0.6;

  const lowBody = ctx.createBiquadFilter();
  lowBody.type = 'peaking';
  lowBody.frequency.value = preset.lowBodyHz;
  lowBody.Q.value = 0.9;
  lowBody.gain.value = preset.lowBodyDb;

  const mud = ctx.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = preset.mudHz;
  mud.Q.value = 1.1;
  mud.gain.value = preset.mudDb;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = preset.presenceHz;
  presence.Q.value = 1.0;
  presence.gain.value = preset.presenceDb;

  /* formant-style tilt: high shelf up + low shelf down (or vice versa) */
  const tiltHi = ctx.createBiquadFilter();
  tiltHi.type = 'highshelf';
  tiltHi.frequency.value = 2500;
  tiltHi.gain.value = preset.formantTilt * 3;

  const tiltLo = ctx.createBiquadFilter();
  tiltLo.type = 'lowshelf';
  tiltLo.frequency.value = 420;
  tiltLo.gain.value = -preset.formantTilt * 1.5;

  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = preset.airHz;
  air.gain.value = preset.airDb;

  /* --- harmonic saturation --- */
  const satIn = ctx.createGain();
  satIn.gain.value = 1 + preset.saturation * 1.6;
  const shaper = ctx.createWaveShaper();
  shaper.curve = satCurve(1 + preset.saturation * 5);
  shaper.oversample = '2x';
  const satOut = ctx.createGain();
  satOut.gain.value = 1 / (1 + preset.saturation * 0.9);

  /* --- metallic layer: parallel resonant band-pass bank, mixed low --- */
  const metalIn = ctx.createGain();
  metalIn.gain.value = 1;
  const metalOut = ctx.createGain();
  metalOut.gain.value = preset.metallic * 0.22; // restrained by design
  for (const [f, q] of [
    [920, 9],
    [1540, 11],
    [2680, 8],
  ] as const) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 1 / 3;
    metalIn.connect(bp).connect(g).connect(metalOut);
  }

  /* --- compression --- */
  const compIn = ctx.createGain();
  compIn.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.ratio.value = preset.compRatio;
  comp.threshold.value = preset.compThresholdDb;
  comp.knee.value = 12;
  comp.attack.value = preset.compAttackSec;
  comp.release.value = preset.compReleaseSec;
  const makeup = ctx.createGain();
  makeup.gain.value = linearFromDb(Math.min(6, Math.max(0, (preset.compRatio - 1) * 1.6)));

  /* --- reverb: dry + short wet send --- */
  const dry = ctx.createGain();
  dry.gain.value = 1;
  const wet = ctx.createGain();
  wet.gain.value = preset.reverb * 0.8;
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = makeImpulse(ctx, preset.reverbDecaySec, sr);
  const mix = ctx.createGain();
  mix.gain.value = 1;

  /* --- true-peak-aware limiting + output trim --- */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = preset.limiterCeilingDb;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  const master = ctx.createGain();
  master.gain.value = linearFromDb(preset.gainDb);

  /* ---- wiring ---- */
  src
    .connect(hpf)
    .connect(lowBody)
    .connect(mud)
    .connect(presence)
    .connect(tiltHi)
    .connect(tiltLo)
    .connect(air)
    .connect(satIn)
    .connect(shaper)
    .connect(satOut);

  satOut.connect(compIn);
  satOut.connect(metalIn);
  metalOut.connect(compIn);

  compIn.connect(comp).connect(makeup).connect(dry).connect(mix);
  makeup.connect(conv).connect(wet).connect(mix);
  mix.connect(limiter).connect(master).connect(ctx.destination);

  src.start(0);

  let rendered: AudioBuffer;
  try {
    rendered = await ctx.startRendering();
  } catch (err) {
    console.warn('[voice] offline render failed, using unprocessed audio:', err);
    return { buffer: input, truePeakDb: truePeakDb([input.getChannelData(0)]), trimDb: 0, rendered: false };
  }

  /* measure true peak and correct it — a DynamicsCompressor alone does not
     guarantee a sample ceiling on inter-sample peaks */
  const chans: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) chans.push(rendered.getChannelData(c));
  let tp = truePeakDb(chans);
  let trim = 0;
  const ceiling = preset.limiterCeilingDb;
  if (tp > ceiling) {
    trim = ceiling - tp;
    const g = linearFromDb(trim);
    for (const ch of chans) {
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i] * g;
        ch[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    }
    tp = truePeakDb(chans);
  }

  return { buffer: rendered, truePeakDb: tp, trimDb: trim, rendered: true };
}
