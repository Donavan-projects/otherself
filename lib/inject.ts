// Étape 3, test d'injection (code jetable) : remplace getUserMedia pour que la page
// reçoive le canvas de l'avatar comme caméra et un son préenregistré comme micro.
// Ne dépend d'aucune API d'extension : tourne aussi dans le monde MAIN d'un onglet.

import { AvatarRenderer } from './avatar';
import { createLogger } from './log';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;

const log = createLogger('inject');

export interface FakeMediaSources {
  photo: ImageBitmap | null;
  /** Fichier audio encodé (mp3, ogg…) ; un bip est émis s'il est absent. */
  audio: ArrayBuffer | null;
}

interface FakeTracks {
  video: MediaStreamTrack;
  audio: MediaStreamTrack;
}

// Nom affiché par la plateforme pour la caméra, le micro et les pistes injectées.
export const DEVICE_LABEL = 'Avatar IA – Contre-Recruteur';
const DEVICE_IDS = { videoinput: 'contre-recruteur-camera', audioinput: 'contre-recruteur-micro' } as const;
const GROUP_ID = 'contre-recruteur';

export function installFakeGetUserMedia(sources: FakeMediaSources) {
  // Patch du prototype : couvre aussi les appels qui ne passent pas par navigator.mediaDevices.
  const proto = MediaDevices.prototype;
  const originalGetUserMedia = proto.getUserMedia;
  const originalEnumerateDevices = proto.enumerateDevices;
  let fake: Promise<FakeTracks> | null = null;

  proto.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
    log(`getUserMedia intercepté : ${JSON.stringify(constraints ?? {})}`);
    if (!constraints?.video && !constraints?.audio) return originalGetUserMedia.call(this, constraints);
    fake ??= createFakeTracks(sources);
    const { video, audio } = await fake;
    // Des clones : la page peut arrêter ses pistes sans couper les sources.
    const tracks: MediaStreamTrack[] = [];
    if (constraints.video) tracks.push(disguise(video.clone(), 'videoinput'));
    if (constraints.audio) tracks.push(disguise(audio.clone(), 'audioinput'));
    log(`flux injecté renvoyé : ${tracks.map((track) => `${track.kind} « ${track.label} »`).join(' + ')}`);
    return new MediaStream(tracks);
  };

  // Seuls la fausse caméra et le faux micro sont proposés ; les sorties audio réelles restent.
  proto.enumerateDevices = async function (this: MediaDevices) {
    const real = await originalEnumerateDevices.call(this);
    const outputs = real.filter((device) => device.kind === 'audiooutput');
    const devices = [fakeDevice('videoinput'), fakeDevice('audioinput'), ...outputs];
    log(`enumerateDevices intercepté : ${devices.map((device) => `${device.kind} « ${device.label} »`).join(', ')}`);
    return devices;
  };

  log('getUserMedia et enumerateDevices remplacés');
  // Invite la page à relire la liste des périphériques.
  navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
}

type InputKind = keyof typeof DEVICE_IDS;

function fakeDevice(kind: InputKind): MediaDeviceInfo {
  const info = {
    deviceId: DEVICE_IDS[kind],
    groupId: GROUP_ID,
    kind,
    label: DEVICE_LABEL,
  };
  // Hérite du vrai prototype pour passer les tests `instanceof` (InputDeviceInfo absent de Firefox).
  const proto = typeof InputDeviceInfo === 'undefined' ? MediaDeviceInfo.prototype : InputDeviceInfo.prototype;
  const device = Object.create(proto) as MediaDeviceInfo;
  for (const [key, value] of Object.entries(info)) Object.defineProperty(device, key, { value, enumerable: true });
  Object.defineProperty(device, 'toJSON', { value: () => info });
  return device;
}

/** Donne à la piste le libellé et l'identifiant du faux périphérique. */
function disguise(track: MediaStreamTrack, kind: InputKind): MediaStreamTrack {
  const getSettings = track.getSettings.bind(track);
  Object.defineProperty(track, 'label', { value: DEVICE_LABEL });
  Object.defineProperty(track, 'getSettings', {
    value: () => ({ ...getSettings(), deviceId: DEVICE_IDS[kind], groupId: GROUP_ID }),
  });
  return track;
}

async function createFakeTracks(sources: FakeMediaSources): Promise<FakeTracks> {
  return { video: createVideoTrack(sources.photo), audio: await createAudioTrack(sources.audio) };
}

function createVideoTrack(photo: ImageBitmap | null): MediaStreamTrack {
  // Canvas hors DOM : la page ne voit que le flux, bandeau compris (règle 1).
  const renderer = new AvatarRenderer(document.createElement('canvas'), photo);
  renderer.draw();
  const track = renderer.canvas.captureStream(FPS).getVideoTracks()[0];
  if (!track) throw new Error('captureStream n\'a fourni aucune piste vidéo');

  // Redessin continu : un canvas figé peut ne produire aucune image dans le flux.
  // setInterval plutôt que requestAnimationFrame, qui s'arrête si l'onglet est masqué.
  let frames = 0;
  let last = performance.now();
  setInterval(() => {
    renderer.draw();
    frames += 1;
  }, 1000 / FPS);
  setInterval(() => {
    const now = performance.now();
    log(`vidéo : ${((frames * 1000) / (now - last)).toFixed(1)} images/s dessinées`);
    frames = 0;
    last = now;
  }, STATS_INTERVAL_MS);

  const { width, height } = track.getSettings();
  log(`piste vidéo créée depuis le canvas (${width}x${height} @ ${FPS} fps)`);
  return track;
}

async function createAudioTrack(encoded: ArrayBuffer | null): Promise<MediaStreamTrack> {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();

  if (encoded) {
    const buffer = await context.decodeAudioData(encoded);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    source.start();
    log(`son préenregistré en boucle (${buffer.duration.toFixed(1)} s, ${buffer.sampleRate} Hz)`);
  } else {
    startBeeps(context, destination);
    log('aucun son préenregistré (testAudio) : bip de 440 Hz chaque seconde');
  }

  // Sans geste de l'utilisateur, le navigateur peut laisser le contexte suspendu : piste muette.
  log(`contexte audio créé : ${context.state}`);
  context.addEventListener('statechange', () => log(`contexte audio : ${context.state}`));
  if (context.state !== 'running') await context.resume().catch(() => undefined);

  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error('aucune piste audio créée');
  return track;
}

function startBeeps(context: AudioContext, destination: AudioNode) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  setInterval(() => {
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.setValueAtTime(0, now + 0.2);
  }, 1000);
}
