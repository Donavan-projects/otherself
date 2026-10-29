// Configuration de la démo : local/config.json, généré au build depuis config.local.json
// (voir wxt.config.ts et docs/config.md). Lisible seulement depuis les pages de
// l'extension : la clé API n'est jamais transmise à la page de la plateforme.

export type Language = 'en' | 'fr';

export interface DemoConfig {
  /** Personnage : avatar/<avatar>.svg. */
  avatar: string;
  /** Fond : avatar/fonds/<background>.svg. */
  background: string;
  /** Variante de couleurs : classe de la palette du SVG → couleur (« none » pour masquer, ex. barbe). */
  palette: Record<string, string>;
  /** Coiffure : sous-groupe coiffure_<hairstyle> du SVG. */
  hairstyle: string;
  /** Accessoires : sous-groupes accessoire_<nom> affichés. */
  accessories: string[];
  /** Décalage vertical du bandeau en pixels (négatif : vers le haut), borné à la zone de sécurité. */
  bannerOffsetY: number;
  testAudio: string | null;
  cv: string | null;
  debugSafeZone: boolean;
  /** Texte du bandeau (règle 1) : jamais vide. */
  bannerText: string;
  /** Déclaration prononcée après la révélation, avant les réponses (mode « message »). */
  messageText: string;
  language: Language;
  /** Prénom ou nom du candidat : l'avatar parle de lui à la troisième personne. */
  candidateName: string;
  /** Identifiant de voix Piper, par exemple en_US-norman-medium ; vide : voix du personnage (data-voix du SVG). */
  voice: string;
  /** Synthèse vocale : piper (local, gratuit, par défaut) ou openai (payant, en streaming). */
  ttsProvider: 'piper' | 'openai';
  /** Voix OpenAI ; vide : voix du personnage (data-voix-openai du SVG). */
  openaiVoice: string;
  openaiTtsModel: string;
  /** Hauteur de la voix Piper en demi-tons (−6 à +6), sans changement de débit. 0 : voix d'origine. */
  pitchSemitones: number;
  /** Réglages Piper (débit, intonation, rythme) ; absents : valeurs retenues dans lib/tts.ts. */
  piperScales: { lengthScale?: number; noiseScale?: number; noiseW?: number };
  /** Silence (ms) après lequel le recruteur est considéré comme ayant fini de parler. */
  silenceMs: number;
  /** Parole continue (ms) par-dessus la voix de l'avatar nécessaire pour l'interrompre (anti-écho). */
  bargeInMs: number;
  openaiApiKey: string;
  /** Retour audio de la voix de l'avatar pour l'utilisateur (document offscreen). */
  monitorAvatar: boolean;
  /** Volume du retour, de 0 à 1. */
  monitorVolume: number;
  sttModel: string;
  llmModel: string;
}

export const DEFAULT_BANNER_TEXT = 'Candidat automatisé, comme vous.';

const DEFAULTS: DemoConfig = {
  avatar: 'otherself',
  background: 'bureau-clair',
  palette: {},
  hairstyle: 'principale',
  accessories: [],
  bannerOffsetY: 0,
  testAudio: null,
  cv: null,
  debugSafeZone: false,
  bannerText: DEFAULT_BANNER_TEXT,
  messageText: '',
  language: 'en',
  candidateName: '',
  // Vide : voix du personnage. « high » est trop lent en WebAssembly sur la machine de référence.
  voice: '',
  ttsProvider: 'piper',
  openaiVoice: '',
  openaiTtsModel: 'gpt-4o-mini-tts',
  piperScales: {},
  pitchSemitones: 0,
  silenceMs: 800,
  bargeInMs: 600,
  openaiApiKey: '',
  monitorAvatar: true,
  monitorVolume: 0.8,
  sttModel: 'gpt-live-transcribe',
  llmModel: 'gpt-5.6-luna',
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
  config.candidateName = typeof raw.candidateName === 'string' ? raw.candidateName.trim() : '';
  config.monitorAvatar = raw.monitorAvatar !== false;
  config.monitorVolume =
    Number.isFinite(Number(raw.monitorVolume)) && raw.monitorVolume !== undefined
      ? Math.min(1, Math.max(0, Number(raw.monitorVolume)))
      : DEFAULTS.monitorVolume;
  config.ttsProvider = raw.ttsProvider === 'openai' ? 'openai' : 'piper';
  config.voice = safeName(raw.voice) ?? '';
  config.openaiVoice = safeName(raw.openaiVoice) ?? '';
  config.piperScales = Object.fromEntries(
    (['lengthScale', 'noiseScale', 'noiseW'] as const).flatMap((key) => {
      const value = Number((raw.piperScales as Record<string, unknown> | undefined)?.[key]);
      return Number.isFinite(value) && value > 0 ? [[key, value]] : [];
    }),
  );
  config.pitchSemitones = Number.isFinite(Number(raw.pitchSemitones)) ? Math.min(6, Math.max(-6, Number(raw.pitchSemitones))) : 0;
  config.avatar = safeName(raw.avatar) ?? DEFAULTS.avatar;
  config.background = safeName(raw.background) ?? DEFAULTS.background;
  config.palette = Object.fromEntries(
    Object.entries(raw.palette && typeof raw.palette === 'object' ? raw.palette : {}).filter(
      ([name, color]) => safeName(name) !== null && typeof color === 'string' && /^[#\w(),.% -]+$/.test(color),
    ),
  );
  config.hairstyle = safeName(raw.hairstyle) ?? DEFAULTS.hairstyle;
  config.accessories = Array.isArray(raw.accessories) ? raw.accessories.flatMap((name) => safeName(name) ?? []) : [];
  config.bannerOffsetY = Number.isFinite(Number(raw.bannerOffsetY)) ? Number(raw.bannerOffsetY) : 0;
  config.bargeInMs = Number(raw.bargeInMs) >= 0 && raw.bargeInMs !== undefined ? Number(raw.bargeInMs) : DEFAULTS.bargeInMs;
  return config;
}

/** Nom de fichier ou de classe sans chemin ni caractère spécial. */
function safeName(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]+$/.test(value) ? value : null;
}

/** Voix par défaut du personnage : attributs data-voix et data-voix-openai de la racine du SVG. */
export async function avatarVoices(avatar: string): Promise<{ piper: string | null; openai: string | null }> {
  const response = await fetch(localUrl(`/avatar-svg/${avatar}.svg`));
  if (!response.ok) return { piper: null, openai: null };
  const root = /<svg\b[^>]*>/.exec(await response.text())?.[0] ?? '';
  const read = (name: string) => safeName(new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1]);
  return { piper: read('data-voix'), openai: read('data-voix-openai') };
}

export async function loadLocalText(path: string | null): Promise<string> {
  if (!path) return '';
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
}
