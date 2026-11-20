// Découpe du texte du LLM en morceaux à synthétiser au fil du streaming : une phrase entière par morceau (. ! ? …).
// Plus de coupure aux virgules (mesuré : « His experience spans operations, | products, and automation. » coupait
// l'intonation et ajoutait une pause au milieu d'une énumération), sauf pour une phrase de plus de 30 mots (rare, le
// prompt en demande 20 au plus), coupée à sa dernière virgule possible ; jamais devant une conjonction ou une
// préposition. Le premier morceau reste court sans règle particulière : le prompt demande une première phrase de 3 à
// 8 mots. Les synthèses en parallèle et l'attente avant de jouer (lib/speech-queue.ts) évitent les trous.

/** Au-delà, une phrase sans point est coupée à sa dernière virgule possible. */
const MAX_SENTENCE_WORDS = 30;
/** Garde-fou : aucune ponctuation pendant 45 mots. */
const SAFETY_WORDS = 45;

/** Mots devant lesquels on ne coupe jamais. */
const NO_CUT_BEFORE = new Set([
  'and', 'but', 'or', 'nor', 'so', 'because', 'which', 'who', 'whom', 'whose', 'where', 'when', 'while', 'that', 'than',
  'with', 'including', 'then', 'if', 'although', 'though', 'as',
  'for', 'in', 'at', 'to', 'on', 'of', 'from', 'by', 'about', 'into', 'during', 'since', 'after', 'before', 'over', 'under',
  'et', 'mais', 'ou', 'donc', 'car', 'ni', 'que', 'qui', 'où', 'dont', 'quand', 'lorsque', 'si', 'avec', 'notamment',
  'puis', 'parce', 'pour', 'dans', 'chez', 'à', 'au', 'aux', 'en', 'sur', 'de', 'des', 'du', 'par', 'depuis', 'pendant', 'comme',
]);

const SENTENCE_END = /[.!?…]["')\]»]*$/;
const SOFT_END = /[,;:]["')\]»]*$/;

/**
 * Sépare les morceaux prêts à dire du texte encore en cours d'écriture. `_wordsSoFar` (mots déjà découpés) n'est plus
 * utilisé depuis la fin de la règle du premier morceau court. À la fin du flux, passer `final` pour tout rendre.
 */
export function takeChunks(text: string, _wordsSoFar: number, final = false): [string[], string] {
  const chunks: string[] = [];
  let rest = text.trimStart();
  for (;;) {
    const chunk = nextChunk(final ? `${rest} ` : rest);
    if (chunk === null) break;
    const trimmed = chunk.trim();
    if (trimmed) chunks.push(trimmed);
    rest = rest.slice(chunk.length).trimStart();
  }
  if (final && rest.trim()) {
    chunks.push(rest.trim());
    rest = '';
  }
  return [chunks, rest];
}

/** Début de `text` à dire maintenant, ou null s'il faut attendre la suite du flux. */
function nextChunk(text: string): string | null {
  const words = [...text.matchAll(/\S+/g)];
  // Le dernier mot n'est complet que si un blanc le suit.
  const complete = /\s$/.test(text) ? words.length : words.length - 1;
  const until = (index: number) => {
    const word = words[index]!;
    return text.slice(0, word.index + word[0].length);
  };
  /** Coupe permise après le mot n° index : le mot suivant est complet et n'est ni une conjonction ni une préposition. */
  const canCutAfter = (index: number) =>
    index + 1 < complete && !NO_CUT_BEFORE.has(words[index + 1]![0].toLowerCase().replace(/^["'(«]+/, ''));
  let lastSoft = -1;
  for (let i = 0; i < complete; i += 1) {
    const word = words[i]![0];
    const count = i + 1;
    if (SENTENCE_END.test(word)) return until(i);
    if (SOFT_END.test(word) && canCutAfter(i)) lastSoft = i;
    if (count > MAX_SENTENCE_WORDS && lastSoft >= 0) return until(lastSoft);
    if (count >= SAFETY_WORDS && canCutAfter(i)) return until(i);
  }
  return null;
}
