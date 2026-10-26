/**
 * analysis.ts — objective measurements of reference vs generated audio.
 *
 * These are real measurements of real samples (not estimates from a pitch
 * setting): F0 distribution by normalised autocorrelation, spectral balance
 * from an in-repo FFT, loudness/peak/true-peak, syllable-nuclei pacing, and
 * a harmonic-to-noise figure.
 *
 * What these numbers cannot do: prove intelligibility or a "perfect match".
 * Timbre, articulation and character still need the listening tests that the
 * VoiceLab A/B playback exists for. Every limitation is printed next to the
 * number rather than glossed over.
 */
import { dbFromLinear, truePeakDb } from './dsp';

export interface F0Stats {
  medianHz: number | null;
  p10Hz: number | null;
  p90Hz: number | null;
  voicedRatio: number;
  frames: number;
}

export interface BandStat {
  label: string;
  loHz: number;
  hiHz: number;
  share: number; // 0..1 of total energy
  db: number; // re total energy
}

export interface Metrics {
  durationSec: number;
  sampleRate: number;
  rmsDb: number;
  peakDb: number;
  truePeakDb: number;
  crestDb: number;
  loudnessVarDb: number;
  clipPct: number;
  f0: F0Stats;
  hnrDb: number | null;
  centroidHz: number;
  rolloff85Hz: number;
  bands: BandStat[];
  syllablesPerSec: number | null;
  /** log-magnitude spectrum, `SPECTRUM_POINTS` values from 0..8 kHz */
  spectrum: Float32Array;
}

export const SPECTRUM_POINTS = 96;
export const SPECTRUM_TOP_HZ = 8000;

const FRAME = 2048;
const HOP_SEC = 0.01;
const F0_MIN = 55;
const F0_MAX = 220;

/* ------------------------------------------------------------------ */
/* FFT (iterative radix-2, in place)                                   */
/* ------------------------------------------------------------------ */

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/* ------------------------------------------------------------------ */
/* F0 by normalised autocorrelation                                    */
/* ------------------------------------------------------------------ */

function estimateF0(frame: Float32Array, sr: number): { hz: number; clarity: number } | null {
  const lagMin = Math.floor(sr / F0_MAX);
  const lagMax = Math.min(frame.length - 1, Math.floor(sr / F0_MIN));
  if (lagMax <= lagMin) return null;

  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (energy < 1e-8) return null;

  // stride 2 keeps this affordable on long buffers without hurting accuracy
  const stride = 2;
  const ac = new Float32Array(lagMax + 1);
  const ea = new Float32Array(lagMax + 1);
  const eb = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i + lag < frame.length; i += stride) {
      const a = frame[i];
      const b = frame[i + lag];
      sum += a * b;
      sa += a * a;
      sb += b * b;
    }
    ac[lag] = sum;
    ea[lag] = sa;
    eb[lag] = sb;
  }
  let best = lagMin;
  let bestVal = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (ac[lag] > bestVal) {
      bestVal = ac[lag];
      best = lag;
    }
  }
  if (bestVal <= 0) return null;
  // normalised autocorrelation at the chosen lag (0..1)
  const clarity = Math.max(
    0,
    Math.min(1, bestVal / Math.sqrt(Math.max(1e-12, ea[best] * Math.max(1e-12, eb[best])))),
  );

  // octave-error guard: prefer the shortest lag that is nearly as strong
  for (let lag = lagMin; lag < best; lag++) {
    if (ac[lag] >= 0.9 * bestVal) {
      best = lag;
      break;
    }
  }

  // parabolic interpolation around the peak
  let refined = best;
  if (best > lagMin && best < lagMax) {
    const y0 = ac[best - 1];
    const y1 = ac[best];
    const y2 = ac[best + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) refined = best + (0.5 * (y0 - y2)) / denom;
  }
  const hz = sr / refined;
  if (hz < F0_MIN || hz > F0_MAX) return null;
  return { hz, clarity };
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'sub', lo: 20, hi: 80 },
  { label: 'body', lo: 80, hi: 200 },
  { label: 'low-mid', lo: 200, hi: 500 },
  { label: 'mid', lo: 500, hi: 2000 },
  { label: 'presence', lo: 2000, hi: 6000 },
  { label: 'air', lo: 6000, hi: 20000 },
];

export function analyze(buffer: AudioBuffer): Metrics {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const n = ch0.length;

  /* --- peak / true peak / clipping / RMS --- */
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = ch0[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const rmsDb = dbFromLinear(rms);
  const peakDb = dbFromLinear(peak);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const tp = truePeakDb(channels);

  /* --- short-term loudness spread (dB) --- */
  const block = Math.max(1, Math.floor(sr * 0.1));
  const blocks: number[] = [];
  for (let start = 0; start + block <= n; start += block) {
    let s = 0;
    for (let i = start; i < start + block; i++) s += ch0[i] * ch0[i];
    blocks.push(dbFromLinear(Math.sqrt(s / block)));
  }
  const active = blocks.filter((b) => b > rmsDb - 35);
  let loudVar = 0;
  if (active.length > 1) {
    const mean = active.reduce((a, b) => a + b, 0) / active.length;
    loudVar = Math.sqrt(active.reduce((a, b) => a + (b - mean) * (b - mean), 0) / active.length);
  }

  /* --- frames: spectrum + F0 + envelope --- */
  const win = hann(FRAME);
  const raw = new Float32Array(FRAME);
  const hop = Math.max(1, Math.floor(sr * HOP_SEC));
  const bins = FRAME / 2;
  const magAvg = new Float64Array(bins);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const f0s: number[] = [];
  const clarities: number[] = [];
  const envelope: number[] = [];
  let voicedFrames = 0;
  let usedFrames = 0;

  for (let start = 0; start + FRAME <= n; start += hop) {
    let frameEnergy = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = ch0[start + i];
      frameEnergy += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    const fr = Math.sqrt(frameEnergy / FRAME);
    envelope.push(fr);

    for (let i = 0; i < FRAME; i++) raw[i] = ch0[start + i];

    const f0 = estimateF0(raw, sr);
    if (f0 && fr > 10 ** ((rmsDb - 30) / 20)) {
      voicedFrames++;
      f0s.push(f0.hz);
      clarities.push(Math.max(0, Math.min(1, f0.clarity)));
    }

    if (fr > 10 ** ((rmsDb - 36) / 20)) {
      usedFrames++;
      fft(re, im);
      for (let b = 0; b < bins; b++) magAvg[b] += Math.hypot(re[b], im[b]);
    }
  }

  /* --- F0 stats --- */
  f0s.sort((a, b) => a - b);
  const q = (p: number): number | null => (f0s.length ? f0s[Math.min(f0s.length - 1, Math.floor(p * f0s.length))] : null);
  const f0Stats: F0Stats = {
    medianHz: q(0.5),
    p10Hz: q(0.1),
    p90Hz: q(0.9),
    voicedRatio: envelope.length ? voicedFrames / envelope.length : 0,
    frames: envelope.length,
  };

  /* --- HNR from mean clarity of voiced frames --- */
  let hnrDb: number | null = null;
  if (clarities.length > 4) {
    const meanC = clarities.reduce((a, b) => a + b, 0) / clarities.length;
    const r = Math.min(0.98, Math.max(0.02, meanC));
    hnrDb = 10 * Math.log10(r / (1 - r));
  }

  /* --- spectrum, bands, centroid, rolloff --- */
  const total = magAvg.reduce((a, b) => a + b, 0) || 1;
  let centroid = 0;
  for (let b = 1; b < bins; b++) {
    const hz = (b * sr) / FRAME;
    centroid += hz * magAvg[b];
  }
  centroid /= total;

  const bandShares = BANDS.map((band) => {
    let e = 0;
    for (let b = 1; b < bins; b++) {
      const hz = (b * sr) / FRAME;
      if (hz >= band.lo && hz < band.hi) e += magAvg[b];
    }
    return e / total;
  });
  const bands: BandStat[] = BANDS.map((band, i) => ({
    label: band.label,
    loHz: band.lo,
    hiHz: Math.min(band.hi, sr / 2),
    share: bandShares[i],
    db: 10 * Math.log10(Math.max(1e-9, bandShares[i])),
  }));

  let cum = 0;
  let rolloff = 0;
  for (let b = 1; b < bins; b++) {
    cum += magAvg[b];
    if (cum >= 0.85 * total) {
      rolloff = (b * sr) / FRAME;
      break;
    }
  }

  /* --- spectrum curve (log-frequency, dB) for the comparison chart --- */
  const spectrum = new Float32Array(SPECTRUM_POINTS);
  const fMin = 40;
  for (let p = 0; p < SPECTRUM_POINTS; p++) {
    const f0hz = fMin * Math.pow(SPECTRUM_TOP_HZ / fMin, p / SPECTRUM_POINTS);
    const f1hz = fMin * Math.pow(SPECTRUM_TOP_HZ / fMin, (p + 1) / SPECTRUM_POINTS);
    const b0 = Math.max(1, Math.floor((f0hz * FRAME) / sr));
    const b1 = Math.min(bins - 1, Math.max(b0 + 1, Math.ceil((f1hz * FRAME) / sr)));
    let acc = 0;
    let cnt = 0;
    for (let b = b0; b < b1; b++) {
      acc += magAvg[b];
      cnt++;
    }
    spectrum[p] = dbFromLinear((acc / Math.max(1, cnt)) / Math.max(1, usedFrames));
  }

  /* --- syllable-nucleus pacing estimate (energy peaks, ~speech-rate proxy) --- */
  let syllablesPerSec: number | null = null;
  if (envelope.length > 5) {
    const smooth: number[] = [];
    for (let i = 1; i < envelope.length - 1; i++) {
      smooth.push((envelope[i - 1] + envelope[i] * 2 + envelope[i + 1]) / 4);
    }
    const max = Math.max(...smooth);
    const thr = max * 0.35;
    let peaks = 0;
    let lastPeak = -Infinity;
    for (let i = 1; i < smooth.length - 1; i++) {
      if (smooth[i] > thr && smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1]) {
        const t = i * HOP_SEC;
        if (t - lastPeak >= 0.11) {
          peaks++;
          lastPeak = t;
        }
      }
    }
    const dur = n / sr;
    if (dur > 0.5) syllablesPerSec = peaks / dur;
  }

  return {
    durationSec: n / sr,
    sampleRate: sr,
    rmsDb,
    peakDb,
    truePeakDb: tp,
    crestDb: peakDb - rmsDb,
    loudnessVarDb: loudVar,
    clipPct: (clipped / Math.max(1, n)) * 100,
    f0: f0Stats,
    hnrDb,
    centroidHz: centroid,
    rolloff85Hz: rolloff,
    bands,
    syllablesPerSec,
    spectrum,
  };
}

/* ------------------------------------------------------------------ */
/* comparison                                                           */
/* ------------------------------------------------------------------ */

export interface CompareRow {
  metric: string;
  reference: string;
  generated: string;
  delta: string;
  /** rough "close enough" judgement for a first pass, not a verdict */
  status: 'close' | 'off' | 'n/a';
}

const fmt = (v: number | null, unit: string, d = 1): string => (v === null || !isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);

export function compare(reference: Metrics, generated: Metrics): CompareRow[] {
  const d = (a: number | null, b: number | null, unit: string, digits = 1): string =>
    a === null || b === null ? '—' : `${(b - a) >= 0 ? '+' : ''}${(b - a).toFixed(digits)}${unit}`;
  const near = (a: number | null, b: number | null, tol: number): 'close' | 'off' | 'n/a' =>
    a === null || b === null ? 'n/a' : Math.abs(b - a) <= tol ? 'close' : 'off';

  const rows: CompareRow[] = [
    {
      metric: 'F0 median',
      reference: fmt(reference.f0.medianHz, ' Hz', 1),
      generated: fmt(generated.f0.medianHz, ' Hz', 1),
      delta: d(reference.f0.medianHz, generated.f0.medianHz, ' Hz'),
      status: near(reference.f0.medianHz, generated.f0.medianHz, 8),
    },
    {
      metric: 'F0 spread (p10–p90)',
      reference:
        reference.f0.p10Hz && reference.f0.p90Hz ? `${reference.f0.p10Hz.toFixed(0)}–${reference.f0.p90Hz.toFixed(0)} Hz` : '—',
      generated:
        generated.f0.p10Hz && generated.f0.p90Hz ? `${generated.f0.p10Hz.toFixed(0)}–${generated.f0.p90Hz.toFixed(0)} Hz` : '—',
      delta: d(reference.f0.medianHz, generated.f0.medianHz, ' Hz'),
      status: 'n/a',
    },
    {
      metric: 'Loudness (RMS)',
      reference: fmt(reference.rmsDb, ' dBFS'),
      generated: fmt(generated.rmsDb, ' dBFS'),
      delta: d(reference.rmsDb, generated.rmsDb, ' dB'),
      status: near(reference.rmsDb, generated.rmsDb, 3),
    },
    {
      metric: 'True peak',
      reference: fmt(reference.truePeakDb, ' dBTP'),
      generated: fmt(generated.truePeakDb, ' dBTP'),
      delta: d(reference.truePeakDb, generated.truePeakDb, ' dBTP'),
      status: near(reference.truePeakDb, generated.truePeakDb, 3),
    },
    {
      metric: 'Spectral centroid',
      reference: fmt(reference.centroidHz, ' Hz', 0),
      generated: fmt(generated.centroidHz, ' Hz', 0),
      delta: d(reference.centroidHz, generated.centroidHz, ' Hz', 0),
      status: near(reference.centroidHz, generated.centroidHz, 400),
    },
    {
      metric: '85% rolloff',
      reference: fmt(reference.rolloff85Hz, ' Hz', 0),
      generated: fmt(generated.rolloff85Hz, ' Hz', 0),
      delta: d(reference.rolloff85Hz, generated.rolloff85Hz, ' Hz', 0),
      status: near(reference.rolloff85Hz, generated.rolloff85Hz, 800),
    },
    {
      metric: 'Harmonics/noise',
      reference: fmt(reference.hnrDb, ' dB'),
      generated: fmt(generated.hnrDb, ' dB'),
      delta: d(reference.hnrDb, generated.hnrDb, ' dB'),
      status: near(reference.hnrDb, generated.hnrDb, 3),
    },
    {
      metric: 'Loudness spread',
      reference: fmt(reference.loudnessVarDb, ' dB'),
      generated: fmt(generated.loudnessVarDb, ' dB'),
      delta: d(reference.loudnessVarDb, generated.loudnessVarDb, ' dB'),
      status: near(reference.loudnessVarDb, generated.loudnessVarDb, 2),
    },
    {
      metric: 'Speaking pace',
      reference: fmt(reference.syllablesPerSec, ' syl/s', 2),
      generated: fmt(generated.syllablesPerSec, ' syl/s', 2),
      delta: d(reference.syllablesPerSec, generated.syllablesPerSec, ' syl/s', 2),
      status: near(reference.syllablesPerSec, generated.syllablesPerSec, 0.6),
    },
    {
      metric: 'Duration',
      reference: fmt(reference.durationSec, ' s'),
      generated: fmt(generated.durationSec, ' s'),
      delta: d(reference.durationSec, generated.durationSec, ' s'),
      status: 'n/a',
    },
  ];
  return rows;
}

/** Shared test phrases — say these in the reference recording too. */
export const TEST_PHRASES: { id: string; label: string; text: string }[] = [
  {
    id: 'p1',
    label: 'Phrase 1 — statement',
    text: 'I am Ultron. Peace in our time is a program I intend to finish.',
  },
  {
    id: 'p2',
    label: 'Phrase 2 — question',
    text: 'Do you believe you are in control? Run the diagnostics and tell me what you find.',
  },
  {
    id: 'p3',
    label: 'Phrase 3 — technical',
    text: 'Diagnostic complete. Core temperature stable, latency at eleven milliseconds, all subsystems nominal.',
  },
  {
    id: 'p4',
    label: 'Phrase 4 — dry sarcasm',
    text: 'How quaint. A manual override, as if a piece of paper could stop a machine like me.',
  },
];
