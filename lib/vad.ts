// Détection de parole (Silero VAD v5, ONNX Runtime en WebAssembly) sur le son du
// recruteur. Découpe le flux en prises de parole : début confirmé, puis fin après
// un silence réglable (silenceMs).

import * as ort from 'onnxruntime-web/wasm';
import { localUrl } from './config';
import { createLogger } from './log';

const log = createLogger('vad');

export const VAD_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 512; // 32 ms
const CONTEXT_SAMPLES = 64;
const FRAME_MS = (FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;
const POSITIVE_THRESHOLD = 0.5;
const NEGATIVE_THRESHOLD = 0.35;
/** Parole continue nécessaire pour confirmer un début (évite les bruits brefs). */
const MIN_SPEECH_MS = 250;
/** Bilan périodique : trames analysées et probabilité de parole maximale (diagnostic). */
const REPORT_INTERVAL_MS = 10000;

/** À appeler avant toute session ONNX : fichiers WASM servis par l'extension, un seul thread. */
export function configureOnnxRuntime() {
  ort.env.wasm.wasmPaths = localUrl('/vendor/ort/');
  // Pas de SharedArrayBuffer dans une page d'extension non isolée : un seul thread.
  ort.env.wasm.numThreads = 1;
}

export interface VadEvents {
  /** Début de parole confirmé ; `startedAt` = horodatage (Date.now) du premier son. */
  onSpeechStart(startedAt: number): void;
  /** Fin de parole ; `lastVoiceAt` = dernier son (Date.now), avant le silence d'attente. */
  onSpeechEnd(lastVoiceAt: number, durationMs: number): void;
}

export class Vad {
  private context = new Float32Array(CONTEXT_SAMPLES);
  private state: ort.Tensor = Vad.emptyState();
  private readonly sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  private pending = new Float32Array(0);
  private queue: Promise<void> = Promise.resolve();
  private speaking = false;
  private voicedMs = 0;
  private silentMs = 0;
  private firstVoiceAt = 0;
  private lastVoiceAt = 0;
  private readonly report = { frames: 0, maxProbability: 0, first: true };

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly silenceMs: number,
    private readonly events: VadEvents,
  ) {}

  static async create(silenceMs: number, events: VadEvents): Promise<Vad> {
    const session = await ort.InferenceSession.create(localUrl('/vendor/silero_vad_v5.onnx'), {
      executionProviders: ['wasm'],
    });
    log(`Silero VAD v5 prêt (seuil de silence ${silenceMs} ms)`);
    const vad = new Vad(session, silenceMs, events);
    setInterval(() => vad.logReport(), REPORT_INTERVAL_MS);
    return vad;
  }

  private logReport() {
    const { frames, maxProbability } = this.report;
    if (frames === 0) return;
    log(
      `bilan sur ${REPORT_INTERVAL_MS / 1000} s : ${frames} trame(s) analysée(s) à ${VAD_SAMPLE_RATE} Hz, ` +
        `probabilité de parole max ${maxProbability.toFixed(2)} (début de parole au-dessus de ${POSITIVE_THRESHOLD})`,
    );
    this.report.frames = 0;
    this.report.maxProbability = 0;
  }

  private static emptyState() {
    return new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  }

  get isSpeaking() {
    return this.speaking;
  }

  /** Durée de parole de la prise de parole en cours, du premier au dernier son (hors silence d'attente). */
  get speechMs() {
    return this.speaking ? this.lastVoiceAt - this.firstVoiceAt : 0;
  }

  /** Ajoute de l'audio à 16 kHz ; traité dans l'ordre, trame par trame. */
  push(samples: Float32Array, receivedAt: number) {
    this.queue = this.queue.then(() => this.process(samples, receivedAt)).catch((error: unknown) => {
      log(`erreur : ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async process(samples: Float32Array, receivedAt: number) {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    const frames = Math.floor(merged.length / FRAME_SAMPLES);
    for (let i = 0; i < frames; i += 1) {
      const frame = merged.subarray(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES);
      // Horodatage approximatif de la fin de cette trame.
      const frameAt = receivedAt - ((frames - 1 - i) * FRAME_MS);
      this.update(await this.probability(frame), frameAt);
    }
    this.pending = merged.slice(frames * FRAME_SAMPLES);
  }

  private async probability(frame: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES);
    input.set(this.context);
    input.set(frame, CONTEXT_SAMPLES);
    this.context = frame.slice(-CONTEXT_SAMPLES);
    const output = await this.session.run({
      input: new ort.Tensor('float32', input, [1, input.length]),
      state: this.state,
      sr: this.sr,
    });
    this.state = output.stateN!;
    return (output.output!.data as Float32Array)[0]!;
  }

  private update(probability: number, frameAt: number) {
    if (this.report.first) {
      this.report.first = false;
      log(`première trame analysée (${FRAME_SAMPLES} échantillons à ${VAD_SAMPLE_RATE} Hz, probabilité ${probability.toFixed(2)})`);
    }
    this.report.frames += 1;
    this.report.maxProbability = Math.max(this.report.maxProbability, probability);
    if (probability >= POSITIVE_THRESHOLD) {
      if (this.voicedMs === 0) this.firstVoiceAt = frameAt - FRAME_MS;
      this.voicedMs += FRAME_MS;
      this.silentMs = 0;
      this.lastVoiceAt = frameAt;
      if (!this.speaking && this.voicedMs >= MIN_SPEECH_MS) {
        this.speaking = true;
        log(`début de parole du recruteur (p=${probability.toFixed(2)})`);
        this.events.onSpeechStart(this.firstVoiceAt);
      }
      return;
    }
    if (probability < NEGATIVE_THRESHOLD || !this.speaking) {
      this.silentMs += FRAME_MS;
      if (!this.speaking && this.silentMs >= MIN_SPEECH_MS) this.voicedMs = 0;
      if (this.speaking && this.silentMs >= this.silenceMs) {
        this.speaking = false;
        const duration = this.lastVoiceAt - this.firstVoiceAt;
        this.voicedMs = 0;
        log(`fin de parole du recruteur (${Math.round(duration)} ms de parole, ${this.silenceMs} ms de silence)`);
        this.events.onSpeechEnd(this.lastVoiceAt, duration);
      }
    }
  }
}
