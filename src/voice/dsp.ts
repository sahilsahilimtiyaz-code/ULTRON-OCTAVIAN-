/**
 * dsp.ts — pure Float32Array signal processing for the voice engine.
 *
 * Everything here is DOM-free so it can be unit-checked in Node
 * (scripts/dsp-check.mjs) as well as used in the browser.
 *
 * The important piece is `pitchShift`, which changes pitch WITHOUT changing
 * duration. It is a classic resample + WSOLA time-stretch construction:
 *
 *    resampleBy(x, r)  -> pitch * r, duration / r     (linear interpolation)
 *    wsola(y, r)       -> duration * r                (WSOLA overlap-add)
 *
 *    net: pitch * r, duration unchanged.
 *
 * It is a real phase-aligned time-stretch (search + cross-correlation), not
 * a playbackRate trick. Limitations, stated plainly:
 *  - formants move together with pitch (no independent formant shifting);
 *    `formantTilt` in the preset is an EQ approximation, not formant shift.
 *  - very large shifts (> ~6 semitones) start to sound processed.
 */

export interface PitchShiftOptions {
  /** correlation search half-window in samples (default ≈ 15 ms) */
  searchSec?: number;
  /** progress callback 0..1, called between frames */
  onProgress?: (p: number) => void;
  /** returns true to abort early */
  shouldCancel?: () => boolean;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Resample by `r`: output length ≈ N/r, frequencies * r. */
export function resampleBy(x: Float32Array, r: number): Float32Array {
  if (r === 1) return x.slice();
  const n = Math.max(1, Math.floor(x.length / r));
  const out = new Float32Array(n);
  const last = x.length - 1;
  for (let i = 0; i < n; i++) {
    const pos = i * r;
    const i0 = Math.min(last, Math.floor(pos));
    const i1 = Math.min(last, i0 + 1);
    const f = pos - i0;
    out[i] = x[i0] + (x[i1] - x[i0]) * f;
  }
  return out;
}

/** Hann window of length n. */
function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Normalised cross-correlation of x[q..] against already-written output. */
function ncc(x: Float32Array, q: number, out: Float32Array, syn: number, len: number): number {
  let num = 0;
  let e1 = 0;
  let e2 = 0;
  const end = Math.min(len, out.length - syn, x.length - q);
  if (end <= 8) return -2;
  // stride 2 keeps the search ~2x faster with no measurable alignment loss
  let count = 0;
  for (let i = 0; i < end; i += 2) {
    const a = x[q + i];
    const b = out[syn + i];
    num += a * b;
    e1 += a * a;
    e2 += b * b;
    count++;
  }
  if (e1 < 1e-12 || e2 < 1e-12 || count === 0) return -1;
  return num / Math.sqrt(e1 * e2);
}

/**
 * WSOLA time-stretch. Returns a buffer of length ≈ x.length * alpha with the
 * pitch of `x` preserved. alpha > 1 stretches (slower), alpha < 1 shortens.
 */
export function wsola(
  x: Float32Array,
  alpha: number,
  sampleRate: number,
  opts: PitchShiftOptions = {},
): Float32Array {
  if (alpha === 1) return x.slice();

  const L = Math.max(512, Math.round(sampleRate * 0.033));   // ~33 ms grain
  const Hs = Math.round(L / 4);                               // 75% overlap (COLA)
  const Ha = Hs / alpha;
  const win = hann(L);
  const outLen = Math.max(1, Math.round(x.length * alpha));
  const out = new Float32Array(outLen + L);
  const overlap = Hs;                       // correlation reference length
  const search = Math.round((opts.searchSec ?? 0.015) * sampleRate);
  const nFrames = Math.ceil(outLen / Hs) + 1;
  const lastStart = x.length - L - 1;

  for (let f = 0; f < nFrames; f++) {
    if (opts.shouldCancel?.()) break;
    const syn = f * Hs;
    const ana = f * Ha;
    let best = Math.max(0, Math.min(lastStart, Math.round(ana)));

    if (f > 0 && lastStart > 0 && search > 4) {
      // coarse pass (step 4) then a short refinement — much cheaper than a
      // dense search, alignment quality is the same for speech.
      const lo = Math.max(0, Math.round(ana) - search);
      const hi = Math.min(lastStart, Math.round(ana) + search);
      let bestScore = -2;
      for (let q = lo; q <= hi; q += 4) {
        const s = ncc(x, q, out, syn, overlap);
        if (s > bestScore) {
          bestScore = s;
          best = q;
        }
      }
      const rLo = Math.max(0, best - 4);
      const rHi = Math.min(lastStart, best + 4);
      for (let q = rLo; q <= rHi; q++) {
        const s = ncc(x, q, out, syn, overlap);
        if (s > bestScore) {
          bestScore = s;
          best = q;
        }
      }
    }

    // overlap-add the chosen grain
    const stop = Math.min(x.length, best + L);
    for (let i = 0; i < stop - best; i++) {
      const o = syn + i;
      if (o >= out.length) break;
      out[o] += x[best + i] * win[i];
    }

    if (opts.onProgress && (f & 63) === 0) {
      opts.onProgress(Math.min(1, syn / outLen));
    }
  }

  // Hann @ 75% overlap sums to 2.0 in the interior (COLA)
  const res = new Float32Array(outLen);
  const norm = 0.5;
  for (let i = 0; i < outLen; i++) res[i] = out[i] * norm;
  opts.onProgress?.(1);
  return res;
}

/**
 * Duration-preserving pitch shift. `semitones` > 0 raises pitch, < 0 lowers.
 * Returns a buffer whose length matches the input.
 */
export function pitchShift(
  x: Float32Array,
  sampleRate: number,
  semitones: number,
  opts: PitchShiftOptions = {},
): Float32Array {
  if (Math.abs(semitones) < 0.05) return x.slice();
  const r = Math.pow(2, semitones / 12);
  const y = resampleBy(x, r);
  const z = wsola(y, r, sampleRate, opts);
  if (z.length === x.length) return z;
  const out = new Float32Array(x.length);
  const n = Math.min(z.length, out.length);
  out.set(z.subarray(0, n));
  return out;
}

/** Process every channel of an AudioBuffer-like structure. */
export function pitchShiftChannels(
  channels: Float32Array[],
  sampleRate: number,
  semitones: number,
  opts: PitchShiftOptions = {},
): Float32Array[] {
  if (Math.abs(semitones) < 0.05) return channels.map((c) => c.slice());
  return channels.map((c, idx) =>
    pitchShift(c, sampleRate, semitones, {
      ...opts,
      onProgress: opts.onProgress ? (p) => opts.onProgress!((idx + p) / channels.length) : undefined,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* measurement helpers                                                 */
/* ------------------------------------------------------------------ */

export function rmsOf(x: Float32Array): number {
  if (!x.length) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

export function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function dbFromLinear(v: number): number {
  return 20 * Math.log10(Math.max(1e-7, v));
}

export function linearFromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * True-peak estimate: 4x linear-interpolated oversampling of each channel.
 * This is an ESTIMATE (no band-limited FIR), good enough to catch inter-sample
 * overs and to report a credible peak number. Reported as such in diagnostics.
 */
export function truePeakDb(channels: Float32Array[], oversample = 4): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i];
      const b = ch[i + 1];
      const step = (b - a) / oversample;
      for (let k = 1; k < oversample; k++) {
        const v = Math.abs(a + step * k);
        if (v > peak) peak = v;
      }
      const av = Math.abs(a);
      if (av > peak) peak = av;
    }
  }
  return dbFromLinear(peak);
}

/** Apply a flat gain (dB) to every sample, hard-clipping at ±1 as a last resort. */
export function applyGainDb(channels: Float32Array[], gainDb: number): void {
  if (Math.abs(gainDb) < 0.001) return;
  const g = linearFromDb(gainDb);
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * g;
      ch[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
}

/**
 * Loudness staging: move the buffer toward `targetDbFS` RMS without allowing
 * more than `maxGainDb` of boost (never blind-boost a quiet source).
 */
export function stageRms(channels: Float32Array[], targetDbFS = -20, maxGainDb = 12): number {
  let sum = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      sum += ch[i] * ch[i];
      n++;
    }
  }
  if (!n) return 0;
  const rmsDb = dbFromLinear(Math.sqrt(sum / n));
  const want = Math.max(-maxGainDb, Math.min(maxGainDb, targetDbFS - rmsDb));
  applyGainDb(channels, want);
  return want;
}
