// Dictionnaire de prononciation, pour la synthèse Piper seulement : certains noms sont mal lus (« Nova » devient à peu
// près « Nover » : eSpeak NG, le phonémiseur de Piper, le transcrit nˈəʊvə, et la voix norman colore ce schwa final en
// « er »). Le texte envoyé à la voix remplace ces mots par une graphie phonétique ; le texte affiché, la transcription
// (« Avatar : … ») et le LLM gardent l'orthographe. Mots entiers, sans tenir compte de la casse. La voix OpenAI
// (ttsProvider: openai) lit l'orthographe elle-même : le dictionnaire ne lui est pas appliqué.

import type { SpeechAudio, TtsEngine } from './tts';

/**
 * Graphies par défaut, choisies d'après les phonèmes d'eSpeak NG (colonne Phonèmes de la page voices) :
 * Nova, Nohvah, Nowvah, Novah et Nohva donnent tous nˈəʊvə (même schwa final) ; Noh-vah et « Noh vah » donnent deux
 * accents toniques (nˈəʊvˈɑː) ; Nohvaa, Nohvar et Nohvahh donnent un « ah » long (nˈəʊvɑː, 0,88 s seul) ; Nohvuh donne
 * nˈəʊvʌ, voyelle pleine courte de « cup », un seul accent, durée de Nova (0,68 s contre 0,63 s) : le plus proche d'un
 * « Nova » prononcé naturellement. À confirmer à l'oreille : page voices, ?prononcer=Nova:Nohvuh,Nohvaa,Noh-vah.
 */
export const DEFAULT_PRONUNCIATIONS: Readonly<Record<string, string>> = { Nova: 'Nohvuh' };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remplace chaque mot de la table par sa graphie phonétique ; table vide : texte inchangé. */
export function createPronouncer(table: Record<string, string>): (text: string) => string {
  const entries = Object.entries(table).filter(([word, spelling]) => word.trim() && spelling.trim());
  if (entries.length === 0) return (text) => text;
  const byWord = new Map(entries.map(([word, spelling]) => [word.trim().toLocaleLowerCase(), spelling.trim()]));
  // Mots entiers : bornes Unicode (lettres et chiffres), les plus longs d'abord pour les noms composés.
  const words = [...byWord.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return (text) => text.replace(pattern, (match) => byWord.get(match.toLocaleLowerCase()) ?? match);
}

/** Moteur de voix qui prononce selon la table ; les appelants lui passent toujours le texte d'origine. */
export function withPronunciations(engine: TtsEngine, table: Record<string, string>): TtsEngine {
  const pronounce = createPronouncer(table);
  return {
    get description() {
      const count = Object.keys(table).length;
      return count ? `${engine.description}, prononciation de ${count} mot(s) ajustée` : engine.description;
    },
    synthesize: (text: string): Promise<SpeechAudio> => engine.synthesize(pronounce(text)),
    stream: (text: string, onAudio: (audio: SpeechAudio) => void, signal?: AbortSignal) => engine.stream(pronounce(text), onAudio, signal),
  };
}
