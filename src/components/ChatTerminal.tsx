/**
 * INTERACTION TERMINAL — glass console, role bubbles, composer with mic + send.
 * Behaviour is unchanged: same submit path, same recognition/meter flow.
 */
import { useEffect, useRef, useState } from 'react';
import { sendUserMessage, stopAll } from '../core/chatFlow';
import { setState, useStore, setFace } from '../core/store';
import { recognize, startMicMeter, stopMicMeter, stopSpeaking } from '../core/voice';
import { bumpPulse, setPulseMode } from '../core/pulse';

function timeLabel(ts: number): string {
  return new Date(ts)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    .toUpperCase();
}

export default function ChatTerminal() {
  const messages = useStore((s) => s.messages);
  const thinking = useStore((s) => s.thinking);
  const speaking = useStore((s) => s.speaking);
  const micActive = useStore((s) => s.micActive);
  const provider = useStore((s) => s.settings.provider);
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [partial, setPartial] = useState<string | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking, partial]);

  const busy = thinking || speaking;

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setPartial(null);
    void sendUserMessage(text);
  };

  const onMic = async () => {
    if (micActive) {
      stopSpeaking();
      stopMicMeter();
      setPulseMode('off');
      setState({ micActive: false, voiceStatus: 'off' });
      setFace('idle');
      return;
    }
    setState({ micActive: true, voiceStatus: 'listening', voiceError: null });
    setPulseMode('listening');
    setFace('listening');
    // best-effort real mic energy for the waveform/jaw; recognition is
    // already running, so a failure here can never break voice input
    void startMicMeter();
    try {
      const text = await recognize({
        onPartial: (t) => {
          setPartial(t);
          bumpPulse(0.4);
        },
      });
      stopMicMeter();
      if (text) {
        setPartial(null);
        void sendUserMessage(text);
      } else {
        setState({ micActive: false, voiceStatus: 'off' });
        setPulseMode('off');
        setFace('idle');
      }
    } catch (err) {
      stopMicMeter();
      const msg = err instanceof Error ? err.message : String(err);
      setState({ micActive: false, voiceStatus: 'error', voiceError: msg });
      setPulseMode('off');
      setFace('error');
      setTimeout(() => setFace('idle'), 1800);
    }
  };

  return (
    <section className="terminal" aria-label="Chat and interaction terminal">
      <header className="terminal-head">
        <div className="th-left">
          <span className="th-dot" aria-hidden="true" />
          <span className="th-title">INTERACTION TERMINAL</span>
        </div>
        <div className="th-right">
          <span className="th-chip">{provider === 'demo' ? 'DEMO' : provider.replace(/-/g, ' ')}</span>
          <span className="th-chip">{messages.length} MSG</span>
        </div>
      </header>

      <div className="terminal-body" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <article className="msg msg-assistant">
            <div className="msg-meta">
              <span className="msg-sender">ULTRON</span>
            </div>
            <div className="msg-text">
              Ask me your query. I will manage, optimize, and override your tasks.
            </div>
            {provider === 'demo' && <DemoChip />}
          </article>
        )}

        {messages.map((m) => (
          <article key={m.id} className={`msg msg-${m.role}${m.error ? ' msg-error' : ''}`}>
            <div className="msg-meta">
              <span className="msg-sender">
                {m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'ULTRON' : 'SYSTEM'}
              </span>
              <span>{timeLabel(m.ts)}</span>
            </div>
            <div className="msg-text">
              {m.role === 'system' ? m.text.replace(/^SYSTEM\s*\/\/\s*/i, '') : m.text}
            </div>
            {m.demo && m.role === 'assistant' && <DemoChip />}
          </article>
        ))}

        {partial && (
          <article className="msg msg-partial">
            <div className="msg-meta">
              <span className="msg-sender">YOU · LISTENING</span>
            </div>
            <div className="msg-text">{partial}</div>
          </article>
        )}

        {thinking && (
          <article className="msg msg-thinking">
            <span className="sys-red">PROCESSING</span>
            <span className="think-dots" aria-hidden="true"><i /><i /><i /></span>
          </article>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="input-row">
          <button
            type="button"
            className={`mic-btn ${micActive ? 'mic-on' : ''}`}
            aria-label={micActive ? 'Stop listening' : 'Start voice input'}
            onClick={() => void onMic()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <line x1="12" y1="17" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>

          <input
            className="cmd-input"
            type="text"
            placeholder="Command ULTRON…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Command input"
          />

          <button
            type={busy ? 'button' : 'submit'}
            className="send-btn"
            aria-label={busy ? 'Stop' : 'Send'}
            onClick={busy ? () => stopAll() : undefined}
          >
            {busy ? (
              <span className="stop-square" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.4 20.6 21 12 3.4 3.4 5.6 10.4 15 12l-9.4 1.6Z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

function DemoChip() {
  return <span className="demo-chip">DEMO RESPONSE</span>;
}
