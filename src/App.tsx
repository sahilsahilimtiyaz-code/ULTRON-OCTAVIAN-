/**
 * ULTRON AI — root component. Composes the HUD: status strip, header,
 * robot panel, linkage panel, chat terminal, tabs, views and dock.
 */
import { useEffect } from 'react';
import StatusBar from './components/StatusBar';
import Header from './components/Header';
import RobotPanel from './components/RobotPanel';
import LinkagePanel from './components/LinkagePanel';
import ChatTerminal from './components/ChatTerminal';
import BottomTabs from './components/BottomTabs';
import BottomNav from './components/BottomNav';
import SettingsSheet from './components/SettingsSheet';
import { DiagnosticsView, LabView, SystemsView } from './components/Views';
import { bootFace } from './robot/FaceCanvas';
import { addMessage, normalizeSettings, setState, useStore, getState } from './core/store';
import { kvGet } from './core/idb';
import { warmUpSynthesis } from './core/voice';
import { setPulseMode } from './core/pulse';
import type { Settings } from './core/types';

export default function App() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);

  /* boot: load settings, welcome message, warm voice, start face */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await kvGet<Settings>('settings');
      if (cancelled) return;
      // merge over current defaults so settings saved by an older build
      // still have every voice-engine field at runtime
      if (saved) setState({ settings: normalizeSettings(saved) });
      warmUpSynthesis();
      if (getStateMessagesEmpty()) {
        addMessage({
          role: 'system',
          text: 'SYSTEM // ULTRON ACTIVE — boot sequence complete. Cognitive core rendering, voice bridge checked.',
          demo: true,
        });
      }
      bootFace();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* network status */
  useEffect(() => {
    const on = () => setState({ netStatus: 'online' });
    const off = () => setState({ netStatus: 'offline' });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  /* keep voice pulse mode in step with mic + speaking */
  useEffect(() => {
    const s = getState();
    if (s.speaking) setPulseMode('speaking');
    else if (s.micActive) setPulseMode('listening');
    else if (s.thinking) setPulseMode('thinking');
  });

  return (
    <div className="app">
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-aurora" />
        <div className="bg-grid" />
        <div className="bg-noise" />
        <div className="bg-vignette" />
      </div>

      <StatusBar />
      <Header />

      {view === 'dashboard' && (
        <main className="hud-scroll">
          <RobotPanel />
          <LinkagePanel />
          <ChatTerminal />
          <BottomTabs />
        </main>
      )}
      {view === 'diagnostics' && (
        <main className="hud-scroll">
          <DiagnosticsView />
        </main>
      )}
      {view === 'lab' && (
        <main className="hud-scroll">
          <LabView />
        </main>
      )}
      {view === 'systems' && (
        <main className="hud-scroll">
          <SystemsView />
        </main>
      )}

      <BottomNav />
      <SettingsSheet />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function getStateMessagesEmpty(): boolean {
  return getState().messages.length === 0;
}
