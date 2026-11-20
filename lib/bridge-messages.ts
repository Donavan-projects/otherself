// Messages entre la page (monde MAIN), le pont (content script isolé) et le document
// offscreen. Les données audio voyagent en base64 (les ports d'extension
// sérialisent en JSON).

import type { AvatarState } from './avatar-states';

export const PORT_NAME = 'otherself-tab';
/** Clé des messages window.postMessage entre monde MAIN et monde isolé. */
export const PAGE_TAG = '__otherSelfBridge';

/** De la page vers l'extension. */
export type FromPage =
  /** Son du recruteur (partage de l'onglet par la page) : PCM 16 bits mono à 24 kHz. */
  | { type: 'audio'; pcm: string; at: number }
  /** La plateforme a demandé le micro : la voix de l'avatar peut être entendue. */
  | { type: 'mic-ready' }
  /** La voix de l'avatar (re)commence à sortir dans le micro injecté. */
  | { type: 'playback-started'; responseId: number; at: number }
  | { type: 'playback-idle'; responseId: number }
  /** Morceau de voix programmé dans le micro injecté : début et fin réels de sa lecture (Date.now), mesure des silences. */
  | { type: 'playback-chunk'; responseId: number; startAt: number; endAt: number }
  /** Pause (voix coupée, pipeline arrêté) ou reprise ; at : Date.now du clic, pour mesurer les délais. */
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number };

/** De l'extension vers la page. */
export type ToPage =
  /** Pont tout juste relié : la page renvoie son état (mic-ready). */
  | { type: 'hello' }
  /** Voix de l'avatar : PCM float 32 bits mono. */
  | { type: 'speak'; responseId: number; pcm: string; sampleRate: number; /** Texte prononcé (sous-titres de la page recruteur). */ text?: string; /** Phrase d'attente. */ filler?: boolean }
  | { type: 'stop' }
  /** État de l'avatar décidé par lib/conversation.ts ; at : Date.now du changement. */
  | { type: 'state'; state: AvatarState; previous: AvatarState; at: number; reason: string }
  /** Hochement de l'avatar à l'écoute (courte pause du recruteur). */
  | { type: 'nod'; at: number }
  /** Pipeline préchauffé : ouverture, rappel et phrases d'attente synthétisés (la page recruteur attend ce signal). */
  | { type: 'warm'; at: number };

/** Du document offscreen vers le pont (en plus de ToPage). */
export type FromOffscreen = ToPage | { type: 'log'; line: string };

export interface PageEnvelope {
  [PAGE_TAG]: 'to-ext' | 'to-page';
  message: FromPage | ToPage;
}
