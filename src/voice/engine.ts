/**
 * engine.ts — the cinematic voice engine: one place that turns text into
 * scheduled, processed, measurable speech.
 *
 *   text -> TTS provider (browser | neural | local)
 *        -> decoded AudioBuffer (when the provider exposes one)
 *        -> RMS staging + duration-preserving pitch shift
 *        -> offline FX render (EQ, saturation, metallic layer, compression,
 *           short reverb, true-peak-aware limiting)
 *        -> playback through an AnalyserNode
 *        -> measured RMS drives the shared pulse (waveform + robot jaw)
 *
 * Guarantees:
 *  - exactly one utterance at a time (a new speak cancels the previous one),
 *  - onEnd ALWAYS fires, so the face/state machine can never get stuck,
 *  - the browser SpeechSynthesis path still works with no network and no key,
 *  - measured energy is only claimed when an analyser really is measuring;
 *    otherwise pulse.ts falls back to its synthetic envelope and diagnostics
 *    says so.
 */
import { resolvePreset, type VoicePreset } from './presets';
import { pitchShiftChannels, stageRms } from './dsp';
import { renderFx } from './chain';
import {
  getAudioContext,
  getTtsProvider,
  ttsErrorMessage,
  type SynthProgress,
  type TTSConfig,
  type TTSProviderId,
} from './tts';
import { getState } from '../core/store';
import { setRealEnergy } from '../core/pulse';

export interface SpeakOptions {
  onProgress?: (p: SynthProgress) => void;
  /** synthetic pulses — only used by paths with no measurable audio */
  onPulse?: (strength: number) => void;
  /** fired when a provider failed and the browser fallback took over */
  onFallback?: (message: string) => void;
  onEnd?: () => void;
}

export interface RenderMeta {
  provider: TTSProviderId;
  preset: string;
  bypass: boolean;
  pitchSemitones: number;
  /** measured 4x-oversampled true peak of the finished audio (dBTP) */
  truePeakDb: number | null;
  trimDb: number;
  offlineRendered: boolean;
  renderMs: number;
}

export interface PreparedSpeech {
  /** provider audio, untouched */
  raw: AudioBuffer;
  /** what actually gets played */
  processed: AudioBuffer;
  meta: RenderMeta;
}

function rmsToPulse(rms: number): number {
  // speech RMS roughly 0.008 (quiet) .. 0.25 (loud) — map to a 0..1 jaw drive
  const v = Math.min(1, rms * 6);
  return Math.min(1, Math.pow(v, 0.85));
}

function makeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const len = Math.max(1, channels[0]?.length ?? 1);
  try {
    return new AudioBuffer({ numberOfChannels: channels.length, length: len, sampleRate });
  } catch {
    const ctx = getAudioContext();
    const b = ctx.createBuffer(channels.length, len, sampleRate);
    channels.forEach((c, i) => b.copyToChannel(c, i));
    return b;
  }
}

function copyChannels(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c).slice());
  return out;
}

class VoiceEngine {
  private generation = 0;
  private active: { ctrl: AbortController; finish: () => void } | null = null;
  private playback: { src: AudioBufferSourceNode; stop: () => void } | null = null;
  private last: PreparedSpeech | null = null;
  private lastErrorValue: string | null = null;
  private micStop: (() => void) | null = null;

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  get lastOutput(): PreparedSpeech | null {
    return this.last;
  }

  get playing(): boolean {
    return this.playback !== null;
  }

  /* ---------------------------------------------------------------- */

  private cfg(): TTSConfig {
    const v = getState().settings.voice;
    const provider = getTtsProvider(v.provider);
    const caps = provider.caps();
    return {
      provider: v.provider as TTSProviderId,
      voiceId: v.voiceId || caps.defaultVoice,
      model: v.model || caps.defaultModel,
      endpoint: v.endpoint || caps.defaultEndpoint,
      apiKey: v.apiKey || '',
      rate: v.rate,
    };
  }

  preset(): VoicePreset {
    const v = getState().settings.voice;
    return resolvePreset({
      preset: v.preset,
      rate: v.rate,
      pitchSemitones: v.pitchSemitones,
      formantTilt: v.formantTilt,
      metallic: v.metallic,
      reverb: v.reverb,
      bypass: v.bypass,
    });
  }

  /* ---------------------------------------------------------------- */
  /* synthesis (no playback) — used by the VoiceLab A/B workflow       */
  /* ---------------------------------------------------------------- */

  async synthesizeToBuffers(
    text: string,
    handlers: { onProgress?: (p: SynthProgress) => void; signal?: AbortSignal } = {},
  ): Promise<PreparedSpeech> {
    const cfg = this.cfg();
    const provider = getTtsProvider(cfg.provider);
    try {
      const result = await provider.synthesize(text, cfg, {
        onProgress: handlers.onProgress,
        signal: handlers.signal,
      });
      if (result.kind !== 'buffer') {
        throw new Error('This provider plays audio itself and exposes no buffer, so it cannot be processed or measured.');
      }
      return this.process(result.buffer, this.preset(), handlers.onProgress);
    } catch (err) {
      this.lastErrorValue = ttsErrorMessage(err);
      throw err;
    }
  }

  /** Stage + pitch-shift + offline FX render of a provider buffer. */
  private async process(
    input: AudioBuffer,
    preset: VoicePreset,
    onProgress?: (p: SynthProgress) => void,
  ): Promise<PreparedSpeech> {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (preset.bypass) {
      this.last = {
        raw: input,
        processed: input,
        meta: {
          provider: getState().settings.voice.provider as TTSProviderId,
          preset: preset.id,
          bypass: true,
          pitchSemitones: 0,
          truePeakDb: null,
          trimDb: 0,
          offlineRendered: false,
          renderMs: 0,
        },
      };
      return this.last;
    }

    onProgress?.({ stage: 'processing', detail: 'loudness staging' });
    const channels = copyChannels(input);
    stageRms(channels, -20, 12);

    if (Math.abs(preset.pitchSemitones) >= 0.1) {
      onProgress?.({ stage: 'processing', detail: `pitch ${preset.pitchSemitones > 0 ? '+' : ''}${preset.pitchSemitones} st` });
      await new Promise<void>((r) => setTimeout(r, 0)); // let the UI paint the stage
      pitchShiftChannels(channels, input.sampleRate, preset.pitchSemitones, {
        onProgress: (p) => onProgress?.({ stage: 'processing', detail: `pitch ${(p * 100).toFixed(0)}%` }),
      });
    }

    const shifted = makeBuffer(channels, input.sampleRate);
    onProgress?.({ stage: 'processing', detail: 'fx render' });
    const fx = await renderFx(shifted, preset);

    const prepared: PreparedSpeech = {
      raw: input,
      processed: fx.buffer,
      meta: {
        provider: getState().settings.voice.provider as TTSProviderId,
        preset: preset.id,
        bypass: false,
        pitchSemitones: preset.pitchSemitones,
        truePeakDb: fx.rendered ? fx.truePeakDb : null,
        trimDb: fx.trimDb,
        offlineRendered: fx.rendered,
        renderMs:
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
      },
    };
    this.last = prepared;
    return prepared;
  }

  /* ---------------------------------------------------------------- */
  /* speaking                                                          */
  /* ---------------------------------------------------------------- */

  speak(text: string, opts: SpeakOptions = {}): void {
    this.cancel();
    const gen = ++this.generation;
    const ctrl = new AbortController();
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      if (this.active?.ctrl === ctrl) this.active = null;
      setRealEnergy(null, 'playback');
      opts.onEnd?.();
    };
    this.active = { ctrl, finish };
    // finish() is idempotent: every exit path ends here, so onEnd always fires
    void this.runSpeak(text, opts, ctrl, gen, finish)
      .catch((err) => {
        this.lastErrorValue = ttsErrorMessage(err);
      })
      .then(() => finish());
  }

  private async runSpeak(
    text: string,
    opts: SpeakOptions,
    ctrl: AbortController,
    gen: number,
    finish: () => void,
  ): Promise<void> {
    const cfg = this.cfg();
    let result;
    try {
      result = await getTtsProvider(cfg.provider).synthesize(text, cfg, {
        onProgress: opts.onProgress,
        onBoundary: opts.onPulse,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (gen !== this.generation || ctrl.signal.aborted) return;
      const msg = ttsErrorMessage(err);
      this.lastErrorValue = msg;
      opts.onFallback?.(msg);
      if (cfg.provider === 'browser') return; // nothing to fall back to
      try {
        result = await getTtsProvider('browser').synthesize(
          text,
          { ...cfg, provider: 'browser', voiceId: '', model: '' },
          { onProgress: opts.onProgress, onBoundary: opts.onPulse, signal: ctrl.signal },
        );
      } catch (err2) {
        if (gen !== this.generation) return;
        this.lastErrorValue = ttsErrorMessage(err2);
        return;
      }
    }

    if (gen !== this.generation || ctrl.signal.aborted) return;
    if (!result) return;

    if (result.kind === 'handled') {
      // browser synthesis: it played itself, nothing measurable exists
      finish();
      return;
    }

    const preset = this.preset();
    const prepared = await this.process(result.buffer, preset, opts.onProgress);
    if (gen !== this.generation || ctrl.signal.aborted) return;

    opts.onProgress?.({ stage: 'playing', detail: preset.bypass ? 'raw' : preset.id });
    try {
      await this.playBuffer(prepared.processed, ctrl.signal);
    } catch (err) {
      if (gen !== this.generation) return;
      // no Web Audio playback possible: keep the reply audible via fallback
      const msg = ttsErrorMessage(err);
      this.lastErrorValue = msg;
      opts.onFallback?.(msg);
      try {
        await getTtsProvider('browser').synthesize(
          text,
          { ...cfg, provider: 'browser', voiceId: '', model: '' },
          { onProgress: opts.onProgress, onBoundary: opts.onPulse, signal: ctrl.signal },
        );
      } catch {
        /* nothing more we can do; state still recovers via finish() */
      }
    }
    if (gen !== this.generation) return;
    finish();
  }

  /* ---------------------------------------------------------------- */
  /* playback                                                          */
  /* ---------------------------------------------------------------- */

  /** Play a buffer through the analyser so real energy drives the jaw. */
  playBuffer(buffer: AudioBuffer, signal?: AbortSignal): Promise<void> {
    let ctx: AudioContext;
    try {
      ctx = getAudioContext();
    } catch (err) {
      return Promise.reject(err);
    }
    void ctx.resume().catch(() => undefined);

    return new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);

      const data = new Float32Array(analyser.fftSize);
      let raf = 0;
      let done = false;

      const stop = () => {
        if (done) return;
        done = true;
        if (raf) cancelAnimationFrame(raf);
        setRealEnergy(null, 'playback');
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        try {
          src.disconnect();
          analyser.disconnect();
          gain.disconnect();
        } catch {
          /* already gone */
        }
        if (this.playback?.src === src) this.playback = null;
        resolve();
      };

      const pump = () => {
        if (done) return;
        raf = requestAnimationFrame(pump);
        analyser.getFloatTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        setRealEnergy(rmsToPulse(Math.sqrt(s / data.length)), 'playback');
      };

      src.onended = stop;
      signal?.addEventListener('abort', stop, { once: true });
      this.playback = { src, stop };
      src.start(0);
      pump();
    });
  }

  stopPlayback(): void {
    this.playback?.stop();
    this.playback = null;
  }

  /** Stop generation, playback and provider requests; always safe to call. */
  cancel(): void {
    this.stopPlayback();
    const active = this.active;
    if (active) {
      active.ctrl.abort();
      active.finish();
    }
    try {
      getTtsProvider(getState().settings.voice.provider).cancel();
    } catch {
      /* provider without a cancel path */
    }
    this.generation++;
  }

  /* ---------------------------------------------------------------- */
  /* microphone energy metering (real measurements for LISTENING)      */
  /* ---------------------------------------------------------------- */

  /**
   * Best-effort attach of an AnalyserNode to the microphone. Called AFTER
   * speech recognition has started; if it fails (permission, device busy,
   * in-app browser quirks) it returns false and the synthetic listening
   * pulse is used — recognition itself is never touched.
   */
  async startMicMeter(): Promise<boolean> {
    if (this.micStop) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = getAudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let raf = 0;
      let done = false;
      const pump = () => {
        if (done) return;
        raf = requestAnimationFrame(pump);
        analyser.getFloatTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        setRealEnergy(rmsToPulse(Math.sqrt(s / data.length)), 'mic');
      };
      pump();
      this.micStop = () => {
        done = true;
        if (raf) cancelAnimationFrame(raf);
        setRealEnergy(null, 'mic');
        try {
          src.disconnect();
          analyser.disconnect();
        } catch {
          /* ignore */
        }
        stream.getTracks().forEach((t) => t.stop());
        this.micStop = null;
      };
      return true;
    } catch {
      return false;
    }
  }

  stopMicMeter(): void {
    this.micStop?.();
  }
}

export const voiceEngine = new VoiceEngine();
