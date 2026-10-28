/**
 * ULTRON AI — Sites worker.
 *
 * Two jobs:
 *   1. serve the built app from env.ASSETS (SPA fallback included),
 *   2. expose a SAME-ORIGIN voice gateway, because fish.audio sends no CORS
 *      headers (measured: the preflight 404s), so a browser page can never
 *      call api.fish.audio directly.
 *
 * Required secret on this site: FISH_API_KEY  (Sites → Secrets)
 * Without it, the routes answer 502 with an explicit message instead of
 * failing silently — the app surfaces that message verbatim.
 *
 * This file is copied to freebuff-sites-build/worker.js before deploying
 * (freebuff-sites-build/ is generated, this is the source of truth).
 */

const FISH_BASE = 'https://api.fish.audio';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function missingKey() {
  return json(502, {
    error: 'gateway_misconfigured',
    message: 'FISH_API_KEY is not set on this deployment. Add it in Sites → Secrets, then try again.',
  });
}

/** POST /api/fish/tts — proxies the documented Fish Audio /v1/tts call. */
async function fishTts(request, env) {
  const key = env.FISH_API_KEY;
  if (!key) return missingKey();

  const body = await request.text();
  const model = request.headers.get('model');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  if (model) headers.model = model;

  let res;
  try {
    res = await fetch(`${FISH_BASE}/v1/tts`, { method: 'POST', headers, body });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'Could not reach api.fish.audio.' });
  }

  const buf = await res.arrayBuffer();
  // error bodies are JSON, success bodies are audio bytes — pass both through
  return new Response(buf, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || (res.ok ? 'audio/mpeg' : 'application/json'),
      'cache-control': 'no-store',
    },
  });
}

/** POST /api/fish/model — proxies the documented voice-cloning upload. */
async function fishModel(request, env) {
  const key = env.FISH_API_KEY;
  if (!key) return missingKey();

  const form = request.headers.get('content-type') || 'multipart/form-data';
  let buf;
  try {
    buf = await request.arrayBuffer();
  } catch {
    return json(400, { error: 'bad_request', message: 'Could not read the upload body.' });
  }

  let res;
  try {
    res = await fetch(`${FISH_BASE}/model`, {
      method: 'POST',
      headers: { 'Content-Type': form, Authorization: `Bearer ${key}` },
      body: buf,
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'Could not reach api.fish.audio.' });
  }

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/fish/tts' || pathname === '/api/fish/model') {
      if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
      return pathname.endsWith('/tts') ? fishTts(request, env) : fishModel(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
