// Rendu après coup d'une prise de la page recruteur (local/prises/) : la prise n'enregistre que les deux voix et un
// journal de tout ce qui pilote l'image (entrypoints/recruiter/recording.ts) ; cette page refait les vidéos hors temps
// réel, à 30 images/s exactes d'un temps virtuel :
// - Nova : même code qu'en injection (lib/avatar-frames.ts : avatar 3D ou secours, marqueur IA peint en dernier, image
//   de pause), même graine du hasard (clignements, saccades), mêmes états et hochements aux mêmes instants, bouche
//   pilotée par la voix enregistrée (niveau RMS sur 1024 échantillons, comme le micro injecté) ;
// - le recruteur : même dessin qu'en direct (entrypoints/recruiter/visual.ts), couronne pilotée par sa voix enregistrée
//   (analyseur Web Audio hors temps réel, mêmes réglages) ;
// - l'aperçu composé (recruteur à gauche, Nova à droite, 1920×540) avec les deux voix mixées.
// Encodage WebCodecs (VP8, Opus), écriture WebM sans dépendance (./webm.ts). Mêmes noms de fichiers qu'avant :
// prise-…-avatar.webm, -recruteur.webm, -apercu.webm. Voix, SRT et infos de la prise inchangés.
// La vidéo est donc un nouveau rendu de la prise, par la même logique, et non l'image envoyée en direct.

import { mapAssets } from '@/lib/avatar';
import { createAvatarFrames, type AvatarFrameSources } from '@/lib/avatar-frames';
import type { AvatarState } from '@/lib/avatar-states';
import { loadSources } from '@/lib/activation';
import { fileToBlob, pauseText } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { onRenderEvent, renderClock } from '@/lib/render-random';
import { drawRecruiterFrame, RECRUITER_FFT, RECRUITER_HEIGHT, RECRUITER_WIDTH } from '../recruiter/visual';
import { opusHead, writeWebm, type WebmChunk } from './webm';

const log = createLogger('rendu');
const FPS = 30;
const SAMPLE_RATE = 48_000;
/** Analyseur du niveau de la voix de Nova : même taille que le micro injecté (lib/inject.ts, createLevelMeter). */
const LEVEL_FFT = 1024;
const AVATAR_SIZE = { width: 1280, height: 720 };
const PREVIEW_SIZE = { width: 1920, height: 540 };
const BITRATES = { avatar: 5_000_000, recruteur: 1_500_000, apercu: 5_000_000 };

interface JournalEvent {
  kind: string;
  at: number;
  [detail: string]: number | string;
}

interface Journal {
  version: number;
  fps: number;
  durationMs: number;
  perfStart: number;
  renderEvents: JournalEvent[];
  recruiterLines: { start: number; end: number; text: string }[];
  fillers: { at: number; text: string }[];
}

export interface RenderInput {
  prefix: string;
  journal: Journal;
  voiceAvatar: ArrayBuffer;
  voiceRecruiter: ArrayBuffer;
  /** Images de contrôle (secondes de la prise) : aperçu composé enregistré en PNG (-image-XXs.png). */
  snapshots?: number[];
}

export interface RenderStats {
  frames: number;
  durationMs: number;
  renderer: string;
  rendererInTake: string;
  elapsedMs: number;
  preRollFrames: number;
  blinks: { take: number; replayed: number; identical: number };
  saccades: { take: number; replayed: number; identical: number };
  states: number;
  nods: number;
  fillers: number;
  files: { name: string; bytes: number }[];
  replayed: { blink: number[]; saccade: number[] };
}

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const status = (message: string) => {
  statusEl.textContent = message;
  log(message);
};

// ——— Audio : décodage, analyse hors temps réel, mélange ———

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes.slice(0));
}

function mono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) out[i]! += data[i]! / buffer.numberOfChannels;
  }
  return out;
}

/**
 * Niveau de la voix de Nova et spectre de la voix du recruteur à chaque image, lus comme en direct : analyseurs Web
 * Audio (mêmes tailles, lissage par défaut), interrogés à l'heure de chaque image (contexte hors temps réel suspendu).
 */
async function analyse(avatar: AudioBuffer, recruiter: AudioBuffer, frames: number) {
  const length = Math.ceil((frames / FPS) * SAMPLE_RATE) + 256;
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const levelAnalyser = ctx.createAnalyser();
  levelAnalyser.fftSize = LEVEL_FFT;
  const spectrum = ctx.createAnalyser();
  spectrum.fftSize = RECRUITER_FFT;
  for (const [buffer, analyser] of [[avatar, levelAnalyser], [recruiter, spectrum]] as const) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    source.start(0);
  }
  const levels = new Float32Array(frames);
  const bins = new Uint8Array(frames * spectrum.frequencyBinCount);
  const samples = new Float32Array(LEVEL_FFT);
  for (let i = 1; i < frames; i += 1) {
    void ctx.suspend(i / FPS).then(() => {
      levelAnalyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      levels[i] = Math.sqrt(sum / samples.length);
      spectrum.getByteFrequencyData(bins.subarray(i * spectrum.frequencyBinCount, (i + 1) * spectrum.frequencyBinCount));
      void ctx.resume();
    });
  }
  await ctx.startRendering();
  return { levels, bins, binCount: spectrum.frequencyBinCount };
}

const dequeue = (target: EventTarget) => new Promise((resolve) => target.addEventListener('dequeue', resolve, { once: true }));

async function encodeOpus(samples: Float32Array): Promise<{ chunks: WebmChunk[]; head: Uint8Array }> {
  const chunks: WebmChunk[] = [];
  let head: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ timestamp: chunk.timestamp, key: true, data });
      const description = metadata?.decoderConfig?.description;
      if (description && !head) head = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer.slice(0)) : new Uint8Array(description.slice(0));
    },
    error: (error) => (failure = error),
  });
  encoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 128_000 });
  const frame = 960;
  for (let at = 0; at < samples.length; at += frame) {
    const data = samples.slice(at, at + frame);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: data.length, numberOfChannels: 1, timestamp: Math.round((at / SAMPLE_RATE) * 1e6), data }));
    if (encoder.encodeQueueSize > 50) await dequeue(encoder);
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return { chunks, head: head ?? opusHead(1, SAMPLE_RATE) };
}

// ——— Vidéo ———

async function videoEncoder(width: number, height: number, bitrate: number) {
  const config: VideoEncoderConfig = { codec: 'vp8', width, height, bitrate, framerate: FPS, latencyMode: 'quality' };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error(`encodeur VP8 indisponible (${width}×${height})`);
  const chunks: WebmChunk[] = [];
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', data });
    },
    error: (error) => (failure = error),
  });
  encoder.configure(config);
  return {
    chunks,
    async encode(source: HTMLCanvasElement, index: number) {
      if (failure) throw failure;
      const frame = new VideoFrame(source, { timestamp: Math.round((index * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: index % FPS === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await dequeue(encoder);
    },
    async finish() {
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      chunks.sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d', { alpha: false })!];
}

/** Sources de l'avatar préparées comme pour l'injection (lib/activation.ts, puis conversion de entrypoints/content.ts). */
async function avatarSources(): Promise<AvatarFrameSources> {
  const sources = await loadSources();
  return {
    avatar: await mapAssets(sources.avatar, (file) => createImageBitmap(fileToBlob(file))),
    vrm: sources.vrm && {
      model: await fileToBlob(sources.vrm.model).arrayBuffer(),
      background: await createImageBitmap(fileToBlob(sources.vrm.background)),
      camera: sources.vrm.camera,
    },
    marking: await createImageBitmap(fileToBlob(sources.marking)),
    pauseText: pauseText(sources.language),
  };
}

/** Événements du rendu reproduits identiques (même heure prévue à 5 ms près, l'avatar créé dans le même instant). */
function compare(take: JournalEvent[], replayed: number[], kind: string) {
  const inTake = take.filter((event) => event.kind === kind && event.at >= 0).map((event) => event.at);
  const identical = inTake.filter((at) => replayed.some((other) => Math.abs(other - at) <= 5)).length;
  return { take: inTake.length, replayed: replayed.filter((at) => at >= 0).length, identical };
}

export async function render(input: RenderInput, save: (name: string, blob: Blob) => Promise<void>): Promise<RenderStats> {
  const started = performance.now();
  const { journal, prefix } = input;
  if (journal.version !== 1) throw new Error(`journal de version ${journal.version} inconnue`);
  const created = journal.renderEvents.find((event) => event.kind === 'create');
  if (!created) throw new Error('journal sans création de l’avatar (graine absente)');
  const frameCount = Math.round((journal.durationMs * FPS) / 1000);

  status('voix : décodage et analyse');
  const [avatarVoice, recruiterVoice] = await Promise.all([decode(input.voiceAvatar), decode(input.voiceRecruiter)]);
  const { levels, bins, binCount } = await analyse(avatarVoice, recruiterVoice, frameCount);

  // Horloge virtuelle du rendu : celle de la page pendant la prise (performance.now), image par image.
  // Les animations lisent l'horloge à leur construction (événement 'animator', un peu avant 'create') : même heure ici.
  const animator = journal.renderEvents.find((event) => event.kind === 'animator');
  let virtual = journal.perfStart + (animator ?? created).at;
  renderClock.now = () => virtual;
  const replayed = { blink: [] as number[], saccade: [] as number[] };
  onRenderEvent((kind, at) => {
    if (kind === 'blink' || kind === 'saccade') replayed[kind].push(at - journal.perfStart);
  });
  let level = 0;
  status('avatar : préparation');
  const sources = { ...(await avatarSources()), initialState: (created.state as AvatarState | undefined) ?? 'inactif' };
  const frames = await createAvatarFrames(sources, () => level, log, {
    seed: Number(created.seed),
    renderer: created.renderer === 'secours' ? 'secours' : 'vrm',
  });
  const events = journal.renderEvents.filter((event) => ['state', 'nod', 'pause'].includes(event.kind)).sort((a, b) => a.at - b.at);
  let next = 0;
  /** Événements de la prise jusqu'à `until` (ms depuis le début), chacun à son heure. */
  const apply = (until: number) => {
    while (next < events.length && events[next]!.at <= until) {
      const event = events[next++]!;
      virtual = journal.perfStart + event.at;
      if (event.kind === 'state') frames.setState(event.state as AvatarState);
      else if (event.kind === 'nod') frames.nod();
      else if (event.kind === 'pause') frames.setPaused(event.paused === 1);
    }
  };
  // Avant la prise (depuis l'activation) : mêmes images, non encodées, pour que les tirages et la physique en soient
  // au même point qu'en direct au début de la prise.
  let preRollFrames = 0;
  virtual = journal.perfStart + created.at;
  frames.draw(virtual);
  for (let t = created.at + 1000 / FPS; t < 0; t += 1000 / FPS) {
    apply(t);
    virtual = journal.perfStart + t;
    frames.draw(virtual);
    preRollFrames += 1;
  }

  const encoders = {
    avatar: await videoEncoder(AVATAR_SIZE.width, AVATAR_SIZE.height, BITRATES.avatar),
    recruteur: await videoEncoder(RECRUITER_WIDTH, RECRUITER_HEIGHT, BITRATES.recruteur),
    apercu: await videoEncoder(PREVIEW_SIZE.width, PREVIEW_SIZE.height, BITRATES.apercu),
  };
  const [recruiterCanvas, recruiterCtx] = canvas(RECRUITER_WIDTH, RECRUITER_HEIGHT);
  const [previewCanvas, previewCtx] = canvas(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
  for (let i = 0; i < frameCount; i += 1) {
    const t = (i * 1000) / FPS;
    apply(t);
    virtual = journal.perfStart + t;
    level = levels[i] ?? 0;
    frames.draw(virtual);
    const speaking = journal.recruiterLines.some((line) => line.start <= t && t < line.end);
    drawRecruiterFrame(recruiterCtx, bins.subarray(i * binCount, (i + 1) * binCount), speaking, virtual);
    previewCtx.fillStyle = '#000';
    previewCtx.fillRect(0, 0, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
    previewCtx.drawImage(recruiterCanvas, 0, 0, PREVIEW_SIZE.width / 2, PREVIEW_SIZE.height);
    previewCtx.drawImage(frames.canvas, PREVIEW_SIZE.width / 2, 0, PREVIEW_SIZE.width / 2, PREVIEW_SIZE.height);
    await Promise.all([encoders.avatar.encode(frames.canvas, i), encoders.recruteur.encode(recruiterCanvas, i), encoders.apercu.encode(previewCanvas, i)]);
    const second = input.snapshots?.find((at) => Math.round(at * FPS) === i);
    if (second !== undefined) {
      const [still, stillCtx] = canvas(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
      stillCtx.drawImage(previewCanvas, 0, 0);
      still.toBlob((blob) => blob && void save(`${prefix}-image-${second}s.png`, blob), 'image/png');
    }
    if (i % (FPS * 10) === 0) status(`images : ${i} / ${frameCount} (${Math.round(t / 1000)} s de prise, ${Math.round((performance.now() - started) / 1000)} s écoulées)`);
  }
  onRenderEvent(null);
  const renderer = frames.kind();
  frames.dispose();
  await Promise.all(Object.values(encoders).map((encoder) => encoder.finish()));

  status('aperçu : voix mixées');
  const avatarSamples = mono(avatarVoice);
  const recruiterSamples = mono(recruiterVoice);
  const mixed = new Float32Array(Math.min(Math.max(avatarSamples.length, recruiterSamples.length), Math.ceil((frameCount / FPS) * SAMPLE_RATE)));
  for (let i = 0; i < mixed.length; i += 1) mixed[i] = Math.max(-1, Math.min(1, (avatarSamples[i] ?? 0) + (recruiterSamples[i] ?? 0)));
  const opus = await encodeOpus(mixed);

  const files: { name: string; bytes: number }[] = [];
  const outputs: [string, Blob][] = [
    ['avatar', writeWebm({ ...AVATAR_SIZE, chunks: encoders.avatar.chunks })],
    ['recruteur', writeWebm({ width: RECRUITER_WIDTH, height: RECRUITER_HEIGHT, chunks: encoders.recruteur.chunks })],
    ['apercu', writeWebm({ ...PREVIEW_SIZE, chunks: encoders.apercu.chunks }, { sampleRate: SAMPLE_RATE, channels: 1, opusHead: opus.head, chunks: opus.chunks })],
  ];
  for (const [name, blob] of outputs) {
    const file = `${prefix}-${name}.webm`;
    await save(file, blob);
    files.push({ name: file, bytes: blob.size });
  }
  const stats: RenderStats = {
    frames: frameCount,
    durationMs: journal.durationMs,
    renderer,
    rendererInTake: String(created.renderer),
    elapsedMs: Math.round(performance.now() - started),
    preRollFrames,
    blinks: compare(journal.renderEvents, replayed.blink, 'blink'),
    saccades: compare(journal.renderEvents, replayed.saccade, 'saccade'),
    states: events.filter((event) => event.kind === 'state').length,
    nods: events.filter((event) => event.kind === 'nod').length,
    fillers: journal.fillers.length,
    files,
    replayed: { blink: replayed.blink.map((at) => +at.toFixed(1)), saccade: replayed.saccade.map((at) => +at.toFixed(1)) },
  };
  status(`rendu terminé en ${(stats.elapsedMs / 1000).toFixed(0)} s : ${frameCount} images par vidéo, ${files.map((file) => file.name).join(', ')}`);
  return stats;
}

// ——— Commande par script (scripts/render-prise.ts) : fichiers passés en base64, vidéos téléchargées ———

const base64ToBuffer = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0)).buffer;

function download(name: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return Promise.resolve();
}

declare global {
  interface Window {
    __render?: {
      run(prefix: string, journal: string, voiceAvatar: string, voiceRecruiter: string, snapshots?: number[]): Promise<string>;
    };
  }
}

window.__render = {
  async run(prefix, journal, voiceAvatar, voiceRecruiter, snapshots) {
    const stats = await render({ prefix, journal: JSON.parse(journal) as Journal, voiceAvatar: base64ToBuffer(voiceAvatar), voiceRecruiter: base64ToBuffer(voiceRecruiter), snapshots }, download);
    return JSON.stringify(stats);
  },
};

// ——— Commande à la main : dossier des prises choisi dans la page, vidéos écrites à côté du journal ———

const select = document.querySelector<HTMLSelectElement>('#prise')!;
const renderButton = document.querySelector<HTMLButtonElement>('#render')!;
let folder: FileSystemDirectoryHandle | null = null;
document.querySelector('#folder')!.addEventListener('click', () => {
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return status('sélecteur de dossier indisponible : utiliser npm run rendu:prise');
  void picker({ id: 'otherself-prises', mode: 'readwrite' }).then(async (handle) => {
    folder = handle;
    select.textContent = '';
    for await (const name of (handle as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name.endsWith('-journal.json')) select.add(new Option(name.replace('-journal.json', '')));
    }
    select.hidden = renderButton.hidden = select.options.length === 0;
    status(select.options.length ? `${select.options.length} prise(s) avec journal` : 'aucune prise avec journal dans ce dossier');
  });
});
renderButton.addEventListener('click', () => {
  if (!folder) return;
  const handle = folder;
  const prefix = select.value;
  const read = async (name: string) => (await (await handle.getFileHandle(name)).getFile()).arrayBuffer();
  renderButton.disabled = true;
  void (async () => {
    const journal = JSON.parse(new TextDecoder().decode(await read(`${prefix}-journal.json`))) as Journal;
    await render({ prefix, journal, voiceAvatar: await read(`${prefix}-voix-avatar.webm`), voiceRecruiter: await read(`${prefix}-voix-recruteur.webm`) }, async (name, blob) => {
      const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
    });
  })()
    .catch((error: unknown) => status(`erreur : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => (renderButton.disabled = false));
});
status('prêt');
