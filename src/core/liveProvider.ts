/**
 * Live provider adapter (OpenAI-compatible /chat/completions, non-streaming
 * for Milestone 1; streaming upgrade planned in Milestone 3).
 *
 * Security posture: the key lives only in this device's local IndexedDB and
 * is sent directly to the provider the user chose. Nothing else sees it.
 * No keys are ever hardcoded.
 */
import { providerInfo } from './providers';
import type { ChatMsg, ProviderId, Settings } from './types';

export interface ChatOptions {
  settings: Settings;
  history: ChatMsg[];
  userText: string;
  signal: AbortSignal;
}

const SYSTEM_PROMPT =
  'You are ULTRON, a cinematic AI coding assistant running on a mobile device. ' +
  'Answer clearly and concisely. You help with software projects: planning, code review, ' +
  'file changes and debugging. Current coding tools are limited to chat advice until the ' +
  'workspace tools activate.';

/* ------------------------------------------------------------------ */
/* Google model recovery                                               */
/*                                                                     */
/* Google retires model IDs (gemini-2.0-flash was shut down), and any */
/* saved ID then 404s. On a 404 we list the key's real models and      */
/* retry once with the best available chat model — the fix survives   */
/* future retirements. Cache keeps it to one extra request per key.   */
/* ------------------------------------------------------------------ */

const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const googleModelCache = new Map<string, string>();

/** Higher is better: stable flash models win, then newer versions. */
function googleModelScore(model: string): number {
  let s = 0;
  if (/flash/i.test(model)) s += 40;
  if (/pro/i.test(model)) s += 10;
  if (/lite/i.test(model)) s -= 15;
  if (/preview|exp/i.test(model)) s -= 20;
  const v = model.match(/(\d+(?:\.\d+)?)/);
  if (v) s += Math.min(30, parseFloat(v[1]) * 4);
  return s;
}

async function resolveGoogleModel(key: string, failedModel: string): Promise<string | null> {
  const cached = googleModelCache.get(key);
  if (cached && cached !== failedModel) return cached;
  try {
    const res = await fetch(`${GOOGLE_MODELS_URL}?key=${encodeURIComponent(key)}&pageSize=200`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const notChat = /embedding|aqa|imagen|tts|live|image|omni|transcribe|robotics|computer-use|deep-research|antigravity|lyria/i;
    const candidates = (data.models ?? [])
      .filter(
        (m) =>
          m.name &&
          m.name !== `models/${failedModel}` &&
          (m.supportedGenerationMethods ?? []).includes('generateContent') &&
          !notChat.test(m.name),
      )
      .map((m) => m.name!.replace(/^models\//, ''))
      .sort((a, b) => googleModelScore(b) - googleModelScore(a));
    const pick = candidates[0] ?? null;
    if (pick) googleModelCache.set(key, pick);
    return pick;
  } catch {
    return null;
  }
}

export async function sendLiveChat(opts: ChatOptions): Promise<string> {
  const { settings, history, userText, signal } = opts;
  const id = settings.provider as ProviderId;
  const info = providerInfo(id);
  if (info.id === 'demo') throw new Error('DEMO mode does not use the network.');
  if (id === 'custom') {
    const url = settings.models['custom']?.startsWith('http') ? settings.models['custom'] : '';
    if (!url) throw new Error('Custom provider needs a base URL saved in Settings.');
    return callCompletions(url.replace(/\/$/, ''), settings.apiKeys['custom'] ?? '', settings.models['custom'] ?? '', history, userText, signal, info.note);
  }
  if (!info.baseURL) throw new Error('Provider has no endpoint configured.');
  const key = settings.apiKeys[id] ?? '';
  const model = settings.models[id] || info.defaultModel;
  return callCompletions(info.baseURL, key, model, history, userText, signal, info.note,
    id === 'google' ? () => resolveGoogleModel(key, model) : undefined);
}

async function callCompletions(
  baseURL: string,
  key: string,
  model: string,
  history: ChatMsg[],
  userText: string,
  signal: AbortSignal,
  note?: string,
  onNotFound?: () => Promise<string | null>,
): Promise<string> {
  if (!model) throw new Error('No model set for this provider. Pick one in Settings.');
  if (keyNeeded(note) && !key) throw new Error('No API key saved for this provider. Open Settings.');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-12).filter((m) => !m.error).map((m) => ({ role: m.role === 'system' ? 'assistant' : m.role, content: m.text })),
    { role: 'user', content: userText },
  ];

  const request = (m: string) =>
    fetch(baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model: m, messages, max_tokens: 600, temperature: 0.7 }),
    });

  let res = await request(model);
  // Retired model (404): ask the recovery hook for a live model and retry once.
  if (res.status === 404 && onNotFound) {
    const alt = await onNotFound();
    if (alt && alt !== model) res = await request(alt);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const raw = await res.text();
      try {
        const body = JSON.parse(raw) as { error?: { message?: string } };
        detail = body?.error?.message
          ? `HTTP ${res.status} — ${body.error.message}`
          : `HTTP ${res.status}${raw ? ` — ${raw.slice(0, 180)}` : ''}`;
      } catch {
        const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) detail = `HTTP ${res.status} — ${text.slice(0, 180)}`;
      }
    } catch {
      /* no readable body */
    }
    throw new Error(`Provider error: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Provider returned an empty response.');
  return text;
}

function keyNeeded(note?: string): boolean {
  // OpenCode Zen works without a key for its free models.
  return note ? !note.includes('free models') : true;
}
