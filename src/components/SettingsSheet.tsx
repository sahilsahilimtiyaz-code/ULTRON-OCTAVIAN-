/**
 * Settings sheet (slide-up): AI provider + key + model, voice prefs, data wipe.
 * Security model: keys are stored ONLY in this device's local IndexedDB and
 * are sent directly to the selected provider. No keys are embedded in code.
 */
import { useEffect, useState } from 'react';
import { PROVIDER_ORDER, providerInfo } from '../core/providers';
import { setState, updateSettings, toast } from '../core/store';
import { wipeLocalData } from '../core/idb';
import { detectCaps } from '../core/voice';
import { APP_VERSION } from '../core/config';
import type { ProviderId } from '../core/types';

export default function SettingsSheet() {
  const open = useOpen();
  const settings = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const caps = detectCaps();

  useEffect(() => {
    if (!open) return;
    setKeyDraft(settings.apiKeys[settings.provider] ?? '');
    const info = providerInfo(settings.provider);
    setModelDraft(settings.models[settings.provider] ?? info.defaultModel);
    setCustomUrl(settings.models['custom'] ?? '');
  }, [open, settings]);

  if (!open) return null;

  const info = providerInfo(settings.provider);

  const save = () => {
    updateSettings({
      apiKeys: { ...settings.apiKeys, [settings.provider]: keyDraft.trim() },
      models: { ...settings.models, [settings.provider]: modelDraft.trim() || info.defaultModel, ...(settings.provider === 'custom' ? { custom: customUrl.trim() } : {}) },
    });
    toast('SETTINGS SAVED');
    setState({ settingsOpen: false });
  };

  const pickProvider = (id: ProviderId) => {
    const inf = providerInfo(id);
    setState({ settings: { ...settings, provider: id } });
    setKeyDraft(settings.apiKeys[id] ?? '');
    setModelDraft(settings.models[id] ?? inf.defaultModel);
  };

  return (
    <div className="sheet-backdrop" onClick={() => setState({ settingsOpen: false })}>
      <div className="sheet" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>SYSTEM CONFIG</span>
          <button className="sheet-close" aria-label="Close settings" onClick={() => setState({ settingsOpen: false })}>✕</button>
        </div>
        <div className="sheet-body">
          <label className="fld-label" htmlFor="prov-select">AI PROVIDER</label>
          <select
            id="prov-select"
            className="fld"
            value={settings.provider}
            onChange={(e) => pickProvider(e.target.value as ProviderId)}
          >
            {PROVIDER_ORDER.map((id) => (
              <option key={id} value={id}>
                {providerInfo(id).label}
              </option>
            ))}
          </select>
          {info.note && <p className="fld-note">{info.note}</p>}

          {settings.provider === 'custom' && (
            <>
              <label className="fld-label" htmlFor="custom-url">BASE URL (…/v1)</label>
              <input id="custom-url" className="fld" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://your-host/v1" />
            </>
          )}

          {info.needsKey && (
            <>
              <label className="fld-label" htmlFor="api-key">API KEY</label>
              <div className="key-row">
                <input
                  id="api-key"
                  className="fld"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={info.corsOk === false ? 'saved, but needs backend proxy (M6)' : 'paste key…'}
                />
                <button className="key-eye" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? 'HIDE' : 'SHOW'}
                </button>
              </div>
              <p className="fld-note">
                Stored only in this device's local database. Sent only to {info.label}. Never embedded in the app code.
              </p>
            </>
          )}

          {settings.provider !== 'demo' && settings.provider !== 'custom' && (
            <>
              <label className="fld-label" htmlFor="model">MODEL</label>
              <input id="model" className="fld" value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} placeholder={info.defaultModel} />
              {settings.provider === 'opencode-zen' && (
                <p className="fld-note">Free models need no key: mimo-v2.6-flash-free, flint-40b-free, beam-free…</p>
              )}
            </>
          )}

          <div className="toggle-row">
            <span>SPEAK REPLIES ALOUD</span>
            <button
              className={`toggle ${settings.autoSpeak ? 'on' : ''}`}
              role="switch"
              aria-checked={settings.autoSpeak}
              onClick={() => updateSettings({ autoSpeak: !settings.autoSpeak })}
            >
              <i />
            </button>
          </div>
          <p className="fld-note">
            Voice input: {caps.recognition ? 'supported' : 'NOT supported in this browser'} · Speech output: {caps.synthesis ? 'supported' : 'NOT supported'}
          </p>

          <button className="btn-primary" onClick={save}>SAVE CONFIG</button>
          <button
            className="btn-danger"
            onClick={() => {
              void wipeLocalData().then(() => {
                setState({ messages: [] });
                toast('ALL LOCAL DATA CLEARED');
                setState({ settingsOpen: false });
              });
            }}
          >
            CLEAR ALL LOCAL DATA
          </button>
          <p className="fld-note dim">
            {APP_VERSION} · Conversations and settings are stored locally on this device only.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useStore } from '../core/store';
function useOpen() {
  return useStore((s) => s.settingsOpen);
}
function useSettings() {
  return useStore((s) => s.settings);
}
