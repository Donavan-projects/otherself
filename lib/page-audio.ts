// Audio côté page (monde MAIN de l'onglet de la plateforme) :
// - capture du son du recruteur : uniquement les pistes audio distantes reçues par
//   RTCPeerConnection, jamais le micro de l'utilisateur ni la voix de l'avatar ;
// - lecture de la voix de l'avatar dans la piste du micro injecté.

import { createLogger } from './log';
import { base64ToBuffer, bufferToBase64, floatToInt16, resample } from './pcm';

const log = createLogger('inject');
const logTts = createLogger('tts');

export const CAPTURE_SAMPLE_RATE = 24000;
const PROCESSOR_FRAMES = 2048;

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
      sources.push(source);
      if (responseId !== current) {
        current = responseId;
        const delay = (startAt - ctx.currentTime) * 1000;
        setTimeout(() => {
          logTts(`début de la réponse ${responseId} dans le micro injecté`);
          onStarted(responseId, Date.now());
        }, delay);
      }
      source.addEventListener('ended', () => {
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

/**
 * Capture le son du recruteur. Le remplacement de setRemoteDescription doit être en place
 * avant que la plateforme ne crée sa connexion : activer l'extension avant de rejoindre.
 */
export function captureRemoteAudio(onChunk: (pcm: string, at: number) => void) {
  const seen = new Set<string>();
  let mixer: GainNode | null = null;
  // Contournement Chrome : une piste WebRTC distante peut rester muette dans Web Audio
  // si elle n'est pas aussi lue par un élément média (muet ici).
  const keepAlive: HTMLAudioElement[] = [];

  const ensureMixer = () => {
    if (mixer) return mixer;
    const ctx = audioContext();
    mixer = ctx.createGain();
    const processor = ctx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    mixer.connect(processor);
    processor.connect(silent).connect(ctx.destination);
    processor.addEventListener('audioprocess', (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToInt16(resample(input, ctx.sampleRate, CAPTURE_SAMPLE_RATE));
      onChunk(bufferToBase64(pcm.buffer), Date.now());
    });
    return mixer;
  };

  const addTrack = (track: MediaStreamTrack) => {
    if (track.kind !== 'audio' || seen.has(track.id)) return;
    seen.add(track.id);
    const stream = new MediaStream([track]);
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    keepAlive.push(element);
    audioContext().createMediaStreamSource(stream).connect(ensureMixer());
    log(`son du recruteur : piste distante ${track.id.slice(0, 8)} branchée (${seen.size} au total)`);
  };

  const scan = (connection: RTCPeerConnection) => {
    for (const receiver of connection.getReceivers()) addTrack(receiver.track);
  };

  const proto = RTCPeerConnection.prototype;
  const originalSetRemoteDescription = proto.setRemoteDescription;
  const watched = new WeakSet<RTCPeerConnection>();
  proto.setRemoteDescription = async function (this: RTCPeerConnection, ...args: Parameters<typeof originalSetRemoteDescription>) {
    if (!watched.has(this)) {
      watched.add(this);
      this.addEventListener('track', (event) => addTrack(event.track));
      log('connexion WebRTC de la plateforme détectée');
    }
    const result = await originalSetRemoteDescription.apply(this, args);
    scan(this);
    return result;
  } as typeof originalSetRemoteDescription;
  log('capture du son du recruteur prête (pistes WebRTC distantes uniquement)');
}
