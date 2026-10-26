/**
 * Facial state machine — drives the procedural head through
 * IDLE / LISTENING / THINKING / SPEAKING / CODING / SUCCESS / ERROR
 * with smooth lerped transitions and micro-expressions.
 *
 * Motion respects prefers-reduced-motion (scaled down, never frozen hard).
 */
import * as THREE from 'three';
import type { FaceStateName } from '../core/types';
import { currentPulse } from '../core/pulse';
import type { HeadRefs } from './headBuilder';

const TAU = Math.PI * 2;

interface MotionFlags {
  scale: number; // 1 normal, ~0.3 reduced motion
}

export class FaceController {
  private refs: HeadRefs;
  private state: FaceStateName = 'boot';
  private stateTime = 0;
  private motion: MotionFlags = { scale: 1 };

  // smoothed head orientation targets
  private targetRX = 0;
  private targetRY = 0;
  private targetRZ = 0;
  private targetY = 0;

  // eye/blink bookkeeping
  private blinkTimer = 2 + Math.random() * 3;
  private blinkPhase = -1; // -1 = closed idle, 0..1 open
  private nextDart = 0;
  private dartX = 0;
  private dartY = 0;

  // drag interaction
  private userYaw = 0;
  private userPitch = 0;

  private root: THREE.Group;

  constructor(refs: HeadRefs, root: THREE.Group) {
    this.refs = refs;
    this.root = root;
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      this.motion.scale = mq.matches ? 0.25 : 1;
      mq.addEventListener?.('change', (e) => (this.motion.scale = e.matches ? 0.25 : 1));
    }
    this.setPoseImmediate(0, 0, 0);
  }

  setState(s: FaceStateName): void {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s === 'boot') this.setPoseImmediate(0, -0.9, 0); // start looking away, head turns on
  }

  setMotionScale(v: number): void {
    this.motion.scale = v;
  }

  /** Called by FaceCanvas when the user drags the face. */
  addDrag(dx: number, dy: number): void {
    this.userYaw = THREE.MathUtils.clamp(this.userYaw + dx, -0.6, 0.6);
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + dy, -0.35, 0.4);
  }

  private setPoseImmediate(rx: number, ry: number, rz: number): void {
    this.targetRX = rx;
    this.targetRY = ry;
    this.targetRZ = rz;
    this.refs.headGroup.rotation.set(rx, ry, rz);
  }

  /* ------------------------------------------------------------------ */

  update(dt: number, t: number): void {
    const s = this.state;
    this.stateTime += dt;
    const st = this.stateTime;
    const M = this.motion.scale;
    const refs = this.refs;

    /* ---------- per-state targets ---------- */
    switch (s) {
      case 'boot': {
        // power-on: head turns to face viewer, eyes flicker on
        const k = Math.min(1, st / 1.6);
        this.targetRY = -0.9 * (1 - k) * M;
        this.targetRX = -0.08 * M;
        let flick = 0.15;
        if (k >= 1) flick = 1;
        else if (st > 0.5 && Math.sin(st * 40) > -0.3) flick = 1;
        this.setEyes(2.6 * flick, flick * 0.9);
        break;
      }
      case 'idle': {
        this.targetRX = Math.sin(t * 0.55) * 0.03 * M;
        this.targetRY = Math.sin(t * 0.41 + 1.3) * 0.14 * M;
        this.targetRZ = Math.sin(t * 0.33) * 0.02 * M;
        this.targetY = Math.sin(t * 0.9) * 0.012 * M; // breathing bob
        this.setEyes(2.2 + Math.sin(t * 1.1) * 0.25, 0.75 + Math.sin(t * 2.2) * 0.08);
        break;
      }
      case 'listening': {
        // lean in, eyes steady on viewer, brighter
        this.targetRX = -0.09 * M;
        this.targetRY = Math.sin(t * 0.7) * 0.04 * M;
        this.targetRZ = 0.015 * M;
        this.setEyes(2.8 + Math.sin(t * 3.1) * 0.3, 0.95);
        break;
      }
      case 'thinking': {
        // darts + faint head shake + flicker
        if (t > this.nextDart) {
          this.nextDart = t + 0.35 + Math.random() * 0.7;
          this.dartX = (Math.random() - 0.5) * 0.3;
          this.dartY = (Math.random() - 0.5) * 0.12;
        }
        this.targetRX = 0.06 * M + this.dartY * M;
        this.targetRY = Math.sin(t * 5.3) * 0.02 * M + this.dartX * M;
        this.targetRZ = Math.sin(t * 4.7) * 0.012 * M;
        const flick = 1.6 + Math.max(0, Math.sin(t * 9.1)) * 1.1;
        this.setEyes(flick, 0.5);
        break;
      }
      case 'speaking': {
        // jaw articulation driven by shared voice pulse
        const p = currentPulse();
        const open = 0.02 + p * 0.28;
        refs.jaw.rotation.x = THREE.MathUtils.lerp(refs.jaw.rotation.x, open, 1 - Math.exp(-dt * 18));
        (refs.jawFaceplate.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + p * 0.8;
        this.targetRX = -0.04 * M + Math.sin(t * 1.9) * 0.015 * M;
        this.targetRY = Math.sin(t * 0.9) * 0.06 * M;
        this.targetRZ = 0;
        this.setEyes(2.4 + p * 0.6, 0.85);
        break;
      }
      case 'coding': {
        // focused: slight lean down-forward, steady bright eyes, scan sweep
        this.targetRX = 0.1 * M;
        this.targetRY = Math.sin(t * 0.8) * 0.1 * M;
        this.targetRZ = 0;
        this.setEyes(2.9, 0.9 + Math.sin(t * 6) * 0.05);
        break;
      }
      case 'success': {
        // quick nod + flare
        const k = Math.min(1, st / 0.9);
        const nod = Math.sin(k * Math.PI) * 0.16;
        this.targetRX = nod * M;
        this.targetRY = 0;
        this.targetRZ = 0;
        this.setEyes(3.4 - k * 1.2, 1);
        break;
      }
      case 'error': {
        // restrained warning: dim flicker + side shake
        const shake = Math.sin(st * 22) * 0.02 * Math.max(0, 1 - st / 1.2);
        this.targetRX = 0.02 * M;
        this.targetRY = shake * M;
        this.targetRZ = Math.sin(st * 18) * 0.01 * M;
        const flick = st < 1.4 ? (Math.sin(st * 30) > 0 ? 1.4 : 0.5) : 1.0;
        this.setEyes(flick, 0.4);
        break;
      }
      case 'angry': {
        // hostile glare: head lowered, slow menacing sway, hot steady eyes
        this.targetRX = 0.07 * M;
        this.targetRY = Math.sin(t * 1.05) * 0.035 * M;
        this.targetRZ = Math.sin(t * 0.8) * 0.012 * M;
        this.setEyes(2.4 + Math.max(0, Math.sin(t * 3.2)) * 0.6, 0.95);
        break;
      }
    }

    /* ---------- smooth apply ---------- */
    const k = 1 - Math.exp(-dt * 6);
    const hg = refs.headGroup;
    hg.rotation.x += (this.targetRX - hg.rotation.x) * k;
    hg.rotation.y += (this.targetRY + this.userYaw - hg.rotation.y) * k;
    hg.rotation.z += (this.targetRZ - hg.rotation.z) * k;
    hg.position.y += (this.targetY - hg.position.y) * k;
    this.root.rotation.y += (this.userYaw * 0.15 - this.root.rotation.y) * k;

    // idle jaw closes gently when not speaking
    if (s !== 'speaking') {
      refs.jaw.rotation.x += (0 - refs.jaw.rotation.x) * Math.min(1, dt * 6);
    }

    /* ---------- blinking ---------- */
    if (s === 'idle' || s === 'listening' || s === 'coding') {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
        this.blinkPhase = 0;
        this.blinkTimer = 2.4 + Math.random() * 3.6;
      }
    }
    if (this.blinkPhase >= 0) {
      const speed = dt * 9;
      this.blinkPhase += speed;
      const cyc = this.blinkPhase % TAU;
      const down = Math.max(0, Math.sin(Math.min(cyc, Math.PI))); // 0..1..0
      const closed = Math.min(1, down * 1.4);
      refs.eyeLidL.position.y = 0.32 - closed * 0.13;
      refs.eyeLidR.position.y = 0.32 - closed * 0.13;
      if (this.blinkPhase > Math.PI + 0.4) {
        this.blinkPhase = -1;
        refs.eyeLidL.position.y = 0.32;
        refs.eyeLidR.position.y = 0.32;
      }
    }
  }

  private setEyes(intensity: number, glow: number): void {
    this.refs.eyeMat.emissiveIntensity = intensity;
    this.refs.glowMatL.opacity = glow;
    this.refs.glowMatR.opacity = glow;
  }
}
