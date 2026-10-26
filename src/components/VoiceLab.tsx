/**
 * VOICE REFERENCE LAB (inside DIAGNOSTICS) — Phase 6 of the voice milestone.
 *
 * Workflow: record/supply the SAME phrase you generate, then compare
 * measured numbers and listen A/B:
 *   reference clip  -> decode -> measure
 *   generated audio -> engine (TTS + pitch + FX chain) -> measure
 * plus before (raw) / after (processed) playback of the generated audio.
 *
 * The numbers are real measurements of real samples. They do not, on their
 * own, prove a voice match — the A/B playback is not decoration, it is half
 * of the method. Nothing here claims a match; it reports differences.
 */
import { useEffect, useRef, useState } from 'react';
import { getState, updateSettings, useStore } from '../core/store';
import { voiceEngine, type PreparedSpeech } from '../voice/engine';
import { analyze, compare, TEST_PHRASES, type CompareRow, type Metrics } from '../voice/analysis';
import { decodeClip, refsList, type RefClip } from '../voice/cloning';
import { getPreset } from '../voice/presets';

const nf = (v: number | null, unit: string, d = 1): string => (v === null || !isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);

export default function VoiceLab() {
  const voice = useStore((s) => s.settings.voice);
  const [clips, setClips] = useState<RefClip[]>([]);
  const [refMetrics, setRefMetrics] = useState<Metrics | null>(null);
  const [genMetrics, setGenMetrics] = useState<Metrics | null>(null);
  const [prepared, setPrepared] = useState<PreparedSpeech | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refsList()
      .then(setClips)
      .catch(() => undefined);
  }, []);

  const phrase = TEST_PHRASES.find((p) => p.id === voice.testPhraseId) ?? TEST_PHRASES[0];
  const clip = clips.find((c) => c.id === voice.refClipId) ?? null;
  const preset = getPreset(voice.preset);
  const rows: CompareRow[] = refMetrics && genMetrics ? compare(refMetrics, genMetrics) : [];

  const analyzeReference = async () => {
    if (!clip) {
      setError('Upload/select a reference clip in Settings → Voice engine first.');
      return;
    }
    setError(null);
    setPhase('DECODING REFERENCE');
    try {
      const buf = await decodeClip(clip);
      setRefMetrics(analyze(buf));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase(null);
    }
  };

  const generateOutput = async () => {
    setError(null);
    try {
      const out = await voiceEngine.synthesizeToBuffers(phrase.text, {
        onProgress: (p) => setPhase(p.detail ? `${p.stage.toUpperCase()} // ${p.detail.toUpperCase()}` : p.stage.toUpperCase()),
      });
      setPrepared(out);
      setGenMetrics(analyze(out.processed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase(null);
    }
  };

  return (
    <section className="voice-section" aria-label="Voice reference lab">
      <div className="voice-title">VOICE REFERENCE LAB</div>
      <p className="fld-note">
        Same phrase in, same phrase out — reference clip and generated audio are measured with the same analyser
        (F0 distribution, spectral balance, loudness, true peak, harmonic/noise, pacing).
      </p>

      <label className="fld-label" htmlFor="lab-phrase">TEST PHRASE</label>
      <select
        id="lab-phrase"
        className="fld"
        value={voice.testPhraseId}
        onChange={(e) => {
          const id = e.target.value;
          updateSettings({ voice: { ...getState().settings.voice, testPhraseId: id } });
        }}
      >
        {TEST_PHRASES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — “{p.text.slice(0, 34)}…”
          </option>
        ))}
      </select>
      <p className="fld-note dim">{phrase.text}</p>

      <div className="ab-row">
        <button className="btn-ghost" onClick={() => void analyzeReference()} disabled={!clip || phase !== null}>
          MEASURE REFERENCE
        </button>
        <button className="btn-ghost" onClick={() => void generateOutput()} disabled={phase !== null}>
          {phase ? 'WORKING…' : 'GENERATE + MEASURE'}
        </button>
      </div>
      {phase && <p className="fld-note">Engine: {phase}</p>}
      {error && <p className="fld-note err">{error}</p>}

      <div className="ab-row">
        <button
          className="btn-ghost"
          disabled={!clip}
          onClick={() => {
            if (!clip) return;
            void decodeClip(clip)
              .then((b) => voiceEngine.playBuffer(b))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)));
          }}
        >
          PLAY REFERENCE
        </button>
        <button className="btn-ghost" disabled={!prepared} onClick={() => prepared && void voiceEngine.playBuffer(prepared.raw)}>
          PLAY RAW
        </button>
        <button
          className="btn-ghost"
          disabled={!prepared}
          onClick={() => prepared && void voiceEngine.playBuffer(prepared.processed)}
        >
          PLAY PROCESSED
        </button>
        <button className="btn-ghost" onClick={() => voiceEngine.stopPlayback()}>STOP</button>
      </div>

      <SpectrumChart reference={refMetrics} generated={genMetrics} />

      {refMetrics && <MetricBlock title="REFERENCE — MEASURED" m={refMetrics} />}
      {genMetrics && (
        <MetricBlock
          title={`GENERATED — ${preset.name}${prepared ? ` · render ${prepared.meta.renderMs.toFixed(0)} ms${prepared.meta.trimDb ? ` · trim ${prepared.meta.trimDb.toFixed(1)} dB` : ''}` : ''}`}
          m={genMetrics}
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="voice-title small">COMPARISON</div>
          <div className="cmp-table" role="table" aria-label="Reference versus generated">
            <div className="cmp-row cmp-head">
              <span>METRIC</span><span>REF</span><span>GEN</span><span>Δ</span>
            </div>
            {rows.map((r) => (
              <div key={r.metric} className={`cmp-row ${r.status === 'off' ? 'cmp-off' : ''}`}>
                <span>{r.metric}</span>
                <span>{r.reference}</span>
                <span>{r.generated}</span>
                <span>{r.delta}</span>
              </div>
            ))}
          </div>
          <p className="fld-note dim">
            Highlighted rows differ more than a first-pass tolerance. Closing the gap = listen, adjust the preset,
            regenerate, re-measure. Numbers describe pitch and spectral balance; articulation and character are
            judged by ear with the A/B buttons above.
          </p>
        </>
      )}
    </section>
  );
}

function MetricBlock({ title, m }: { title: string; m: Metrics }) {
  return (
    <div className="metric-block">
      <div className="voice-title small">{title}</div>
      <ul className="fact-list">
        <li>F0 median: <b>{nf(m.f0.medianHz, ' Hz')}</b> (p10–p90: {nf(m.f0.p10Hz, ' Hz', 0)}–{nf(m.f0.p90Hz, ' Hz', 0)}), voiced {Math.round(m.f0.voicedRatio * 100)}% of frames</li>
        <li>Loudness: <b>{nf(m.rmsDb, ' dBFS')}</b> RMS · peak {nf(m.peakDb, ' dBFS')} · true peak {nf(m.truePeakDb, ' dBTP', 2)} · crest {nf(m.crestDb, ' dB')}</li>
        <li>Tone: centroid {nf(m.centroidHz, ' Hz', 0)} · 85% rolloff {nf(m.rolloff85Hz, ' Hz', 0)} · harmonics/noise {nf(m.hnrDb, ' dB')}</li>
        <li>Pacing: {nf(m.syllablesPerSec, ' syl/s', 2)} · duration {nf(m.durationSec, ' s')} · loudness spread {nf(m.loudnessVarDb, ' dB')}{m.clipPct > 0.01 ? ` · clipped ${m.clipPct.toFixed(2)}%` : ''}</li>
        <li>
          Band energy:{' '}
          {m.bands.map((b) => `${b.label} ${(b.share * 100).toFixed(0)}%`).join(' · ')}
        </li>
      </ul>
    </div>
  );
}

/** Overlay of the two log-frequency spectra (reference vs generated). */
function SpectrumChart({ reference, generated }: { reference: Metrics | null; generated: Metrics | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(120, canvas.clientWidth) * dpr;
    const h = Math.max(80, canvas.clientHeight) * dpr;
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,7,12,0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,45,63,0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const draw = (m: Metrics | null, color: string) => {
      if (!m) return;
      const spec = m.spectrum;
      let max = -120;
      for (let i = 0; i < spec.length; i++) if (spec[i] > max) max = spec[i];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      for (let i = 0; i < spec.length; i++) {
        const x = (i / (spec.length - 1)) * w;
        const db = Math.max(-72, spec[i] - max);
        const y = h - ((db + 72) / 72) * (h - 6) - 3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw(reference, 'rgba(255,74,94,0.95)');
    draw(generated, 'rgba(90,220,255,0.95)');
  }, [reference, generated]);

  return (
    <div className="spec-wrap">
      <canvas ref={ref} className="spec-canvas" aria-label="Spectrum overlay: reference vs generated" />
      <div className="spec-legend">
        <span className="spec-ref">REFERENCE</span>
        <span className="spec-gen">GENERATED</span>
        <span className="spec-dim">40 Hz → 8 kHz · −72 dB range</span>
      </div>
    </div>
  );
}
