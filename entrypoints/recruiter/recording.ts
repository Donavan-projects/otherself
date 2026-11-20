// Enregistrement brut d'une prise sur la page recruteur IA, sans aucune vidéo encodée pendant l'entretien (le
// processeur ne fait que l'entretien) : les deux voix (pistes séparées, démarrées dans le même instant), des
// sous-titres SRT horodatés avec les deux interlocuteurs, un fichier d'informations et un journal horodaté de tout ce
// qui pilote l'image (graine du hasard du rendu, états, hochements, clignements, saccades, pause, répliques du
// recruteur, phrases d'attente, sous-titres). Les vidéos (Nova, recruteur, aperçu composé) sont rendues ensuite, hors
// temps réel, par la page render (scripts/render-prise.ts) : même code de rendu et de marqueur qu'en injection.
// Les sous-titres partent des heures réelles de lecture : répliques du recruteur jouées ici, morceaux de voix de
// l'avatar programmés par la page (playback-chunk) avec leur texte (speak).
// Rangement : dossier choisi par l'utilisateur (sélecteur de dossier du navigateur, par exemple local/prises/ du
// dépôt, ignoré par git), sinon téléchargements. Aucune permission d'extension (règle 6).

import { PAGE_TAG, type PageEnvelope } from '@/lib/bridge-messages';
import { createLogger } from '@/lib/log';

const log = createLogger('prise');

/** Événement du rendu de l'avatar (lib/render-random.ts) : heure performance.now() de la page, détails. */
export interface RenderJournalEvent {
  kind: string;
  at: number;
  [detail: string]: number | string;
}

export interface RecordingSources {
  avatarVoice: MediaStreamTrack;
  /** Voix du recruteur : nœud dont la sortie est la voix seule. */
  recruiterVoice: AudioNode;
  context: AudioContext;
  /** Événements du rendu de l'avatar depuis sa création (création et graine comprises). */
  renderEvents: RenderJournalEvent[];
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
  private readonly recruiterLines: { start: number; end: number; text: string }[] = [];
  private readonly fillers: { at: number; text: string }[] = [];
  /** Début de la prise : Date.now() et performance.now() du même instant. */
  private startedPerf = 0;
  /** Textes de l'avatar reçus (speak), en attente de leur heure de lecture (playback-chunk), dans l'ordre. */
  private readonly pendingTexts: string[] = [];
  private startedAt = 0;
  private readonly onMessage = (event: MessageEvent) => this.listen(event);
  private floor: ConstantSourceNode | null = null;

  constructor(
    private readonly sources: RecordingSources,
    private readonly prefix: string,
    private readonly info: Record<string, unknown>,
  ) {}

  /** Toutes les pistes démarrent dans le même tour de boucle : même instant zéro pour la prise et les sous-titres. */
  start() {
    const { avatarVoice, recruiterVoice, context } = this.sources;
    // Aucune vidéo encodée en direct : trois encodages, deux voix Piper et le rendu 3D saturaient le processeur
    // (mesuré le 20/11 : vidéo de l'avatar à 22,9 images/s, trous jusqu'à 1,6 s, à chaque réponse).
    const audio = pickType(['audio/webm;codecs=opus', 'audio/webm']);
    // Voix séparées (jamais vers les haut-parleurs). Chaque sortie reçoit un fond
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
    const tracks: [string, MediaStream][] = [
      ['voix-avatar', avatarOut],
      ['voix-recruteur', recruiterOut],
    ];
    for (const [name, stream] of tracks) {
      const recorder = new MediaRecorder(stream, { mimeType: audio, audioBitsPerSecond: 128_000 });
      const entry = { name, recorder, chunks: [] as Blob[] };
      recorder.addEventListener('dataavailable', (event) => event.data.size && entry.chunks.push(event.data));
      this.recorders.push(entry);
    }
    window.addEventListener('message', this.onMessage);
    this.startedAt = Date.now();
    this.startedPerf = performance.now();
    for (const { recorder } of this.recorders) recorder.start(1000);
    log(`prise démarrée : ${this.recorders.map((entry) => entry.name).join(', ')} (${audio}) et journal du rendu ; vidéos rendues après la prise`);
  }

  /** Réplique du recruteur jouée (heures réelles). */
  recruiterLine(text: string, start: number, end: number) {
    this.cues.push({ speaker: this.sources.recruiterName, start, end, text });
    this.recruiterLines.push({ start, end, text });
  }

  /** Voix de l'avatar : texte (speak, vers la page) puis heures de lecture (playback-chunk, vers l'extension). */
  private listen(event: MessageEvent) {
    if (event.source !== window) return;
    const envelope = event.data as Partial<PageEnvelope> | null;
    const message = envelope?.message;
    if (!message) return;
    if (envelope[PAGE_TAG] === 'to-page' && message.type === 'speak') {
      this.pendingTexts.push(message.filler ? `[phrase d'attente] ${message.text ?? ''}` : (message.text ?? ''));
      if (message.filler) this.fillers.push({ at: Date.now(), text: message.text ?? '' });
    }
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

  /**
   * Journal du rendu (page render, scripts/render-prise.ts) : temps en ms depuis le début de la prise, négatifs avant
   * (l'avatar est créé à l'activation : ses tirages commencent là). perfStart : performance.now() du début de la prise,
   * horloge absolue du rendu (respiration, dérive de la tête, pulsation du voyant en dépendent).
   */
  private journal(durationMs: number) {
    const fromDate = (at: number) => +(at - this.startedAt).toFixed(1);
    return {
      version: 1,
      fps: 30,
      durationMs,
      perfStart: this.startedPerf,
      startedAt: new Date(this.startedAt).toISOString(),
      avatarName: this.sources.avatarName,
      recruiterName: this.sources.recruiterName,
      renderEvents: this.sources.renderEvents.map((event) => ({ ...event, at: +(event.at - this.startedPerf).toFixed(1) })),
      recruiterLines: this.recruiterLines.map((line) => ({ ...line, start: fromDate(line.start), end: fromDate(line.end) })),
      fillers: this.fillers.map((filler) => ({ ...filler, at: fromDate(filler.at) })),
      cues: [...this.cues].sort((a, b) => a.start - b.start).map((cue) => ({ ...cue, start: fromDate(cue.start), end: fromDate(cue.end) })),
    };
  }

  /** Arrête toutes les pistes et range les fichiers ; renvoie leurs emplacements. */
  async stop(): Promise<string[]> {
    window.removeEventListener('message', this.onMessage);
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
    saved.push(await save(`${this.prefix}-journal.json`, new Blob([JSON.stringify(this.journal(durationMs))], { type: 'application/json' })));
    log(`prise enregistrée (${(durationMs / 1000).toFixed(1)} s, ${this.cues.length} sous-titres) : ${saved.join(', ')}`);
    return saved;
  }
}
