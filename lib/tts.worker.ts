// Worker de synthèse Piper (document offscreen) : la synthèse ne bloque plus le fil
// principal, où tournent la capture, le VAD et la transcription. Worker classique (pas
// module) : le phonémiseur Emscripten ne se reconnaît en worker que si importScripts existe.
// Les API d'extension n'existent pas ici : les chemins des fichiers WASM arrivent du fil principal.

import { TtsSession } from '@mintplex-labs/piper-tts-web';
import { decodeWav } from './pcm';

export type ToTtsWorker =
  | { type: 'init'; voiceId: string; wasmPaths: { onnxWasm: string; piperData: string; piperWasm: string } }
  | { type: 'synth'; id: number; text: string };

export type FromTtsWorker =
  | { type: 'progress'; loaded: number; total: number; url: string }
  | { type: 'ready' }
  | { type: 'audio'; id: number; samples: Float32Array<ArrayBuffer>; sampleRate: number; elapsedMs: number }
  | { type: 'error'; id?: number; message: string };

const scope = self as unknown as {
  postMessage(message: FromTtsWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToTtsWorker>) => void) | null;
};

let session: Promise<TtsSession> | null = null;
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
    session.then(
      () => scope.postMessage({ type: 'ready' }),
      (error: unknown) => scope.postMessage({ type: 'error', message: errorMessage(error) }),
    );
    return;
  }
  const { id, text } = message;
  queue = queue.then(async () => {
    try {
      if (!session) throw new Error('voix non chargée');
      const started = performance.now();
      const wav = await (await session).predict(text);
      const { samples, sampleRate } = decodeWav(await wav.arrayBuffer());
      scope.postMessage({ type: 'audio', id, samples, sampleRate, elapsedMs: performance.now() - started }, [samples.buffer]);
    } catch (error) {
      scope.postMessage({ type: 'error', id, message: errorMessage(error) });
    }
  });
};
