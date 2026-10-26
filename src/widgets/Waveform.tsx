/**
 * Animated voice waveform (canvas 2D). Reads the shared voice pulse so it
 * matches the robot's jaw movement exactly.
 */
import { useEffect, useRef } from 'react';
import { currentPulse, pulseMode } from '../core/pulse';

export default function Waveform({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const t0 = performance.now();
    const BARS = 44;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(2, canvas.clientWidth * dpr);
      canvas.height = Math.max(2, canvas.clientHeight * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const t = (now - t0) / 1000;
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      const amp = currentPulse();
      const mode = pulseMode();

      ctx.clearRect(0, 0, w, h);
      // center guide line
      ctx.strokeStyle = 'rgba(255,45,63,0.28)';
      ctx.lineWidth = Math.max(1, h * 0.012);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      const bw = w / BARS;
      const barW = Math.max(1.5, bw * 0.42);
      for (let i = 0; i < BARS; i++) {
        const x = i * bw + bw * 0.5;
        const ph = i * 0.55;
        const n =
          Math.abs(Math.sin(t * 5.3 + ph)) * 0.45 +
          Math.abs(Math.sin(t * 2.9 + ph * 1.7)) * 0.35 +
          Math.abs(Math.sin(t * 7.7 + ph * 0.6)) * 0.2;
        const idleFloor = mode === 'off' ? 0.05 + 0.04 * Math.abs(Math.sin(t * 1.4 + ph)) : 0.08;
        const a = Math.min(1, (idleFloor + amp * n) * 0.95);
        const bh = Math.max(2, a * (h * 0.46));
        const grad = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
        grad.addColorStop(0, '#ff4a5e');
        grad.addColorStop(0.5, '#ff2038');
        grad.addColorStop(1, '#ff4a5e');
        ctx.fillStyle = grad;
        ctx.fillRect(x - barW / 2, mid - bh, barW, bh * 2);
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVis = () => (document.hidden ? stop() : ((running = false), start()));
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
