/**
 * VOICE ENGINE — the voice section of the settings sheet.
 *
 * Provider + credentials, ULTRON_PRIME / BYPASS preset, the adjustable
 * processing values, reference-audio management with validation and the
 * ElevenLabs cloning workflow, plus test/reference/output playback.
 *
 * Everything shown here reflects the REAL capabilities of the selected
 * provider (buffer audio, cloning, CORS status, verified or not) — nothing
 * is presented as working that has not actually been run.
 */
import { useEffect, useRef, useState } from 'react';
import { toast, updateSettings, useStore } from '../core/store';
import { voiceEngine } from '../voice/engine';
import { capsOf, defaultEndpoint, type TTSProviderId } from '../voice/tts';
import { PRESET_ORDER, clamp, getPreset, defaultProviderVoice, type VoiceSettings } from '../voice/presets';
import { TEST_PHRASES } from '../voice/analysis';
import {
  assessMaterial,
  cloneLimits,
  cloningSupported,
  cloneVoice,
  decodeClip,
  refsAdd,
  refsList,
  refsRemove,
  validateRefFile,
  type RefClip,
} from '../voice/cloning';

const PROVIDER_CHOICES: TTSProviderId[] = ['browser', 'elevenlabs', 'openai', 'local', 'fishaudio'];

function fmtSec(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s` : `${s.toFixed(1)}s`;
}

export default function VoiceEnginePanel() {
  const voice = useStore((s) => s.settings.voice);
  const [clips, setClips] = useState<RefClip[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refsList()
      .then(setClips)
      .catch(() => undefined);
  }, []);

  const caps = capsOf(voice.provider);
  const basePreset = getPreset(voice.preset);
  const processingOff = voice.bypass || basePreset.id === 'bypass';
  const limits = cloneLimits(voice.provider);
  const material = assessMaterial(clips, limits);
  const phrase = TEST_PHRASES.find((p) => p.id === voice.testPhraseId) ?? TEST_PHRASES[0];
  const selectedClip = clips.find((c) => c.id === voice.refClipId) ?? null;

  const patch = (p: Partial<VoiceSettings>) => updateSettings({ voice: { ...voice, ...p } });

  /* ---------------- test voice ---------------- */

  const onTest = () => {
    if (speaking) {
      voiceEngine.cancel();
      setSpeaking(false);
      setStatus(null);
      return;
    }
    setSpeaking(true);
    setError(null);
    voiceEngine.speak(phrase.text, {
      onProgress: (p) => setStatus(p.detail ? `${p.stage.toUpperCase()} // ${p.detail.toUpperCase()}` : p.stage.toUpperCase()),
      onFallback: (m) => setError(`Provider failed, browser fallback used: ${m}`),
      onEnd: () => {
        setSpeaking(false);
        setStatus(null);
      },
    });
  };

  /* ---------------- reference clips ---------------- */

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await validateRefFile(file, limits);
        if (!res.ok || !res.clip) {
          setError(res.reason ?? 'Reference file rejected.');
          continue;
        }
        if (res.warnings.length) toast(res.warnings[0].toUpperCase());
        const next = await refsAdd(res.clip);
        setClips(next);
        if (!voice.refClipId) patch({ refClipId: res.clip.id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const playClip = async (clip: RefClip) => {
    setBusy(true);
    setError(null);
    try {
      const buffer = await decodeClip(clip);
      // reference audio is played RAW — you must hear what you supplied
      await voiceEngine.playBuffer(buffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeClip = async (id: string) => {
    const next = await refsRemove(id);
    setClips(next);
    if (voice.refClipId === id) patch({ refClipId: next[0]?.id ?? null });
  };

  const onClone = async () => {
    if (!selectedClip) {
      setError('Select (or upload) a reference clip first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const usable = limits.multipleClips ? clips.filter((c) => !c.bytesLost).slice(0, 5) : [selectedClip];
      const res = await cloneVoice({
        provider: voice.provider,
        endpoint: voice.endpoint || defaultEndpoint(voice.provider),
        apiKey: voice.apiKey,
        name: `ULTRON ${new Date().toISOString().slice(0, 10)}`,
        clips: usable,
      });
      patch({ voiceId: res.voiceId });
      toast('VOICE CLONE CREATED');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- output playback ---------------- */

  const out = voiceEngine.lastOutput;
  const playOutput = (which: 'raw' | 'processed') => {
    const buf = out ? (which === 'raw' ? out.raw : out.processed) : null;
    if (!buf) {
      setError('No generated output yet. Generate one in DIAGNOSTICS → VOICE REFERENCE LAB.');
      return;
    }
    void voiceEngine.playBuffer(buf).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  /* ---------------- render ---------------- */

  return (
    <section className="voice-section" aria-label="Voice engine">
      <div className="voice-title">VOICE ENGINE</div>

      <label className="fld-label" htmlFor="tts-provider">TTS PROVIDER</label>
      <select
        id="tts-provider"
        className="fld"
        value={voice.provider}
        onChange={(e) => {
          const id = e.target.value as TTSProviderId;
          // keep a hand-typed voice id, otherwise fill the provider's default
          // (e.g. Fish Audio ships with the user's saved model id)
          const held =
            voice.voiceId && voice.voiceId !== defaultProviderVoice(voice.provider)
              ? voice.voiceId
              : '';
          patch({ provider: id, endpoint: '', voiceId: held || defaultProviderVoice(id) });
        }}
      >
        {PROVIDER_CHOICES.map((id) => (
          <option key={id} value={id}>
            {capsOf(id).label}
          </option>
        ))}
      </select>
      <ul className="caps-list">
        <li>Audio buffer (pitch shift + FX + measurement): <b>{caps.bufferAudio ? 'YES' : 'NO'}</b></li>
        <li>Voice cloning workflow: <b>{caps.cloning ? `DOCUMENTED (${voice.provider === 'fishaudio' ? 'Fish Audio' : 'ElevenLabs'})` : 'NOT AVAILABLE'}</b></li>
        <li>Direct browser calls: <b>{caps.cors === 'yes' ? 'ALLOWED' : caps.cors === 'no' ? 'BLOCKED' : 'UNVERIFIED'}</b></li>
        <li>End-to-end tested from this app: <b>{caps.verified ? 'YES' : 'NO — UNTESTED'}</b></li>
      </ul>
      {caps.notes.map((n) => (
        <p key={n} className="fld-note">• {n}</p>
      ))}

      <label className="fld-label" htmlFor="tts-voice">VOICE / MODEL ID</label>
      <input
        // remount on provider switch so the field re-fills with that
        // provider's default voice id while staying fully controlled
        key={voice.provider}
        id="tts-voice"
        className="fld"
        value={voice.voiceId}
        placeholder={caps.defaultVoice || (caps.voiceSelection ? 'provider voice id' : 'n/a')}
        onChange={(e) => patch({ voiceId: e.target.value })}
      />
      {caps.needsKey && (
        <>
          <label className="fld-label" htmlFor="tts-model">MODEL (OPTIONAL)</label>
          <input
            id="tts-model"
            className="fld"
            value={voice.model}
            placeholder={caps.defaultModel}
            onChange={(e) => patch({ model: e.target.value })}
          />
        </>
      )}

      {caps.id !== 'browser' && (
        <>
          <label className="fld-label" htmlFor="tts-endpoint">ENDPOINT (GATEWAY RECOMMENDED)</label>
          <input
            id="tts-endpoint"
            className="fld"
            value={voice.endpoint}
            placeholder={caps.defaultEndpoint}
            onChange={(e) => patch({ endpoint: e.target.value })}
          />
          <label className="fld-label" htmlFor="tts-key">API KEY (OPTIONAL — GATEWAY HOLDS IT SERVER-SIDE)</label>
          <div className="key-row">
            <input
              id="tts-key"
              className="fld"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              value={voice.apiKey}
              placeholder="leave empty when using your own gateway"
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
            <button className="key-eye" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>
              {showKey ? 'HIDE' : 'SHOW'}
            </button>
          </div>
          <p className="fld-note">
            Keys are stored only in this device&apos;s database and never embedded in the app. Prefer a gateway endpoint:
            then this key field stays empty and the secret never reaches the browser.
          </p>
        </>
      )}

      <label className="fld-label" htmlFor="voice-preset">PRESET</label>
      <select
        id="voice-preset"
        className="fld"
        value={voice.preset}
        onChange={(e) => patch({ preset: e.target.value as VoiceSettings['preset'] })}
      >
        {PRESET_ORDER.map((id) => (
          <option key={id} value={id}>
            {getPreset(id).name} — {getPreset(id).blurb}
          </option>
        ))}
      </select>

      <div className="toggle-row">
        <span>PROCESSING BYPASS (RAW AUDIO)</span>
        <button
          className={`toggle ${voice.bypass ? 'on' : ''}`}
          role="switch"
          aria-checked={voice.bypass}
          onClick={() => patch({ bypass: !voice.bypass })}
        >
          <i />
        </button>
      </div>
      {processingOff && (
        <p className="fld-note">
          Processing is bypassed: pitch shift, EQ, saturation, metallic layer, compression and reverb are all skipped.
        </p>
      )}

      <Slider
        label="SPEAKING RATE"
        value={voice.rate}
        min={0.75}
        max={1.15}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => patch({ rate: v })}
      />
      <Slider
        label="PITCH"
        value={voice.pitchSemitones}
        min={-8}
        max={4}
        step={0.5}
        disabled={processingOff}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`}
        onChange={(v) => patch({ pitchSemitones: v })}
      />
      <Slider
        label="FORMANT TILT (EQ APPROXIMATION)"
        value={voice.formantTilt}
        min={-1}
        max={1}
        step={0.05}
        disabled={processingOff}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
        onChange={(v) => patch({ formantTilt: v })}
      />
      <Slider
        label="METALLIC LAYER"
        value={voice.metallic}
        min={0}
        max={1}
        step={0.05}
        disabled={processingOff}
        format={(v) => v.toFixed(2)}
        onChange={(v) => patch({ metallic: v })}
      />
      <Slider
        label="REVERB"
        value={voice.reverb}
        min={0}
        max={1}
        step={0.05}
        disabled={processingOff}
        format={(v) => v.toFixed(2)}
        onChange={(v) => patch({ reverb: v })}
      />
      <p className="fld-note dim">
        EQ curve, saturation, compression and limiter ceiling live in the preset
        (src/voice/presets.ts) — {basePreset.name} is the starting point, not a fixed truth.
      </p>

      {/* ------------- test / playback ------------- */}

      <label className="fld-label" htmlFor="test-phrase">TEST PHRASE</label>
      <select
        id="test-phrase"
        className="fld"
        value={voice.testPhraseId}
        onChange={(e) => patch({ testPhraseId: e.target.value })}
      >
        {TEST_PHRASES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <button className={`btn-primary ${speaking ? 'btn-stop' : ''}`} onClick={onTest}>
        {speaking ? 'STOP VOICE' : `TEST VOICE — ${getPreset(voice.preset).name}`}
      </button>
      {status && <p className="fld-note">Engine: {status}</p>}
      <div className="ab-row">
        <button className="btn-ghost" onClick={() => playOutput('raw')} disabled={!out}>
          PLAY OUTPUT (RAW)
        </button>
        <button className="btn-ghost" onClick={() => playOutput('processed')} disabled={!out}>
          PLAY OUTPUT (PROCESSED)
        </button>
        <button className="btn-ghost" onClick={() => voiceEngine.stopPlayback()}>STOP</button>
      </div>

      {/* ------------- reference audio ------------- */}

      <div className="voice-title small">REFERENCE AUDIO {cloningSupported(voice.provider) ? '' : '(CLONE UNAVAILABLE HERE)'}</div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        multiple
        className="file-input"
        onChange={(e) => void onFiles(e.target.files)}
        aria-label="Add reference audio"
      />
      <p className="fld-note">
        Accepted: {limits.extensions.join(', ')} · max {(limits.maxBytes / 1048576).toFixed(0)} MB ·
        {' '}{limits.minSec}–{limits.maxSec} s per clip (recommended ≥ {limits.recommendedSec} s for cloning).
      </p>

      {clips.length > 0 && (
        <ul className="clip-list">
          {clips.map((c) => (
            <li key={c.id} className={c.id === voice.refClipId ? 'clip selected' : 'clip'}>
              <button className="clip-name" onClick={() => patch({ refClipId: c.id })} title="Select for cloning">
                {c.name}
              </button>
              <span className="clip-meta">
                {fmtSec(c.durationSec)} · {(c.size / 1024).toFixed(0)} KB{c.bytesLost ? ' · NO DATA' : ''}
              </span>
              <button className="clip-btn" onClick={() => void playClip(c)} aria-label={`Play ${c.name}`}>PLAY</button>
              <button className="clip-btn" onClick={() => void removeClip(c.id)} aria-label={`Remove ${c.name}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <p className="fld-note">
        Material on hand: {clips.length} clip(s), {material.totalSec.toFixed(0)} s —{' '}
        {material.sufficient ? 'enough to attempt a clone.' : 'NOT enough for a trustworthy clone.'}
      </p>
      {material.warnings.map((w) => (
        <p key={w} className="fld-note warn">⚠ {w}</p>
      ))}

      {cloningSupported(voice.provider) ? (
        <button className="btn-primary" onClick={() => void onClone()} disabled={busy || !clips.length}>
          {busy ? 'WORKING…' : 'CLONE VOICE FROM REFERENCES'}
        </button>
      ) : (
        <p className="fld-note">
          Cloning is not offered by this provider. ElevenLabs is the one documented cloning workflow implemented here.
        </p>
      )}

      {error && <p className="fld-note err">{error}</p>}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className={`slider-row ${disabled ? 'disabled' : ''}`}>
      <div className="slider-head">
        <span>{label}</span>
        <b>{format(value)}</b>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(clamp(parseFloat(e.target.value), min, max))}
      />
    </div>
  );
}
