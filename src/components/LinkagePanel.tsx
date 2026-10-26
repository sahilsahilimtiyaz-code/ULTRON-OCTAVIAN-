/** Middle panel: cinematic planet stage + uplink metrics + gauges. */
import HudPanel, { PanelHead } from './HudPanel';
import Gauge from '../widgets/Gauge';
import GlobeCanvas from '../widgets/GlobeCanvas';

const SPARKS: Record<string, number[]> = {
  ingestion: [34, 58, 42, 72, 54, 88, 66, 94, 74, 100],
  nodes: [48, 52, 60, 56, 70, 68, 78, 84, 80, 92],
  latency: [82, 70, 74, 60, 66, 52, 58, 44, 50, 38],
};

export default function LinkagePanel() {
  return (
    <HudPanel className="linkage-panel" label="Global linkage">
      <PanelHead
        kicker="GLOBAL LINKAGE"
        title="PLANETARY UPLINK"
        right={
          <span className="pill pill-live">
            <i />
            LIVE SYNC
          </span>
        }
      />

      <div className="linkage-stage">
        <div className="earth-stage">
          <div className="earth-frame">
            <GlobeCanvas />
          </div>
          <span className="earth-caption">LIVE ORBITAL RENDER · 47.62°N 122.33°W</span>
        </div>

        <div className="linkage-side">
          <div className="linkage-metrics">
            <Metric label="DATA INGESTION" value="4.8" unit="TB/s" spark={SPARKS.ingestion} />
            <Metric label="ACTIVE NODES" value="128" unit="" spark={SPARKS.nodes} />
            <Metric label="LATENCY" value="34" unit="ms" spark={SPARKS.latency} />
          </div>

          <div className="gauge-row">
            <div className="gauge-cell">
              <Gauge value={96} size={84} />
              <span className="gc-k">THREAT DETECTION</span>
              <span className="gc-v">ACTIVE</span>
            </div>
            <div className="gauge-cell">
              <Gauge value={88} size={84} />
              <span className="gc-k">NETWORK</span>
              <span className="gc-v">SUBVERSION</span>
            </div>
          </div>
        </div>
      </div>
    </HudPanel>
  );
}

function Metric({
  label,
  value,
  unit,
  spark,
}: {
  label: string;
  value: string;
  unit: string;
  spark: number[];
}) {
  return (
    <div className="lmetric">
      <span className="lm-k">{label}</span>
      <span className="lm-v">
        {value}
        {unit && <em>{unit}</em>}
      </span>
      <span className="lm-spark" aria-hidden="true">
        {spark.map((h, i) => (
          <i key={i} style={{ height: `${Math.max(14, h)}%`, opacity: 0.35 + (h / 100) * 0.65 }} />
        ))}
      </span>
    </div>
  );
}
