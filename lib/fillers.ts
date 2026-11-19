// Phrases d'attente de l'avatar, jouées quand la réponse est prête mais doit encore attendre avant de commencer
// (lib/speech-queue.ts, attente avant de jouer) : courtes, neutres, sans rien affirmer sur le candidat. Textes fixes,
// gardés par l'extension comme la révélation (lib/disclosure.ts) : ils ne vont ni au moteur ni dans son historique.
// Pas de « Good question » : le prompt interdit de flatter la question. Sans dépendance : chargé aussi par Node.

import { candidateLabel, possessive, type Persona } from './disclosure.ts';

export function fillerTexts(persona: Persona): string[] {
  const name = candidateLabel(persona.language, persona.candidateName);
  return persona.language === 'fr'
    ? ['Laissez-moi y réfléchir.', 'Un instant.', `Je regarde dans les notes de ${name}.`, 'Je vérifie cela.']
    : ['Let me think about that.', 'One moment.', `Let me check ${possessive(name)} notes.`, 'Let me look at that.'];
}
