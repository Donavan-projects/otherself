// File des morceaux d'une réponse, entre le texte du moteur (découpé en phrases, lib/chunks.ts) et la page :
// - le premier morceau part en synthèse dès que son texte est écrit, seul ; les suivants dès qu'il est synthétisé (voix
//   en parallèle, lib/voice-pool.ts) ;
// - ses silences extrêmes sont retirés et une pause régulière ajoutée (lib/speech-pacing.ts) ;
// - les morceaux sont envoyés dans l'ordre ;
// - attente avant de jouer : avant le premier morceau de la réponse seulement, si les morceaux suivants déjà écrits
//   risquent d'arriver après la fin de la voix qui les précède (machine lente, processeur chargé), le début de la
//   lecture est retardé d'autant, d'après le modèle de vitesse appris (lib/voice-pool.ts). Un silence avant la réponse
//   est mieux toléré par un recruteur automatisé qu'un silence au milieu, qu'il prend pour la fin. Jamais au milieu
//   de la réponse : retarder un morceau quand la lecture s'est arrêtée allongerait le trou au lieu de l'éviter (mesuré).
//   Sur une machine assez rapide, la prévision ne demande jamais d'attente.
// Sans API d'extension : offscreen (lib/conversation.ts) et banc des silences (page voices).

import { paceSpeech, pauseAfter, SENTENCE_PAUSE_MS } from './speech-pacing';
import type { SpeechAudio } from './tts';
import { wordCount, type VoicePool } from './voice-pool';

/** Acheminement d'un morceau jusqu'à sa lecture dans la page (pont, avance de la page), compté dans la prévision. */
const TRANSPORT_MS = 100;
/**
 * Marge de sécurité de la prévision. 350 ms depuis le premier morceau synthétisé seul (20/11) : les suivants partent
 * plus tard, et un trou de 697 ms (synthèse 123 ms en retard, acheminement 254 ms au lieu de 100) a fait enchaîner un
 * recruteur impatient avec 200 ms.
 */
const MARGIN_MS = 350;
/** Attente plus courte ignorée ; attente maximale avant de jouer. */
const MIN_HOLD_MS = 50;
const MAX_HOLD_MS = 4000;

/** Ce que la file sait d'un morceau au moment de l'envoyer. */
export interface QueuedPiece {
  text: string;
  textReadyAt: number;
  synthStartAt: number;
  synthEndAt: number;
}

export interface SpeechQueueOptions {
  pool: VoicePool;
  signal: AbortSignal;
  /** Envoi d'un morceau déjà rythmé ; faux : envoi refusé (le recruteur parle), la file s'arrête. */
  send(audio: SpeechAudio, piece: QueuedPiece): boolean;
  /** Fin prévue (Date.now) de la voix déjà envoyée ; dans le passé : la lecture est à l'arrêt. */
  playhead(): number;
  log(line: string): void;
}

interface Job {
  text: string;
  words: number;
  readyAt: number;
  startedAt?: number;
  endedAt?: number;
  audio?: SpeechAudio;
  failed?: string;
  settled: Promise<void>;
}

const durationMs = (audio: SpeechAudio) => (audio.samples.length / audio.sampleRate) * 1000;

export class SpeechQueue {
  private readonly jobs: Job[] = [];
  private ended = false;
  private wake: (() => void) | null = null;
  /** Attentes avant de jouer décidées pendant cette réponse (ms). */
  readonly holds: number[] = [];

  constructor(private readonly options: SpeechQueueOptions) {}

  /** Morceau écrit par le moteur : sa synthèse commence tout de suite, s'il y a une voix libre. */
  push(text: string, readyAt = Date.now()) {
    const job: Job = { text, words: wordCount(text), readyAt, settled: Promise.resolve() };
    // Premier morceau prioritaire : les suivants attendent la fin de sa synthèse. En parallèle, les deux voix se
    // partagent le processeur et le premier sort ≈ 1,7 fois plus lentement (mesuré le 20/11 : 0,41 contre 0,23 × temps
    // réel), ce qui retarde le début de la réponse. Sauf morceau qui, synthétisé après le premier, ne serait pas prêt
    // avant la fin de la voix qui le précède (premier morceau court, suivant long) : il imposerait une attente avant de
    // jouer plus longue que le temps gagné (mesuré : jusqu'à 2,1 s avec une première phrase de 3 à 8 mots).
    const first = this.jobs[0];
    const turn = first && !this.needsParallel(first, job) ? first.settled : Promise.resolve();
    job.settled = turn
      .then(() => (this.options.signal.aborted ? Promise.reject(new Error('réponse interrompue')) : this.options.pool.synthesize(text, this.options.signal, (at) => (job.startedAt = at))))
      .then(
        (audio) => {
          job.endedAt = Date.now();
          job.audio = paceSpeech(audio, pauseAfter(text));
        },
        (error: unknown) => {
          job.failed = error instanceof Error ? error.message : String(error);
        },
      )
      .finally(() => this.wake?.());
    this.jobs.push(job);
    this.wake?.();
  }

  /**
   * Vrai si `job`, synthétisé seulement après le premier morceau, serait prêt trop tard : sa synthèse prévue (et la
   * marge) dépasse la voix qui le précède (premier morceau, morceaux intermédiaires et leurs pauses).
   */
  private needsParallel(first: Job, job: Job): boolean {
    if (first.audio || first.failed) return false;
    const { model } = this.options.pool;
    const covered = [first, ...this.jobs.slice(1)].reduce((sum, item) => sum + model.predict(item.words).audioMs + SENTENCE_PAUSE_MS, 0);
    return model.predict(job.words).synthMs + TRANSPORT_MS + MARGIN_MS > covered;
  }

  /** Plus de texte à venir pour cette réponse. */
  end() {
    this.ended = true;
    this.wake?.();
  }

  /** Envoie les morceaux dans l'ordre, une fois `gate` passée (l'ouverture), jusqu'à la fin ou l'interruption. */
  async play(gate: Promise<void>): Promise<void> {
    await gate;
    const { signal } = this.options;
    for (let index = 0; ; index += 1) {
      while (index >= this.jobs.length) {
        if (this.ended || signal.aborted) return;
        await new Promise<void>((resolve) => (this.wake = resolve));
        this.wake = null;
      }
      const job = this.jobs[index]!;
      await job.settled;
      if (signal.aborted) return;
      if (!job.audio) {
        this.options.log(`synthèse impossible : ${job.failed ?? 'inconnue'} (« ${job.text} »)`);
        continue;
      }
      // Premier morceau de la réponse : il commencerait dès son arrivée, ou après la voix déjà envoyée (ouverture,
      // phrase d'attente et sa pause). La suite ne doit pas s'interrompre : son début est retardé si besoin.
      const now = Date.now();
      if (index === 0) {
        const naturalStart = Math.max(now + TRANSPORT_MS, this.options.playhead());
        const hold = Math.min(MAX_HOLD_MS, this.requiredStart(index, now, durationMs(job.audio)) - naturalStart);
        if (hold >= MIN_HOLD_MS) {
          this.holds.push(hold);
          this.options.log(
            `attente de ${Math.round(hold)} ms avant de jouer « ${job.text.slice(0, 40)}${job.text.length > 40 ? '…' : ''} » : ` +
              `les morceaux suivants ne seraient pas prêts à temps (synthèse ${this.options.pool.model.ratio.toFixed(2)} × temps réel)`,
          );
          await new Promise((resolve) => setTimeout(resolve, hold));
          if (signal.aborted) return;
        }
      }
      if (!this.options.send(job.audio, { text: job.text, textReadyAt: job.readyAt, synthStartAt: job.startedAt ?? now, synthEndAt: job.endedAt ?? now })) return;
    }
  }

  /**
   * Attente nécessaire avant de jouer le morceau `index` pour que les morceaux suivants déjà écrits s'enchaînent sans
   * trou : chacun doit être prêt (prévision) avant la fin de la voix qui le précède.
   */
  /**
   * Début prévu (Date.now) de la réponse, attente avant de jouer comprise, sans la voix pas encore envoyée (phrase
   * d'attente à caler) ; null tant qu'aucun morceau n'est écrit. Sert à caler la phrase d'attente pour qu'elle finisse
   * juste avant (lib/conversation.ts).
   */
  predictedStart(now = Date.now()): number | null {
    const first = this.jobs[0];
    if (!first) return null;
    const { model } = this.options.pool;
    const predicted = model.predict(first.words);
    const ready = first.audio || first.failed ? now : Math.max(now, (first.startedAt ?? now) + predicted.synthMs);
    const audioMs = first.audio ? durationMs(first.audio) : predicted.audioMs + SENTENCE_PAUSE_MS;
    const natural = Math.max(ready + TRANSPORT_MS, this.options.playhead());
    return Math.max(natural, Math.min(natural + MAX_HOLD_MS, this.requiredStart(0, ready, audioMs)));
  }

  /** Début au plus tôt (Date.now) du morceau `index` pour que les morceaux suivants déjà écrits arrivent à temps. */
  private requiredStart(index: number, now: number, firstAudioMs: number): number {
    const { model, concurrency, inProgress } = this.options.pool;
    // Voix : libre maintenant, ou à la fin prévue de sa synthèse en cours.
    const slots = inProgress.map((running) => Math.max(now + MIN_HOLD_MS, running.startedAt + model.predict(running.words).synthMs));
    while (slots.length < concurrency) slots.push(now);
    slots.sort((a, b) => a - b);
    let covered = firstAudioMs;
    let start = now;
    for (const job of this.jobs.slice(index + 1)) {
      const predicted = model.predict(job.words);
      let ready: number;
      if (job.audio || job.failed) ready = now;
      else if (job.startedAt !== undefined) ready = Math.max(now + MIN_HOLD_MS, job.startedAt + predicted.synthMs);
      else {
        // Pas encore commencé : prendra la première voix libre.
        const slot = slots.shift() ?? now;
        ready = Math.max(now, slot) + predicted.synthMs;
        slots.push(ready);
        slots.sort((a, b) => a - b);
      }
      start = Math.max(start, ready + TRANSPORT_MS + MARGIN_MS - covered);
      covered += job.audio ? durationMs(job.audio) : predicted.audioMs + SENTENCE_PAUSE_MS;
    }
    return start;
  }
}
