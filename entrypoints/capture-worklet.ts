// AudioWorklet du document offscreen : transmet le son capturé de l'onglet par blocs
// d'environ 43 ms (2048 échantillons) au fil principal, qui le passe au VAD et à la
// transcription. Remplace ScriptProcessorNode (obsolète).

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const BLOCK_SAMPLES = 2048;

export default defineUnlistedScript(() => {
  class CaptureProcessor extends AudioWorkletProcessor {
    private block = new Float32Array(BLOCK_SAMPLES);
    private filled = 0;

    process(inputs: Float32Array[][]): boolean {
      const channels = inputs[0];
      const first = channels?.[0];
      if (!channels || !first) return true;
      for (let i = 0; i < first.length; i += 1) {
        // Mixage mono des canaux de l'onglet.
        let sum = 0;
        for (const channel of channels) sum += channel[i] ?? 0;
        this.block[this.filled] = sum / channels.length;
        this.filled += 1;
        if (this.filled === BLOCK_SAMPLES) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(BLOCK_SAMPLES);
          this.filled = 0;
        }
      }
      return true;
    }
  }
  registerProcessor('otherself-capture', CaptureProcessor);
});
