/**
 * Secondary views: DIAGNOSTICS (face-state tests + subsystem truth),
 * LAB (workspace placeholder), SYSTEMS (provider + storage status).
 */
import VoiceLab from './VoiceLab';
import { flashFace } from '../core/chatFlow';
import { toast, useStore } from '../core/store';
import { detectCaps } from '../core/voice';
import { voiceEngine } from '../voice/engine';
import { capsOf } from '../voice/tts';
import { getPreset, resolvePreset } from '../voice/presets';
import { energySource } from '../core/pulse';
import { providerInfo } from '../core/providers';
import { PROVIDER_ORDER } from '../core/providers';
import { setState } from '../core/store';
import type { FaceStateName } from '../core/types';

const TEST_STATES: FaceStateName[] = ['idle', 'listening', 'thinking', 'speaking', 'coding', 'success', 'error', 'angry'];

function PageHead({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="view-head">
      <span className="view-eyebrow">{eyebrow}</span>
      <h1 className="view-title">{title}</h1>
      {note && <p className="view-note">{note}</p>}
    </div>
  );
}

export function DiagnosticsView() {
  const face = useStore((s) => s.face);
  const net = useStore((s) => s.netStatus);
  const voice = useStore((s) => s.settings.voice);
  const ttsStatus = useStore((s) => s.ttsStatus);
  const caps = detectCaps();
  const tts = capsOf(voice.provider);
  const preset = resolvePreset({
    preset: voice.preset,
    rate: voice.rate,
    pitchSemitones: voice.pitchSemitones,
    formantTilt: voice.formantTilt,
    metallic: voice.metallic,
    reverb: voice.reverb,
    bypass: voice.bypass,
  });
  const out = voiceEngine.lastOutput;
  const source = energySource();

  return (
    <div className="view">
      <PageHead
        eyebrow="SYSTEM DIAGNOSTICS"
        title="DIAGNOSTICS"
        note="Trigger each facial state manually — verifies the animation controller end-to-end."
      />

      <section className="card">
        <div className="card-head">
          <span className="card-title">FACE STATE OVERRIDE</span>
          <span className="pill"><i />LIVE RENDER</span>
        </div>
        <div className="state-grid">
          {TEST_STATES.map((s) => (
            <button key={s} className={`state-btn ${face === s ? 'state-current' : ''}`} onClick={() => flashFace(s, 2400)}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">SUBSYSTEM REPORT</span>
        </div>
        <ul className="fact-list">
          <li>Network link <b>{net.toUpperCase()}</b></li>
          <li>Speech recognition <b>{caps.recognition ? 'SUPPORTED' : 'NOT SUPPORTED'}</b></li>
          <li>Speech synthesis <b>{caps.synthesis ? 'SUPPORTED' : 'NOT SUPPORTED'}</b></li>
          <li>Web Audio + offline render <b>{caps.webAudio ? (caps.offlineRender ? 'SUPPORTED' : 'WEB AUDIO ONLY') : 'NOT SUPPORTED'}</b></li>
          <li>Mic energy meter <b>{caps.micMeter ? 'AVAILABLE' : 'NOT AVAILABLE'}</b></li>
          <li>3D face <b>LIVE RENDER</b></li>
          <li>Storage <b>INDEXEDDB + LOCALSTORAGE</b></li>
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">VOICE ENGINE</span>
          <span className={`pill ${preset.bypass ? 'pill-warn' : 'pill-live'}`}>
            <i />
            {preset.bypass ? 'BYPASS' : 'ULTRON_PRIME'}
          </span>
        </div>
        <ul className="fact-list">
          <li>Provider <b>{tts.label.toUpperCase()}</b></li>
          <li>Preset <b>{getPreset(voice.preset).name}</b></li>
          <li>Rate / pitch <b>{voice.rate.toFixed(2)}× · {preset.bypass ? 'BYPASSED' : `${preset.pitchSemitones > 0 ? '+' : ''}${preset.pitchSemitones} ST`}</b></li>
          <li>Metallic / reverb <b>{preset.metallic.toFixed(2)} · {preset.reverb.toFixed(2)}</b></li>
          <li>Processing chain <b>{preset.bypass ? 'RAW AUDIO' : 'EQ → SAT → METAL → COMP → REVERB → LIMIT'}</b></li>
          <li>Voice model <b>{voice.voiceId || tts.defaultVoice || '—'}{voice.model ? ` · ${voice.model}` : ''}</b></li>
          <li>Cloning workflow <b>{tts.cloning ? 'AVAILABLE (ELEVENLABS)' : 'NOT AVAILABLE'}</b></li>
          <li>
            Jaw / waveform source{' '}
            <b className={source === 'synthetic' ? 'st-warn' : ''}>
              {source === 'synthetic' ? 'SYNTHETIC' : `MEASURED (${source.toUpperCase()})`}
            </b>
          </li>
          <li>
            Last render{' '}
            <b>
              {out
                ? `${out.processed.duration.toFixed(1)} S${out.meta.truePeakDb !== null ? ` · ${out.meta.truePeakDb.toFixed(2)} DBTP` : ''}${out.meta.trimDb ? ` · TRIM ${out.meta.trimDb.toFixed(1)} DB` : ''} · ${out.meta.renderMs.toFixed(0)} MS`
                : 'NONE YET'}
            </b>
          </li>
          <li>Last error <b>{voiceEngine.lastError ?? 'NONE'}</b></li>
          <li>Engine status <b>{ttsStatus ?? (voiceEngine.playing ? 'PLAYING' : 'IDLE')}</b></li>
        </ul>
      </section>

      <VoiceLab />
    </div>
  );
}

export function LabView() {
  return (
    <div className="view">
      <PageHead
        eyebrow="CODING WORKSPACE"
        title="LAB"
        note="Activates in Milestone 5: file tree, editor, change previews (diffs), task progress and project export with controlled file tools."
      />
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
      <PageHead
        eyebrow="AI SYSTEMS"
        title="MODEL LINK"
        note="Direct device → provider connections verified at build time. Keys stay on this device."
      />

      <div className="prov-table" role="table" aria-label="Provider status">
        <div className="prov-row prov-head" role="row">
          <span>PROVIDER</span><span>LINK</span><span style={{ textAlign: 'right' }}>STATE</span>
        </div>
        {PROVIDER_ORDER.map((id) => {
          const info = providerInfo(id);
          const selected = settings.provider === id;
          const hasKey = !!settings.apiKeys[id] || !info.needsKey;
          const state = id === 'demo' ? 'ACTIVE' : selected ? (hasKey ? 'SELECTED' : 'NEEDS KEY') : hasKey ? 'READY' : 'NO KEY';
          return (
            <button
              key={id}
              role="row"
              className={`prov-row prov-btn ${selected ? 'prov-selected' : ''}`}
              onClick={() => {
                setState({ settings: { ...settings, provider: id } });
                toast(`${info.label.toUpperCase()} SELECTED`);
              }}
            >
              <span className="prov-name">{info.label}</span>
              <span className={`prov-link ${info.corsOk === false ? 'link-bad' : 'link-ok'}`}>
                {info.corsOk === null ? 'UNKNOWN' : info.corsOk === false ? 'PROXY REQ' : 'DIRECT'}
              </span>
              <span className={`prov-state ${state === 'NEEDS KEY' || state === 'NO KEY' ? 'st-warn' : ''}`}>{state}</span>
            </button>
          );
        })}
      </div>

      <p className="view-note dim">
        Network: {net}. NVIDIA requires a backend proxy (Milestone 6) for browser calls.
      </p>
    </div>
  );
}
