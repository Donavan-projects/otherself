// Phrases d'attente de l'avatar, jouées rarement quand la réponse tarde (lib/conversation.ts, maybeFiller) : surtout
// des interjections brèves, et quelques phrases un peu plus longues réservées aux grosses attentes. Neutres, sans rien
// affirmer sur le candidat. Textes fixes, gardés par l'extension comme la révélation (lib/disclosure.ts) : ils ne vont
// ni au moteur ni dans son historique. Pas de « Good question » : le prompt interdit de flatter la question.
// Sans dépendance : chargé aussi par Node.

import { candidateLabel, possessive, type Persona } from './disclosure.ts';

export interface FillerTexts {
  /** Interjections brèves : la réserve courante. */
  short: string[];
  /** Phrases un peu plus longues : grosses attentes seulement. */
  long: string[];
}

export function fillerTexts(persona: Persona): FillerTexts {
  const name = candidateLabel(persona.language, persona.candidateName);
  return persona.language === 'fr'
    ? {
        short: ['Hmm.', 'Bien.', 'Voyons.', 'Alors.', 'D’accord.'],
        long: ['Laissez-moi y réfléchir.', `Je regarde dans les notes de ${name}.`, 'Un instant, je vérifie.'],
      }
    : {
        short: ['Hmm.', 'Right.', 'Let me see.', 'Okay.', 'Well.'],
        long: ['Let me think about that.', `Let me check ${possessive(name)} notes.`, 'One moment, let me check.'],
      };
}

const QUESTION_STARTS: Record<Persona['language'], RegExp> = {
  en: /^(what|how|why|when|where|which|who|whom|whose|tell me|describe|give me|walk me|explain|share|can you|could you|would you|will you|do you|did you|does|have you|has|are you|is there|is|are|were|was|should|talk about|let's talk)\b/,
  fr: /^(qu|quoi|comment|pourquoi|quand|où|quel|quelle|quels|quelles|qui|combien|racontez|raconte|décrivez|décris|donnez|expliquez|parlez|pouvez-vous|pourriez-vous|est-ce|avez-vous|êtes-vous)/,
};

/**
 * Vraie question (une phrase d'attente a du sens) : point d'interrogation, ou tournure interrogative ; jamais une
 * phrase très courte (moins de 4 mots) ni une conclusion sans question (« Thank you for your time. Goodbye. »).
 */
export function isRealQuestion(text: string, language: Persona['language']): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.split(/\s+/).filter(Boolean).length < 4) return false;
  if (clean.includes('?')) return true;
  // Dernière phrase du recruteur : c'est elle qui porte la demande.
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return QUESTION_STARTS[language].test(sentences.at(-1) ?? clean);
}
