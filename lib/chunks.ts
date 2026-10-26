// Découpe du texte du LLM en morceaux à synthétiser au fil du streaming, uniquement à la
// ponctuation : fin de phrase (. ! ? …), ou virgule, point-virgule, deux-points pour scinder une
// phrase longue. Jamais devant une conjonction ou une préposition (« … pipelines, | and … » ou
// « … | for a logistics company » coupent l'intonation). Le premier morceau reste court : sa
// synthèse retarde le début de la voix.

/** Début de réponse : coupé à la première ponctuation après au moins 3 mots (fin de phrase : 1 mot). */
const FIRST_SOFT_MIN_WORDS = 3;
/** Tant que la réponse a moins de mots que cela, on est encore « au début ». */
const FIRST_PART_WORDS = 4;
/** Ensuite : phrases entières jusqu'à 22 mots ; au-delà, coupe à la dernière virgule possible. */
const MAX_WORDS = 22;
const NEXT_SOFT_MIN_WORDS = 5;
/** Garde-fou : aucune ponctuation pendant 40 mots (rare, le prompt demande des phrases courtes). */
const SAFETY_WORDS = 40;

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

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Sépare les morceaux prêts à dire du texte encore en cours d'écriture. `wordsSoFar` : mots de
 * la réponse déjà découpés. À la fin du flux, passer `final` pour tout rendre.
 */
export function takeChunks(text: string, wordsSoFar: number, final = false): [string[], string] {
  const chunks: string[] = [];
  let rest = text.trimStart();
  let words = wordsSoFar;
  for (;;) {
    const chunk = nextChunk(final ? `${rest} ` : rest, words < FIRST_PART_WORDS);
    if (chunk === null) break;
    const trimmed = chunk.trim();
    if (trimmed) chunks.push(trimmed);
    words += wordCount(trimmed);
    rest = rest.slice(chunk.length).trimStart();
  }
  if (final && rest.trim()) {
    chunks.push(rest.trim());
    rest = '';
  }
  return [chunks, rest];
}

/** Début de `text` à dire maintenant, ou null s'il faut attendre la suite du flux. */
function nextChunk(text: string, first: boolean): string | null {
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
    if (SENTENCE_END.test(word)) return count <= MAX_WORDS || lastSoft < 0 ? until(i) : until(lastSoft);
    if (SOFT_END.test(word) && canCutAfter(i)) {
      if (first && count >= FIRST_SOFT_MIN_WORDS) return until(i);
      if (count >= NEXT_SOFT_MIN_WORDS && count <= MAX_WORDS) lastSoft = i;
    }
    if (count > MAX_WORDS && lastSoft >= 0) return until(lastSoft);
    if (count >= SAFETY_WORDS && canCutAfter(i)) return until(i);
  }
  return null;
}
