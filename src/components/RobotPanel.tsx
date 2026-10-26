/** Top panel: live face render + voice-sync waveform + telemetry readouts. */
import { useEffect, useRef, useState } from 'react';
import FaceLive from '../robot/FaceVideoPlayer';
import Waveform from '../widgets/Waveform';
import HudPanel, { PanelHead } from './HudPanel';
import { useStore } from '../core/store';
import { currentPulse } from '../core/pulse';
import type { FaceStateName } from '../core/types';

const FACE_LABEL: Record<FaceStateName, string> = {
  boot: 'BOOTING',
  idle: 'ACTIVE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'TRANSMITTING',
  coding: 'CODING',
  success: 'SUCCESS',
  error: 'FAULT DETECTED',
  angry: 'HOSTILE',
};

export default function RobotPanel() {
  const face = useStore((s) => s.face);
  const micActive = useStore((s) => s.micActive);
  const speaking = useStore((s) => s.speaking);
  const ttsStatus = useStore((s) => s.ttsStatus);

  const syncLabel = speaking ? (ttsStatus ?? 'TRANSMITTING') : micActive ? 'LISTENING' : FACE_LABEL[face];
  const live = speaking || micActive;

  return (
    <HudPanel className="robot-panel" label="Cognitive unit">
      <PanelHead
        kicker="COGNITIVE UNIT // CORE-01"
        title="NEURAL INTERFACE"
        right={
          <span className={`pill ${live ? 'pill-live' : 'pill-ok'}`}>
            <i />
            {live ? 'VOICE LINK' : 'STANDBY'}
          </span>
        }
      />

      <div className="robot-grid">
        <div className="robot-face-box">
          <FaceLive />
          <span className="face-sweep" aria-hidden="true" />
          <span className="robot-box-corner tl" aria-hidden="true" />
          <span className="robot-box-corner br" aria-hidden="true" />
          <span className="face-tag">
            <b>FACE // 01</b>
            <i aria-hidden="true" />
            {FACE_LABEL[face]}
          </span>
        </div>

        <div className="robot-right">
          <div className="voice-sync-row">
            <span className="vs-label">
              VOICE SYNC <span className="vs-dim">//</span>{' '}
              <span className="vs-active">{syncLabel}</span>
            </span>
            <LevelMeter />
          </div>

          <div className="wave-box">
            <Waveform className="wave-canvas" />
          </div>

          <TelemetryGrid />
        </div>
      </div>
    </HudPanel>
  );
}

/** Live energy meter driven by the same measured pulse as the waveform + jaw. */
function LevelMeter() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      if (el) el.style.setProperty('--lvl', currentPulse().toFixed(3));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <span className="level-meter" ref={ref} aria-hidden="true">
      <i /><i /><i /><i /><i />
    </span>
  );
}

/* Telemetry readouts — decorative HUD values that drift live. */
interface TeleItem { label: string; base: number; unit: string; decimals: number; bar?: number }

const TELE: TeleItem[] = [
  { label: 'CORE LOAD', base: 62.4, unit: '%', decimals: 1, bar: 0.72 },
  { label: 'MEMORY BUS', base: 7.4, unit: 'GB/s', decimals: 1, bar: 0.55 },
  { label: 'ACCESS RATE', base: 99.98, unit: '%', decimals: 2, bar: 0.92 },
  { label: 'PACKET I/O', base: 22.14, unit: 'K/s', decimals: 2, bar: 0.4 },
  { label: 'TENSOR OPS', base: 16.4, unit: 'T/s', decimals: 1, bar: 0.3 },
  { label: 'UPTIME', base: 122.6, unit: 'h', decimals: 1, bar: 0.85 },
];

function TelemetryGrid() {
  return (
    <div className="tele-grid" role="presentation">
      {TELE.map((item, i) => (
        <TeleCell key={item.label} item={item} idx={i} />
      ))}
    </div>
  );
}

function TeleCell({ item, idx }: { item: TeleItem; idx: number }) {
  const [v, setV] = useState(item.base);
  useEffect(() => {
    const iv = setInterval(() => {
      const drift = (Math.random() - 0.5) * item.base * 0.02;
      setV(Math.max(0, item.base + drift));
    }, 1200 + idx * 240);
    return () => clearInterval(iv);
  }, [item.base, idx]);
  return (
    <div className="tele-cell">
      <div className="tele-row">
        <span className="tele-label">{item.label}</span>
        <span className="tele-val">
          {v.toFixed(item.decimals)}
          {item.unit}
        </span>
      </div>
      {item.bar !== undefined && (
        <div className="tele-bar" aria-hidden="true">
          <i style={{ width: `${item.bar * 100}%` }} />
        </div>
      )}
    </div>
  );
}
