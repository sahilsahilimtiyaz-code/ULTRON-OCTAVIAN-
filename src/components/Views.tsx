/**
 * Secondary views: DIAGNOSTICS (with face-state test buttons), LAB
 * (workspace placeholder — Milestone 5), SYSTEMS (provider + storage status).
 */
import { flashFace } from '../core/chatFlow';
import { toast, useStore } from '../core/store';
import { detectCaps } from '../core/voice';
import { providerInfo } from '../core/providers';
import { PROVIDER_ORDER } from '../core/providers';
import { setState } from '../core/store';
import type { FaceStateName } from '../core/types';

const TEST_STATES: FaceStateName[] = ['idle', 'listening', 'thinking', 'speaking', 'coding', 'success', 'error', 'angry'];

export function DiagnosticsView() {
  const face = useStore((s) => s.face);
  const net = useStore((s) => s.netStatus);
  const caps = detectCaps();

  return (
    <div className="view">
      <div className="view-title">DIAGNOSTICS</div>
      <p className="view-note">Trigger each facial state manually — verifies the animation controller end-to-end.</p>
      <div className="state-grid">
        {TEST_STATES.map((s) => (
          <button key={s} className={`state-btn ${face === s ? 'state-current' : ''}`} onClick={() => flashFace(s, 2400)}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="view-title small">SUBSYSTEM REPORT</div>
      <ul className="fact-list">
        <li>Network link: <b>{net.toUpperCase()}</b></li>
        <li>Speech recognition: <b>{caps.recognition ? 'SUPPORTED' : 'NOT SUPPORTED'}</b></li>
        <li>Speech synthesis: <b>{caps.synthesis ? 'SUPPORTED' : 'NOT SUPPORTED'}</b></li>
        <li>3D face: <b>LIVE RENDER</b> (drag to rotate)</li>
        <li>Storage: <b>IndexedDB + localStorage fallback</b></li>
      </ul>
    </div>
  );
}

export function LabView() {
  return (
    <div className="view">
      <div className="view-title">CODING WORKSPACE</div>
      <p className="view-note">
        This panel activates in <b>Milestone 5</b>: file tree, editor, change previews (diffs),
        task progress and project export with controlled file tools.
      </p>
      <div className="lab-stub">
        <div className="lab-row"><span>FILE TOOLS</span><b>STANDBY</b></div>
        <div className="lab-row"><span>EDITOR</span><b>STANDBY</b></div>
        <div className="lab-row"><span>TEST RUNNER</span><b>STANDBY</b></div>
        <div className="lab-row"><span>APK BUILD</span><b>NOT CONNECTED</b></div>
      </div>
      <p className="view-note dim">
        The agent will never claim a build or test ran unless the operation really executed and was verified.
      </p>
    </div>
  );
}

export function SystemsView() {
  const settings = useStore((s) => s.settings);
  const net = useStore((s) => s.netStatus);

  return (
    <div className="view">
      <div className="view-title">AI SYSTEMS</div>
      <p className="view-note">
        Direct device → provider connections verified at build time. Keys stay on this device.
      </p>
      <div className="prov-table" role="table" aria-label="Provider status">
        <div className="prov-row prov-head">
          <span>PROVIDER</span><span>LINK</span><span>STATE</span>
        </div>
        {PROVIDER_ORDER.map((id) => {
          const info = providerInfo(id);
          const selected = settings.provider === id;
          const hasKey = !!settings.apiKeys[id] || !info.needsKey;
          const state = id === 'demo' ? 'ACTIVE' : selected ? (hasKey ? 'SELECTED' : 'NEEDS KEY') : hasKey ? 'READY' : 'NO KEY';
          return (
            <button key={id} className={`prov-row prov-btn ${selected ? 'prov-selected' : ''}`} onClick={() => { setState({ settings: { ...settings, provider: id } }); toast(`${info.label.toUpperCase()} SELECTED`); }}>
              <span className="prov-name">{info.label}</span>
              <span className={`prov-link ${info.corsOk === false ? 'link-bad' : 'link-ok'}`}>
                {info.corsOk === null ? 'UNKNOWN' : info.corsOk === false ? 'PROXY REQ' : 'DIRECT'}
              </span>
              <span className={`prov-state ${state === 'NEEDS KEY' || state === 'NO KEY' ? 'st-warn' : ''}`}>{state}</span>
            </button>
          );
        })}
      </div>
      <p className="view-note dim">Network: {net}. NVIDIA requires a backend proxy (Milestone 6) for browser calls.</p>
    </div>
  );
}
