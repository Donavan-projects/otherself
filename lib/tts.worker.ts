// Worker de synthèse Piper (document offscreen) : la synthèse ne bloque plus le fil
// principal, où tournent la capture, le VAD et la transcription. Worker classique (pas
// module) : le phonémiseur Emscripten ne se reconnaît en worker que si importScripts existe.
// Les API d'extension n'existent pas ici : les chemins des fichiers WASM arrivent du fil principal.

import { TtsSession } from '@mintplex-labs/piper-tts-web';
import { decodeWav } from './pcm';

/** Réglages de l'inférence Piper (fichier JSON de la voix) : débit, variation de l'intonation, du rythme. */
export interface PiperScales {
  lengthScale: number;
  noiseScale: number;
  noiseW: number;
}

export type ToTtsWorker =
  | { type: 'init'; voiceId: string; scales: Partial<PiperScales>; wasmPaths: { onnxWasm: string; piperData: string; piperWasm: string } }
  | { type: 'synth'; id: number; text: string; scales?: Partial<PiperScales> };

export type FromTtsWorker =
  | { type: 'progress'; loaded: number; total: number; url: string }
  | { type: 'ready'; scales: PiperScales }
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
const parse = JSON.parse;
JSON.parse = function (text: string, reviver?: (key: string, value: unknown) => unknown) {
  const value = parse(text, reviver) as unknown;
  const candidate = (value as { inference?: Inference; espeak?: unknown } | null) ?? null;
  if (candidate && typeof candidate === 'object' && candidate.inference && candidate.espeak) inference = candidate.inference;
  return value;
};

function applyScales(scales: Partial<PiperScales> = {}) {
  if (!inference) return;
  if (scales.lengthScale !== undefined) inference.length_scale = scales.lengthScale;
  if (scales.noiseScale !== undefined) inference.noise_scale = scales.noiseScale;
  if (scales.noiseW !== undefined) inference.noise_w = scales.noiseW;
}

const currentScales = (): PiperScales => ({
  lengthScale: inference?.length_scale ?? 1,
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
    const { scales } = message;
    session.then(
      () => {
        applyScales(scales);
        scope.postMessage({ type: 'ready', scales: currentScales() });
      },
      (error: unknown) => scope.postMessage({ type: 'error', message: errorMessage(error) }),
    );
    return;
  }
  const { id, text, scales } = message;
  queue = queue.then(async () => {
    try {
      if (!session) throw new Error('voix non chargée');
      const ready = await session;
      // Réglages propres à cette phrase (banc d'essai des voix) : appliqués, puis gardés.
      if (scales) applyScales(scales);
      const started = performance.now();
      const wav = await ready.predict(text);
      const { samples, sampleRate } = decodeWav(await wav.arrayBuffer());
      scope.postMessage({ type: 'audio', id, samples, sampleRate, elapsedMs: performance.now() - started }, [samples.buffer]);
    } catch (error) {
      scope.postMessage({ type: 'error', id, message: errorMessage(error) });
    }
  });
};
