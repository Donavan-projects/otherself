// Phrases d'attente de l'avatar, jouées rarement quand la réponse tarde (lib/conversation.ts, maybeFiller) : des
// phrases de trois mots ou plus, jamais un mot isolé (Piper rend mal les mots seuls : « Okay. », « Right. », « Hmm. »
// sonnent étirés ou plaintifs). Neutres, sans rien affirmer sur le candidat. Textes fixes, gardés par l'extension comme
// la révélation (lib/disclosure.ts) : ils ne vont ni au moteur ni dans son historique. Pas de « Good question » : le
// prompt interdit de flatter la question. Toutes à valider à l'oreille (page voices, ?jeu=attente) ; celles dont la
// durée trahit une déformation sont écartées au démarrage (distortedFillers). Sans dépendance : chargé aussi par Node.

import { candidateLabel, possessive, type Persona } from './disclosure.ts';

export function fillerTexts(persona: Persona): string[] {
  const name = candidateLabel(persona.language, persona.candidateName);
  return persona.language === 'fr'
    ? ['Laissez-moi voir.', 'Laissez-moi y réfléchir.', 'Une petite seconde.', `Je regarde les notes de ${name}.`, 'Un instant, je vérifie.', 'Je regarde cela.']
    : ['Let me see.', 'Let me think about that.', 'Give me a second.', `Let me check ${possessive(name)} notes.`, 'One moment, please.', 'Let me look at that.'];
}

/** Durée d'une phrase anormale si elle dépasse de plus de 50 % la durée attendue d'après son nombre de lettres. */
const DISTORTION_RATIO = 1.5;

/**
 * Phrases d'attente dont la durée trahit une déformation de la synthèse (voyelles étirées, silence intérieur) :
 * durée par lettre comparée à la médiane des autres. Renvoie les textes à écarter et le rapport de chacun.
 */
export function distortedFillers(durations: { text: string; ms: number }[]): { text: string; ratio: number; distorted: boolean }[] {
  const letters = (text: string) => Math.max(1, text.replace(/[^\p{L}]/gu, '').length);
  const perLetter = durations.map(({ text, ms }) => ms / letters(text)).sort((a, b) => a - b);
  const median = perLetter[Math.floor(perLetter.length / 2)] ?? 0;
  return durations.map(({ text, ms }) => {
    const ratio = median ? ms / letters(text) / median : 1;
    return { text, ratio, distorted: ratio > DISTORTION_RATIO };
  });
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
