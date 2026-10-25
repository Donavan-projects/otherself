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

// Normalisation : la voix de Piper sort nettement plus bas qu'une voix de visio. Niveau de
// parole visé (RMS des passages parlés, silences exclus) et crête maximale (pas de saturation).
const TARGET_SPEECH_DBFS = -18;
const MAX_PEAK = 0.89; // −1 dBFS
const MAX_GAIN = 10;
const FRAME_MS = 20;
/** Trames comptées comme parole : à moins de 30 dB de la plus forte, et au-dessus de −55 dBFS. */
const ACTIVE_RANGE_DB = 30;
const ACTIVE_FLOOR_DBFS = -55;

const dbfs = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
const fromDbfs = (db: number) => 10 ** (db / 20);

interface Normalized {
  samples: Float32Array<ArrayBuffer>;
  beforeDbfs: number;
  afterDbfs: number;
  beforePeak: number;
  afterPeak: number;
  gain: number;
}

/** Ramène la parole au niveau visé, sans dépasser la crête maximale. */
export function normalizeSpeech(samples: Float32Array<ArrayBuffer>, sampleRate: number): Normalized {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const frames: number[] = [];
  let peak = 0;
  for (let start = 0; start < samples.length; start += frame) {
    let sum = 0;
    const end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i += 1) {
      const value = samples[i]!;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    frames.push(sum / (end - start));
  }
  const loudest = Math.max(0, ...frames);
  const gate = Math.max(loudest * fromDbfs(-ACTIVE_RANGE_DB) ** 2, fromDbfs(ACTIVE_FLOOR_DBFS) ** 2);
  const active = frames.filter((power) => power >= gate);
  const speechRms = active.length ? Math.sqrt(active.reduce((sum, power) => sum + power, 0) / active.length) : 0;
  if (speechRms === 0 || peak === 0) {
    return { samples, beforeDbfs: -Infinity, afterDbfs: -Infinity, beforePeak: peak, afterPeak: peak, gain: 1 };
  }
  const gain = Math.min(fromDbfs(TARGET_SPEECH_DBFS) / speechRms, MAX_PEAK / peak, MAX_GAIN);
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) output[i] = samples[i]! * gain;
  return {
    samples: output,
    beforeDbfs: dbfs(speechRms),
    afterDbfs: dbfs(speechRms * gain),
    beforePeak: peak,
    afterPeak: peak * gain,
    gain,
  };
}

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
    const { sampleRate, elapsedMs } = message;
    const level = normalizeSpeech(message.samples, sampleRate);
    const { samples } = level;
    const durationMs = (samples.length / sampleRate) * 1000;
    const ratio = elapsedMs / durationMs;
    const slow = ratio > SLOW_RATIO && durationMs > SLOW_WARNING_MIN_AUDIO_MS;
    log(
      `phrase synthétisée en ${Math.round(elapsedMs)} ms (${Math.round(durationMs)} ms d'audio, ${ratio.toFixed(2)} × temps réel ; ` +
        `niveau de parole ${level.beforeDbfs.toFixed(0)} → ${level.afterDbfs.toFixed(0)} dBFS, crête ${level.beforePeak.toFixed(2)} → ` +
        `${level.afterPeak.toFixed(2)}, gain ×${level.gain.toFixed(1)}) : « ${pending.text} »` +
        (slow ? ' — voix trop lente pour cette machine, préférer une voix « medium » plus légère' : ''),
    );
    pending.resolve({ samples, sampleRate });
  }
}
