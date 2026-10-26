/**
 * Circular HUD gauge (SVG) — hairline track, crimson progress arc, micro ticks.
 * Animated on load. Pure SVG, no canvas cost.
 */
import { useEffect, useId, useRef, useState } from 'react';

interface GaugeProps {
  value: number; // 0..100
  size: number;
  caption?: string;
  sublabel?: string;
  sublabelClass?: string;
}

const TAU = Math.PI * 2;
const START = -Math.PI * 0.75; // arc start (bottom-left)
const SWEEP = Math.PI * 1.5; // 270 degrees

function arcPath(r: number, a0: number, a1: number, cx: number, cy: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export default function Gauge({ value, size, caption, sublabel, sublabelClass }: GaugeProps) {
  const [shown, setShown] = useState(0);
  const target = useRef(value);
  target.current = value;
  const gradId = `g-${useId().replace(/[:]/g, '')}`;

  useEffect(() => {
    let raf = 0;
    let startTs: number | null = null;
    const duration = 1100;
    const step = (now: number) => {
      if (startTs === null) startTs = now;
      const p = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(target.current * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const to = setTimeout(() => {
      setShown(0);
      raf = requestAnimationFrame(step);
    }, 240);
    return () => {
      clearTimeout(to);
      cancelAnimationFrame(raf);
    };
  }, [value]);

  const s = size;
  const c = s / 2;
  const rTrack = c - s * 0.09;
  const rProg = rTrack;
  const rTicks = c - s * 0.045;
  const frac = Math.max(0, Math.min(1, shown / 100));
  const a1 = START + SWEEP * frac;

  const ticks = [];
  for (let i = 0; i <= 24; i++) {
    const a = START + (SWEEP * i) / 24;
    const long = i % 4 === 0;
    const r0 = rTicks - (long ? s * 0.045 : s * 0.022);
    const x0 = c + r0 * Math.cos(a);
    const y0 = c + r0 * Math.sin(a);
    const x1 = c + rTicks * Math.cos(a);
    const y1 = c + rTicks * Math.sin(a);
    ticks.push(
      <line
        key={i}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={long ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.14)'}
        strokeWidth={long ? 1.1 : 0.7}
        strokeLinecap="round"
      />,
    );
  }

  return (
    <div className="gauge-wrap">
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={`${Math.round(shown)} percent`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#b3132a" />
            <stop offset="0.55" stopColor="#ff2f4a" />
            <stop offset="1" stopColor="#ff8d9b" />
          </linearGradient>
        </defs>

        {/* track */}
        <path d={arcPath(rProg, START, START + SWEEP, c, c)} fill="none" stroke="rgba(255,255,255,0.075)" strokeWidth={s * 0.032} strokeLinecap="round" />

        {/* progress */}
        {frac > 0.005 && (
          <path
            d={arcPath(rProg, START, a1, c, c)}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={s * 0.032}
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 5px rgba(255,47,74,.55))' }}
          />
        )}

        {ticks}

        {/* needle + hub */}
        <line
          x1={c}
          y1={c}
          x2={c + rProg * 0.76 * Math.cos(a1)}
          y2={c + rProg * 0.76 * Math.sin(a1)}
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={s * 0.009}
          strokeLinecap="round"
        />
        <circle cx={c} cy={c} r={s * 0.015} fill="#fff" opacity="0.9" />

        <text
          x={c}
          y={c + s * 0.055}
          textAnchor="middle"
          className="gauge-num"
          fontSize={s * 0.17}
        >
          {Math.round(shown)}
          <tspan fontSize={s * 0.08} dx="1" opacity="0.6">%</tspan>
        </text>
      </svg>
      {caption && <div className="gauge-caption">{caption}</div>}
      {sublabel && <div className={`gauge-sub ${sublabelClass ?? ''}`}>{sublabel}</div>}
    </div>
  );
}

export { TAU };
