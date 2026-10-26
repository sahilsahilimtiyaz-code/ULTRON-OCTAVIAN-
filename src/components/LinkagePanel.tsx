/** Middle panel: two gauges + wireframe globe + ingestion readout. */
import HudPanel from './HudPanel';
import Gauge from '../widgets/Gauge';
import GlobeCanvas from '../widgets/GlobeCanvas';

export default function LinkagePanel() {
  return (
    <HudPanel className="linkage-panel" label="Global linkage">
      <div className="linkage-title">GLOBAL LINKAGE:</div>
      <div className="linkage-grid">
        <div className="lg-side">
          <Gauge value={100} size={104} />
          <div className="lg-caption">THREAT DETECTION:</div>
          <div className="lg-value">ACTIVE</div>
        </div>
        <div className="lg-center">
          <GlobeCanvas />
          <div className="lg-caption">DATA INGESTION:</div>
          <div className="lg-value">4.8 TB/s</div>
        </div>
        <div className="lg-side">
          <Gauge value={100} size={104} />
          <div className="lg-caption">NETWORK:</div>
          <div className="lg-value">SUBVERSION</div>
        </div>
      </div>
    </HudPanel>
  );
}
