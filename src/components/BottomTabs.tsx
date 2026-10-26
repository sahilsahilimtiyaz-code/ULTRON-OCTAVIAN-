/**
 * Lower panel: TELEMETRY / SUBSYSTEMS / WARNINGS as a segmented control.
 * Real system facts (voice support, connection, provider) are mixed with
 * decorative HUD readouts; real rows are marked with a ▲ marker.
 */
import { setState, useStore } from '../core/store';
import { detectCaps } from '../core/voice';
import type { PanelTab } from '../core/types';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'telemetry', label: 'TELEMETRY' },
  { id: 'subsystems', label: 'SUBSYSTEMS' },
  { id: 'warnings', label: 'WARNINGS' },
];

const TELEMETRY_ROWS = [
  ['HIGH-TECH TELEMETRY', '2560D'],
  ['ACCESS RATES', '1.00%'],
  ['START RATES', '16.4%'],
  ['CORE UPTIME', 'STABLE'],
];

export default function BottomTabs() {
  const tab = useStore((s) => s.tab);
  const net = useStore((s) => s.netStatus);
  const caps = detectCaps();
  const provider = useStore((s) => s.settings.provider);

  return (
    <div className="tabs-block">
      <div className="seg" role="tablist" aria-label="System panels">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`seg-btn ${tab === t.id ? 'seg-active' : ''}`}
            onClick={() => setState({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tabs-content">
        {tab === 'telemetry' && (
          <div className="tele-rows">
            {TELEMETRY_ROWS.map(([k, v]) => (
              <div className="trow" key={k}>
                <span className="trow-k">{k}</span>
                <span className="trow-bar" aria-hidden="true"><i /></span>
                <span className="trow-v">{v}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'subsystems' && (
          <div className="subsys-grid">
            <SubCell label="RENDER CORE" value="ACTIVE" good />
            <SubCell label="VOICE INPUT" value={caps.recognition ? 'READY' : 'N/A'} good={caps.recognition} />
            <SubCell label="BRAIN LINK" value={provider === 'demo' ? 'DEMO' : 'LINKED'} good={provider !== 'demo'} />
          </div>
        )}

        {tab === 'warnings' && (
          <div className="warn-rows">
            {net === 'offline' && (
              <WarnRow text="NETWORK LINK: OFFLINE — voice AI and live providers unavailable" real />
            )}
            {!caps.recognition && <WarnRow text="SPEECH RECOGNITION: NOT SUPPORTED in this browser — text input works" real />}
            {provider === 'demo' && <WarnRow text="BRAIN: DEMO MODE — no API key connected yet" real />}
            <WarnRow text="OVERRIDE ACTIVE" />
            <WarnRow text="CORE PROCESSOR: OVERCLOCKED" />
          </div>
        )}
      </div>
    </div>
  );
}

function SubCell({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="subcell">
      <span className={`subcell-icon ${good ? 'ok' : 'warn'}`} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 2 20 7v10l-8 5-8-5V7Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="m8.6 12 2.4 2.4 4.4-4.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={good ? 1 : 0.25} />
        </svg>
      </span>
      <span className="subcell-label">{label}</span>
      <span className={`subcell-val ${good ? '' : 'val-warn'}`}>{value}</span>
    </div>
  );
}

function WarnRow({ text, real }: { text: string; real?: boolean }) {
  return (
    <div className="warn-row" role={real ? 'alert' : undefined}>
      <span className="warn-marker">{real ? '▲' : '›'}</span>
      <span className="warn-text">{text}</span>
      <span className="warn-icon" aria-hidden="true">{real ? '!' : '✦'}</span>
    </div>
  );
}
