// Plusieurs voix de synthèse identiques en parallèle (workers Piper), et modèle de leur vitesse. Mesuré
// (lib/silences.ts) : avec une seule voix, un morceau n'est synthétisé qu'après le précédent, et sa seule marge est la
// durée du précédent ; après un morceau court, une phrase longue arrive en retard et laisse un trou. Avec deux voix, un
// morceau commence dès que son texte est écrit. Deux voix seulement si la machine a au moins 4 fils d'exécution : sinon
// elles se partageraient le même cœur (l'attente avant de jouer, lib/speech-queue.ts, couvre ce cas).
// Le modèle de vitesse (durée de la voix par mot, temps de synthèse par seconde de voix) est appris sur chaque synthèse,
// ouverture comprise ; il sert à prévoir quand un morceau sera prêt.

import type { SpeechAudio, TtsEngine } from './tts';

/** Fils d'exécution à partir desquels deux synthèses tournent en parallèle. */
export const PARALLEL_MIN_THREADS = 4;
/** Lissage du modèle (part de la nouvelle mesure). */
const EWMA = 0.3;
/** Prévision prudente : temps de synthèse majoré (1,15 laissait encore un trou de 745 ms sur le vrai pipeline). */
const SYNTH_BIAS = 1.3;

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Vitesse de la voix : durée par mot et temps de synthèse par milliseconde de voix, appris au fil des synthèses. */
export class SynthesisModel {
  /** Valeurs de départ prudentes, remplacées dès la première synthèse (l'ouverture, au démarrage). */
  msPerWord = 380;
  ratio = 0.5;
  samples = 0;

  update(words: number, synthMs: number, audioMs: number) {
    if (audioMs <= 0) return;
    const first = this.samples === 0;
    this.samples += 1;
    const ratio = synthMs / audioMs;
    this.ratio = first ? ratio : this.ratio + EWMA * (ratio - this.ratio);
    if (words > 0) {
      const perWord = audioMs / words;
      this.msPerWord = first ? perWord : this.msPerWord + EWMA * (perWord - this.msPerWord);
    }
  }

  /** Durée de voix et temps de synthèse prévus pour un texte de `words` mots. */
  predict(words: number): { audioMs: number; synthMs: number } {
    const audioMs = Math.max(1, words) * this.msPerWord;
    return { audioMs, synthMs: audioMs * this.ratio * SYNTH_BIAS };
  }
}

/** Synthèse en cours, pour prévoir quand une voix se libère. */
export interface RunningSynthesis {
  startedAt: number;
  words: number;
}

interface Waiting {
  text: string;
  signal?: AbortSignal | undefined;
  onStart?: ((at: number) => void) | undefined;
  resolve(audio: SpeechAudio): void;
  reject(error: Error): void;
}

/** Voix en parallèle : une synthèse par voix libre, les autres attendent dans l'ordre d'arrivée. */
export class VoicePool implements TtsEngine {
  readonly model = new SynthesisModel();
  private readonly free: TtsEngine[];
  private readonly waiting: Waiting[] = [];
  private readonly running = new Set<RunningSynthesis>();

  constructor(
    private readonly voices: TtsEngine[],
    /** Threads de calcul par voix (description seulement). */
    private readonly threads?: number,
  ) {
    if (voices.length === 0) throw new Error('aucune voix');
    this.free = [...voices];
  }

  get concurrency(): number {
    return this.voices.length;
  }

  get description(): string {
    const threads = this.threads ? ` × ${this.threads} thread(s)` : '';
    return `${this.voices[0]!.description}, ${this.voices.length} synthèse(s) en parallèle${threads}`;
  }

  /** Synthèses en cours (début et longueur), pour la prévision. */
  get inProgress(): RunningSynthesis[] {
    return [...this.running];
  }

  synthesize(text: string, signal?: AbortSignal, onStart?: (at: number) => void): Promise<SpeechAudio> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ text, signal, onStart, resolve, reject });
      this.next();
    });
  }

  async stream(text: string, onAudio: (audio: SpeechAudio) => void, signal?: AbortSignal): Promise<void> {
    onAudio(await this.synthesize(text, signal));
  }

  private next() {
    while (this.free.length > 0 && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      // Réponse abandonnée (interruption) avant son tour : pas de synthèse inutile.
      if (job.signal?.aborted) {
        job.reject(new Error('synthèse abandonnée'));
        continue;
      }
      const voice = this.free.shift()!;
      const startedAt = Date.now();
      const running: RunningSynthesis = { startedAt, words: wordCount(job.text) };
      this.running.add(running);
      job.onStart?.(startedAt);
      voice.synthesize(job.text).then(
        (audio) => {
          this.model.update(running.words, Date.now() - startedAt, (audio.samples.length / audio.sampleRate) * 1000);
          job.resolve(audio);
        },
        (error: unknown) => job.reject(error instanceof Error ? error : new Error(String(error))),
      ).finally(() => {
        this.running.delete(running);
        this.free.push(voice);
        this.next();
      });
    }
  }
}
