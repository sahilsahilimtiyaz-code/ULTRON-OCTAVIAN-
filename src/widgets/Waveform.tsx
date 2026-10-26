/**
 * Animated voice waveform (canvas 2D). Reads the shared voice pulse so it
 * matches the robot's jaw movement exactly — measured energy when audio is
 * available, the documented synthetic fallback otherwise.
 */
import { useEffect, useRef } from 'react';
import { currentPulse, pulseMode } from '../core/pulse';

const BARS = 42;

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

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
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

      /* centre guide */
      ctx.strokeStyle = 'rgba(255,47,74,0.22)';
      ctx.lineWidth = Math.max(1, h * 0.008);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      const bw = w / BARS;
      const barW = Math.max(2, bw * 0.34);
      const radius = barW / 2;

      for (let i = 0; i < BARS; i++) {
        const x = i * bw + bw / 2;
        const ph = i * 0.52;
        const n =
          Math.abs(Math.sin(t * 5.1 + ph)) * 0.44 +
          Math.abs(Math.sin(t * 2.7 + ph * 1.7)) * 0.34 +
          Math.abs(Math.sin(t * 7.9 + ph * 0.6)) * 0.22;
        // resting motion is a gentle travelling wave; speaking/listening uses
        // the measured pulse, which dominates as soon as audio energy exists
        const idle =
          mode === 'off'
            ? 0.09 + 0.05 * Math.abs(Math.sin(t * 1.1 + ph * 0.8))
            : 0.15 + 0.06 * Math.abs(Math.sin(t * 1.7 + ph * 0.9));
        const a = Math.min(1, (idle + amp * n * 0.9) * 0.95);
        const bh = Math.max(3, a * (h * 0.44));

        const grad = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
        grad.addColorStop(0, 'rgba(255,141,155,0.95)');
        grad.addColorStop(0.45, 'rgba(255,47,74,0.95)');
        grad.addColorStop(1, 'rgba(179,19,42,0.85)');

        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(255,47,74,0.45)';
        ctx.shadowBlur = bh * 0.6;
        ctx.beginPath();
        const x0 = x - barW / 2;
        const y0 = mid - bh;
        const height = bh * 2;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x0, y0, barW, height, radius);
        } else {
          ctx.rect(x0, y0, barW, height);
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
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
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
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
