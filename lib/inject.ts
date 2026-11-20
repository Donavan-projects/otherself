// Injection (voie A) : remplace getUserMedia et enumerateDevices pour que la page reçoive
// le canvas de l'avatar comme caméra et la piste audio fournie comme micro, sous le nom
// « Avatar IA – OtherSelf ». Sans API d'extension : tourne dans le monde MAIN d'un onglet.

import type { AvatarAssets, MouthShape } from './avatar';
import { createAvatarFrames } from './avatar-frames';
import type { VrmSources } from './avatar-vrm';
import type { AvatarState } from './avatar-states';
import { renderClock } from './render-random';
import { startFrameClock } from './frame-clock';
import { trustedTypesEnforcement } from './trusted-types';
import { createLogger } from './log';
import { audioContext } from './page-audio';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;
/** Nouveaux devicechange : la page peut n'écouter l'événement qu'un peu après l'injection. */
const DEVICECHANGE_REPEATS_MS = [1000, 3000];
/** Délai après lequel on constate si la page a relu la liste des périphériques. */
const ENUMERATE_CHECK_MS = 5000;

const log = createLogger('inject');

export interface FakeMediaSources {
  avatar: AvatarAssets<ImageBitmap>;
  /** Avatar 3D (prototype) : utilisé s'il est fourni et si WebGL est accéléré ; sinon, et en cas de panne, avatar de secours (images rendues depuis le modèle 3D). */
  vrm?: VrmSources | undefined;
  /** Texte de l'image de pause (« Avatar IA en pause ») : sans avatar, elle n'a ni marquage ni voyant (règle 1). */
  pauseText: string;
  /** Marquage « IA » déjà rendu (règle 1), peint avec le voyant en dernier sur chaque image où l'avatar est visible. */
  marking: ImageBitmap;
  /** État de départ de l'avatar ; « parole » pour un banc sans pipeline (bouche pilotée par le son de test). */
  initialState?: AvatarState;
  /** Crée la piste du micro injecté, au premier appel de getUserMedia. */
  createAudioTrack: () => Promise<MediaStreamTrack>;
}

interface FakeTracks {
  video: MediaStreamTrack;
  audio: MediaStreamTrack;
  stopRendering(): void;
  /** Pause : image fixe « Avatar IA en pause » (sans avatar ni marqueur) au lieu de l'avatar, au même rythme. */
  setPaused(paused: boolean, clickAt?: number): void;
  setAvatarState(state: AvatarState): void;
  nod(): void;
  /** Images par seconde dessinées sur la dernière période de statistiques. */
  fps(): number | null;
}

export interface FakeMediaHandle {
  /** Remet getUserMedia et enumerateDevices d'origine et coupe les pistes remises à la page. */
  uninstall(): void;
  /** Aperçu (lib/preview.ts) : vrai si la page a reçu une piste vidéo encore active. */
  sendingVideo(): boolean;
  /** Aperçu : copie de la piste vidéo envoyée, à arrêter par l'appelant ; null sans caméra demandée. */
  previewTrack(): MediaStreamTrack | null;
  /** Aperçu : images par seconde du flux envoyé. */
  sentFps(): number | null;
  /**
   * Pause : les pistes remises à la page restent vivantes (la plateforme ne voit aucune coupure),
   * seule l'image change. clickAt (Date.now du clic) sert à mesurer le délai.
   */
  setPaused(paused: boolean, clickAt?: number): void;
  /** État de l'avatar décidé par le pipeline (lib/avatar-states.ts), appliqué aussi au rendu créé plus tard. */
  setAvatarState(state: AvatarState): void;
  /** Hochement de l'avatar à l'écoute. */
  nod(): void;
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
  let created: FakeTracks | null = null;
  /** Pistes remises à la page : arrêtées à la désactivation (la page voit « ended »). */
  const handedOut: MediaStreamTrack[] = [];
  let enumerations = 0;
  /** Appliqué aussi aux pistes créées plus tard (pause demandée avant que la plateforme ait demandé la caméra). */
  let paused = false;
  let avatarState: AvatarState = sources.initialState ?? 'inactif';

  proto.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
    log(`getUserMedia intercepté : ${JSON.stringify(constraints ?? {})}`);
    if (!constraints?.video && !constraints?.audio) return originalGetUserMedia.call(this, constraints);
    fake ??= createFakeTracks(sources).then((tracks) => {
      created = tracks;
      if (paused) tracks.setPaused(true);
      tracks.setAvatarState(avatarState);
      return tracks;
    });
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

  const sendingVideo = () => handedOut.some((track) => track.kind === 'video' && track.readyState === 'live');
  return {
    sendingVideo,
    previewTrack: () => (created && sendingVideo() ? created.video.clone() : null),
    sentFps: () => created?.fps() ?? null,
    setPaused(value, clickAt) {
      paused = value;
      created?.setPaused(value, clickAt);
    },
    setAvatarState(state) {
      avatarState = state;
      created?.setAvatarState(state);
    },
    nod: () => created?.nod(),
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
      created = null;
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
  // La bouche suit le niveau du micro injecté, c'est-à-dire la voix réellement jouée.
  let level = () => 0;
  const video = await createVideoTrack(sources, () => level());
  const audio = await sources.createAudioTrack();
  level = createLevelMeter(audio);
  return {
    video: video.track,
    stopRendering: video.stop,
    setPaused: video.setPaused,
    setAvatarState: video.setAvatarState,
    nod: video.nod,
    fps: video.fps,
    audio,
  };
}

/** Niveau RMS instantané d'une piste audio (analyseur, jamais relié aux haut-parleurs). */
function createLevelMeter(track: MediaStreamTrack): () => number {
  const ctx = audioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / samples.length);
  };
}

async function createVideoTrack(
  sources: FakeMediaSources,
  level: () => number,
): Promise<{
  track: MediaStreamTrack;
  stop(): void;
  setPaused(paused: boolean, clickAt?: number): void;
  setAvatarState(state: AvatarState): void;
  nod(): void;
  fps(): number | null;
}> {
  // Canvas hors DOM : la page ne voit que le flux, marqueur IA compris (règle 1).
  // Niveau maximal par période de statistiques : sert à régler les seuils de la bouche (lib/avatar.ts).
  let maxLevel = 0;
  const measured = () => {
    const value = level();
    maxLevel = Math.max(maxLevel, value);
    return value;
  };
  // Avatar 3D ou secours, marqueur IA et image de pause, dessinés dans le même canvas (lib/avatar-frames.ts) : la piste
  // capturée ne change pas en cas de repli.
  const frames = await createAvatarFrames(sources, measured, log);
  const { canvas } = frames;
  frames.draw(renderClock.now());
  const track = canvas.captureStream(FPS).getVideoTracks()[0];
  if (!track) throw new Error('captureStream n\'a fourni aucune piste vidéo');
  let paused = false;
  /** Clic de pause ou de reprise pas encore suivi d'une image : délai logué à la première image dessinée. */
  let pendingClick: { at: number; label: string } | null = null;

  const trustedTypes = await trustedTypesEnforcement();
  // Redessin continu : un canvas figé peut ne produire aucune image dans le flux. Le rythme
  // vient d'une horloge que Chrome ne ralentit pas en arrière-plan (lib/frame-clock.ts) ;
  // requestAnimationFrame s'arrêterait dès que l'onglet est masqué.
  let drawn = 0;
  let drawTime = 0;
  let maxDrawTime = 0;
  const shapes = new Map<MouthShape, number>();
  let last = renderClock.now();
  let lastFps: number | null = null;
  const report = (now: number) => {
    lastFps = (drawn * 1000) / (now - last);
    const mouth = [...shapes].map(([shape, count]) => `${shape} ${count}`).join(', ');
    log(
      `vidéo : ${lastFps.toFixed(1)} images/s (horloge ${clock.kind()}, onglet ${document.visibilityState === 'visible' ? 'visible' : 'masqué'}), ` +
        `dessin ${(drawTime / Math.max(1, drawn)).toFixed(2)} ms en moyenne (max ${maxDrawTime.toFixed(1)} ms), ` +
        (paused ? 'image « Avatar en pause »' : `bouche : ${mouth} (niveau max ${maxLevel.toFixed(3)})`),
    );
    drawn = 0;
    drawTime = 0;
    maxDrawTime = 0;
    maxLevel = 0;
    shapes.clear();
    last = now;
  };
  const clock = startFrameClock(
    FPS,
    () => {
      const start = renderClock.now();
      const shape = frames.draw(start);
      if (shape !== 'pause') shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      const spent = renderClock.now() - start;
      drawn += 1;
      drawTime += spent;
      maxDrawTime = Math.max(maxDrawTime, spent);
      if (pendingClick) {
        log(`${pendingClick.label} : première image dessinée ${Date.now() - pendingClick.at} ms après le clic`);
        pendingClick = null;
      }
      // Bilan porté par l'horloge elle-même : un setInterval serait ralenti en arrière-plan.
      if (start - last >= STATS_INTERVAL_MS) report(start);
    },
    (kind, reason) => log(`rythme du dessin : horloge ${kind} (${reason})`),
    trustedTypes,
  );

  const { width, height } = track.getSettings();
  log(`piste vidéo créée depuis le canvas (${width}x${height} @ ${FPS} fps)`);
  return {
    track,
    fps: () => lastFps,
    setPaused(value, clickAt) {
      if (value === paused) return;
      paused = value;
      frames.setPaused(value);
      if (clickAt !== undefined) pendingClick = { at: clickAt, label: value ? 'pause' : 'reprise' };
      log(value ? 'pause : image « Avatar en pause » à la place de l’avatar (pistes de la plateforme inchangées)' : 'reprise : avatar de nouveau dessiné');
    },
    setAvatarState: (state) => frames.setState(state),
    nod: () => frames.nod(),
    stop() {
      clock.stop();
      frames.dispose();
    },
  };
}
