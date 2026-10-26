/**
 * FacePuppet — layered-image facial animation (the "crop and animate" system).
 *
 * Drop any ORIGINAL head image at:  public/face/head.png
 * Optional region tuning:           public/face/regions.json
 *
 * How it works:
 *  - base layer: the head image, gently swaying/breathing
 *  - jaw layer:  the jaw region is cropped, feather-edged, and slides DOWN
 *                while speaking (driven by the shared voice pulse)
 *  - eyes layer: blink overlay + red glow overlay driven by the face state
 *  - states:     boot / idle / listening / thinking / speaking / coding /
 *                success / error — same names as the 3D controller
 */
import type { FaceStateName } from '../core/types';
import { currentPulse } from '../core/pulse';
import { MicroExpr } from './microExpr';

export interface Rect { x: number; y: number; w: number; h: number } // normalized 0..1

export interface FaceRegions {
  face: Rect;   // visible head crop drawn into the panel
  jaw: Rect;    // part that slides down when talking
  eyes: Rect;   // blink + glow zone
  jawDropFrac: number; // max jaw slide as fraction of drawn head height
  glowColor?: string;  // hex, e.g. '#ff9d1a' — eye-glow overlay tint
}

export const DEFAULT_REGIONS: FaceRegions = {
  face: { x: 0.04, y: 0.02, w: 0.92, h: 0.96 },
  jaw: { x: 0.34, y: 0.62, w: 0.34, h: 0.30 },
  eyes: { x: 0.22, y: 0.32, w: 0.56, h: 0.16 },
  jawDropFrac: 0.045,
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 36, 56];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const BASE = import.meta.env.BASE_URL ?? '/';

// Bump when head.png / regions.json change: a stale or half-written cached
// image can decode to nothing, which would leave the face panel blank.
const ASSET_VERSION = '3';

export interface PuppetAsset {
  img: HTMLImageElement;
  regions: FaceRegions;
}

/** Try to load a drop-in head image + optional regions.json. null if absent. */
export async function loadPuppetAsset(): Promise<PuppetAsset | null> {
  // first drop-in file found wins; svg/jpg/webp also accepted
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'svg']) {
    const img = await loadImage(BASE + `face/head.${ext}?v=${ASSET_VERSION}`).catch(() => null);
    if (img) {
      const regions = await loadRegions().catch(() => null);
      return { img, regions: regions ?? DEFAULT_REGIONS };
    }
  }
  return null;
}

function loadImage(src: string, timeoutMs = 6000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    const fail = (why: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('image load timeout'), timeoutMs);
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => fail('no head image');
    img.src = src;
  });
}

async function loadRegions(): Promise<FaceRegions | null> {
  const res = await fetch(BASE + 'face/regions.json?v=' + ASSET_VERSION);
  if (!res.ok) return null;
  const raw = (await res.json()) as Partial<FaceRegions>;
  return { ...DEFAULT_REGIONS, ...raw };
}

/* ------------------------------------------------------------------ */

interface StateProfile {
  zoom: number;
  eyeGlow: number;
  jawTalk: boolean;
  jitter: number;
}

const PROFILES: Record<FaceStateName, StateProfile> = {
  boot:      { zoom: 1.0,   eyeGlow: 0.15, jawTalk: false, jitter: 0 },
  idle:      { zoom: 1.0,   eyeGlow: 0.45, jawTalk: false, jitter: 0 },
  listening: { zoom: 1.02,  eyeGlow: 0.9,  jawTalk: false, jitter: 0 },
  thinking:  { zoom: 1.005, eyeGlow: 0.6,  jawTalk: false, jitter: 1.6 },
  speaking:  { zoom: 1.005, eyeGlow: 0.75, jawTalk: true,  jitter: 0 },
  coding:    { zoom: 1.015, eyeGlow: 0.95, jawTalk: false, jitter: 0 },
  success:   { zoom: 1.01,  eyeGlow: 1.15, jawTalk: false, jitter: 0 },
  error:     { zoom: 1.0,   eyeGlow: 0.2,  jawTalk: false, jitter: 2.2 },
  angry:     { zoom: 1.02,  eyeGlow: 1.1,  jawTalk: false, jitter: 1.1 },
};

export class FacePuppet {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: HTMLImageElement;
  private regions: FaceRegions;
  private state: FaceStateName = 'boot';
  private stateTime = 0;
  private motionScale = 1;

  private jawCanvas: HTMLCanvasElement | null = null;
  private glowCanvas: HTMLCanvasElement | null = null;

  private micro = new MicroExpr();

  constructor(canvas: HTMLCanvasElement, img: HTMLImageElement, regions: FaceRegions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.img = img;
    this.regions = regions;
    this.prepareLayers();
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      this.motionScale = mq.matches ? 0.25 : 1;
      mq.addEventListener?.('change', (e) => (this.motionScale = e.matches ? 0.25 : 1));
    }
  }

  setState(s: FaceStateName): void {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
    }
  }

  setMotionScale(v: number): void {
    this.motionScale = v;
  }

  /** Pre-render feathered jaw crop + soft glow sprite. */
  private prepareLayers(): void {
    const { img, regions } = this;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const j = regions.jaw;
    const sx = j.x * iw;
    const sy = j.y * ih;
    const sw = j.w * iw;
    const sh = j.h * ih;

    const jc = document.createElement('canvas');
    jc.width = Math.max(2, Math.round(sw));
    jc.height = Math.max(2, Math.round(sh));
    const jctx = jc.getContext('2d');
    if (jctx) {
      jctx.drawImage(img, sx, sy, sw, sh, 0, 0, jc.width, jc.height);
      // feather the top edge so the slide doesn't show a hard seam
      const feather = jc.height * 0.18;
      jctx.globalCompositeOperation = 'destination-in';
      const grad = jctx.createLinearGradient(0, 0, 0, jc.height);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(Math.min(0.4, feather / jc.height), 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      jctx.fillStyle = grad;
      jctx.fillRect(0, 0, jc.width, jc.height);
      jctx.globalCompositeOperation = 'source-over';
    }
    this.jawCanvas = jc;

    const gc = document.createElement('canvas');
    gc.width = 128;
    gc.height = 64;
    const gctx = gc.getContext('2d');
    if (gctx) {
      const [r, g, b] = hexToRgb(this.regions.glowColor ?? '#ff2438');
      const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.55));
      const grad = gctx.createRadialGradient(64, 32, 4, 64, 32, 60);
      grad.addColorStop(0, `rgba(${mix(r)},${mix(g)},${mix(b)},0.9)`);
      grad.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 128, 64);
    }
    this.glowCanvas = gc;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.max(2, Math.round(cssW * dpr));
    this.canvas.height = Math.max(2, Math.round(cssH * dpr));
  }

  /** One frame. t = seconds, dt = delta seconds. */
  draw(t: number, dt: number): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const p = PROFILES[this.state];
    const M = this.motionScale;
    this.stateTime += dt;

    ctx.clearRect(0, 0, cw, ch);

    const { img, regions } = this;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const f = regions.face;
    const fw = f.w * iw;
    const fh = f.h * ih;

    // fit-cover mapping into canvas
    const s = Math.max(cw / fw, ch / fh);
    const dw = fw * s;
    const dh = fh * s;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    const cx = cw / 2;
    const cy = ch / 2;

    // aliveness engine: blinks, squints, saccades, tilts, nods, breathing
    const m = this.micro.update(this.state, t, dt);

    // head motion (micro-engine driven)
    const sway = m.tilt * M;
    const breathe = 1 + m.breathe * 0.0045 * M;
    const zoom = p.zoom * breathe;
    let jitX = 0;
    if (p.jitter > 0) {
      jitX = Math.sin(t * 17.3) * p.jitter * (0.5 + 0.5 * Math.sin(t * 5.1)) * M;
    }
    // success nod / error shake use stateTime; micro-nods ride on top
    let nod = m.nod * M;
    if (this.state === 'success') {
      const k = Math.min(1, this.stateTime / 0.9);
      nod += Math.sin(k * Math.PI) * 0.045 * M;
    }
    const shakeX = this.state === 'error'
      ? Math.sin(this.stateTime * 26) * 2.2 * Math.max(0, 1 - this.stateTime / 1.3) * M * (this.canvas.width / 300)
      : 0;

    ctx.save();
    ctx.translate(cx + jitX + shakeX, cy);
    ctx.rotate(sway + nod);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    // base head
    ctx.drawImage(img, f.x * iw, f.y * ih, fw, fh, dx, dy, dw, dh);

    // jaw: voice pulse when talking + never-fully-still resting motion
    const pulse = currentPulse();
    const open = p.jawTalk ? Math.min(1, pulse * 1.15) : 0;
    const idleOpen = m.jawIdle * 0.16;
    const jawAmt = open + idleOpen;
    if (jawAmt > 0.008 && this.jawCanvas) {
      const j = regions.jaw;
      const jx = dx + j.x * fw * s;
      const jy = dy + j.y * fh * s;
      const jw = j.w * fw * s;
      const jh = j.h * fh * s;
      const drop = jawAmt * regions.jawDropFrac * dh;

      // dark cavity above the sliding jaw
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, open * 1.15 + idleOpen * 1.6);
      ctx.fillStyle = '#050608';
      ctx.fillRect(jx, jy - 2, jw, drop + 4);
      ctx.restore();

      // feathered jaw layer, shifted down
      ctx.drawImage(this.jawCanvas, jx, jy + drop, jw, jh);
    }

    // eye glow overlay
    if (p.eyeGlow > 0.02 && this.glowCanvas) {
      const e = regions.eyes;
      let glow = p.eyeGlow;
      if (this.state === 'thinking') glow *= 0.55 + 0.45 * Math.abs(Math.sin(t * 9.1));
      if (this.state === 'boot') {
        const k = Math.min(1, this.stateTime / 1.6);
        glow *= k >= 1 ? 1 : this.stateTime > 0.5 && Math.sin(this.stateTime * 40) > -0.3 ? 1 : 0.1;
      }
      if (this.state === 'error') glow *= Math.sin(this.stateTime * 30) > 0 ? 1 : 0.3;
      glow *= 1 + m.glow;
      const ex = dx + e.x * fw * s;
      const ey = dy + e.y * fh * s;
      const ew = e.w * fw * s;
      const eh = e.h * fh * s;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, glow * 0.55);
      // gaze offset: the eye glow drifts with the saccades
      const gx = m.gazeX * ew * 0.05;
      const gy = m.gazeY * eh * 0.07;
      ctx.drawImage(this.glowCanvas, ex - ew * 0.25 + gx, ey - eh * 0.6 + gy, ew * 1.5, eh * 2.2);
      ctx.restore();
    }

    // eyelids: a full blink darkens the socket; a squint only drops the upper lid
    const e = regions.eyes;
    const ex = dx + e.x * fw * s;
    const ey = dy + e.y * fh * s;
    const ew = e.w * fw * s;
    const eh = e.h * fh * s;
    const blink = Math.min(1, m.blink);
    const lid = Math.max(blink, m.squint * 0.55);
    if (lid > 0.02) {
      ctx.save();
      if (blink > 0.5) {
        ctx.globalAlpha = blink * 0.9;
        ctx.fillStyle = '#07080c';
        ctx.fillRect(ex, ey, ew, eh);
      } else {
        ctx.globalAlpha = 0.45 + lid * 0.45;
        ctx.fillStyle = '#07080c';
        ctx.fillRect(ex, ey, ew, eh * Math.min(0.6, 0.18 + lid * 0.7));
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
