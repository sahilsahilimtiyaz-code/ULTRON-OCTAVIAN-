/** Floating bottom dock: dashboard, diagnostics, lab, systems, settings. */
import { setState, useStore } from '../core/store';
import type { AppView } from '../core/types';

const ITEMS: Array<{ view: AppView | null; label: string; aria: string }> = [
  { view: 'dashboard', label: 'CORE', aria: 'Dashboard' },
  { view: 'diagnostics', label: 'DIAG', aria: 'Diagnostics' },
  { view: 'lab', label: 'LAB', aria: 'Coding workspace' },
  { view: 'systems', label: 'LINK', aria: 'AI systems' },
  { view: null, label: 'CONFIG', aria: 'Settings' },
];

export default function BottomNav() {
  const view = useStore((s) => s.view);

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {ITEMS.map((item, i) => {
        const active = item.view !== null && item.view === view;
        return (
          <button
            key={item.label}
            className={`bn-btn ${active ? 'bn-active' : ''}`}
            aria-label={item.aria}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (item.view) setState({ view: item.view });
              else setState({ settingsOpen: true });
            }}
          >
            {i === 0 && <DashIcon />}
            {i === 1 && <GaugeIcon />}
            {i === 2 && <FlaskIcon />}
            {i === 3 && <AtomIcon />}
            {i === 4 && <GearIcon />}
            <span className="bn-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* -------- inline icons (original, simple line art) -------- */

function DashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="12" y1="17" x2="16" y2="10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.6" fill="currentColor" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6M10 3v6l-4.5 8.2A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-2.8L14 9V3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="7.5" y1="14" x2="16.5" y2="14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AtomIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="8.6" ry="3.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <ellipse cx="12" cy="12" rx="8.6" ry="3.4" fill="none" stroke="currentColor" strokeWidth="1.25" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="8.6" ry="3.4" fill="none" stroke="currentColor" strokeWidth="1.25" transform="rotate(-60 12 12)" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.2v2.5M12 18.3v2.5M3.2 12h2.5M18.3 12h2.5M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
