/**
 * ULTRON AI — root component. Composes the HUD: status bar, header,
 * robot panel, linkage panel, chat terminal, tabs, views and nav.
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
import { addMessage, setState, useStore, getState } from './core/store';
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
      if (saved) setState({ settings: saved });
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
    const s = useStoreState();
    if (s.speaking) setPulseMode('speaking');
    else if (s.micActive) setPulseMode('listening');
    else if (s.thinking) setPulseMode('thinking');
  });

  return (
    <div className="app">
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-wash w1" />
        <div className="bg-wash w2" />
        <div className="bg-scan" />
        <div className="bg-glitch g1" />
        <div className="bg-glitch g2" />
      </div>

      <StatusBar />
      <Header />

      {view === 'dashboard' && (
        <main className="hud-scroll">
          <RobotPanel />
          <LinkagePanel />
          <ChatTerminal />
          <BottomTabs />
          <div className="corner-spark" aria-hidden="true">✦</div>
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

/* local helpers to avoid circular imports in effects */
function getStateMessagesEmpty(): boolean {
  return getState().messages.length === 0;
}
function useStoreState() {
  return getState();
}
