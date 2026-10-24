// Capture du son du recruteur (monde MAIN, cadre principal de la plateforme) : uniquement
// le son reçu des autres participants, jamais le micro de l'utilisateur ni la voix de
// l'avatar (pistes locales, voir local-tracks.ts).
//
// Sources, de la plus sûre à la plus large :
// 1. connexions RTCPeerConnection : celles créées après l'activation (constructeur
//    remplacé) et celles qui existaient déjà, découvertes au premier appel d'une de leurs
//    méthodes (Meet appelle getStats en continu). Leurs récepteurs ne portent que du son
//    distant.
// 2. secours, si une connexion reste invisible : flux lus par les éléments <audio>/<video>
//    de la page et sources Web Audio créées par la plateforme, pistes locales écartées.

import { isLocal } from './local-tracks';
import { createLogger } from './log';
import { audioContext } from './page-audio';
import { bufferToBase64, floatToInt16, resample } from './pcm';

const log = createLogger('inject');

export const CAPTURE_SAMPLE_RATE = 24000;
const PROCESSOR_FRAMES = 2048;
const RESCAN_INTERVAL_MS = 2000;
const REPORT_INTERVAL_MS = 15000;

/** Méthodes dont l'appel révèle une connexion créée avant l'activation. */
const DISCOVERY_METHODS = [
  'getStats',
  'setRemoteDescription',
  'setLocalDescription',
  'createOffer',
  'createAnswer',
  'addIceCandidate',
  'getReceivers',
  'getTransceivers',
  'getSenders',
  'addTrack',
  'addTransceiver',
] as const;

const shortId = (id: string) => id.slice(0, 8);

export function captureRemoteAudio(onChunk: (pcm: string, at: number) => void) {
  const branched = new Set<string>();
  const rejected = new Set<string>();
  const connections: RTCPeerConnection[] = [];
  const connectionIds = new WeakMap<RTCPeerConnection, number>();
  const ownElements = new WeakSet<HTMLMediaElement>();
  let mixer: GainNode | null = null;
  const level = { sumSquares: 0, samples: 0, peak: 0 };

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
      for (const sample of input) {
        level.sumSquares += sample * sample;
        level.peak = Math.max(level.peak, Math.abs(sample));
      }
      level.samples += input.length;
      const pcm = floatToInt16(resample(input, ctx.sampleRate, CAPTURE_SAMPLE_RATE));
      onChunk(bufferToBase64(pcm.buffer), Date.now());
    });
    return mixer;
  };

  const addTrack = (track: MediaStreamTrack | null, origin: string, remote: boolean) => {
    if (!track || track.kind !== 'audio' || branched.has(track.id) || rejected.has(track.id)) return;
    // Règle d'architecture : la voix de l'avatar et le micro ne repartent jamais dans la transcription.
    if (!remote && isLocal(track)) {
      rejected.add(track.id);
      log(`piste locale écartée (${origin}) : ${shortId(track.id)} « ${track.label} »`);
      return;
    }
    branched.add(track.id);
    const stream = new MediaStream([track]);
    // Contournement Chrome : une piste WebRTC distante peut rester muette dans Web Audio
    // si elle n'est pas aussi lue par un élément média (muet ici).
    const element = new Audio();
    ownElements.add(element);
    element.muted = true;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    audioContext().createMediaStreamSource(stream).connect(ensureMixer());
    log(
      `son du recruteur : piste distante ${shortId(track.id)} branchée (${origin} ; ` +
        `${track.readyState}${track.muted ? ', sans son pour l’instant' : ''} ; ${branched.size} au total)`,
    );
    track.addEventListener('unmute', () => log(`piste ${shortId(track.id)} : le son arrive`), { once: true });
    track.addEventListener('ended', () => log(`piste ${shortId(track.id)} terminée`), { once: true });
  };

  // 1. Connexions WebRTC.
  const proto = RTCPeerConnection.prototype;
  const getReceivers = proto.getReceivers;

  const scan = (connection: RTCPeerConnection, origin: string) => {
    for (const receiver of getReceivers.call(connection)) addTrack(receiver.track, origin, true);
  };

  const discover = (connection: RTCPeerConnection, how: string) => {
    if (connectionIds.has(connection)) return;
    const n = connections.push(connection);
    connectionIds.set(connection, n);
    connection.addEventListener('track', (event) => addTrack(event.track, `connexion n°${n}, événement track`, true));
    connection.addEventListener('connectionstatechange', () => log(`connexion n°${n} : ${connection.connectionState}`));
    const kinds = getReceivers.call(connection).map((receiver) => receiver.track.kind);
    const audio = kinds.filter((kind) => kind === 'audio').length;
    log(
      `connexion WebRTC n°${n} détectée (${how}) : état ${connection.connectionState}, ` +
        `${audio} récepteur(s) audio, ${kinds.length - audio} vidéo`,
    );
    scan(connection, `connexion n°${n}, récepteurs`);
  };

  const methods = proto as unknown as Record<string, unknown>;
  const native = (fn: unknown) => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
  // Méthodes déjà remplacées par la page avant l'activation (diagnostic).
  const pageWrapped = DISCOVERY_METHODS.filter((name) => typeof methods[name] === 'function' && !native(methods[name]));
  for (const name of DISCOVERY_METHODS) {
    const original = methods[name];
    if (typeof original !== 'function') continue;
    methods[name] = function (this: RTCPeerConnection, ...args: unknown[]) {
      try {
        discover(this, `déjà créée avant l'activation, vue à l'appel de ${name}`);
      } catch (error) {
        log(`erreur de détection : ${error instanceof Error ? error.message : String(error)}`);
      }
      const result: unknown = (original as (...a: unknown[]) => unknown).apply(this, args);
      if (name === 'setRemoteDescription' && result instanceof Promise) {
        const n = connectionIds.get(this);
        result.then(() => scan(this, `connexion n°${n}, après setRemoteDescription`), () => undefined);
      }
      return result;
    };
  }

  const scope = window as unknown as Record<string, unknown>;
  const NativePeerConnection = window.RTCPeerConnection;
  const WrappedPeerConnection = new Proxy(NativePeerConnection, {
    construct(target, args, newTarget) {
      const connection = Reflect.construct(target, args, newTarget) as RTCPeerConnection;
      discover(connection, 'créée après l’activation');
      return connection;
    },
  });
  window.RTCPeerConnection = WrappedPeerConnection;
  if (scope.webkitRTCPeerConnection === NativePeerConnection) scope.webkitRTCPeerConnection = WrappedPeerConnection;

  // 2. Secours : éléments média et sources Web Audio de la page.
  const inspectStream = (stream: unknown, origin: string) => {
    if (!(stream instanceof MediaStream)) return;
    for (const track of stream.getAudioTracks()) addTrack(track, origin, false);
  };

  const srcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (srcObject?.set && srcObject.get) {
    const { get, set } = srcObject;
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      ...srcObject,
      get,
      set(this: HTMLMediaElement, value: MediaProvider | null) {
        set.call(this, value);
        if (!ownElements.has(this)) inspectStream(value, `élément <${this.localName}> de la page`);
      },
    });
  }

  const createSource = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (this: AudioContext, stream: MediaStream) {
    inspectStream(stream, 'source Web Audio de la page');
    return createSource.call(this, stream);
  };

  const mediaElements = () =>
    [...document.querySelectorAll<HTMLMediaElement>('audio, video')].filter((element) => !ownElements.has(element));

  // Pistes ajoutées après coup à un flux déjà affecté, connexions qui gagnent des récepteurs.
  setInterval(() => {
    for (const element of mediaElements()) inspectStream(element.srcObject, `élément <${element.localName}> de la page`);
    connections.forEach((connection, index) => {
      if (connection.connectionState !== 'closed') scan(connection, `connexion n°${index + 1}, récepteurs`);
    });
  }, RESCAN_INTERVAL_MS);

  setInterval(() => {
    const rms = level.samples ? Math.sqrt(level.sumSquares / level.samples) : 0;
    const db = rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dBFS` : 'silence';
    const elements = mediaElements().filter((element) => element.srcObject instanceof MediaStream).length;
    log(
      `bilan capture : ${connections.length} connexion(s) WebRTC, ${branched.size} piste(s) distante(s) branchée(s), ` +
        `${rejected.size} locale(s) écartée(s), ${elements} élément(s) média de la page avec flux ; ` +
        `niveau du recruteur sur ${REPORT_INTERVAL_MS / 1000} s : ${db} (crête ${level.peak.toFixed(2)}), ` +
        `contexte audio ${mixer ? audioContext().state : 'pas encore créé'}`,
    );
    level.sumSquares = 0;
    level.samples = 0;
    level.peak = 0;
  }, REPORT_INTERVAL_MS);

  // État de la page au moment de l'activation, pour le diagnostic.
  const frames = [...document.querySelectorAll('iframe')];
  const sameOrigin = frames.filter((frame) => {
    try {
      return Boolean(frame.contentDocument);
    } catch {
      return false;
    }
  }).length;
  const existing = mediaElements();
  log(
    `capture du son du recruteur prête : RTCPeerConnection ${native(NativePeerConnection) ? 'natif' : 'déjà remplacé par la page'}, ` +
      `méthodes ${pageWrapped.length ? `déjà remplacées par la page : ${pageWrapped.join(', ')}` : 'natives'} ; ` +
      `${existing.length} élément(s) <audio>/<video> dans la page (${existing.filter((element) => element.srcObject instanceof MediaStream).length} avec flux) ; ` +
      `${frames.length} iframe(s), dont ${sameOrigin} de même origine`,
  );
  for (const element of existing) inspectStream(element.srcObject, `élément <${element.localName}> déjà présent`);
}
