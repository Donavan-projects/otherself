// Étape 3, test d'injection (code jetable) : remplace getUserMedia pour que la page
// reçoive le canvas de l'avatar comme caméra et un son préenregistré comme micro.
// Ne dépend d'aucune API d'extension : pourra tourner dans le monde MAIN d'un onglet.

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

export function installFakeGetUserMedia(sources: FakeMediaSources) {
  const mediaDevices = navigator.mediaDevices;
  const original = mediaDevices.getUserMedia.bind(mediaDevices);
  let fake: Promise<FakeTracks> | null = null;

  mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    log(`getUserMedia intercepté : ${JSON.stringify(constraints ?? {})}`);
    if (!constraints?.video && !constraints?.audio) return original(constraints);
    fake ??= createFakeTracks(sources);
    const { video, audio } = await fake;
    // Des clones : la page peut arrêter ses pistes sans couper les sources.
    const tracks: MediaStreamTrack[] = [];
    if (constraints.video) tracks.push(video.clone());
    if (constraints.audio) tracks.push(audio.clone());
    const stream = new MediaStream(tracks);
    log(`flux injecté renvoyé : ${tracks.map((track) => track.kind).join(' + ')}`);
    return stream;
  };
  log('getUserMedia remplacé');
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
