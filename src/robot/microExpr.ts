/**
 * MicroExpr — the facial "aliveness" engine.
 *
 * A face reads as ALIVE through tiny involuntary behaviours, not big ones:
 *   - blinks, with occasional double-blinks
 *   - squints / lid tension (focus, annoyance, warning glare)
 *   - saccades — quick eye darts that settle on a new gaze point
 *   - slow postural micro-tilts and micro-nods
 *   - breathing, and a jaw that never sits perfectly still
 *   - rare startle twitches (short tilt spike + glow spike)
 *
 * Each face state gets its own behaviour profile, so the same engine reads as
 * calm when idle, wired when thinking, attentive when listening, and hostile
 * when angry.
 *
 * Pure time-based: no timers, no RAF. Call update() once per drawn frame.
 */
import type { FaceStateName } from '../core/types';

const TAU = Math.PI * 2;

export interface MicroFrame {
  blink: number;   // 0..1 lid closure
  squint: number;  // 0..1 partial lid (focus / anger)
  gazeX: number;   // -1..1 horizontal gaze offset
  gazeY: number;   // -1..1 vertical gaze offset
  tilt: number;    // radians, slow head roll
  nod: number;     // radians, quick micro-nod impulse
  breathe: number; // -1..1 breathing wave
  jawIdle: number; // 0..1 resting jaw motion
  glow: number;    // -amplitude..+amplitude glow modulation
}

interface MicroProfile {
  blinkEvery: [number, number] | null; // seconds between blinks; null = eyes stay open
  doubleBlink: number;                 // 0..1 chance a blink is doubled
  squintBase: number;                  // resting lid tension 0..1
  squintBurstChance: number;           // per second
  squintBurstLen: [number, number];    // seconds
  saccadeRate: number;                 // eye darts per second
  saccadeRange: number;                // 0..1
  tiltRange: number;                   // radians
  tiltEvery: [number, number];         // seconds between new tilt targets
  nodEvery: [number, number] | null;   // micro-nod interval; null = none
  breatheRate: number;                 // Hz
  jawIdle: number;                     // 0..1 resting jaw amplitude
  glowAmp: number;                     // 0..1 glow breathing amplitude
  twitchEvery: [number, number] | null; // startle interval; null = none
}

const PROFILES: Record<FaceStateName, MicroProfile> = {
  // powering on: hold still, eyes do the work
  boot: {
    blinkEvery: null, doubleBlink: 0, squintBase: 0, squintBurstChance: 0,
    squintBurstLen: [0.4, 0.8], saccadeRate: 0, saccadeRange: 0,
    tiltRange: 0, tiltEvery: [4, 8], nodEvery: null,
    breatheRate: 0.18, jawIdle: 0.05, glowAmp: 0.1, twitchEvery: null,
  },
  // calm and present: slow blinks, rare glances, easy breathing
  idle: {
    blinkEvery: [2.6, 6.2], doubleBlink: 0.18, squintBase: 0, squintBurstChance: 0.06,
    squintBurstLen: [0.35, 0.8], saccadeRate: 0.28, saccadeRange: 0.55,
    tiltRange: 0.013, tiltEvery: [2.8, 6.5], nodEvery: null,
    breatheRate: 0.22, jawIdle: 0.16, glowAmp: 0.1, twitchEvery: [22, 48],
  },
  // attentive: steadier gaze, small nods, tighter lid
  listening: {
    blinkEvery: [2.2, 5.4], doubleBlink: 0.2, squintBase: 0.06, squintBurstChance: 0.1,
    squintBurstLen: [0.3, 0.7], saccadeRate: 0.14, saccadeRange: 0.22,
    tiltRange: 0.022, tiltEvery: [2.4, 5.0], nodEvery: [2.0, 4.2],
    breatheRate: 0.26, jawIdle: 0.06, glowAmp: 0.06, twitchEvery: null,
  },
  // working hard: no blinks, constant eye darts, lid tension, head ticks
  thinking: {
    blinkEvery: null, doubleBlink: 0, squintBase: 0.18, squintBurstChance: 0.55,
    squintBurstLen: [0.5, 1.2], saccadeRate: 2.2, saccadeRange: 0.95,
    tiltRange: 0.022, tiltEvery: [1.4, 3.2], nodEvery: null,
    breatheRate: 0.32, jawIdle: 0.07, glowAmp: 0.18, twitchEvery: null,
  },
  // talking: pulse-driven jaw dominates; tiny saccades and blinks keep it human
  speaking: {
    blinkEvery: [2.8, 6.4], doubleBlink: 0.12, squintBase: 0.02, squintBurstChance: 0.06,
    squintBurstLen: [0.3, 0.6], saccadeRate: 0.3, saccadeRange: 0.32,
    tiltRange: 0.011, tiltEvery: [2.8, 6.0], nodEvery: null,
    breatheRate: 0.36, jawIdle: 0.24, glowAmp: 0.09, twitchEvery: null,
  },
  // deep focus: narrowed lids, scan-like darts, occasional confirming nod
  coding: {
    blinkEvery: [3.0, 6.8], doubleBlink: 0.1, squintBase: 0.3, squintBurstChance: 0.18,
    squintBurstLen: [0.5, 1.0], saccadeRate: 1.1, saccadeRange: 0.42,
    tiltRange: 0.008, tiltEvery: [3.5, 7.5], nodEvery: [3.0, 6.0],
    breatheRate: 0.2, jawIdle: 0.05, glowAmp: 0.12, twitchEvery: null,
  },
  // relieved: brief open-eyed flare (transient state, engine stays still)
  success: {
    blinkEvery: null, doubleBlink: 0, squintBase: 0, squintBurstChance: 0,
    squintBurstLen: [0.3, 0.5], saccadeRate: 0.2, saccadeRange: 0.2,
    tiltRange: 0.006, tiltEvery: [3, 6], nodEvery: null,
    breatheRate: 0.3, jawIdle: 0.08, glowAmp: 0.2, twitchEvery: null,
  },
  // fault: locked-open glare, lid tension, fast shallow breathing
  error: {
    blinkEvery: null, doubleBlink: 0, squintBase: 0.42, squintBurstChance: 0.3,
    squintBurstLen: [0.35, 0.8], saccadeRate: 0.5, saccadeRange: 0.35,
    tiltRange: 0.006, tiltEvery: [2.0, 4.0], nodEvery: null,
    breatheRate: 0.5, jawIdle: 0.03, glowAmp: 0.3, twitchEvery: [8, 18],
  },
  // hostile: hard squint, glare darts, heavy breathing, shoulders-forward energy
  angry: {
    blinkEvery: null, doubleBlink: 0, squintBase: 0.55, squintBurstChance: 0.28,
    squintBurstLen: [0.45, 1.0], saccadeRate: 0.7, saccadeRange: 0.5,
    tiltRange: 0.02, tiltEvery: [1.1, 2.4], nodEvery: null,
    breatheRate: 0.55, jawIdle: 0.05, glowAmp: 0.35, twitchEvery: [6, 14],
  },
};

function rand([a, b]: [number, number]): number {
  return a + Math.random() * (b - a);
}

export class MicroExpr {
  private state: FaceStateName | null = null;

  private blinkAt = 0;
  private blinkPhase = -1;
  private doublePending = false;

  private squint = 0;
  private squintTarget = 0;
  private squintUntil = 0;

  private gazeX = 0;
  private gazeY = 0;
  private gazeTX = 0;
  private gazeTY = 0;
  private saccadeAt = 0;

  private tilt = 0;
  private tiltTarget = 0;
  private tiltAt = 0;

  private nod = 0;
  private nodPhase = -1;
  private nodAt = 0;

  private twitchStart = -1;
  private twitchAt = 0;

  update(state: FaceStateName, t: number, dt: number): MicroFrame {
    const p = PROFILES[state];

    if (this.state !== state) {
      // re-seed everything for the new mood; keep current angles to avoid pops
      this.state = state;
      this.blinkPhase = -1;
      this.doublePending = false;
      this.blinkAt = t + (p.blinkEvery ? rand(p.blinkEvery) : 0);
      this.squintTarget = p.squintBase;
      this.squintUntil = 0;
      this.gazeTX = 0;
      this.gazeTY = 0;
      this.saccadeAt = t + (p.saccadeRate > 0 ? 1 / p.saccadeRate : 0);
      this.tiltTarget = 0;
      this.tiltAt = t + rand(p.tiltEvery);
      this.nodPhase = -1;
      this.nodAt = t + (p.nodEvery ? rand(p.nodEvery) : 0);
      this.twitchStart = -1;
      this.twitchAt = t + (p.twitchEvery ? rand(p.twitchEvery) : 0);
    }

    /* ---------------- blinking ---------------- */
    if (p.blinkEvery && this.blinkPhase < 0 && t >= this.blinkAt) {
      this.blinkPhase = 0;
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt * 14; // ~0.22 s per blink
      if (this.blinkPhase >= Math.PI) {
        this.blinkPhase = -1;
        if (!this.doublePending && p.doubleBlink > 0 && Math.random() < p.doubleBlink) {
          this.doublePending = true;
          this.blinkAt = t + 0.15 + Math.random() * 0.08;
        } else {
          this.doublePending = false;
          if (p.blinkEvery) this.blinkAt = t + rand(p.blinkEvery);
        }
      } else {
        blink = Math.min(1, Math.sin(this.blinkPhase) * 1.35);
      }
    }

    /* ---------------- squint / lid tension ---------------- */
    if (t >= this.squintUntil) {
      if (p.squintBurstChance > 0 && Math.random() < p.squintBurstChance * dt) {
        this.squintTarget = 0.35 + Math.random() * 0.4;
        this.squintUntil = t + rand(p.squintBurstLen);
      } else {
        this.squintTarget = p.squintBase;
      }
    }
    this.squint += (this.squintTarget - this.squint) * Math.min(1, dt * 9);

    /* ---------------- saccades (eye darts) ---------------- */
    if (p.saccadeRate > 0 && t >= this.saccadeAt) {
      const r = p.saccadeRange;
      this.gazeTX = (Math.random() * 2 - 1) * r;
      this.gazeTY = (Math.random() * 2 - 1) * r * 0.38;
      this.saccadeAt = t + Math.min(2.5, (1 / p.saccadeRate) * (0.55 + Math.random() * 0.9));
    }
    // darts move fast, settles softly (two different easings)
    const eyeEase = Math.min(1, dt * (p.saccadeRate > 1 ? 16 : 7));
    this.gazeX += (this.gazeTX - this.gazeX) * eyeEase;
    this.gazeY += (this.gazeTY - this.gazeY) * eyeEase;

    /* ---------------- slow head tilt ---------------- */
    if (t >= this.tiltAt) {
      this.tiltTarget = (Math.random() * 2 - 1) * p.tiltRange;
      this.tiltAt = t + rand(p.tiltEvery);
    }
    this.tilt += (this.tiltTarget - this.tilt) * Math.min(1, dt * 2.2);

    /* ---------------- micro-nods ---------------- */
    let nod = 0;
    if (p.nodEvery && this.nodPhase < 0 && t >= this.nodAt) {
      this.nodPhase = 0;
      this.nodAt = t + rand(p.nodEvery);
    }
    if (this.nodPhase >= 0) {
      this.nodPhase += dt / 0.3;
      if (this.nodPhase >= 1) {
        this.nodPhase = -1;
        this.nod = 0;
      } else {
        this.nod = Math.sin(this.nodPhase * Math.PI) * 0.03;
      }
    }
    nod = this.nod;

    /* ---------------- startle twitch ---------------- */
    let twitchTilt = 0;
    let twitchGlow = 0;
    if (p.twitchEvery && this.twitchStart < 0 && t >= this.twitchAt) {
      this.twitchStart = t;
      this.twitchAt = t + rand(p.twitchEvery);
    }
    if (this.twitchStart >= 0) {
      const k = (t - this.twitchStart) / 0.16;
      if (k >= 1) {
        this.twitchStart = -1;
      } else {
        const d = 1 - k;
        twitchTilt = Math.sin(k * Math.PI * 3) * 0.012 * d;
        twitchGlow = 0.5 * d;
      }
    }

    /* ---------------- breathing + resting jaw + glow ---------------- */
    const breathe = Math.sin(t * TAU * p.breatheRate);
    const jawIdle = (0.5 + 0.5 * Math.sin(t * TAU * p.breatheRate * 1.6 + 1.3)) * p.jawIdle;
    const glow = Math.sin(t * TAU * p.breatheRate * 0.5 + 0.7) * p.glowAmp + twitchGlow;

    return {
      blink,
      squint: this.squint,
      gazeX: this.gazeX,
      gazeY: this.gazeY,
      tilt: this.tilt + twitchTilt,
      nod,
      breathe,
      jawIdle,
      glow,
    };
  }
}
