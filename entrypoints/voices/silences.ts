// Banc des silences (page voices, ?silences) : de vraies questions passent par le même enchaînement qu'en entretien
// (moteur LLM avec le profil, découpe en morceaux de lib/chunks.ts, synthèse l'une après l'autre), et la lecture est
// programmée comme dans la page (lib/page-audio.ts : à la suite du morceau précédent, ou 20 ms après l'arrivée d'un
// morceau en retard). Mêmes mesures et mêmes lignes de log que lib/conversation.ts (lib/silences.ts), sans plateforme,
// sans transcription ni pont. Appels au LLM facturés (clé de config.local.json).

import { takeChunks } from '@/lib/chunks';
import type { DemoConfig } from '@/lib/config';
import { llmEngine } from '@/lib/llm-engine';
import { createLogger } from '@/lib/log';
import { localFileProfile } from '@/lib/profile';
import { withPronunciations } from '@/lib/pronunciation';
import { analyzePieces, describeResponse, IMPATIENT_SILENCE_MS, measureSilence, SilenceSummary, type Junction, type VoicePiece } from '@/lib/silences';
import { DEFAULT_PIPER_SCALES, PiperVoice, type SpeechAudio, type TtsEngine } from '@/lib/tts';
import { OpenAiVoice } from '@/lib/tts-openai';

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
  responses: { question: string; pieces: VoicePiece[]; junctions: Junction[]; line: string }[];
  summary: string;
}

declare global {
  interface Window {
    __silences?: SilenceBenchResult;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Réponse à une question : flux du moteur → morceaux → synthèse dans l'ordre → lecture programmée. */
async function answer(engine: Awaited<ReturnType<ReturnType<typeof llmEngine>>>, voice: TtsEngine, question: string): Promise<VoicePiece[]> {
  const endedAt = Date.now();
  const pieces: VoicePiece[] = [];
  const queue: { text: string; readyAt: number }[] = [];
  const signal: { wake: (() => void) | null } = { wake: null };
  let done = false;
  let playhead = 0;
  // Synthèse : un morceau après l'autre, comme Conversation.speakSentences.
  const speaker = (async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) {
        if (done) return;
        await new Promise<void>((resolve) => (signal.wake = resolve));
        signal.wake = null;
        continue;
      }
      const synthStartAt = Date.now();
      await voice.stream(next.text, (audio: SpeechAudio) => {
        const sentAt = Date.now();
        const durationMs = (audio.samples.length / audio.sampleRate) * 1000;
        const playStartAt = Math.max(sentAt + PAGE_LEAD_MS, playhead);
        playhead = playStartAt + durationMs;
        pieces.push({
          kind: 'réponse',
          text: next.text,
          textReadyAt: next.readyAt,
          synthStartAt,
          synthEndAt: sentAt,
          sentAt,
          durationMs,
          ...measureSilence(audio.samples, audio.sampleRate),
          playStartAt,
          playEndAt: playhead,
        });
      });
    }
  })();
  let buffer = '';
  let words = 0;
  const push = (final: boolean) => {
    const [ready, rest] = takeChunks(buffer, words, final);
    buffer = rest;
    words += ready.reduce((sum, chunk) => sum + chunk.split(/\s+/).length, 0);
    const readyAt = Date.now();
    queue.push(...ready.map((text) => ({ text, readyAt })));
    if (ready.length) signal.wake?.();
  };
  for await (const fragment of engine.reply({ text: question, startedAt: endedAt - 2000, endedAt }, new AbortController().signal)) {
    buffer += fragment;
    push(false);
  }
  push(true);
  done = true;
  signal.wake?.();
  await speaker;
  // Laisse la lecture simulée se terminer : la question suivante arrive après la réponse, comme en entretien.
  await sleep(Math.max(0, playhead - Date.now()));
  return pieces;
}

export async function runSilenceBench(config: DemoConfig, questions: string[], status: (message: string) => void, tbody: HTMLTableSectionElement) {
  const result: SilenceBenchResult = { done: false, voice: '', responses: [], summary: '' };
  window.__silences = result;
  if (!config.openaiApiKey) {
    status('openaiApiKey absent de config.local.json : banc des silences impossible');
    result.done = true;
    return;
  }
  status('chargement de la voix et du moteur…');
  let voice: TtsEngine;
  if (config.ttsProvider === 'openai') {
    voice = new OpenAiVoice({ apiKey: config.openaiApiKey, model: config.openaiTtsModel, voice: config.openaiVoice });
  } else {
    voice = withPronunciations(await PiperVoice.load(config.voice, { ...DEFAULT_PIPER_SCALES, ...config.piperScales }, config.pitchSemitones), config.pronunciations);
    // Première phrase de chauffe, non mesurée : la première inférence est toujours plus lente.
    await voice.synthesize('Hello.');
  }
  result.voice = voice.description;
  const engine = await llmEngine({ apiKey: config.openaiApiKey, model: config.llmModel })(localFileProfile(config), config);
  const summary = new SilenceSummary();
  for (const [index, question] of questions.entries()) {
    status(`question ${index + 1} / ${questions.length} : ${question}`);
    const pieces = await answer(engine, voice, question);
    const junctions = analyzePieces(pieces);
    summary.add(junctions);
    const line = describeResponse(`la réponse ${index + 1}`, pieces, junctions, false);
    log(line);
    result.responses.push({ question, pieces, junctions, line });
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
    ]) {
      row.insertCell().textContent = text;
    }
  }
  result.summary = summary.describe();
  log(result.summary);
  status(`terminé : ${result.summary}`);
  result.done = true;
}
