// Configuration de la démo : local/config.json, généré au build depuis config.local.json
// (voir wxt.config.ts et docs/config.md). Lisible seulement depuis les pages de
// l'extension : la clé API n'est jamais transmise à la page de la plateforme.

import { badgeTextOrDefault } from './badge';
import { DEFAULT_PRONUNCIATIONS } from './pronunciation';

export type Language = 'en' | 'fr';

export interface DemoConfig {
  /** Fond : avatar/fonds/<background>.svg. */
  background: string;
  /** Rendu de l'avatar : vrm (modèle 3D avatar/otherself.vrm, par défaut ; repli automatique sur le secours) ou fallback (secours seul : images rendues depuis le modèle 3D ; « svg » accepté). */
  avatarRenderer: 'fallback' | 'vrm';
  testAudio: string | null;
  cv: string | null;
  /** Texte du marquage imprimé sur la veste (règle 1) : jamais vide ; « IA » ou « AI » par défaut selon la langue. */
  badgeText: string;
  /** Déclaration prononcée après la révélation, avant les réponses (mode « message »). */
  messageText: string;
  language: Language;
  /** Prénom ou nom du candidat : l'avatar parle de lui à la troisième personne. */
  candidateName: string;
  /** Prononciation pour la synthèse vocale seulement : mot → graphie phonétique (lib/pronunciation.ts), en plus des défauts. */
  pronunciations: Record<string, string>;
  /** Nom de l'avatar, dit dans la révélation (« I'm Nova, an AI avatar… ») ; vide : avatar sans nom. Jamais celui du candidat. */
  avatarName: string;
  /** Identifiant de voix Piper ; par défaut en_US-norman-medium (domaine public). */
  voice: string;
  /** Synthèse vocale : piper (local, gratuit, par défaut) ou openai (payant, en streaming). */
  ttsProvider: 'piper' | 'openai';
  /** Voix OpenAI (ttsProvider: openai) ; par défaut ash. */
  openaiVoice: string;
  openaiTtsModel: string;
  /** Hauteur de la voix Piper en demi-tons (−6 à +6), sans changement de débit ; par défaut +1,5. */
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
  /** Bouton « Aperçu de l'avatar » du popup (fenêtre Picture-in-Picture pour le tournage). */
  previewWindow: boolean;
  sttModel: string;
  llmModel: string;
}

const DEFAULTS: DemoConfig = {
  background: 'atrium',
  avatarRenderer: 'vrm',
  testAudio: null,
  cv: null,
  badgeText: 'AI',
  messageText: '',
  language: 'en',
  candidateName: '',
  avatarName: 'Nova',
  pronunciations: { ...DEFAULT_PRONUNCIATIONS },
  // Voix de l'avatar (choisies à l'écoute le 29/10) : norman, LibriVox, domaine public, entraînée de zéro ; jamais joe
  // ni libritts_r pour une publication (affinées à partir de lessac). « high » est trop lent en WebAssembly sur la
  // machine de référence.
  voice: 'en_US-norman-medium',
  ttsProvider: 'piper',
  openaiVoice: 'ash',
  openaiTtsModel: 'gpt-4o-mini-tts',
  piperScales: {},
  pitchSemitones: 1.5,
  silenceMs: 800,
  bargeInMs: 600,
  openaiApiKey: '',
  monitorAvatar: true,
  monitorVolume: 0.8,
  previewWindow: true,
  sttModel: 'gpt-live-transcribe',
  llmModel: 'gpt-5.6-luna',
};

// Fichiers ajoutés au build (local/, vendor/) : absents des chemins typés par WXT.
export const localUrl = (path: string) => new URL(path, browser.runtime.getURL('/')).href;

export async function loadDemoConfig(): Promise<DemoConfig> {
  const raw = (await (await fetch(localUrl('/local/config.json'))).json()) as Partial<DemoConfig>;
  const config: DemoConfig = { ...DEFAULTS, ...raw };
  config.language = raw.language === 'fr' ? 'fr' : 'en';
  config.badgeText = badgeTextOrDefault(raw.badgeText, config.language);
  config.silenceMs = Number(raw.silenceMs) > 0 ? Number(raw.silenceMs) : DEFAULTS.silenceMs;
  config.candidateName = typeof raw.candidateName === 'string' ? raw.candidateName.trim() : '';
  config.avatarName = avatarNameOrDefault(raw.avatarName, config.candidateName);
  config.pronunciations = pronunciationsWithDefaults(raw.pronunciations);
  config.monitorAvatar = raw.monitorAvatar !== false;
  config.previewWindow = raw.previewWindow !== false;
  config.monitorVolume =
    Number.isFinite(Number(raw.monitorVolume)) && raw.monitorVolume !== undefined
      ? Math.min(1, Math.max(0, Number(raw.monitorVolume)))
      : DEFAULTS.monitorVolume;
  config.ttsProvider = raw.ttsProvider === 'openai' ? 'openai' : 'piper';
  config.voice = safeName(raw.voice) ?? DEFAULTS.voice;
  config.openaiVoice = safeName(raw.openaiVoice) ?? DEFAULTS.openaiVoice;
  config.piperScales = Object.fromEntries(
    (['lengthScale', 'noiseScale', 'noiseW'] as const).flatMap((key) => {
      const value = Number((raw.piperScales as Record<string, unknown> | undefined)?.[key]);
      return Number.isFinite(value) && value > 0 ? [[key, value]] : [];
    }),
  );
  config.pitchSemitones = clampPitch(raw.pitchSemitones) ?? DEFAULTS.pitchSemitones;
  config.background = safeName(raw.background) ?? DEFAULTS.background;
  // fallback : avatar de secours seul (images rendues depuis le modèle 3D) ; « svg », ancien nom, est accepté.
  const renderer = raw.avatarRenderer as string | undefined;
  config.avatarRenderer = renderer === 'fallback' || renderer === 'svg' ? 'fallback' : 'vrm';
  config.bargeInMs = Number(raw.bargeInMs) >= 0 && raw.bargeInMs !== undefined ? Number(raw.bargeInMs) : DEFAULTS.bargeInMs;
  return config;
}

const SPOKEN_TEXT = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}' .-]*$/u;
const PRONUNCIATION_MAX = 40;

/**
 * Défauts (DEFAULT_PRONUNCIATIONS) complétés ou remplacés par ceux de config.local.json ; une graphie vide retire un
 * défaut. Mots et graphies : lettres, chiffres, espaces, apostrophes, points et tirets, 40 caractères au plus.
 */
export function pronunciationsWithDefaults(value: unknown): Record<string, string> {
  const table: Record<string, string> = { ...DEFAULT_PRONUNCIATIONS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return table;
  for (const [word, spelling] of Object.entries(value as Record<string, unknown>)) {
    const key = word.trim();
    if (!SPOKEN_TEXT.test(key) || key.length > PRONUNCIATION_MAX || typeof spelling !== 'string') continue;
    // La casse ne compte pas : une entrée de l'utilisateur remplace le défaut de même mot.
    for (const existing of Object.keys(table)) if (existing.toLocaleLowerCase() === key.toLocaleLowerCase()) delete table[existing];
    const said = spelling.trim();
    if (said === '') continue;
    if (SPOKEN_TEXT.test(said) && said.length <= PRONUNCIATION_MAX) table[key] = said;
  }
  return table;
}

const AVATAR_NAME_MAX = 30;

/**
 * Nom de l'avatar : absent → « Nova » ; "" → avatar sans nom ; illisible, trop long ou égal au nom du candidat (l'avatar
 * ne se fait jamais passer pour le candidat) → défaut, ou sans nom si le défaut est lui-même le nom du candidat.
 * Mêmes règles que l'avertissement du build (wxt.config.ts).
 */
export function avatarNameOrDefault(value: unknown, candidateName: string): string {
  const sameAsCandidate = (name: string) => candidateName.trim() !== '' && name.toLocaleLowerCase() === candidateName.trim().toLocaleLowerCase();
  const fallback = sameAsCandidate(DEFAULTS.avatarName) ? '' : DEFAULTS.avatarName;
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return fallback;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name === '') return '';
  if (name.length > AVATAR_NAME_MAX || !/^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u.test(name) || sameAsCandidate(name)) return fallback;
  return name;
}

/** Hauteur en demi-tons bornée à [−6, 6], ou null si absente ou illisible. */
function clampPitch(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value))) return null;
  return Math.min(6, Math.max(-6, Number(value)));
}

/** Nom de fichier ou de classe sans chemin ni caractère spécial. */
function safeName(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]+$/.test(value) ? value : null;
}

export async function loadLocalText(path: string | null): Promise<string> {
  if (!path) return '';
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
}
