// Retour audio de la voix de l'avatar pour l'utilisateur, joué par le document offscreen.
// Jamais dans l'onglet de l'entretien : le son de cet onglet est capturé comme son du
// recruteur (tab-audio.ts), alors que la sortie du document offscreen ne l'est pas.

import type { SpeechAudio } from './tts';
import { createLogger } from './log';

const log = createLogger('tts');

export class AvatarMonitor {
  private readonly context = new AudioContext();
  private readonly gain: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private nextStart = 0;

  constructor(volume: number) {
    this.gain = this.context.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(this.context.destination);
    log(
      `retour audio de la voix de l'avatar actif (volume ${Math.round(volume * 100)} %, contexte ${this.context.state}) : ` +
        'joué par le document offscreen, hors de l’onglet capturé',
    );
  }

  play(audio: SpeechAudio) {
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
    const buffer = this.context.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(audio.samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextStart);
    this.nextStart = startAt + buffer.duration;
    source.start(startAt);
    this.sources.push(source);
    source.addEventListener('ended', () => {
      this.sources = this.sources.filter((item) => item !== source);
    });
  }

  stop() {
    const playing = this.sources;
    this.sources = [];
    this.nextStart = 0;
    for (const source of playing) source.stop();
  }
}
