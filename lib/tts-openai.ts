// Synthèse vocale OpenAI (option ttsProvider = "openai", même clé que la transcription et le LLM) :
// PCM 16 bits à 24 kHz reçu en streaming et rendu par morceaux d'environ 200 ms, sans attendre la
// fin de la phrase. Payante, contrairement à Piper (choix par défaut).

import { createLogger } from './log';
import type { SpeechAudio, TtsEngine } from './tts';

const log = createLogger('tts');

const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const SAMPLE_RATE = 24000;
/** Taille des morceaux envoyés à la page. */
const PIECE_MS = 200;
// Les voix OpenAI sortent vers −21 dBFS (mesuré le 26/10/2026) : gain fixe vers −18 dBFS, comme
// Piper, sans normaliser morceau par morceau (le niveau pomperait). Crête bornée à −1 dBFS.
const GAIN = 1.4;
const MAX_PEAK = 0.89;
const INSTRUCTIONS =
  'Calm, warm and natural conversational tone, like a composed professional in a video interview. Natural pace, not slow.';

export interface OpenAiVoiceOptions {
  apiKey: string;
  model: string;
  voice: string;
}

export class OpenAiVoice implements TtsEngine {
  constructor(private readonly options: OpenAiVoiceOptions) {}

  get description() {
    return `OpenAI ${this.options.model}, voix ${this.options.voice} (streaming)`;
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const pieces: Float32Array<ArrayBuffer>[] = [];
    await this.stream(text, (audio) => pieces.push(audio.samples));
    const samples = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let offset = 0;
    for (const piece of pieces) {
      samples.set(piece, offset);
      offset += piece.length;
    }
    return { samples, sampleRate: SAMPLE_RATE };
  }

  async stream(text: string, onAudio: (audio: SpeechAudio) => void, signal?: AbortSignal): Promise<void> {
    const started = performance.now();
    const response = await fetch(SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.options.model,
        voice: this.options.voice,
        input: text,
        response_format: 'pcm',
        instructions: INSTRUCTIONS,
      }),
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`synthèse OpenAI : ${response.status} ${await response.text()}`);
    const reader = response.body.getReader();
    const pieceBytes = Math.round((SAMPLE_RATE * PIECE_MS) / 1000) * 2;
    let pending = new Uint8Array(0);
    let firstMs: number | null = null;
    let totalSamples = 0;
    const emit = (bytes: Uint8Array) => {
      const samples = pcm16ToFloat(bytes);
      totalSamples += samples.length;
      firstMs ??= performance.now() - started;
      onAudio({ samples, sampleRate: SAMPLE_RATE });
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      pending = merged;
      while (pending.length >= pieceBytes) {
        emit(pending.subarray(0, pieceBytes));
        pending = pending.slice(pieceBytes);
      }
    }
    // Dernier morceau, en nombre pair d'octets.
    if (pending.length >= 2) emit(pending.subarray(0, pending.length - (pending.length % 2)));
    log(
      `phrase OpenAI : premier morceau à ${Math.round(firstMs ?? 0)} ms, fin à ${Math.round(performance.now() - started)} ms ` +
        `(${Math.round((totalSamples / SAMPLE_RATE) * 1000)} ms d'audio) : « ${text} »`,
    );
  }
}

function pcm16ToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = (view.getInt16(i * 2, true) / 32768) * GAIN;
    samples[i] = Math.max(-MAX_PEAK, Math.min(MAX_PEAK, value));
  }
  return samples;
}
