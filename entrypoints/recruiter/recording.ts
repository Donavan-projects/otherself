// Enregistrement brut d'une prise sur la page recruteur IA : pistes séparées, toutes démarrées dans le même instant
// (vidéo de l'avatar telle qu'envoyée, 1280×720 ; vidéo du recruteur ; voix de l'avatar ; voix du recruteur), un aperçu
// déjà composé (écran partagé, voix mixées) pour juger la prise, des sous-titres SRT horodatés avec les deux
// interlocuteurs, et un fichier d'informations. Les sous-titres partent des heures réelles de lecture : répliques du
// recruteur jouées ici, morceaux de voix de l'avatar programmés par la page (playback-chunk) avec leur texte (speak).
// Rangement : dossier choisi par l'utilisateur (sélecteur de dossier du navigateur, par exemple local/prises/ du
// dépôt, ignoré par git), sinon téléchargements. Aucune permission d'extension (règle 6).

import { PAGE_TAG, type PageEnvelope } from '@/lib/bridge-messages';
import { createLogger } from '@/lib/log';

const log = createLogger('prise');
const PREVIEW_WIDTH = 1920;
const PREVIEW_HEIGHT = 540;

export interface RecordingSources {
  avatarVideo: MediaStreamTrack;
  avatarVoice: MediaStreamTrack;
  recruiterCanvas: HTMLCanvasElement;
  /** Voix du recruteur : nœud dont la sortie est la voix seule. */
  recruiterVoice: AudioNode;
  context: AudioContext;
  avatarElement: HTMLVideoElement;
  recruiterName: string;
  /** Nom de l'avatar dans les sous-titres (avatarName, sinon « AI avatar »). */
  avatarName: string;
}

interface Cue {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/** Sous-titres : temps relatifs au début de la prise, au format SRT. */
function toSrt(cues: Cue[], startedAt: number): string {
  const stamp = (at: number) => {
    const ms = Math.max(0, Math.round(at - startedAt));
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return [...cues]
    .sort((a, b) => a.start - b.start)
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.speaker}: ${cue.text}\n`)
    .join('\n');
}

const pickType = (candidates: string[]) => candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';

/** Dossier choisi par l'utilisateur pour les prises (sélecteur de dossier), gardé pour la session. */
let folder: FileSystemDirectoryHandle | null = null;

export async function chooseFolder(): Promise<string> {
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return 'sélecteur de dossier indisponible : les prises iront dans les téléchargements';
  folder = await picker({ id: 'otherself-prises', mode: 'readwrite' });
  return `dossier des prises : ${folder.name}`;
}

async function save(name: string, blob: Blob): Promise<string> {
  if (folder) {
    const file = await folder.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return `${folder.name}/${name}`;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `téléchargements/${name}`;
}

export class Recording {
  private readonly recorders: { name: string; recorder: MediaRecorder; chunks: Blob[] }[] = [];
  private readonly cues: Cue[] = [];
  /** Textes de l'avatar reçus (speak), en attente de leur heure de lecture (playback-chunk), dans l'ordre. */
  private readonly pendingTexts: string[] = [];
  private startedAt = 0;
  private composing = 0;
  private readonly onMessage = (event: MessageEvent) => this.listen(event);
  private readonly preview = document.createElement('canvas');
  private floor: ConstantSourceNode | null = null;

  constructor(
    private readonly sources: RecordingSources,
    private readonly prefix: string,
    private readonly info: Record<string, unknown>,
  ) {}

  /** Toutes les pistes démarrent dans le même tour de boucle : même instant zéro pour la prise et les sous-titres. */
  start() {
    const { avatarVideo, avatarVoice, recruiterCanvas, recruiterVoice, context } = this.sources;
    const video = pickType(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
    const audio = pickType(['audio/webm;codecs=opus', 'audio/webm']);
    const both = pickType(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    // Voix séparées, et mélange des deux pour l'aperçu (jamais vers les haut-parleurs). Chaque sortie reçoit un fond
    // continu quasi nul (−120 dB) : sans lui, Chrome n'écrit rien pendant les silences d'une piste audio seule, et la
    // voix se décalait par rapport aux vidéos (mesuré : voix de l'avatar commençant à sa première parole, 15 s trop tôt).
    const floor = context.createConstantSource();
    floor.offset.value = 1e-6;
    floor.start();
    this.floor = floor;
    const avatarIn = context.createMediaStreamSource(new MediaStream([avatarVoice]));
    const output = (...inputs: AudioNode[]) => {
      const destination = context.createMediaStreamDestination();
      for (const input of [...inputs, floor]) input.connect(destination);
      return destination.stream;
    };
    const avatarOut = output(avatarIn);
    const recruiterOut = output(recruiterVoice);
    const mix = output(recruiterVoice, avatarIn);
    // Aperçu composé : recruteur à gauche, avatar à droite.
    this.preview.width = PREVIEW_WIDTH;
    this.preview.height = PREVIEW_HEIGHT;
    const draw = () => {
      const ctx = this.preview.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      ctx.drawImage(recruiterCanvas, 0, 0, PREVIEW_WIDTH / 2, PREVIEW_HEIGHT);
      ctx.drawImage(this.sources.avatarElement, PREVIEW_WIDTH / 2, 0, PREVIEW_WIDTH / 2, PREVIEW_HEIGHT);
      this.composing = requestAnimationFrame(draw);
    };
    draw();
    const tracks: [string, MediaStream, string, number][] = [
      ['avatar', new MediaStream([avatarVideo]), video, 8_000_000],
      ['recruteur', recruiterCanvas.captureStream(30), video, 4_000_000],
      ['voix-avatar', avatarOut, audio, 0],
      ['voix-recruteur', recruiterOut, audio, 0],
      ['apercu', new MediaStream([...this.preview.captureStream(30).getVideoTracks(), ...mix.getAudioTracks()]), both, 6_000_000],
    ];
    for (const [name, stream, mimeType, bits] of tracks) {
      const recorder = new MediaRecorder(stream, { mimeType, ...(bits ? { videoBitsPerSecond: bits } : {}), audioBitsPerSecond: 128_000 });
      const entry = { name, recorder, chunks: [] as Blob[] };
      recorder.addEventListener('dataavailable', (event) => event.data.size && entry.chunks.push(event.data));
      this.recorders.push(entry);
    }
    window.addEventListener('message', this.onMessage);
    this.startedAt = Date.now();
    for (const { recorder } of this.recorders) recorder.start(1000);
    log(`prise démarrée : ${this.recorders.map((entry) => entry.name).join(', ')} (${video}, ${audio})`);
  }

  /** Réplique du recruteur jouée (heures réelles). */
  recruiterLine(text: string, start: number, end: number) {
    this.cues.push({ speaker: this.sources.recruiterName, start, end, text });
  }

  /** Voix de l'avatar : texte (speak, vers la page) puis heures de lecture (playback-chunk, vers l'extension). */
  private listen(event: MessageEvent) {
    if (event.source !== window) return;
    const envelope = event.data as Partial<PageEnvelope> | null;
    const message = envelope?.message;
    if (!message) return;
    if (envelope[PAGE_TAG] === 'to-page' && message.type === 'speak') this.pendingTexts.push(message.text ?? '');
    else if (envelope[PAGE_TAG] === 'to-page' && message.type === 'stop') {
      // Voix coupée : le sous-titre en cours s'arrête maintenant, les textes en attente ne seront pas dits.
      const now = Date.now();
      for (const cue of this.cues) if (cue.speaker === this.sources.avatarName && cue.end > now) cue.end = now;
      this.pendingTexts.length = 0;
    } else if (envelope[PAGE_TAG] === 'to-ext' && message.type === 'playback-chunk') {
      const text = this.pendingTexts.shift();
      if (text) this.cues.push({ speaker: this.sources.avatarName, start: message.startAt, end: message.endAt, text });
    }
  }

  /** Arrête toutes les pistes et range les fichiers ; renvoie leurs emplacements. */
  async stop(): Promise<string[]> {
    window.removeEventListener('message', this.onMessage);
    cancelAnimationFrame(this.composing);
    this.floor?.stop();
    const durationMs = Date.now() - this.startedAt;
    const blobs = await Promise.all(
      this.recorders.map(
        ({ name, recorder, chunks }) =>
          new Promise<[string, Blob]>((resolve) => {
            recorder.addEventListener('stop', () => resolve([name, new Blob(chunks, { type: recorder.mimeType })]), { once: true });
            recorder.stop();
          }),
      ),
    );
    const saved: string[] = [];
    for (const [name, blob] of blobs) saved.push(await save(`${this.prefix}-${name}.webm`, blob));
    saved.push(await save(`${this.prefix}.srt`, new Blob([toSrt(this.cues, this.startedAt)], { type: 'application/x-subrip' })));
    const info = { ...this.info, startedAt: new Date(this.startedAt).toISOString(), durationMs, cues: this.cues.length, files: blobs.map(([name, blob]) => ({ name, bytes: blob.size, type: blob.type })) };
    saved.push(await save(`${this.prefix}-infos.json`, new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' })));
    log(`prise enregistrée (${(durationMs / 1000).toFixed(1)} s, ${this.cues.length} sous-titres) : ${saved.join(', ')}`);
    return saved;
  }
}
