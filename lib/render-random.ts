// Hasard et horloge du rendu de l'avatar, reproductibles : clignements, saccades, côté du regard en réflexion. En
// direct, la graine est tirée au hasard et l'horloge est performance.now() : comportement inchangé (mêmes lois). Le
// rendu après coup d'une prise (page render.html) reprend la graine notée dans le journal et remplace l'horloge par
// un temps virtuel : mêmes tirages, aux mêmes instants. Un flux pseudo-aléatoire séparé par usage : l'ordre dans
// lequel les usages tirent (qui peut varier d'une image à l'autre) ne décale pas les autres.
// Sans API d'extension : monde MAIN et pages.

let seed = (Math.random() * 2 ** 32) >>> 0;
const streams = new Map<string, () => number>();

/** Horloge du rendu (ms) : performance.now() en direct, temps virtuel dans le rendu après coup. */
export const renderClock = { now: (): number => performance.now() };

export function renderSeed(): number {
  return seed;
}

/** Nouvelle graine : tous les flux repartent de zéro. */
export function setRenderSeed(value: number) {
  seed = value >>> 0;
  streams.clear();
}

/** Mulberry32 : générateur simple et rapide, assez bon pour des clignements. */
function mulberry32(start: number): () => number {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Nombre dans [0, 1) du flux `stream` (un flux par usage). */
export function renderRandom(stream: string): number {
  let next = streams.get(stream);
  if (!next) {
    next = mulberry32(seed ^ hash(stream));
    streams.set(stream, next);
  }
  return next();
}

export const renderBetween = (stream: string, min: number, max: number) => min + renderRandom(stream) * (max - min);

/** Événements du rendu (création, clignements, saccades…) pour le journal d'une prise ; aucun écouteur en temps normal. */
export type RenderEventListener = (kind: string, at: number, detail?: Record<string, number | string>) => void;
let listener: RenderEventListener | null = null;

export function onRenderEvent(callback: RenderEventListener | null) {
  listener = callback;
}

export function renderEvent(kind: string, at: number, detail?: Record<string, number | string>) {
  listener?.(kind, at, detail);
}
