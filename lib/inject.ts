// Injection (voie A) : remplace getUserMedia et enumerateDevices pour que la page reçoive
// le canvas de l'avatar comme caméra et la piste audio fournie comme micro, sous le nom
// « Avatar IA – OtherSelf ». Sans API d'extension : tourne dans le monde MAIN d'un onglet.

import { AvatarRenderer, type AvatarOptions } from './avatar';
import { createLogger } from './log';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;
/** Nouveaux devicechange : la page peut n'écouter l'événement qu'un peu après l'injection. */
const DEVICECHANGE_REPEATS_MS = [1000, 3000];
/** Délai après lequel on constate si la page a relu la liste des périphériques. */
const ENUMERATE_CHECK_MS = 5000;

const log = createLogger('inject');

export interface FakeMediaSources {
  photo: ImageBitmap | null;
  avatarOptions: AvatarOptions;
  /** Crée la piste du micro injecté, au premier appel de getUserMedia. */
  createAudioTrack: () => Promise<MediaStreamTrack>;
}

interface FakeTracks {
  video: MediaStreamTrack;
  audio: MediaStreamTrack;
  stopRendering(): void;
}

export interface FakeMediaHandle {
  /** Remet getUserMedia et enumerateDevices d'origine et coupe les pistes remises à la page. */
  uninstall(): void;
}

// Nom affiché par la plateforme pour la caméra, le micro et les pistes injectées.
export const DEVICE_LABEL = 'Avatar IA – OtherSelf';
const DEVICE_IDS = { videoinput: 'otherself-camera', audioinput: 'otherself-micro' } as const;
const GROUP_ID = 'otherself';

export function installFakeGetUserMedia(sources: FakeMediaSources): FakeMediaHandle {
  // Patch du prototype : couvre aussi les appels qui ne passent pas par navigator.mediaDevices.
  const proto = MediaDevices.prototype;
  const originalGetUserMedia = proto.getUserMedia;
  const originalEnumerateDevices = proto.enumerateDevices;
  let fake: Promise<FakeTracks> | null = null;
  /** Pistes remises à la page : arrêtées à la désactivation (la page voit « ended »). */
  const handedOut: MediaStreamTrack[] = [];
  let enumerations = 0;

  proto.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
    log(`getUserMedia intercepté : ${JSON.stringify(constraints ?? {})}`);
    if (!constraints?.video && !constraints?.audio) return originalGetUserMedia.call(this, constraints);
    fake ??= createFakeTracks(sources);
    const { video, audio } = await fake;
    // Des clones : la page peut arrêter ses pistes sans couper les sources.
    const tracks: MediaStreamTrack[] = [];
    if (constraints.video) tracks.push(disguise(video.clone(), 'videoinput'));
    if (constraints.audio) tracks.push(disguise(audio.clone(), 'audioinput'));
    handedOut.push(...tracks);
    log(`flux injecté renvoyé : ${tracks.map((track) => `${track.kind} « ${track.label} »`).join(' + ')}`);
    return new MediaStream(tracks);
  };

  // Seuls la fausse caméra et le faux micro sont proposés ; les sorties audio réelles restent.
  proto.enumerateDevices = async function (this: MediaDevices) {
    enumerations += 1;
    const real = await originalEnumerateDevices.call(this);
    const outputs = real.filter((device) => device.kind === 'audiooutput');
    const devices = [fakeDevice('videoinput'), fakeDevice('audioinput'), ...outputs];
    log(`enumerateDevices intercepté : ${devices.map((device) => `${device.kind} « ${device.label} »`).join(', ')}`);
    return devices;
  };

  log('getUserMedia et enumerateDevices remplacés');
  // Invite la page à relire la liste des périphériques, puis constate si elle l'a fait.
  const announce = (when: string) => {
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    log(`devicechange envoyé à la page (${when})`);
  };
  announce('installation');
  const repeats = DEVICECHANGE_REPEATS_MS.map((delay) => setTimeout(() => announce(`+${delay / 1000} s`), delay));
  const check = setTimeout(() => {
    log(
      enumerations > 0
        ? `la page a relu la liste des périphériques (${enumerations} appel(s) à enumerateDevices) : « ${DEVICE_LABEL} » doit y figurer`
        : 'la page n’a PAS relu la liste après devicechange : choisir un autre micro puis revenir dans ses réglages pour qu’elle la relise',
    );
  }, ENUMERATE_CHECK_MS);

  return {
    uninstall() {
      for (const timer of [...repeats, check]) clearTimeout(timer);
      proto.getUserMedia = originalGetUserMedia;
      proto.enumerateDevices = originalEnumerateDevices;
      for (const track of handedOut) track.stop();
      void fake?.then((tracks) => {
        tracks.stopRendering();
        tracks.video.stop();
        tracks.audio.stop();
      });
      log(`désactivation : getUserMedia et enumerateDevices d'origine remis, ${handedOut.length} piste(s) injectée(s) arrêtée(s)`);
      handedOut.length = 0;
      fake = null;
      // La page relit la liste : vraie caméra et vrai micro de nouveau proposés.
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    },
  };
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
  const video = createVideoTrack(sources.photo, sources.avatarOptions);
  return { video: video.track, stopRendering: video.stop, audio: await sources.createAudioTrack() };
}

function createVideoTrack(photo: ImageBitmap | null, options: AvatarOptions): { track: MediaStreamTrack; stop(): void } {
  // Canvas hors DOM : la page ne voit que le flux, bandeau compris (règle 1).
  const renderer = new AvatarRenderer(document.createElement('canvas'), photo, options);
  renderer.draw();
  const track = renderer.canvas.captureStream(FPS).getVideoTracks()[0];
  if (!track) throw new Error('captureStream n\'a fourni aucune piste vidéo');

  // Redessin continu : un canvas figé peut ne produire aucune image dans le flux.
  // setInterval plutôt que requestAnimationFrame, qui s'arrête si l'onglet est masqué.
  let frames = 0;
  let last = performance.now();
  const drawing = setInterval(() => {
    renderer.draw();
    frames += 1;
  }, 1000 / FPS);
  const stats = setInterval(() => {
    const now = performance.now();
    log(`vidéo : ${((frames * 1000) / (now - last)).toFixed(1)} images/s dessinées`);
    frames = 0;
    last = now;
  }, STATS_INTERVAL_MS);

  const { width, height } = track.getSettings();
  log(`piste vidéo créée depuis le canvas (${width}x${height} @ ${FPS} fps)`);
  return {
    track,
    stop() {
      clearInterval(drawing);
      clearInterval(stats);
    },
  };
}
