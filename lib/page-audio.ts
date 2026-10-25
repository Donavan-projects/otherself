// Audio côté page (monde MAIN de l'onglet de la plateforme) : lecture de la voix de
// l'avatar dans la piste du micro injecté. Cette voix ne doit jamais être jouée sur les
// haut-parleurs de l'onglet (ctx.destination) : le son de l'onglet est partagé comme son
// du recruteur (share-tab.ts).

import { createLogger } from './log';
import { base64ToBuffer } from './pcm';

const log = createLogger('inject');
const logTts = createLogger('tts');

let context: AudioContext | null = null;

/** Contexte audio partagé ; créé au premier appel de getUserMedia (geste de l'utilisateur). */
export function audioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
    log(`contexte audio créé : ${context.state} (${context.sampleRate} Hz)`);
    context.addEventListener('statechange', () => log(`contexte audio : ${context?.state}`));
    // Sans geste de l'utilisateur, le navigateur peut laisser le contexte suspendu.
    const resume = () => void context?.resume();
    document.addEventListener('pointerdown', resume, { capture: true });
    document.addEventListener('keydown', resume, { capture: true });
  }
  if (context.state !== 'running') void context.resume().catch(() => undefined);
  return context;
}

export interface VoiceOutput {
  track: MediaStreamTrack;
  speak(responseId: number, pcm: string, sampleRate: number): void;
  stop(): void;
}

/** Piste du micro injecté : silence, sauf quand l'avatar parle. */
export function createVoiceOutput(
  onStarted: (responseId: number, at: number) => void,
  onIdle: (responseId: number) => void,
): VoiceOutput {
  const ctx = audioContext();
  const destination = ctx.createMediaStreamDestination();
  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error('aucune piste audio créée');
  let sources: AudioBufferSourceNode[] = [];
  let nextStart = 0;
  let current = -1;
  const notifyStarted = (responseId: number, startAt: number) => {
    setTimeout(() => onStarted(responseId, Date.now()), (startAt - ctx.currentTime) * 1000);
  };

  return {
    track,
    speak(responseId, pcm, sampleRate) {
      const samples = new Float32Array(base64ToBuffer(pcm));
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      const startAt = Math.max(ctx.currentTime + 0.02, nextStart);
      nextStart = startAt + buffer.duration;
      source.start(startAt);
      // Reprise après un silence (début de réponse, ou phrase suivante arrivée en retard) :
      // le document offscreen sait que l'avatar parle de nouveau (garde-fou d'écho).
      const resumed = sources.length === 0;
      sources.push(source);
      if (responseId !== current) {
        current = responseId;
        logTts(`début de la réponse ${responseId} dans le micro injecté`);
      }
      if (resumed) notifyStarted(responseId, startAt);
      source.addEventListener('ended', () => {
        // Source arrêtée par stop() : la réponse a été coupée, pas terminée.
        if (!sources.includes(source)) return;
        sources = sources.filter((item) => item !== source);
        if (sources.length === 0) onIdle(responseId);
      });
    },
    stop() {
      for (const source of sources) source.stop();
      sources = [];
      nextStart = 0;
      current = -1;
      logTts('voix de l’avatar coupée');
    },
  };
}
