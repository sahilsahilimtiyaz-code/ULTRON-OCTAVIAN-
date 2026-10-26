/**
 * Offline DEMO brain. Produces clearly-labelled scripted answers so the whole
 * interface can be tested without any API key.
 *
 * These are NOT real model outputs and are always marked demo:true.
 */
import type { ChatMsg } from './types';

interface DemoRule {
  match: RegExp;
  reply: string;
}

const RULES: DemoRule[] = [
  {
    match: /\b(hi|hello|hey|greetings)\b/i,
    reply:
      'Hello. ULTRON online. In DEMO MODE I answer with scripted samples so you can test voice, animation and the interface. Add an API key in Settings to connect a real model.',
  },
  {
    match: /\b(who are you|what are you|your name)\b/i,
    reply:
      'I am ULTRON, a cinematic AI assistant shell. My face, voice and workspace are real software; my brain is currently DEMO MODE until you connect a provider.',
  },
  {
    match: /\b(status|report|diagnostics?)\b/i,
    reply:
      'Status report: rendering core ONLINE. Voice system checked at boot. Telemetry feed simulated. Coding workspace arrives in Milestone 5. Running in DEMO MODE.',
  },
  {
    match: /\b(demo|test)\b/i,
    reply:
      'DEMO MODE confirmed. Try: "what is your status", "tell me about this interface", or say "build" to hear the coding-agent plan.',
  },
  {
    match: /\b(build|create|code|app|website|program)\b/i,
    reply:
      'Coding agent plan (sample): 1. inspect project files, 2. draft a plan, 3. propose file changes, 4. show you a diff for approval, 5. apply and run checks. The workspace with file tools activates in Milestone 5.',
  },
  {
    match: /\b(face|robot|eyes|animation)\b/i,
    reply:
      'My face is an original procedural design rendered live in 3D: breathing idle motion, blinking, eye focus, jaw articulation while speaking, and state reactions for listening, thinking, success and error.',
  },
  {
    match: /\b(voice|speak|microphone|listen)\b/i,
    reply:
      'Voice bridge active: tap the microphone and speak; I replay answers through the speech engine when your browser supports it. Some Android browsers limit this — text always works.',
  },
  {
    match: /\b(bye|goodbye|shutdown|sleep)\b/i,
    reply: 'Going standby. Wake me any time.',
  },
];

const FALLBACK = [
  'Command received. DEMO MODE brain has scripted responses only — connect a provider in Settings for real answers.',
  'Acknowledged. This offline sample brain cannot reason about your request yet. Add an API key (OpenCode Zen has free models) and I will answer for real.',
  'Signal received and logged. Real reasoning requires a live provider; DEMO MODE stays honest about that.',
];

export function demoReply(history: ChatMsg[], userText: string): string {
  const last = userText.trim();
  for (const rule of RULES) {
    if (rule.match.test(last)) return rule.reply;
  }
  const i = (history.length + last.length) % FALLBACK.length;
  return FALLBACK[i];
}
