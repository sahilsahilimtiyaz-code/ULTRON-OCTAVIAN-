/**
 * dsp-check.mjs — headless numeric checks for src/voice/dsp.ts.
 *
 * The pitch shifter is the one part of the voice engine that can be verified
 * objectively without a browser or credentials, so it gets verified:
 *   1. duration is preserved exactly,
 *   2. pitch actually moves by the requested number of semitones,
 *   3. output is finite, roughly unity gain, and not clipped,
 *   4. zero shift is a bit-exact pass-through.
 *
 * Run with: npm run check:dsp   (bundles the TS module with esbuild first)
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'node_modules', '.cache', 'dsp-check.mjs');

await build({
  entryPoints: [path.join(root, 'src/voice/dsp.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'error',
});

const dsp = await import(outFile);
const { resampleBy, wsola, pitchShift, stageRms, truePeakDb, rmsOf } = dsp;

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** synthetic voiced signal: F0 with harmonics + a breathy noise floor */
function voiceLike(f0, sr, sec) {
  const n = Math.floor(sr * sec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 8) * Math.min(1, (sec - t) * 8);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / (h * 1.3);
    x[i] = env * (s * 0.7 + (Math.random() * 2 - 1) * 0.02);
  }
  return x;
}

/** autocorrelation F0 estimate (same idea the analysis module uses) */
function measureF0(x, sr, minHz = 50, maxHz = 300) {
  const lagMin = Math.floor(sr / maxHz);
  const lagMax = Math.floor(sr / minHz);
  let best = lagMin;
  let bestVal = -Infinity;
  const from = Math.floor(x.length * 0.25);
  const to = Math.floor(x.length * 0.75);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = from; i + lag < to; i += 2) sum += x[i] * x[i + lag];
    if (sum > bestVal) {
      bestVal = sum;
      best = lag;
    }
  }
  return sr / best;
}

const SR = 48000;
const src = voiceLike(78, SR, 2.0); // deep male baritone, right in ULTRON range
const srcF0 = measureF0(src, SR);

console.log(`source: ${src.length} samples @ ${SR} Hz, measured F0 = ${srcF0.toFixed(2)} Hz\n`);

/* 1 + 3. zero shift passes through */
{
  const out = pitchShift(src, SR, 0);
  let identical = out.length === src.length;
  for (let i = 0; identical && i < src.length; i++) if (out[i] !== src[i]) identical = false;
  check('zero semitones = bit-exact pass-through', identical);
}

/* 1. duration preserved for every shift amount */
for (const st of [-4, -3, -2, -1, 1, 2]) {
  const out = pitchShift(src, SR, st);
  check(`duration preserved at ${st > 0 ? '+' : ''}${st} st`, out.length === src.length,
    `${src.length} -> ${out.length} samples`);
}

/* 2. pitch moves by the requested amount */
for (const st of [-4, -3, -2, 2]) {
  const out = pitchShift(src, SR, st);
  const got = measureF0(out, SR);
  const want = srcF0 * Math.pow(2, st / 12);
  const errSemis = 12 * Math.log2(got / want);
  check(`pitch at ${st > 0 ? '+' : ''}${st} st within 0.5 semitone`, Math.abs(errSemis) < 0.5,
    `want ${want.toFixed(2)} Hz, got ${got.toFixed(2)} Hz (${errSemis.toFixed(3)} st error)`);
}

/* 3. finite, unity-ish gain, not clipped */
for (const st of [-4, 2]) {
  const out = pitchShift(src, SR, st);
  let finite = true;
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) { finite = false; break; }
  const ratio = rmsOf(out) / rmsOf(src);
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  check(`output sane at ${st > 0 ? '+' : ''}${st} st`, finite && ratio > 0.6 && ratio < 1.6 && peak <= 1.001,
    `rms ratio ${ratio.toFixed(3)}, peak ${peak.toFixed(3)}`);
}

/* 4. wsola keeps COLA gain ~1 on a steady tone */
{
  const tone = voiceLike(120, SR, 1.0);
  const stretched = wsola(tone, 1.0 + 0.37, SR);
  const ratio = rmsOf(stretched) / rmsOf(tone);
  check('wsola unity-ish gain when stretching', ratio > 0.6 && ratio < 1.6, `rms ratio ${ratio.toFixed(3)}`);
  check('wsola length follows alpha', Math.abs(stretched.length - tone.length * 1.37) <= 4,
    `expected ~${Math.round(tone.length * 1.37)}, got ${stretched.length}`);
}

/* 5. resample: shorter/longer + frequency moved the right way */
{
  const y = resampleBy(src, 0.84);
  check('resampleBy(0.84) length ≈ N/0.84', Math.abs(y.length - Math.floor(src.length / 0.84)) <= 1,
    `got ${y.length}`);
  const f = measureF0(y, SR);
  check('resampleBy(0.84) lowers frequency', Math.abs(f - srcF0 * 0.84) < srcF0 * 0.05,
    `measured ${f.toFixed(2)} Hz vs ${ (srcF0 * 0.84).toFixed(2)} Hz`);
}

/* 6. helpers behave */
{
  const ch = [src.slice()];
  const applied = stageRms(ch, -20, 12);
  const tp = truePeakDb(ch);
  check('stageRms moves toward target', Math.abs(20 * Math.log10(rmsOf(ch[0]) + 1e-9) - (-20)) < 1.5,
    `applied ${applied.toFixed(2)} dB, rms now ${(20 * Math.log10(rmsOf(ch[0]))).toFixed(2)} dBFS`);
  check('truePeakDb reports a sane peak', tp > -40 && tp < 3, `${tp.toFixed(2)} dBTP`);
}

console.log(`\n${failures === 0 ? 'ALL DSP CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
