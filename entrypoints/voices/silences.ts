// Banc des silences (page voices, ?silences) : de vraies questions passent par le même enchaînement qu'en entretien
// (moteur LLM avec le profil, découpe de lib/chunks.ts, voix et file de synthèse de lib/avatar-voice.ts et
// lib/speech-queue.ts : synthèses en parallèle, pauses régulières, attente avant de jouer), et la lecture est
// programmée comme dans la page (lib/page-audio.ts : à la suite du morceau précédent, ou 20 ms après l'arrivée d'un
// morceau en retard). Mêmes mesures et mêmes lignes de log que lib/conversation.ts (lib/silences.ts), sans plateforme,
// sans transcription ni pont. Appels au LLM facturés (clé de config.local.json).

import { takeChunks } from '@/lib/chunks';
import type { DemoConfig } from '@/lib/config';
import { llmEngine } from '@/lib/llm-engine';
import { createLogger } from '@/lib/log';
import { localFileProfile } from '@/lib/profile';
import { analyzePieces, describeResponse, IMPATIENT_SILENCE_MS, measureSilence, SilenceSummary, type Junction, type VoicePiece } from '@/lib/silences';
import { createAvatarVoice } from '@/lib/avatar-voice';
import { SpeechQueue } from '@/lib/speech-queue';
import type { SpeechAudio } from '@/lib/tts';
import type { VoicePool } from '@/lib/voice-pool';

const log = createLogger('tts');
/** Avance de la page sur la lecture d'un morceau arrivé alors que rien ne joue (lib/page-audio.ts). */
const PAGE_LEAD_MS = 20;

/** Questions par défaut : deux courtes, trois comportementales (réponses longues, découpées), une ouverte. */
export const DEFAULT_SILENCE_QUESTIONS = [
  "What's his most recent position?",
  'Tell me about a time he automated a slow manual process.',
  'Which automation tools does he work with?',
  'Describe a time he had to deal with a messy or poorly documented API.',
  'Give me an example of a project he built end to end, from idea to working product.',
  'Why should we hire him rather than another candidate?',
];

export interface SilenceBenchResult {
  done: boolean;
  voice: string;
  responses: { question: string; pieces: VoicePiece[]; junctions: Junction[]; holds: number[]; line: string }[];
  summary: string;
}

declare global {
  interface Window {
    __silences?: SilenceBenchResult;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Réponse à une question : flux du moteur → morceaux → file de synthèse (même code qu'en entretien) → lecture simulée. */
async function answer(engine: Awaited<ReturnType<ReturnType<typeof llmEngine>>>, voice: VoicePool, question: string): Promise<{ pieces: VoicePiece[]; holds: number[] }> {
  const endedAt = Date.now();
  const pieces: VoicePiece[] = [];
  let playhead = 0;
  const signal = new AbortController().signal;
  const queue = new SpeechQueue({
    pool: voice,
    signal,
    playhead: () => playhead,
    log: (line) => log(line),
    // Lecture programmée comme dans la page : à la suite, ou PAGE_LEAD_MS après l'arrivée.
    send: (audio: SpeechAudio, piece) => {
      const sentAt = Date.now();
      const durationMs = (audio.samples.length / audio.sampleRate) * 1000;
      const playStartAt = Math.max(sentAt + PAGE_LEAD_MS, playhead);
      playhead = playStartAt + durationMs;
      pieces.push({ kind: 'réponse', ...piece, sentAt, durationMs, ...measureSilence(audio.samples, audio.sampleRate), playStartAt, playEndAt: playhead });
      return true;
    },
  });
  const speaker = queue.play(Promise.resolve());
  let buffer = '';
  for await (const fragment of engine.reply({ text: question, startedAt: endedAt - 2000, endedAt }, signal)) {
    buffer += fragment;
    const [ready, rest] = takeChunks(buffer, 0);
    buffer = rest;
    for (const text of ready) queue.push(text);
  }
  for (const text of takeChunks(buffer, 0, true)[0]) queue.push(text);
  queue.end();
  await speaker;
  // Laisse la lecture simulée se terminer : la question suivante arrive après la réponse, comme en entretien.
  await sleep(Math.max(0, playhead - Date.now()));
  return { pieces, holds: queue.holds };
}

export async function runSilenceBench(
  config: DemoConfig,
  questions: string[],
  status: (message: string) => void,
  tbody: HTMLTableSectionElement,
  voices?: number,
  threads?: number,
) {
  const result: SilenceBenchResult = { done: false, voice: '', responses: [], summary: '' };
  window.__silences = result;
  if (!config.openaiApiKey) {
    status('openaiApiKey absent de config.local.json : banc des silences impossible');
    result.done = true;
    return;
  }
  status('chargement de la voix et du moteur…');
  const voice = await createAvatarVoice(config, voices, threads);
  // Chauffe, non mesurée (première inférence plus lente) ; elle donne aussi au modèle de vitesse sa première mesure,
  // comme l'ouverture synthétisée au démarrage de l'entretien.
  await Promise.all(Array.from({ length: voice.concurrency }, () => voice.synthesize('Hello. Before we begin, I want to be transparent.')));
  result.voice = `${voice.description} ; ${navigator.hardwareConcurrency} fils d'exécution`;
  const engine = await llmEngine({ apiKey: config.openaiApiKey, model: config.llmModel })(localFileProfile(config), config);
  const summary = new SilenceSummary();
  for (const [index, question] of questions.entries()) {
    status(`question ${index + 1} / ${questions.length} : ${question}`);
    const { pieces, holds } = await answer(engine, voice, question);
    const junctions = analyzePieces(pieces);
    summary.add(junctions);
    const line = describeResponse(`la réponse ${index + 1}`, pieces, junctions, false);
    log(line);
    result.responses.push({ question, pieces, junctions, holds, line });
    const longest = junctions.reduce<Junction | null>((best, junction) => (best && best.totalMs >= junction.totalMs ? best : junction), null);
    const row = tbody.insertRow();
    for (const text of [
      question,
      String(pieces.length),
      `${(pieces.reduce((sum, piece) => sum + piece.durationMs, 0) / 1000).toFixed(1)} s`,
      longest ? `${Math.round(longest.totalMs)} ms` : '-',
      longest?.cause ?? '-',
      longest ? `trou ${Math.round(longest.gapMs)} ms, audio ${Math.round(longest.audioMs)} ms` : '-',
      String(junctions.filter((junction) => junction.totalMs >= IMPATIENT_SILENCE_MS).length),
      holds.length ? holds.map((hold) => `${Math.round(hold)} ms`).join(', ') : '-',
    ]) {
      row.insertCell().textContent = text;
    }
  }
  result.summary = summary.describe();
  log(result.summary);
  status(`terminé : ${result.summary}`);
  result.done = true;
}
