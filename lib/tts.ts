// Synthèse vocale locale : Piper en WebAssembly (ONNX Runtime + phonémiseur espeak-ng),
// dans un worker (tts.worker.ts) pour ne pas bloquer le fil principal du document offscreen.
// La voix choisie (voice dans config.local.json) est téléchargée une seule fois depuis
// Hugging Face, puis gardée dans le stockage privé de l'extension (OPFS).

import { localUrl } from './config';
import { createLogger } from './log';
import type { FromTtsWorker, ToTtsWorker } from './tts.worker';

const log = createLogger('tts');

/** L'avertissement de lenteur ne concerne que les phrases assez longues pour être mesurées. */
const SLOW_WARNING_MIN_AUDIO_MS = 2000;
const SLOW_RATIO = 0.8;

export interface SpeechAudio {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

interface Pending {
  text: string;
  resolve(audio: SpeechAudio): void;
  reject(error: Error): void;
}

export class PiperVoice {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  private constructor(
    private readonly worker: Worker,
    readonly voice: string,
  ) {
    worker.addEventListener('message', (event: MessageEvent<FromTtsWorker>) => this.onMessage(event.data));
  }

  static async load(voice: string): Promise<PiperVoice> {
    const started = performance.now();
    const worker = new Worker(new URL('./tts.worker.ts', import.meta.url));
    let lastPercent = -10;
    await new Promise<void>((resolve, reject) => {
      const onMessage = ({ data }: MessageEvent<FromTtsWorker>) => {
        if (data.type === 'progress') {
          if (!data.total || !data.url.endsWith('.onnx')) return;
          const percent = Math.floor((data.loaded / data.total) * 100);
          if (percent >= lastPercent + 10) {
            lastPercent = percent;
            log(`téléchargement de la voix ${voice} : ${percent} % (${Math.round(data.total / 1e6)} Mo, une seule fois)`);
          }
        } else if (data.type === 'ready' || data.type === 'error') {
          worker.removeEventListener('message', onMessage);
          if (data.type === 'ready') resolve();
          else reject(new Error(data.message));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (event) => reject(new Error(`worker Piper : ${event.message}`)), { once: true });
      const init: ToTtsWorker = {
        type: 'init',
        voiceId: voice,
        wasmPaths: {
          onnxWasm: localUrl('/vendor/ort/'),
          piperData: localUrl('/vendor/piper/piper_phonemize.data'),
          piperWasm: localUrl('/vendor/piper/piper_phonemize.wasm'),
        },
      };
      worker.postMessage(init);
    });
    log(`voix ${voice} prête dans un worker (${Math.round(performance.now() - started)} ms)`);
    return new PiperVoice(worker, voice);
  }

  synthesize(text: string): Promise<SpeechAudio> {
    const id = (this.nextId += 1);
    return new Promise<SpeechAudio>((resolve, reject) => {
      this.pending.set(id, { text, resolve, reject });
      const message: ToTtsWorker = { type: 'synth', id, text };
      this.worker.postMessage(message);
    });
  }

  private onMessage(message: FromTtsWorker) {
    if (message.type !== 'audio' && !(message.type === 'error' && message.id !== undefined)) return;
    const pending = this.pending.get(message.id!);
    if (!pending) return;
    this.pending.delete(message.id!);
    if (message.type === 'error') {
      log(`erreur de synthèse : ${message.message} (« ${pending.text} »)`);
      pending.reject(new Error(message.message));
      return;
    }
    const { samples, sampleRate, elapsedMs } = message;
    const durationMs = (samples.length / sampleRate) * 1000;
    const ratio = elapsedMs / durationMs;
    const slow = ratio > SLOW_RATIO && durationMs > SLOW_WARNING_MIN_AUDIO_MS;
    log(
      `phrase synthétisée en ${Math.round(elapsedMs)} ms (${Math.round(durationMs)} ms d'audio, ${ratio.toFixed(2)} × temps réel) : « ${pending.text} »` +
        (slow ? ' — voix trop lente pour cette machine, préférer une voix « medium » plus légère' : ''),
    );
    pending.resolve({ samples, sampleRate });
  }
}
