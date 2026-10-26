/**
 * FaceCanvas: mounts the WebGL renderer, handles resize / visibility /
 * reduced motion / low power, and degrades gracefully to a 2D fallback
 * if WebGL is unavailable.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildHead, buildMaterials, type HeadRefs } from './headBuilder';
import { FaceController } from './FaceController';
import { getState, setState, useStore } from '../core/store';
import { stepPulse, currentPulse } from '../core/pulse';
import type { FaceStateName } from '../core/types';

let cachedController: FaceController | null = null;
export function faceController(): FaceController | null {
  return cachedController;
}

export default function FaceCanvas() {
  const holderRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const faceState = useStore((s) => s.face);
  const lowPower = useStore((s) => s.settings.lowPower);
  const lowPowerRef = useRef(lowPower);
  lowPowerRef.current = lowPower;

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !lowPowerRef.current,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      setFailed(true);
      return;
    }
    if (!renderer.getContext()) {
      setFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    camera.position.set(0, 0.02, 2.5);
    camera.lookAt(0, -0.02, 0);

    // environment reflections (rendered once, cheap afterwards)
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      pmrem.dispose();
    } catch {
      /* env map optional */
    }

    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.7, 2.1, 1.7);
    scene.add(key);
    const red = new THREE.PointLight(0xff2038, 9, 7, 1.7);
    red.position.set(0, -1.0, 1.15);
    scene.add(red);
    const rim = new THREE.DirectionalLight(0xd6e4ff, 2.0);
    rim.position.set(-1.9, 1.1, -2.1);
    scene.add(rim);
    const fill = new THREE.PointLight(0x51678a, 2.5, 8, 1.8);
    fill.position.set(-1.5, 0.2, 1.5);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0x0e1016, 2.2));

    const mats = buildMaterials();
    const refs: HeadRefs = buildHead(mats);
    scene.add(refs.root);

    const controller = new FaceController(refs, refs.root);
    cachedController = controller;
    controller.setState(getState().face);

    /* ---------- sizing ---------- */
    const resize = () => {
      const w = holder.clientWidth || 10;
      const h = holder.clientHeight || 10;
      const dpr = Math.min(window.devicePixelRatio || 1, lowPowerRef.current ? 1 : 1.75);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    /* ---------- drag to rotate ---------- */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: TouchEvent | PointerEvent) => {
      dragging = true;
      const p = 'touches' in e ? e.touches[0] : e;
      lastX = p.clientX;
      lastY = p.clientY;
    };
    const move = (e: TouchEvent | PointerEvent) => {
      if (!dragging) return;
      const p = 'touches' in e ? e.touches[0] : e;
      controller.addDrag((p.clientX - lastX) * 0.005, (p.clientY - lastY) * 0.004);
      lastX = p.clientX;
      lastY = p.clientY;
      if ('touches' in e) e.preventDefault();
    };
    const up = () => (dragging = false);
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    holder.appendChild(el);

    /* ---------- render loop (paused when hidden) ---------- */
    let raf = 0;
    let running = true;
    let last = performance.now();
    const clock0 = performance.now();

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - clock0) / 1000;

      stepPulse(dt, t);
      controller.update(dt, t);
      // mouth grille glow follows the shared voice pulse
      refs.mouthGlowMat.emissiveIntensity = 0.6 + currentPulse() * 2.4;
      renderer.render(scene, camera);
    };
    const start = () => {
      if (!running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVis = () => (document.hidden ? stop() : ((last = performance.now()), start()));
    document.addEventListener('visibilitychange', onVis);
    start();

    /* ---------- cleanup ---------- */
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      holder.removeChild(el);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          o.geometry?.dispose?.();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose?.();
        }
      });
      renderer.dispose();
      if (cachedController === controller) cachedController = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // face state -> controller
  useEffect(() => {
    cachedController?.setState(faceState as FaceStateName);
  }, [faceState]);

  // low power toggles renderer quality live
  useEffect(() => {
    const c = cachedController;
    if (c) c.setMotionScale(lowPower ? 0.55 : 1);
  }, [lowPower]);

  if (failed) {
    // Honest, usable fallback: 2D HUD head, everything else keeps working.
    return (
      <div className="face-fallback" role="img" aria-label="Robotic face (2D fallback)">
        <svg viewBox="0 0 100 120" className="ff-svg">
          <ellipse cx="50" cy="50" rx="30" ry="36" fill="#181b22" stroke="#3a4150" strokeWidth="1.5" />
          <ellipse cx="38" cy="44" rx="8" ry="3.2" fill="#ff2038">
            <animate attributeName="opacity" values="1;.4;1" dur="2.4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="62" cy="44" rx="8" ry="3.2" fill="#ff2038">
            <animate attributeName="opacity" values="1;.4;1" dur="2.4s" repeatCount="indefinite" />
          </ellipse>
          <rect x="40" y="62" width="20" height="4" rx="2" fill="#3a4150" />
          <rect x="42" y="90" width="16" height="3" fill="#23272e" />
          <rect x="40" y="96" width="20" height="3" fill="#23272e" />
        </svg>
        <span className="ff-note">3D UNAVAILABLE — 2D HUD MODE</span>
      </div>
    );
  }

  return <div ref={holderRef} className="face-canvas-holder" aria-label="Robotic face viewport" />;
}

/** Boot the face into idle once app mounts (power-on sequence). */
export function bootFace(): void {
  setState({ booted: true });
  const c = cachedController;
  if (c) {
    c.setState('boot');
    setTimeout(() => {
      if (getState().face === 'boot') setState({ face: 'idle' });
    }, 1900);
  } else {
    setState({ face: 'idle' });
  }
}
