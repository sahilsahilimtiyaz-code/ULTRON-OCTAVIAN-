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
