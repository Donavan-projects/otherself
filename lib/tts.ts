// Synthèse vocale locale : Piper en WebAssembly (ONNX Runtime + phonémiseur espeak-ng).
// La voix choisie (voice dans config.local.json) est téléchargée une seule fois depuis
// Hugging Face, puis gardée dans le stockage privé de l'extension (OPFS).

import { TtsSession } from '@mintplex-labs/piper-tts-web';
import { localUrl } from './config';
import { createLogger } from './log';
import { decodeWav } from './pcm';

const log = createLogger('tts');

export interface SpeechAudio {
  samples: Float32Array;
  sampleRate: number;
}

export class PiperVoice {
  private constructor(
    private readonly session: TtsSession,
    readonly voice: string,
  ) {}

  static async load(voice: string): Promise<PiperVoice> {
    const started = performance.now();
    let lastPercent = -10;
    const session = await TtsSession.create({
      voiceId: voice,
      wasmPaths: {
        onnxWasm: localUrl('/vendor/ort/'),
        piperData: localUrl('/vendor/piper/piper_phonemize.data'),
        piperWasm: localUrl('/vendor/piper/piper_phonemize.wasm'),
      },
      progress: ({ loaded, total, url }) => {
        if (!total || !url.endsWith('.onnx')) return;
        const percent = Math.floor((loaded / total) * 100);
        if (percent >= lastPercent + 10) {
          lastPercent = percent;
          log(`téléchargement de la voix ${voice} : ${percent} % (${Math.round(total / 1e6)} Mo, une seule fois)`);
        }
      },
    });
    log(`voix ${voice} prête (${Math.round(performance.now() - started)} ms)`);
    return new PiperVoice(session, voice);
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const started = performance.now();
    const wav = await this.session.predict(text);
    const { samples, sampleRate } = decodeWav(await wav.arrayBuffer());
    const elapsed = performance.now() - started;
    const durationMs = (samples.length / sampleRate) * 1000;
    const ratio = elapsed / durationMs;
    log(
      `phrase synthétisée en ${Math.round(elapsed)} ms (${Math.round(durationMs)} ms d'audio, ${ratio.toFixed(2)} × temps réel) : « ${text} »` +
        (ratio > 0.8 ? ' — voix trop lente pour cette machine, préférer une voix « medium »' : ''),
    );
    return { samples, sampleRate };
  }
}
