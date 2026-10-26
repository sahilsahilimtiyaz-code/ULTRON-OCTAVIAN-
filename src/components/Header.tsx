/** App header: brand lockup, connection mode chip, settings entry. */
import { APP_NAME } from '../core/config';
import { setState, useStore } from '../core/store';

export default function Header() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const provider = useStore((s) => s.settings.provider);

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M12 2.7 20 7v10l-8 4.3L4 17V7Z"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path d="M12 6.3v11.4" stroke="#ff2f4a" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M7.5 9.9h2.6M13.9 9.9h2.6" stroke="rgba(255,255,255,0.82)" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M7.5 13.7h2.6M13.9 13.7h2.6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-name">
            {APP_NAME.replace(/\s*AI$/, '')}
            <span className="brand-ai">AI</span>
          </span>
          <span className="brand-sub">COGNITIVE OPERATING SYSTEM</span>
        </span>
      </div>

      <div className="header-actions">
        <span className={`mode-chip ${provider === 'demo' ? 'chip-demo' : 'chip-live'}`}>
          {provider === 'demo' ? 'DEMO' : 'LIVE'}
        </span>
        <button
          className="icon-btn"
          aria-label="Settings and configuration"
          aria-expanded={settingsOpen}
          onClick={() => setState({ settingsOpen: true })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
