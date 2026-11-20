// Contrat entre le moteur conversationnel et le reste de l'extension (étape 6 de docs/feuille-de-route.md, détail
// dans docs/moteur.md). Un seul fichier de types, sans code.
//
//   son du recruteur → [tour de parole, extension] → HeardTurn → [moteur] → texte en flux → [tour de parole]
//   → voix phrase par phrase + RenderEvent → [rendu, page]
//
// Le moteur ne voit que du texte et quelques événements. Il ne connaît ni l'audio, ni la page, ni la révélation : les
// garanties de transparence restent dans l'extension, hors de sa portée (révélation et rappel court à texte fixe,
// lib/disclosure.ts ; marqueur IA et voyant, lib/badge.ts ; pause et retrait). Le tour de parole (lib/conversation.ts)
// découpe le flux du moteur en phrases pour la voix (lib/chunks.ts) et calcule lui-même les états et les hochements.
// Le rendu ne connaît que RenderEvent et l'audio.

import type { AvatarState } from './avatar-states';
import type { Persona } from './disclosure';
import type { ProfileSource } from './profile';
import type { SpeechAudio } from './tts';

// ——— Entrée du moteur ———

/** Ce que le recruteur a dit : transcription d'une prise de parole complète, avec ses heures (Date.now). */
export interface HeardTurn {
  text: string;
  /** Début de la prise de parole (détection de parole). */
  startedAt: number;
  /** Fin de la prise de parole (dernier instant de voix). */
  endedAt: number;
}

/**
 * Événements de l'entretien donnés au moteur. L'interruption (le recruteur reprend la parole, ou une pause coupe la
 * réponse) n'en fait pas partie : c'est l'abandon du signal passé à reply().
 */
export type EngineEvent =
  /** Nouvel entretien (autre page, onglet rechargé) : le moteur oublie l'historique. */
  | { type: 'reset'; reason: string }
  /** Pause demandée par l'utilisateur : aucune réponse n'est demandée jusqu'à la reprise. */
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number };

// ——— Le moteur ———

/**
 * Moteur conversationnel : reçoit ce que le recruteur a dit et produit le texte à dire. Implémentation actuelle :
 * lib/llm-engine.ts (OpenAI, prompt de lib/prompt.ts). Obligations de tout moteur (docs/moteur.md) : répondre
 * uniquement à partir du profil, sans invention ; parler de la personne représentée à la troisième personne ; ne
 * jamais se dire humain ni se faire passer pour elle ; ne pas répéter la révélation ni saluer (déjà faites par
 * l'extension).
 */
export interface ConversationEngine {
  /** Pour les logs : nom du moteur, modèle… sans contenu du profil. */
  readonly description: string;
  /**
   * Réponse à une prise de parole, en flux : fragments de texte de n'importe quelle taille (mots, phrases, bloc
   * entier), à dire dans l'ordre, sans balisage. signal abandonné = interruption : le moteur s'arrête au plus vite, et
   * une réponse interrompue ne compte pas comme dite.
   */
  reply(turn: HeardTurn, signal: AbortSignal): AsyncIterable<string>;
  notify(event: EngineEvent): void;
}

/** Création d'un moteur : il reçoit le profil par la source du profil (lib/profile.ts), jamais autrement. */
export type EngineFactory = (profile: ProfileSource, persona: Persona) => Promise<ConversationEngine>;

// ——— Sortie vers le rendu ———

/**
 * Événements reçus par le rendu (page : micro injecté, avatar), calculés par le tour de parole et non par le moteur.
 * Transmis par le pont (lib/bridge-messages.ts) sous la même forme.
 */
export type RenderEvent =
  | { type: 'state'; state: AvatarState; previous: AvatarState; at: number; reason: string }
  | { type: 'nod'; at: number };

/** Lien du tour de parole vers le rendu : voix de l'avatar (audio) et événements. */
export interface RenderLink {
  /**
   * Morceau de voix à jouer dans le micro injecté, rattaché à une réponse ; `text` : ce qu'il dit (sous-titres) ;
   * `filler` : phrase d'attente (lib/fillers.ts), marquée comme telle dans les sous-titres.
   */
  speak(responseId: number, audio: SpeechAudio, text?: string, filler?: boolean): void;
  /** Coupe tout ce qui reste à jouer. */
  stop(): void;
  /** Nouvel état de l'avatar (lib/avatar-states.ts), seulement quand il change. */
  state(state: AvatarState, previous: AvatarState, reason: string): void;
  /** Hochement : courte pause du recruteur pendant l'écoute. */
  nod(): void;
}
