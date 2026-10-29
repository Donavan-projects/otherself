// Worker de synthèse Piper (document offscreen) : la synthèse ne bloque plus le fil
// principal, où tournent la capture, le VAD et la transcription. Worker classique (pas
// module) : le phonémiseur Emscripten ne se reconnaît en worker que si importScripts existe.
// Les API d'extension n'existent pas ici : les chemins des fichiers WASM arrivent du fil principal.

import { TtsSession } from '@mintplex-labs/piper-tts-web';
import * as ortModule from 'onnxruntime-web/wasm';
import { decodeWav } from './pcm';

/** Réglages de l'inférence Piper (fichier JSON de la voix) : débit, variation de l'intonation, du rythme. */
export interface PiperScales {
  lengthScale: number;
  noiseScale: number;
  noiseW: number;
}

export type ToTtsWorker =
  | {
      type: 'init';
      voiceId: string;
      /** Voix à plusieurs locuteurs (libritts…) : identifiant du locuteur (clé de speaker_id_map, ex. p3922). */
      speaker?: string;
      /** Hauteur en demi-tons (0 : voix d'origine), voir applyPitch. */
      pitchSemitones?: number;
      scales: Partial<PiperScales>;
      wasmPaths: { onnxWasm: string; piperData: string; piperWasm: string };
    }
  | { type: 'synth'; id: number; text: string; scales?: Partial<PiperScales>; speaker?: string; pitchSemitones?: number };

export type FromTtsWorker =
  | { type: 'progress'; loaded: number; total: number; url: string }
  | { type: 'ready'; scales: PiperScales; speakers: string[] }
  | { type: 'audio'; id: number; samples: Float32Array<ArrayBuffer>; sampleRate: number; elapsedMs: number }
  | { type: 'error'; id?: number; message: string };

const scope = self as unknown as {
  postMessage(message: FromTtsWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToTtsWorker>) => void) | null;
};

let session: Promise<TtsSession> | null = null;

// La bibliothèque lit length_scale, noise_scale et noise_w dans le JSON de la voix, à chaque phrase,
// sans option pour les changer : l'objet est repéré au moment où il est lu (JSON.parse), puis modifié.
type Inference = { length_scale: number; noise_scale: number; noise_w: number };
let inference: Inference | null = null;
/** Locuteurs de la voix (speaker_id_map du même JSON) : nom → numéro. */
let speakerMap: Record<string, number> = {};
const parse = JSON.parse;
JSON.parse = function (text: string, reviver?: (key: string, value: unknown) => unknown) {
  const value = parse(text, reviver) as unknown;
  const candidate = (value as { inference?: Inference; espeak?: unknown; speaker_id_map?: Record<string, number> } | null) ?? null;
  if (candidate && typeof candidate === 'object' && candidate.inference && candidate.espeak) {
    inference = candidate.inference;
    speakerMap = candidate.speaker_id_map ?? {};
  }
  return value;
};

/** length_scale demandé, avant la correction de hauteur. */
let baseLengthScale: number | null = null;
/** Facteur de hauteur 2^(n/12) ; 1 : voix d'origine. */
let pitchFactor = 1;

function applyScales(scales: Partial<PiperScales> = {}) {
  if (!inference) return;
  baseLengthScale ??= inference.length_scale;
  if (scales.lengthScale !== undefined) baseLengthScale = scales.lengthScale;
  if (scales.noiseScale !== undefined) inference.noise_scale = scales.noiseScale;
  if (scales.noiseW !== undefined) inference.noise_w = scales.noiseW;
  inference.length_scale = baseLengthScale * pitchFactor;
}

/**
 * Hauteur : la voix est synthétisée plus lente (length_scale × f, f = 2^(n/12)), puis l'audio est déclaré à une
 * fréquence d'échantillonnage f fois plus haute. Rejoué ainsi (comme avec un playbackRate de f), il retrouve son
 * débit et monte de n demi-tons, dans le micro injecté comme dans le retour audio, sans autre traitement.
 */
function applyPitch(semitones: number | undefined) {
  if (semitones === undefined) return;
  pitchFactor = 2 ** (semitones / 12);
  applyScales();
}

// Locuteur : la bibliothèque envoie toujours sid = 0 (premier locuteur) ; le numéro choisi remplace sid juste
// avant chaque inférence. Même module onnxruntime-web que celui chargé par la bibliothèque.
const ort = ((ortModule as { default?: typeof ortModule }).default ?? ortModule) as typeof ortModule;
let speakerIndex: number | null = null;
// Les types publics présentent InferenceSession comme une fabrique ; à l'exécution, c'est une classe.
type Run = (this: unknown, feeds: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
const sessionClass = ort.InferenceSession as unknown as { prototype: { run: Run } };
const run = sessionClass.prototype.run;
sessionClass.prototype.run = function (feeds, ...rest) {
  const replaced = speakerIndex !== null && 'sid' in feeds ? { ...feeds, sid: new ort.Tensor('int64', [speakerIndex]) } : feeds;
  return run.call(this, replaced, ...rest);
};

function chooseSpeaker(speaker: string | undefined) {
  if (speaker === undefined) return;
  const index = speakerMap[speaker];
  if (index === undefined) throw new Error(`locuteur « ${speaker} » absent de cette voix`);
  speakerIndex = index;
}

const currentScales = (): PiperScales => ({
  lengthScale: baseLengthScale ?? inference?.length_scale ?? 1,
  noiseScale: inference?.noise_scale ?? 0.667,
  noiseW: inference?.noise_w ?? 0.8,
});
// Une phrase à la fois, dans l'ordre d'arrivée.
let queue: Promise<void> = Promise.resolve();

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

scope.onmessage = ({ data: message }) => {
  if (message.type === 'init') {
    session = TtsSession.create({
      voiceId: message.voiceId,
      wasmPaths: message.wasmPaths,
      progress: ({ loaded, total, url }) => scope.postMessage({ type: 'progress', loaded, total, url }),
    });
    const { scales, speaker, pitchSemitones } = message;
    session.then(
      () => {
        applyScales(scales);
        applyPitch(pitchSemitones);
        try {
          chooseSpeaker(speaker);
        } catch (error) {
          scope.postMessage({ type: 'error', message: errorMessage(error) });
          return;
        }
        scope.postMessage({ type: 'ready', scales: currentScales(), speakers: Object.keys(speakerMap) });
      },
      (error: unknown) => scope.postMessage({ type: 'error', message: errorMessage(error) }),
    );
    return;
  }
  const { id, text, scales, speaker, pitchSemitones } = message;
  queue = queue.then(async () => {
    try {
      if (!session) throw new Error('voix non chargée');
      const ready = await session;
      // Réglages propres à cette phrase (banc d'essai des voix) : appliqués, puis gardés.
      if (scales) applyScales(scales);
      applyPitch(pitchSemitones);
      chooseSpeaker(speaker);
      const started = performance.now();
      const wav = await ready.predict(text);
      const { samples, sampleRate } = decodeWav(await wav.arrayBuffer());
      // Fréquence déclarée × f : rejoué plus vite et plus haut, au débit d'origine (applyPitch).
      scope.postMessage({ type: 'audio', id, samples, sampleRate: Math.round(sampleRate * pitchFactor), elapsedMs: performance.now() - started }, [samples.buffer]);
    } catch (error) {
      scope.postMessage({ type: 'error', id, message: errorMessage(error) });
    }
  });
};
