/**
 * Voice layer: browser SpeechRecognition (input) + the cinematic voice engine
 * (output, see src/voice/*).
 *
 * This module keeps its original public API (recognize / speak / stopSpeaking
 * / warmUpSynthesis / detectCaps) so existing callers keep working, while
 * speech output now runs through src/voice/engine.ts:
 *   - neural/local TTS providers when configured (buffer audio),
 *   - the connected Web Audio FX chain (EQ → saturation → metallic layer →
 *     compression → reverb → limiter) rendered offline per utterance,
 *   - measured AnalyserNode energy driving the waveform and the robot jaw,
 *   - browser SpeechSynthesis as the offline/no-key fallback (unchanged
 *     behaviour, still no access to its audio: no FX, no measurement).
 *
 * Honest limitations:
 *  - Android Chrome/Firefox vary: some have no recognition, some silently
 *    refuse network speech. Every failure surfaces as a clear status.
 *  - Browser SpeechSynthesis output cannot be captured, routed through the
 *    effects chain, or pitch-shifted independently. Only its utterance.pitch
 *    coarse control is used, and diagnostics report the pulse as SYNTHETIC.
 *  - Speech timing uses real audio energy when a buffer is playing, otherwise
 *    boundary events / a timer. NOT phoneme-accurate lip sync.
 */

import { voiceEngine } from '../voice/engine';

/* minimal typings for SpeechRecognition which TS does not include */
interface SRResultItem { transcript: string; confidence: number }
interface SRResult { 0: SRResultItem; isFinal: boolean; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRClass = new () => SRInstance;

function getSRClass(): SRClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, SRClass | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceCaps {
  recognition: boolean;
  synthesis: boolean;
  webAudio: boolean;
  offlineRender: boolean;
  micMeter: boolean;
}

export function detectCaps(): VoiceCaps {
  const hasWindow = typeof window !== 'undefined';
  return {
    recognition: !!getSRClass(),
    synthesis: hasWindow && 'speechSynthesis' in window,
    webAudio: hasWindow && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext),
    offlineRender: typeof OfflineAudioContext !== 'undefined' || typeof (window as unknown as { webkitOfflineAudioContext?: unknown } | undefined)?.webkitOfflineAudioContext !== 'undefined',
    micMeter: !!(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia),
  };
}

export interface RecognizeHandlers {
  onPartial?: (text: string) => void;
  onStart?: () => void;
}

/**
 * Start recognition and resolve with the final transcript.
 * Rejects with a human-readable message on failure.
 */
export function recognize(handlers: RecognizeHandlers = {}): Promise<string> {
  const SR = getSRClass();
  if (!SR) {
    return Promise.reject(
      new Error('Speech recognition is not available in this browser. Chrome on Android works best.'),
    );
  }
  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    let settled = false;

    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(msg));
    };

    rec.onstart = () => handlers.onStart?.();
    rec.onresult = (e: SREvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      handlers.onPartial?.(finalText || interim);
    };
    rec.onerror = (e: SRErrorEvent) => {
      switch (e.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          fail('Microphone permission denied. Allow mic access in the browser site settings, then try again.');
          break;
        case 'no-speech':
          finish(''); // nothing said - not an error worth alarming about
          break;
        case 'network':
          fail('Speech service network error. Check your connection or type instead.');
          break;
        case 'aborted':
          finish(finalText);
          break;
        default:
          fail(`Speech recognition error: ${e.error}`);
      }
    };
    rec.onend = () => finish(finalText.trim());

    try {
      rec.start();
    } catch {
      fail('Could not start the microphone. Close other apps using it and retry.');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Continuous dictation — the mic stays live until it is switched off  */
/* ------------------------------------------------------------------ */

export interface DictationHandlers {
  /** full text so far: whatever was in the composer + everything said.
   *  `isFinal` is true when Chrome closed the utterance — that is the safe
   *  moment to act on the text (e.g. auto-send). */
  onPartial?: (text: string, isFinal: boolean) => void;
  onStart?: () => void;
  /** non-fatal message while the session is still running */
  onNotice?: (msg: string) => void;
  /** fatal — the session has stopped and will not restart */
  onError?: (msg: string) => void;
}

interface DictationSession {
  rec: SRInstance;
  handlers: DictationHandlers;
  /** text that was in the composer when the session started */
  base: string;
  /** final segments recognised in this session */
  finals: string;
  /** current interim segment */
  interim: string;
  wanted: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** consecutive hard failures (network / capture) before giving up */
  failures: number;
  /** Android sometimes swallows the first start() — tracked by a watchdog */
  everStarted: boolean;
  watchdog: ReturnType<typeof setTimeout> | null;
}

let session: DictationSession | null = null;

function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  return `${a} ${b}`;
}

function emit(s: DictationSession, isFinal: boolean): void {
  s.handlers.onPartial?.(joinText(s.base, joinText(s.finals, s.interim)), isFinal);
}

export function isDictating(): boolean {
  return session !== null;
}

/**
 * Reset the text a running session composes onto (e.g. after the draft was
 * sent) without stopping the microphone.
 */
export function resetDictation(text = ''): void {
  if (!session) return;
  session.base = text;
  session.finals = '';
  session.interim = '';
  emit(session, false);
}

function teardown(s: DictationSession): void {
  s.wanted = false;
  if (s.restartTimer) {
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
  }
  if (s.watchdog) {
    clearTimeout(s.watchdog);
    s.watchdog = null;
  }
  s.rec.onresult = null;
  s.rec.onerror = null;
  s.rec.onend = null;
  s.rec.onstart = null;
  try {
    s.rec.abort();
  } catch {
    /* already stopped */
  }
  if (session === s) session = null;
}

/** Stop the live dictation session (keeps whatever text was transcribed). */
export function stopDictation(): void {
  if (session) teardown(session);
}

/**
 * Start a continuous recognition session. Chrome/Android stop a continuous
 * session after a pause, so `onend` restarts it automatically until
 * stopDictation() is called — that is what keeps the mic live for dictation.
 *
 * Returns false when the browser has no speech recognition at all.
 */
export function startDictation(handlers: DictationHandlers = {}, base = ''): boolean {
  const SR = getSRClass();
  if (!SR) return false;

  stopDictation();

  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const s: DictationSession = {
    rec,
    handlers,
    base,
    finals: '',
    interim: '',
    wanted: true,
    restartTimer: null,
    failures: 0,
    everStarted: false,
    watchdog: null,
  };
  session = s;

  const restart = (delay: number) => {
    if (!s.wanted || s.restartTimer) return;
    s.restartTimer = setTimeout(() => {
      s.restartTimer = null;
      if (!s.wanted) return;
      try {
        rec.start(); // throws InvalidStateError if it never fully stopped
      } catch {
        /* still running — ignore */
      }
    }, delay);
  };

  const fatal = (msg: string) => {
    teardown(s);
    handlers.onError?.(msg);
  };

  rec.onstart = () => {
    s.everStarted = true;
    s.failures = 0;
    if (s.watchdog) {
      clearTimeout(s.watchdog);
      s.watchdog = null;
    }
    handlers.onStart?.();
  };

  rec.onresult = (e: SREvent) => {
    s.failures = 0; // any successful audio means the session is healthy
    s.everStarted = true;
    let interim = '';
    let sawFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const chunk = (r[0]?.transcript ?? '').trim();
      if (!chunk) continue;
      if (r.isFinal) {
        s.finals = joinText(s.finals, chunk);
        sawFinal = true;
      } else {
        interim = joinText(interim, chunk);
      }
    }
    s.interim = interim;
    emit(s, sawFinal);
  };

  rec.onerror = (e: SRErrorEvent) => {
    switch (e.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        fatal('Microphone permission denied. Allow mic access in the browser site settings, then try again.');
        break;
      case 'audio-capture':
        fatal('No microphone available. Check that a mic is connected and not held by another app.');
        break;
      case 'no-speech':
      case 'audio-capture-timeout':
        // silence — keep listening, this is exactly the restart case
        restart(120);
        break;
      case 'aborted':
        // we abort on teardown; anything else restarts
        if (s.wanted) restart(120);
        break;
      case 'network':
        s.failures += 1;
        if (s.failures >= 4) {
          fatal('Speech service network error. Check your connection or type instead.');
        } else {
          handlers.onNotice?.('Speech service hiccup — reconnecting…');
          restart(600 * s.failures);
        }
        break;
      case 'language-not-supported':
        fatal(`This browser has no speech engine for ${s.rec.lang}. Change the browser language or type instead.`);
        break;
      default:
        s.failures += 1;
        if (s.failures >= 4) fatal(`Speech recognition error: ${e.error}`);
        else restart(400 * s.failures);
    }
  };

  rec.onend = () => {
    // Chrome ends a continuous session after a pause — resume it.
    if (s.wanted) restart(120);
  };

  try {
    rec.start();
  } catch {
    fatal('Could not start the microphone. Close other apps using it and retry.');
    return false;
  }

  // Android Chrome occasionally swallows the very first start() with no
  // onstart, no onend and no error — retry once if nothing happens.
  s.watchdog = setTimeout(() => {
    s.watchdog = null;
    if (!s.wanted || s.everStarted) return;
    try {
      rec.start();
    } catch {
      /* already running */
    }
  }, 1600);
  return true;
}

/* ------------------------------------------------------------------ */
/* Speech synthesis — delegated to the cinematic voice engine          */
/* ------------------------------------------------------------------ */

export interface SpeakHandlers {
  /** synthetic pulse — only used when no measurable audio exists */
  onPulse?: (strength: number) => void;
  onProgress?: (stage: string, detail?: string) => void;
  /** a provider failed and the browser fallback took over */
  onFallback?: (message: string) => void;
  onEnd?: () => void;
}

export function warmUpSynthesis(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  // Android Chrome loads voices lazily - touch them early.
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

export function speak(text: string, handlers: SpeakHandlers = {}): void {
  voiceEngine.speak(text, {
    onPulse: handlers.onPulse,
    onProgress: handlers.onProgress
      ? (p) => handlers.onProgress?.(p.stage, p.detail)
      : undefined,
    onFallback: handlers.onFallback,
    onEnd: handlers.onEnd ?? (() => undefined),
  });
}

export function stopSpeaking(): void {
  voiceEngine.cancel();
}

/** Real microphone energy metering for the LISTENING state (best effort). */
export function startMicMeter(): Promise<boolean> {
  return voiceEngine.startMicMeter();
}

export function stopMicMeter(): void {
  voiceEngine.stopMicMeter();
}
