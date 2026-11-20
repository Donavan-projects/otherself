// Voix de l'avatar telle que l'entretien l'utilise : Piper (réglages, hauteur, prononciation de config.local.json),
// en deux exemplaires parallèles si la machine a au moins 4 fils d'exécution (lib/voice-pool.ts), qui se partagent
// ces fils (threads de calcul d'ONNX Runtime, voir limitThreads dans lib/tts.worker.ts), ou OpenAI. Mesuré sur la
// machine de référence (8 fils, 6 questions) : 2 voix × 4 threads est le seul réglage sans aucune attente avant de
// jouer au repos et sans trou sous charge (1 voix × 8 : un trou ; 2 × 1, 1 × 2 : attentes au repos ; 2 voix × 8
// threads, soit 16 threads pour 8 fils : synthèse 0,4 à 0,8 × temps réel au lieu de 0,2 ×).
// Partagée par le document offscreen et le banc des silences (page voices), pour mesurer la même chose.

import type { DemoConfig } from './config';
import { withPronunciations } from './pronunciation';
import { DEFAULT_PIPER_SCALES, PiperVoice, type TtsEngine } from './tts';
import { OpenAiVoice } from './tts-openai';
import { PARALLEL_MIN_THREADS, VoicePool } from './voice-pool';

/** `parallel` : nombre de voix imposé (banc des silences, comparaisons) ; sinon choix selon la machine. */
export async function createAvatarVoice(config: DemoConfig, parallel?: number, threadsPerVoice?: number): Promise<VoicePool> {
  if (config.ttsProvider === 'openai') {
    return new VoicePool([new OpenAiVoice({ apiKey: config.openaiApiKey, model: config.openaiTtsModel, voice: config.openaiVoice })]);
  }
  const machine = navigator.hardwareConcurrency ?? 1;
  const count = parallel ?? (machine >= PARALLEL_MIN_THREADS ? 2 : 1);
  const threads = threadsPerVoice ?? Math.max(1, Math.floor(machine / count));
  const voices: TtsEngine[] = [];
  // L'une après l'autre : le modèle n'est téléchargé qu'une fois, la seconde le reprend du cache.
  for (let i = 0; i < count; i += 1) {
    const piper = await PiperVoice.load(config.voice, { ...DEFAULT_PIPER_SCALES, ...config.piperScales }, config.pitchSemitones, threads);
    // Prononciation : seulement le texte envoyé à la voix (ni le LLM, ni la transcription « Avatar : … »).
    voices.push(withPronunciations(piper, config.pronunciations));
  }
  return new VoicePool(voices, threads);
}
