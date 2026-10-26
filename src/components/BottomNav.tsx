/** Fixed bottom nav: dashboard, diagnostics, lab (M5), systems, settings. */
import { setState, useStore, toast } from '../core/store';
import type { AppView } from '../core/types';

export default function BottomNav() {
  const view = useStore((s) => s.view);
  const active = view === 'dashboard' ? 0 : view === 'diagnostics' ? 1 : view === 'lab' ? 2 : 3;

  const go = (v: AppView, note?: string) => {
    if (note) toast(note);
    setState({ view: v });
  };

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <button className={`bn-btn ${active === 0 ? 'bn-active' : ''}`} aria-label="Dashboard" onClick={() => setState({ view: 'dashboard' })}>
        <DashIcon />
      </button>
      <button className={`bn-btn ${active === 1 ? 'bn-active' : ''}`} aria-label="Diagnostics" onClick={() => setState({ view: 'diagnostics' })}>
        <GaugeIcon />
      </button>
      <button className={`bn-btn ${active === 2 ? 'bn-active' : ''}`} aria-label="Coding workspace (arrives in Milestone 5)" onClick={() => go('lab', 'CODING WORKSPACE arrives in Milestone 5 — foundation is ready')}>{/* eslint-disable-next-line */}
        <FlaskIcon />
      </button>
      <button className={`bn-btn ${active === 3 ? 'bn-active' : ''}`} aria-label="AI systems" onClick={() => setState({ view: 'systems' })}>
        <AtomIcon />
      </button>
      <button className="bn-btn" aria-label="Settings" onClick={() => setState({ settingsOpen: true })}>
        <GearIcon />
      </button>
    </nav>
  );
}

/* -------- inline icons (original, simple line art) -------- */

function DashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <line x1="12" y1="17" x2="16" y2="10" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="17" r="1.6" fill="currentColor" />
    </svg>
  );
}
function FlaskIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6M10 3v6l-4.5 8.2A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-2.8L14 9V3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="7.5" y1="14" x2="16.5" y2="14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function AtomIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(-60 12 12)" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
