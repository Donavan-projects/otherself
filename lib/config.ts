// Configuration de la démo : local/config.json, généré au build depuis config.local.json
// (voir wxt.config.ts et docs/config.md). Lisible seulement depuis les pages de
// l'extension : la clé API n'est jamais transmise à la page de la plateforme.

export type Language = 'en' | 'fr';

export interface DemoConfig {
  photo: string | null;
  testAudio: string | null;
  cv: string | null;
  debugSafeZone: boolean;
  /** Texte du bandeau (règle 1) : jamais vide. */
  bannerText: string;
  /** Déclaration prononcée après la révélation, avant les réponses (mode « message »). */
  messageText: string;
  language: Language;
  /** Identifiant de voix Piper, par exemple en_US-ljspeech-high. */
  voice: string;
  /** Silence (ms) après lequel le recruteur est considéré comme ayant fini de parler. */
  silenceMs: number;
  openaiApiKey: string;
  sttModel: string;
  llmModel: string;
}

export const DEFAULT_BANNER_TEXT = 'Candidat automatisé, comme vous.';

const DEFAULTS: DemoConfig = {
  photo: null,
  testAudio: null,
  cv: null,
  debugSafeZone: false,
  bannerText: DEFAULT_BANNER_TEXT,
  messageText: '',
  language: 'en',
  // « high » est trop lent en WebAssembly sur la machine de référence (mesuré : 1,25 à 2,7 × temps réel).
  voice: 'en_US-ljspeech-medium',
  silenceMs: 800,
  openaiApiKey: '',
  sttModel: 'gpt-live-transcribe',
  llmModel: 'gpt-6-luna',
};

/** Règle 1 : un texte de bandeau vide ou absent est remplacé par le texte par défaut. */
export function bannerTextOrDefault(text: unknown): string {
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : DEFAULT_BANNER_TEXT;
}

// Fichiers ajoutés au build (local/, vendor/) : absents des chemins typés par WXT.
export const localUrl = (path: string) => new URL(path, browser.runtime.getURL('/')).href;

export async function loadDemoConfig(): Promise<DemoConfig> {
  const raw = (await (await fetch(localUrl('/local/config.json'))).json()) as Partial<DemoConfig>;
  const config: DemoConfig = { ...DEFAULTS, ...raw };
  config.bannerText = bannerTextOrDefault(raw.bannerText);
  config.language = raw.language === 'fr' ? 'fr' : 'en';
  config.silenceMs = Number(raw.silenceMs) > 0 ? Number(raw.silenceMs) : DEFAULTS.silenceMs;
  return config;
}

export async function loadLocalText(path: string | null): Promise<string> {
  if (!path) return '';
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
}
