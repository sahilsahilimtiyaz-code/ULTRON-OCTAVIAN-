/**
 * Circular HUD gauge (SVG) — chrome ring segments + red progress arc + ticks,
 * animated on load. Pure SVG, no canvas cost.
 */
import { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    let raf = 0;
    let v = 0;
    const step = () => {
      v += (target.current - v) * 0.08 + 0.4;
      if (v >= target.current) v = target.current;
      setShown(v);
      if (v < target.current) raf = requestAnimationFrame(step);
    };
    const delay = 350 + Math.random() * 250;
    const to = setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(to);
      cancelAnimationFrame(raf);
    };
  }, [value]);

  const s = size;
  const c = s / 2;
  const rTrack = c - s * 0.1;
  const rProg = rTrack - s * 0.045;
  const rTicks = c - s * 0.055;
  const frac = Math.max(0, Math.min(1, shown / 100));
  const a1 = START + SWEEP * frac;

  const ticks = [];
  for (let i = 0; i <= 30; i++) {
    const a = START + (SWEEP * i) / 30;
    const long = i % 5 === 0;
    const r0 = rTicks - (long ? s * 0.05 : s * 0.025);
    const x0 = c + r0 * Math.cos(a);
    const y0 = c + r0 * Math.sin(a);
    const x1 = c + rTicks * Math.cos(a);
    const y1 = c + rTicks * Math.sin(a);
    ticks.push(<line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={long ? '#5b6470' : '#333a44'} strokeWidth={long ? 1.4 : 0.8} />);
  }

  return (
    <div className="gauge-wrap">
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={`${Math.round(shown)} percent`}>
        {/* dark base disc */}
        <circle cx={c} cy={c} r={rTrack - s * 0.02} fill="#0b0e15" stroke="#20242c" strokeWidth="1" />
        {/* chrome ring segments */}
        <path d={arcPath(rTrack, START + SWEEP * 0.52, START + SWEEP * 0.78, c, c)} fill="none" stroke="#c8cdd6" strokeWidth={s * 0.028} strokeLinecap="round" opacity="0.9" />
        <path d={arcPath(rTrack, START + SWEEP * 0.86, START + SWEEP * 0.98, c, c)} fill="none" stroke="#8d939e" strokeWidth={s * 0.028} strokeLinecap="round" opacity="0.7" />
        {/* faint full track */}
        <path d={arcPath(rProg, START, START + SWEEP, c, c)} fill="none" stroke="#262b34" strokeWidth={s * 0.05} strokeLinecap="round" />
        {/* red progress */}
        {frac > 0.002 && (
          <path d={arcPath(rProg, START, a1, c, c)} fill="none" stroke="url(#gg)" strokeWidth={s * 0.05} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px rgba(255,32,56,.7))' }} />
        )}
        <defs>
          <linearGradient id="gg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5c6e" />
            <stop offset="1" stopColor="#e0182b" />
          </linearGradient>
        </defs>
        {/* ticks */}
        {ticks}
        {/* needle */}
        <line
          x1={c}
          y1={c}
          x2={c + rProg * 0.82 * Math.cos(a1)}
          y2={c + rProg * 0.82 * Math.sin(a1)}
          stroke="#e8ebf0"
          strokeWidth={s * 0.012}
          opacity="0.85"
        />
        <circle cx={c} cy={c} r={s * 0.018} fill="#e8ebf0" />
        {/* value */}
        <text x={c} y={c + s * 0.045} textAnchor="middle" className="gauge-num" fontSize={s * 0.16}>
          {Math.round(shown)}%
        </text>
      </svg>
      {caption && <div className="gauge-caption">{caption}</div>}
      {sublabel && <div className={`gauge-sub ${sublabelClass ?? ''}`}>{sublabel}</div>}
    </div>
  );
}

export { TAU };
