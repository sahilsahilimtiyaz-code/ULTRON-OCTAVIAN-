/**
 * Voice layer: browser SpeechRecognition (input) + SpeechSynthesis (output).
 *
 * Honest limitations handled here:
 *  - Android Chrome/Firefox vary: some have no recognition, some silently
 *    refuse network speech. Every failure surfaces as a clear status.
 *  - Speech timing uses boundary events when available, otherwise a timer —
 *    this drives the jaw/waveform pulse. NOT phoneme-accurate lip sync.
 */

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
}

export function detectCaps(): VoiceCaps {
  return {
    recognition: !!getSRClass(),
    synthesis: typeof window !== 'undefined' && 'speechSynthesis' in window,
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
/* Speech synthesis                                                    */
/* ------------------------------------------------------------------ */

export interface SpeakHandlers {
  onPulse?: (strength: number) => void;
  onEnd?: () => void;
}

/** Robotic-ish voice pick: prefer deeper male en voice, else default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const preferred =
    en.find((v) => /male/i.test(v.name)) ??
    en.find((v) => /google uk english male/i.test(v.name)) ??
    en.find((v) => /daniel|fred|george/i.test(v.name)) ??
    en[0] ??
    voices[0];
  return preferred ?? null;
}

export function warmUpSynthesis(): void {
  if (!('speechSynthesis' in window)) return;
  // Android Chrome loads voices lazily - touch them early.
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

export function speak(text: string, handlers: SpeakHandlers = {}): void {
  if (!('speechSynthesis' in window)) {
    // no TTS: pulse by timer so the face still animates while text appears
    fallbackPulse(text, handlers);
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 0.98;
  u.pitch = 0.72; // lower pitch reads as more machine-like
  u.volume = 1;

  let timerPulse: ReturnType<typeof setInterval> | null = null;

  u.onboundary = () => handlers.onPulse?.(0.7);
  u.onstart = () => {
    // some engines never fire onboundary: keep a gentle pulse as a floor
    timerPulse = setInterval(() => handlers.onPulse?.(0.35), 140);
  };
  const done = () => {
    if (timerPulse) clearInterval(timerPulse);
    handlers.onEnd?.();
  };
  u.onend = done;
  u.onerror = done;

  try {
    window.speechSynthesis.speak(u);
  } catch {
    if (timerPulse) clearInterval(timerPulse);
    fallbackPulse(text, handlers);
  }
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/** Text-only pulse when TTS is unavailable: ~14 chars per second. */
function fallbackPulse(text: string, handlers: SpeakHandlers): void {
  const dur = Math.max(1200, Math.min(9000, (text.length / 14) * 1000));
  const start = Date.now();
  const iv = setInterval(() => handlers.onPulse?.(0.5), 130);
  setTimeout(() => {
    clearInterval(iv);
    handlers.onEnd?.();
  }, dur);
  void start;
}
