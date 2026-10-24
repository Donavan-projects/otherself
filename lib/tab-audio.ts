// Son du recruteur (document offscreen) : le son de l'onglet activé, capturé par
// chrome.tabCapture, c'est-à-dire ce que la plateforme joue réellement, quelle que soit
// sa façon de le décoder (pistes WebRTC, WebAssembly, Web Audio).
// - Rejoué aussitôt sur la sortie par défaut : Chrome coupe le son d'un onglet capturé.
// - Ni le micro de l'utilisateur ni la voix de l'avatar n'y sont : la plateforme ne
//   rejoue pas le micro, et la voix de l'avatar ne sort que par le micro injecté, jamais
//   par les haut-parleurs de l'onglet.

import { localUrl } from './config';
import { createLogger } from './log';
import { floatToInt16, resample } from './pcm';

const log = createLogger('inject');

const REPORT_INTERVAL_MS = 15000;

export class TabAudioCapture {
  private live = true;
  private readonly level = { sumSquares: 0, samples: 0, peak: 0 };
  private readonly report: ReturnType<typeof setInterval>;

  private constructor(
    readonly tabId: number,
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
  ) {
    this.report = setInterval(() => this.logLevel(), REPORT_INTERVAL_MS);
  }

  /** `streamId` : chrome.tabCapture.getMediaStreamId, obtenu par le popup sur clic de l'utilisateur. */
  static async start(
    tabId: number,
    streamId: string,
    sampleRate: number,
    onChunk: (samples: Int16Array, at: number) => void,
  ): Promise<TabAudioCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
      video: false,
    });
    const context = new AudioContext();
    await context.audioWorklet.addModule(localUrl('/capture-worklet.js'));
    const source = context.createMediaStreamSource(stream);
    // L'utilisateur continue d'entendre la plateforme.
    source.connect(context.destination);
    const processor = new AudioWorkletNode(context, 'otherself-capture', { numberOfOutputs: 0 });
    source.connect(processor);

    const capture = new TabAudioCapture(tabId, stream, context);
    processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      capture.measure(block);
      onChunk(floatToInt16(resample(block, context.sampleRate, sampleRate)), Date.now());
    };
    const [track] = stream.getAudioTracks();
    track?.addEventListener('ended', () => {
      log(`capture du son de l'onglet ${tabId} terminée (onglet fermé ou capture arrêtée) : réactiver l'extension`);
      capture.stop();
    });
    log(
      `capture du son de l'onglet ${tabId} démarrée (${context.sampleRate} Hz, contexte ${context.state}) ; ` +
        'son rejoué sur la sortie audio par défaut',
    );
    return capture;
  }

  get isLive() {
    return this.live;
  }

  stop() {
    if (!this.live) return;
    this.live = false;
    clearInterval(this.report);
    for (const track of this.stream.getTracks()) track.stop();
    void this.context.close();
  }

  private measure(block: Float32Array) {
    for (const sample of block) {
      this.level.sumSquares += sample * sample;
      this.level.peak = Math.max(this.level.peak, Math.abs(sample));
    }
    this.level.samples += block.length;
  }

  private logLevel() {
    const { sumSquares, samples, peak } = this.level;
    const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
    const db = rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dBFS` : 'silence';
    log(
      `bilan capture de l'onglet ${this.tabId} sur ${REPORT_INTERVAL_MS / 1000} s : niveau ${db} ` +
        `(crête ${peak.toFixed(2)}), contexte audio ${this.context.state}`,
    );
    this.level.sumSquares = 0;
    this.level.samples = 0;
    this.level.peak = 0;
  }
}
