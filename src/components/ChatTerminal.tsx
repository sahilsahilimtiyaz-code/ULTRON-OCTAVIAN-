/**
 * CHAT & INTERACTION TERMINAL — metallic bezel frame, message list, input row
 * with mic + send/stop. Follows the design language: silver bezel, dark red
 * screen, glowing red border, cyan underline accent.
 */
import { useEffect, useRef, useState } from 'react';
import { sendUserMessage, stopAll } from '../core/chatFlow';
import { setState, useStore } from '../core/store';
import { recognize, stopSpeaking } from '../core/voice';
import { bumpPulse, setPulseMode } from '../core/pulse';
import { setFace } from '../core/store';

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
      setPulseMode('off');
      setState({ micActive: false, voiceStatus: 'off' });
      setFace('idle');
      return;
    }
    setState({ micActive: true, voiceStatus: 'listening', voiceError: null });
    setPulseMode('listening');
    setFace('listening');
    try {
      const text = await recognize({
        onPartial: (t) => {
          setPartial(t);
          bumpPulse(0.4);
        },
      });
      if (text) {
        setPartial(null);
        void sendUserMessage(text);
      } else {
        setState({ micActive: false, voiceStatus: 'off' });
        setPulseMode('off');
        setFace('idle');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ micActive: false, voiceStatus: 'error', voiceError: msg });
      setPulseMode('off');
      setFace('error');
      setTimeout(() => setFace('idle'), 1800);
    }
  };

  return (
    <div className="terminal-outer">
      <div className="terminal-bezel">
        <div className="terminal-screen">
          <div className="terminal-head">
            <span className="th-title">CHAT &amp; INTERACTION TERMINAL</span>
            <span className="th-cyan" aria-hidden="true" />
          </div>

          <div className="terminal-body" ref={listRef} aria-live="polite">
            <div className="msg msg-system">
              <span className="sys-red">SYSTEM //</span> ULTRON ACTIVE
            </div>
            {messages.length === 0 && (
              <div className="msg msg-assistant">
                <span className="msg-sender">ULTRON:</span> Ask me your query. I will manage, optimize,
                and override your tasks.
                {provider === 'demo' && <DemoChip />}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg msg-${m.role} ${m.error ? 'msg-error' : ''}`}>
                {m.role === 'user' && <span className="msg-sender">YOU:</span>}
                {m.role === 'assistant' && <span className="msg-sender">ULTRON:</span>}
                {m.text}
                {m.demo && m.role === 'assistant' && <DemoChip />}
              </div>
            ))}
            {partial && (
              <div className="msg msg-partial">
                <span className="msg-sender">YOU (LISTENING):</span> {partial}
              </div>
            )}
            {thinking && (
              <div className="msg msg-thinking">
                <span className="sys-red">PROCESSING</span>
                <span className="think-dots" aria-hidden="true"><i /><i /><i /></span>
              </div>
            )}
          </div>

          <div className="terminal-input-row">
            <span className="input-label">INPUT COMMAND:</span>
            <div className="input-row">
              <button
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
                placeholder="Search and command..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                aria-label="Command input"
              />
              <button
                className="send-btn"
                aria-label={busy ? 'Stop' : 'Send'}
                onClick={() => (busy ? stopAll() : submit())}
              >
                {busy ? (
                  <span className="stop-square" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 11.5 21 3l-6.5 18-3.4-7.1L3 11.5Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoChip() {
  return <span className="demo-chip">DEMO RESPONSE</span>;
}
