/** Top panel: live 3D head + voice-sync waveform + telemetry readouts. */
import FaceLive from '../robot/FaceVideoPlayer';
import Waveform from '../widgets/Waveform';
import HudPanel from './HudPanel';
import { useStore } from '../core/store';
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

  const syncLabel = speaking ? 'TRANSMITTING' : micActive ? 'LISTENING' : FACE_LABEL[face];

  return (
    <HudPanel className="robot-panel" label="Cognitive unit">
      <div className="robot-grid">
        <div className="robot-face-box">
          <FaceLive />
          <span className="robot-box-corner tl" aria-hidden="true" />
          <span className="robot-box-corner br" aria-hidden="true" />
        </div>
        <div className="robot-right">
          <div className="voice-sync-row">
            <span className="vs-label">
              VOICE SYNC <span className="vs-dim">//</span> <span className="vs-active">{syncLabel}</span>
            </span>
            <span className="vs-eq" aria-hidden="true"><i /><i /></span>
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

/* Telemetry strings — decorative HUD readouts that drift live. */
interface TeleItem { label: string; base: number; unit: string; decimals: number; bar?: number }

const TELE: TeleItem[] = [
  { label: 'TELEMETRY', base: 35668, unit: '', decimals: 0, bar: 0.72 },
  { label: 'GOIR: RAVE', base: 313, unit: ' HB/s', decimals: 0, bar: 0.55 },
  { label: 'ACCESS RATES', base: 1.0, unit: '%', decimals: 2, bar: 0.18 },
  { label: 'DREIVS GORGER', base: 22.14, unit: 'B/s', decimals: 2, bar: 0.4 },
  { label: 'START RATES', base: 16.4, unit: '%', decimals: 1, bar: 0.3 },
  { label: 'TEST RATES', base: 122.6108, unit: '', decimals: 4, bar: 0.85 },
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

import { useEffect, useState } from 'react';

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
