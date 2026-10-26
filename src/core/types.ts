export type FaceStateName =
  | 'boot'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'coding'
  | 'success'
  | 'error'
  | 'angry';

export type AppView = 'dashboard' | 'diagnostics' | 'lab' | 'systems';
export type PanelTab = 'telemetry' | 'subsystems' | 'warnings';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMsg {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  /** true when produced by the offline demo brain, false when a real provider answered */
  demo: boolean;
  error?: boolean;
}

export type ProviderId =
  | 'demo'
  | 'openrouter'
  | 'opencode-zen'
  | 'mistral'
  | 'nvidia'
  | 'google'
  | 'groq'
  | 'custom';

import type { VoiceSettings } from '../voice/presets';

export interface Settings {
  provider: ProviderId;
  /** keys are stored locally on this device only */
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  autoSpeak: boolean;
  lowPower: boolean;
  /** cinematic voice engine configuration (presets, TTS provider, FX) */
  voice: VoiceSettings;
}

export type VoiceStatus = 'off' | 'listening' | 'denied' | 'unsupported' | 'error';

export interface AppState {
  face: FaceStateName;
  view: AppView;
  tab: PanelTab;
  messages: ChatMsg[];
  thinking: boolean;
  speaking: boolean;
  micActive: boolean;
  voiceStatus: VoiceStatus;
  voiceError: string | null;
  /** last TTS engine stage, shown on the Test voice control */
  ttsStatus: string | null;
  netStatus: 'online' | 'offline';
  settings: Settings;
  settingsOpen: boolean;
  toast: string | null;
  booted: boolean;
}
