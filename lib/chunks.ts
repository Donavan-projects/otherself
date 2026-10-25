// Découpe du texte du LLM en morceaux à synthétiser au fil du streaming. Le début d'une
// réponse est court (une proposition, 8 à 12 mots) : sa synthèse retarde le début de la
// voix. Les morceaux suivants restent bornés (16 mots) : chacun doit être synthétisé avant
// la fin du précédent, même quand Piper tombe à 0,7 × temps réel.

interface ChunkLimits {
  minWords: number;
  maxWords: number;
}

const FIRST_CHUNK: ChunkLimits = { minWords: 8, maxWords: 12 };
const NEXT_CHUNK: ChunkLimits = { minWords: 6, maxWords: 16 };

/** Mots devant lesquels une coupure sonne naturelle, faute de virgule. */
const CLAUSE_STARTS = new Set([
  'and', 'but', 'or', 'so', 'because', 'which', 'who', 'where', 'while', 'with', 'including', 'then',
  'et', 'mais', 'ou', 'donc', 'car', 'qui', 'où', 'dont', 'avec', 'notamment', 'puis', 'parce',
]);
/** À défaut, devant une préposition (« … pipelines | for a logistics company »). */
const PHRASE_STARTS = new Set([
  'for', 'in', 'at', 'to', 'on', 'from', 'during', 'since', 'as',
  'pour', 'dans', 'chez', 'à', 'en', 'sur', 'depuis', 'pendant', 'comme',
]);

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Sépare les morceaux prêts à dire du texte encore en cours d'écriture. `wordsSoFar` :
 * mots de la réponse déjà découpés (limites courtes tant que le début de la réponse fait
 * moins de 8 mots, « Yes. » compris). À la fin du flux, passer `final` pour tout rendre.
 */
export function takeChunks(text: string, wordsSoFar: number, final = false): [string[], string] {
  const chunks: string[] = [];
  let rest = text.trimStart();
  let words = wordsSoFar;
  for (;;) {
    const limits = words < FIRST_CHUNK.minWords ? FIRST_CHUNK : NEXT_CHUNK;
    const chunk = nextChunk(final ? `${rest} ` : rest, limits);
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
function nextChunk(text: string, { minWords, maxWords }: ChunkLimits): string | null {
  const words = [...text.matchAll(/\S+/g)];
  const end = /[.!?…](?=\s)/.exec(text);
  if (end) {
    const endIndex = end.index + 1;
    const count = words.filter((word) => word.index < endIndex).length;
    if (count <= maxWords) return text.slice(0, endIndex);
  }
  // Le mot n° maxWords n'est sûr d'être complet que si un autre le suit.
  if (words.length <= maxWords) return null;
  const until = (index: number) => {
    const word = words[index]!;
    return text.slice(0, word.index + word[0].length);
  };
  // Fin de proposition : virgule, point-virgule, deux-points, tiret.
  for (let i = maxWords - 1; i >= minWords - 1; i -= 1) {
    if (/[,;:—–]$/.test(words[i]![0])) return until(i);
  }
  // Sinon, juste avant une conjonction ou un relatif, puis avant une préposition.
  for (const starts of [CLAUSE_STARTS, PHRASE_STARTS]) {
    for (let i = maxWords; i >= minWords; i -= 1) {
      if (starts.has(words[i]![0].toLowerCase())) return until(i - 1);
    }
  }
  return until(maxWords - 1);
}
