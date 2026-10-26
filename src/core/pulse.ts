/**
 * Shared voice-energy pulse used by BOTH the waveform widget and the robot's
 * jaw animation so they stay perfectly in sync.
 *
 * Honest note: this is an energy envelope driven by time and speech events.
 * It is NOT phoneme-level viseme data. Accurate visemes are planned later.
 */
export type PulseMode = 'off' | 'listening' | 'speaking' | 'thinking';

let mode: PulseMode = 'off';
let energy = 0; // smoothed 0..1
let target = 0;
let bump = 0; // transient bump from speech boundary events

/* ------------------------------------------------------------------ */
/* Real audio measurements.                                            */
/*                                                                      */
/* When an AnalyserNode is available (playback chain, or mic meter) the */
/* measured RMS is pushed in here and drives the waveform AND the jaw.  */
/* When nothing is measurable — browser SpeechSynthesis output, a       */
/* browser without Web Audio — `realSource` stays null and the pulse    */
/* falls back to the synthetic envelope below. Diagnostics reports      */
/* which one is active, so fake motion is never presented as data.      */
/* ------------------------------------------------------------------ */

export type EnergySource = 'playback' | 'mic';

let realEnergy = 0;
let realSource: EnergySource | null = null;

/** Push a measured RMS (0..1), or null to release the channel. */
export function setRealEnergy(value: number | null, source: EnergySource = 'playback'): void {
  if (value === null) {
    if (realSource === source) {
      realSource = null;
      realEnergy = 0;
    }
    return;
  }
  realSource = source;
  realEnergy = Math.max(0, Math.min(1, value));
}

/** 'measured' when a real analyser is feeding the pulse, else 'synthetic'. */
export function energySource(): EnergySource | 'synthetic' {
  return realSource ?? 'synthetic';
}

export function setPulseMode(m: PulseMode): void {
  mode = m;
}

export function pulseMode(): PulseMode {
  return mode;
}

/** Called by voice layer on speech boundary events / mic activity. */
export function bumpPulse(strength = 1): void {
  bump = Math.min(1.5, bump + strength);
}

/** Smooth pseudo-random noise in [0,1], stable for a given time. */
function noise(t: number): number {
  const s = Math.sin(t * 2.17) * Math.sin(t * 1.31 + 1.7) * Math.sin(t * 0.53 + 0.4);
  return 0.5 + 0.5 * s;
}

/**
 * Returns the voice energy 0..1 at time t (seconds).
 * - listening: driven by smooth noise (mic analyser integration comes later)
 * - speaking: noise + boundary bumps
 * - thinking: low flicker
 * - off: near silence
 */
export function pulseAt(t: number): number {
  // measured audio wins whenever an analyser is actually running
  if (realSource !== null && (mode === 'speaking' || mode === 'listening')) {
    target = Math.min(1, realEnergy + bump * 0.5);
    return target;
  }

  let t0 = 0;
  switch (mode) {
    case 'listening':
      t0 = 0.25 + 0.7 * noise(t * 2.1);
      break;
    case 'speaking':
      t0 = 0.15 + 0.85 * noise(t * 3.3);
      break;
    case 'thinking':
      t0 = 0.08 + 0.1 * noise(t * 6);
      break;
    default:
      t0 = 0.03 + 0.02 * noise(t * 0.8);
  }
  target = Math.min(1, t0 + bump * 0.6);
  return target;
}

/** Per-frame smoother: call once per animation frame with dt. */
export function stepPulse(dt: number, t: number): number {
  const instant = pulseAt(t);
  bump = Math.max(0, bump - dt * 2.2);
  energy += (instant - energy) * Math.min(1, dt * 12);
  return energy;
}

export function currentPulse(): number {
  return energy;
}
