/** App header: glowing title + hamburger (opens settings). */
import { APP_NAME } from '../core/config';
import { setState, useStore } from '../core/store';

export default function Header() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const provider = useStore((s) => s.settings.provider);

  return (
    <header className="app-header">
      <div className="header-notch" aria-hidden="true" />
      <h1 className="app-title">{APP_NAME}</h1>
      <div className="title-underline" aria-hidden="true">
        <span className="tu-core" />
      </div>
      <button
        className="hamburger"
        aria-label="Settings and menu"
        aria-expanded={settingsOpen}
        onClick={() => setState({ settingsOpen: true })}
      >
        <i /><i /><i />
      </button>
      <span className={`mode-chip ${provider === 'demo' ? 'chip-demo' : 'chip-live'}`}>
        {provider === 'demo' ? 'DEMO' : 'LIVE'}
      </span>
    </header>
  );
}
