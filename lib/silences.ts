// Silences dans la voix de l'avatar : un recruteur automatisé prend un silence trop long au milieu d'une réponse pour
// la fin de celle-ci (InterviewCoach : « sentence fragmentation and transcription cut-offs »). Pour chaque morceau de
// voix envoyé, on garde l'heure où son texte était prêt (sorti du LLM), la synthèse, l'envoi et la lecture réelle
// dans la page ; entre deux morceaux, le silence entendu = fin silencieuse du premier + trou de lecture + début
// silencieux du second. Le trou est attribué à sa cause : attente du LLM (texte pas encore écrit), synthèse en retard
// (texte prêt, audio pas encore rendu) ou transport (audio prêt, arrivé tard dans la page). Sans trou, le silence est
// celui que contient l'audio (pause voulue entre phrases, ou après une virgule). Sans dépendance : offscreen et pages.

/** Silence d'un recruteur « impatient » (plateforme) : au-delà, il peut croire la réponse finie. */
export const IMPATIENT_SILENCE_MS = 700;
/** Trou de lecture en deçà duquel les morceaux sont considérés comme enchaînés (programmation de la page). */
const GAP_TOLERANCE_MS = 40;
/** Niveau sous lequel l'audio est un silence (RMS sur 10 ms ; voix normalisée à −18 dBFS ≈ 0,126). */
const SILENCE_RMS = 0.008;
const FRAME_MS = 10;

/** attente : phrase d'attente (lib/fillers.ts), jouée juste avant la réponse. */
export type PieceKind = 'ouverture' | 'attente' | 'réponse';

/** Un morceau de voix envoyé à la page (une phrase, ou une partie de phrase coupée à une virgule). */
export interface VoicePiece {
  kind: PieceKind;
  text: string;
  /** Texte disponible (sorti du LLM et découpé ; ouverture : préparée d'avance), Date.now. */
  textReadyAt: number;
  synthStartAt: number;
  synthEndAt: number;
  sentAt: number;
  durationMs: number;
  /** Silence au début et à la fin de l'audio, et plus long silence à l'intérieur (pause à une virgule…). */
  leadingMs: number;
  trailingMs: number;
  longestInnerMs: number;
  /** Lecture réelle dans la page (Date.now), connue quand la page l'a programmée. */
  playStartAt?: number;
  playEndAt?: number;
}

export type SilenceCause = 'pause voulue' | 'attente du LLM' | 'synthèse en retard' | 'transport';

/** Enchaînement entre deux morceaux successifs d'une même réponse. */
export interface Junction {
  before: VoicePiece;
  after: VoicePiece;
  /** Silence entendu : fin silencieuse + trou + début silencieux. */
  totalMs: number;
  gapMs: number;
  /** Silence contenu dans l'audio (fin du premier + début du second). */
  audioMs: number;
  cause: SilenceCause;
  /** Part du trou due à chaque cause. */
  llmWaitMs: number;
  synthLateMs: number;
  transportMs: number;
}

/** Silences au début, à la fin et à l'intérieur d'un audio. */
export function measureSilence(samples: Float32Array, sampleRate: number): { leadingMs: number; trailingMs: number; longestInnerMs: number } {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const silent: boolean[] = [];
  for (let start = 0; start < samples.length; start += frame) {
    let sum = 0;
    const end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i += 1) sum += samples[i]! ** 2;
    silent.push(Math.sqrt(sum / (end - start)) < SILENCE_RMS);
  }
  const frameMs = (frame / sampleRate) * 1000;
  let leading = 0;
  while (leading < silent.length && silent[leading]) leading += 1;
  if (leading === silent.length) return { leadingMs: leading * frameMs, trailingMs: 0, longestInnerMs: 0 };
  let trailing = 0;
  while (trailing < silent.length && silent[silent.length - 1 - trailing]) trailing += 1;
  let longest = 0;
  let run = 0;
  for (let i = leading; i < silent.length - trailing; i += 1) {
    run = silent[i] ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { leadingMs: leading * frameMs, trailingMs: trailing * frameMs, longestInnerMs: longest * frameMs };
}

/** Enchaînements d'une réponse, dans l'ordre (morceaux sans heure de lecture ignorés : réponse coupée). */
export function analyzePieces(pieces: VoicePiece[]): Junction[] {
  const played = pieces.filter((piece) => piece.playStartAt !== undefined && piece.playEndAt !== undefined);
  const junctions: Junction[] = [];
  for (let i = 1; i < played.length; i += 1) {
    const before = played[i - 1]!;
    const after = played[i]!;
    const end = before.playEndAt!;
    const gapMs = Math.max(0, after.playStartAt! - end);
    const audioMs = before.trailingMs + after.leadingMs;
    let llmWaitMs = 0;
    let synthLateMs = 0;
    let transportMs = 0;
    let cause: SilenceCause = 'pause voulue';
    if (gapMs > GAP_TOLERANCE_MS) {
      // Le trou se partage entre le texte pas encore écrit, puis l'audio pas encore rendu, puis l'acheminement.
      llmWaitMs = Math.min(gapMs, Math.max(0, after.textReadyAt - end));
      synthLateMs = Math.min(gapMs - llmWaitMs, Math.max(0, after.synthEndAt - Math.max(end, after.textReadyAt)));
      transportMs = Math.max(0, gapMs - llmWaitMs - synthLateMs);
      const parts: [SilenceCause, number][] = [['attente du LLM', llmWaitMs], ['synthèse en retard', synthLateMs], ['transport', transportMs]];
      cause = parts.reduce((best, part) => (part[1] > best[1] ? part : best))[0];
    }
    junctions.push({ before, after, totalMs: gapMs + audioMs, gapMs, audioMs, cause, llmWaitMs, synthLateMs, transportMs });
  }
  return junctions;
}

const ms = (value: number) => `${Math.round(value)} ms`;
const quote = (text: string) => `« ${text.length > 48 ? `${text.slice(0, 45)}…` : text} »`;
const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** Ligne de log d'une réponse : plus long silence et sa cause, silences au-delà du seuil impatient, pauses voulues. */
export function describeResponse(label: string, pieces: VoicePiece[], junctions: Junction[], interrupted: boolean): string {
  const played = pieces.filter((piece) => piece.playStartAt !== undefined);
  const voiceMs = played.reduce((sum, piece) => sum + piece.durationMs, 0);
  const head = `silences de ${label}${interrupted ? ' (interrompue)' : ''} : ${played.length} morceau(x), ${(voiceMs / 1000).toFixed(1)} s de voix`;
  if (junctions.length === 0) return `${head}, aucun enchaînement`;
  const longest = junctions.reduce((best, junction) => (junction.totalMs > best.totalMs ? junction : best));
  const detail =
    longest.cause === 'pause voulue'
      ? `pause voulue (dans l'audio : fin ${ms(longest.before.trailingMs)}, début ${ms(longest.after.leadingMs)})`
      : `${longest.cause} (trou ${ms(longest.gapMs)} : LLM ${ms(longest.llmWaitMs)}, synthèse ${ms(longest.synthLateMs)}, transport ${ms(longest.transportMs)} ; audio ${ms(longest.audioMs)})`;
  const long = junctions.filter((junction) => junction.totalMs >= IMPATIENT_SILENCE_MS);
  const wanted = junctions.filter((junction) => junction.cause === 'pause voulue').map((junction) => junction.totalMs);
  const inner = Math.max(0, ...played.map((piece) => piece.longestInnerMs));
  return (
    `${head} ; plus long ${ms(longest.totalMs)} entre ${quote(longest.before.text)} et ${quote(longest.after.text)}` +
    `${longest.before.kind !== longest.after.kind ? ' (ouverture → réponse)' : ''} : ${detail} ; ` +
    `≥ ${IMPATIENT_SILENCE_MS} ms : ${long.length} sur ${junctions.length}${long.length ? ` (${countCauses(long)})` : ''} ; ` +
    `pauses voulues médiane ${ms(median(wanted))}, max ${ms(Math.max(0, ...wanted))} ; plus long silence dans une phrase ${ms(inner)}`
  );
}

function countCauses(junctions: Junction[]): string {
  const counts = new Map<SilenceCause, number>();
  for (const junction of junctions) counts.set(junction.cause, (counts.get(junction.cause) ?? 0) + 1);
  return [...counts].map(([cause, count]) => `${cause} ${count}`).join(', ');
}

/** Résumé cumulé d'un entretien : remis à zéro au nouvel entretien. */
export class SilenceSummary {
  private responses = 0;
  private junctions: Junction[] = [];

  add(junctions: Junction[]) {
    this.responses += 1;
    this.junctions.push(...junctions);
  }

  reset() {
    this.responses = 0;
    this.junctions = [];
  }

  get all(): readonly Junction[] {
    return this.junctions;
  }

  describe(): string {
    const all = this.junctions;
    if (all.length === 0) return `silences de l'entretien : ${this.responses} réponse(s), aucun enchaînement`;
    const longest = all.reduce((best, junction) => (junction.totalMs > best.totalMs ? junction : best));
    const long = all.filter((junction) => junction.totalMs >= IMPATIENT_SILENCE_MS);
    const gaps = all.filter((junction) => junction.cause !== 'pause voulue');
    return (
      `silences de l'entretien : ${this.responses} réponse(s), ${all.length} enchaînement(s) ; plus long ${ms(longest.totalMs)} (${longest.cause}) ; ` +
      `≥ ${IMPATIENT_SILENCE_MS} ms : ${long.length}${long.length ? ` (${countCauses(long)})` : ''} ; ` +
      `trous de lecture : ${gaps.length}${gaps.length ? ` (${countCauses(gaps)}, médiane ${ms(median(gaps.map((junction) => junction.gapMs)))})` : ''} ; ` +
      `pauses voulues médiane ${ms(median(all.filter((junction) => junction.cause === 'pause voulue').map((junction) => junction.totalMs)))}`
    );
  }
}
