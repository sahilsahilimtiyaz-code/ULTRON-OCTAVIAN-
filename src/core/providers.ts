/**
 * AI provider registry. Every provider speaks the OpenAI-compatible
 * /chat/completions protocol (Google via its official OpenAI-compat layer),
 * so one adapter handles them all and a new provider is one entry here.
 *
 * Reachability + CORS were verified from the target device on build day:
 *  - openrouter:   HTTP 200, CORS *                      -> browser OK
 *  - mistral:      HTTP 401 without key, CORS *          -> browser OK
 *  - google:       endpoint live, CORS echoes origin     -> browser OK
 *  - groq:         HTTP 401 without key, CORS *          -> browser OK
 *  - opencode-zen: HTTP 200, public model list           -> browser OK (verify auth shape)
 *  - nvidia:       HTTP 200, CORS **absent**             -> needs a tiny server proxy (Milestone 6)
 */
import type { ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  baseURL: string;
  defaultModel: string;
  needsKey: boolean;
  /** null = not yet verified */
  corsOk: boolean | null;
  note?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  demo: {
    id: 'demo',
    label: 'Demo Mode (no API key)',
    baseURL: '',
    defaultModel: 'offline-demo',
    needsKey: false,
    corsOk: true,
    note: 'Runs entirely on this device. Answers are scripted, clearly labelled DEMO — never a real model.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    needsKey: true,
    corsOk: true,
    note: 'Verified reachable from this device. Supports hundreds of models.',
  },
  'opencode-zen': {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    baseURL: 'https://opencode.ai/zen/v1',
    defaultModel: 'mimo-v2.6-flash-free',
    needsKey: false,
    corsOk: true,
    note: 'Verified reachable. Offers free models (mimo-v2.6-flash-free, flint-40b-free…). Key optional.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    needsKey: true,
    corsOk: true,
    note: 'Verified reachable from this device.',
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-8b-instruct',
    needsKey: true,
    corsOk: false,
    note: 'Server reachable, but NVIDIA does not allow direct browser calls (no CORS). Needs the small backend proxy planned for Milestone 6 — calls will fail until then.',
  },
  google: {
    id: 'google',
    label: 'Google AI (Gemini)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    needsKey: true,
    corsOk: true,
    note: 'Uses Google\u2019s official OpenAI-compatible endpoint. If a saved model has been retired, the app auto-switches to a current one.',
  },
  groq: {
    id: 'groq',
    label: 'Groq (free tier)',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    needsKey: true,
    corsOk: true,
    note: 'Verified reachable from this device.',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible URL)',
    baseURL: '',
    defaultModel: '',
    needsKey: false,
    corsOk: null,
    note: 'Point at any OpenAI-compatible /v1 endpoint (LM Studio, ollama, vLLM…).',
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'demo',
  'opencode-zen',
  'openrouter',
  'mistral',
  'google',
  'groq',
  'nvidia',
  'custom',
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS[id] ?? PROVIDERS.demo;
}
