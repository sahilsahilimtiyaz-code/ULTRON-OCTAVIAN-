/**
 * FacePuppetCanvas: uses a drop-in head image (public/face/head.png) with the
 * layered puppet animation; falls back to the live 3D head when no image is
 * present. Both are driven by the same face-state store, so Diagnostics
 * controls and chat states work with either renderer.
 */
import { useEffect, useRef, useState } from 'react';
import FaceCanvas from './FaceCanvas';
import { loadPuppetAsset, FacePuppet } from './facePuppet';
import { getState, useStore } from '../core/store';
import { stepPulse } from '../core/pulse';
import type { FaceStateName } from '../core/types';
import type { PuppetAsset } from './facePuppet';

export default function FacePuppetCanvas() {
  const [asset, setAsset] = useState<PuppetAsset | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // watchdog: if the asset probe hangs, still show a face (3D fallback)
    const fallback = setTimeout(() => {
      if (!cancelled) setChecked(true);
    }, 5000);
    void loadPuppetAsset().then((a) => {
      if (cancelled) return;
      clearTimeout(fallback);
      setAsset(a);
      setChecked(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  if (!checked) return null; // brief resolve tick while the asset is probed
  if (!asset) return <FaceCanvas />; // no drop-in image: live 3D head
  return <PuppetRunner asset={asset} />;
}

function PuppetRunner({ asset }: { asset: PuppetAsset }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const puppetRef = useRef<FacePuppet | null>(null);
  const [failed, setFailed] = useState(false);
  const faceState = useStore((s) => s.face);
  const lowPower = useStore((s) => s.settings.lowPower);

  /* mount canvas + render loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!canvas || !holder) return;

    let puppet: FacePuppet;
    try {
      puppet = new FacePuppet(canvas, asset.img, asset.regions);
    } catch {
      return; // 2d context unavailable — holder stays empty
    }
    puppetRef.current = puppet;
    puppet.setState(getState().face);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.6);
      puppet.resize(holder.clientWidth || 10, holder.clientHeight || 10, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    let raf = 0;
    let running = true;
    let drawErrors = 0;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      stepPulse(dt, t);
      try {
        puppet.draw(t, dt);
        drawErrors = 0;
      } catch (err) {
        // a throwing frame must never leave a permanently empty card
        drawErrors++;
        if (drawErrors === 1) console.error('[face] puppet render failed:', err);
        if (drawErrors > 20) {
          stop();
          setFailed(true);
        }
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      puppetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  useEffect(() => {
    puppetRef.current?.setState(faceState as FaceStateName);
  }, [faceState]);

  useEffect(() => {
    puppetRef.current?.setMotionScale(lowPower ? 0.55 : 1);
  }, [lowPower]);

  if (failed) return <FaceCanvas />;

  return (
    <div ref={holderRef} className="face-canvas-holder">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Robotic face" />
    </div>
  );
}
