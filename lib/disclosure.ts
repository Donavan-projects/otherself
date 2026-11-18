// Textes fixes de la transparence (règle 2), gardés par l'extension et jamais par le moteur conversationnel
// (docs/moteur.md) : révélation, rappel court et ouverture (révélation puis messageText). Aucun moteur ne peut les
// retirer, les retarder ni les reformuler : le tour de parole (lib/conversation.ts) les joue lui-même avant toute
// réponse. Sans dépendance (imports de types seulement) : chargé tel quel par scripts/bench-prompt.ts.

import type { Language } from './config';

/** Qui parle et de qui : langue, candidat représenté, nom de l'avatar (vide : avatar sans nom). */
export interface Persona {
  language: Language;
  candidateName: string;
  avatarName: string;
}

const DEFAULT_NAME: Record<Language, string> = { en: 'the candidate', fr: 'le candidat' };

/** Le candidat tel que l'avatar le nomme : son prénom, sinon « the candidate ». */
export function candidateLabel(language: Language, candidateName: string): string {
  return candidateName.trim() || DEFAULT_NAME[language];
}

export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

// Règle 2 : prononcée avant toute réponse, non désactivable. L'avatar parle du candidat à la troisième personne ;
// « I » ne désigne que l'avatar. Son nom, s'il en a un, s'ajoute sans rien retirer : « avatar IA » reste dit en clair.
function disclosure({ language, avatarName }: Persona, name: string): string {
  const avatar = avatarName.trim();
  if (language === 'fr') {
    const who = avatar ? `je suis ${avatar}, un avatar IA qui représente ${name}` : `je suis un avatar IA qui représente ${name}`;
    return `Bonjour. Avant de commencer, je tiens à être transparent : ${who}, et je réponds uniquement à partir de son CV et de ses notes.`;
  }
  const who = avatar ? `I'm ${avatar}, an AI avatar representing ${name}` : `I am an AI avatar representing ${name}`;
  return `Hello. Before we begin, I want to be transparent: ${who}, and I answer only from ${possessive(name)} CV and notes.`;
}

/** Révélation seule (début de l'ouverture), sans messageText. */
export function disclosureText(persona: Persona): string {
  return disclosure(persona, candidateLabel(persona.language, persona.candidateName));
}

/** Rappel court quand l'ouverture a déjà été coupée deux fois (écho, interruptions), ou après une pause. */
export function shortDisclosureText(persona: Persona): string {
  const name = candidateLabel(persona.language, persona.candidateName);
  const avatar = persona.avatarName.trim();
  if (persona.language === 'fr') {
    return avatar ? `Pour rappel, je suis ${avatar}, un avatar IA qui représente ${name}.` : `Pour rappel, je suis un avatar IA qui représente ${name}.`;
  }
  return avatar ? `As a reminder, I'm ${avatar}, an AI avatar representing ${name}.` : `As a reminder, I am an AI avatar representing ${name}.`;
}

/** Ouverture : révélation, puis la déclaration du candidat (messageText) si elle existe. */
export function openingText(persona: Persona, messageText: string): string {
  const first = disclosureText(persona);
  const message = messageText.trim();
  return message ? `${first} ${message}` : first;
}
