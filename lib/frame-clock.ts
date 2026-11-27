// Rythme du dessin de l'avatar, qui ne doit pas être ralenti quand l'onglet de la plateforme
// passe en arrière-plan : Chrome ralentit alors les minuteurs de la page (1 par seconde, puis
// 1 par minute après 5 minutes masqué). Trois horloges, dans l'ordre :
// 1. minuteur dans un worker (URL blob) : les workers ne sont pas ralentis. Jamais tenté sur une
//    page qui impose les Trusted Types (lib/trusted-types.ts) : Chrome y logue une erreur ;
// 2. si la page refuse le worker, horloge Web Audio : une suite de courts ConstantSourceNode
//    (un tiers de période d'image chacun) enchaînés sur l'horloge audio, chaque fin (onended) donnant un
//    battement. Sans URL à charger (pas de CSP ni de Trusted Types), sans ScriptProcessorNode
//    (déprécié). Reliés à une destination MediaStream privée, jamais à ctx.destination : rien n'est
//    joué dans l'onglet ;
// 3. en dernier recours, setInterval (ralenti en arrière-plan).
// Une horloge qui ne bat pas dans la seconde est abandonnée pour la suivante. Monde MAIN.

import { audioContext } from './page-audio';

/** Délai sans battement après lequel on passe à l'horloge suivante. */
const WATCHDOG_MS = 1000;
/**
 * Horloge Web Audio : chaque source dure un tiers de période d'image (≈ 11 ms, la granularité de l'ancien
 * ScriptProcessorNode) ; des fins plus espacées arrivaient groupées en arrière-plan et la capture du canvas perdait
 * des images (26 images/s reçues au banc). Sources programmées d'avance : absorbe un retard du fil principal.
 */
const AUDIO_CLOCK_STEPS = 3;
const AUDIO_CLOCK_AHEAD = 6;

const WORKER_SOURCE = `let timer = null;
onmessage = (event) => {
  clearInterval(timer);
  if (event.data > 0) timer = setInterval(() => postMessage(0), event.data);
};`;

export type FrameClockKind = 'worker' | 'web-audio' | 'setInterval';

export interface FrameClock {
  kind(): FrameClockKind;
  stop(): void;
}

interface Ticker {
  stop(): void;
}

/**
 * Appelle onTick environ fps fois par seconde ; onChange signale l'horloge en service.
 * skipWorker : raison de ne pas tenter le worker (Trusted Types imposés), ou null.
 */
export function startFrameClock(
  fps: number,
  onTick: () => void,
  onChange: (kind: FrameClockKind, reason: string) => void,
  skipWorker: string | null = null,
): FrameClock {
  const intervalMs = 1000 / fps;
  let stopped = false;
  let current: Ticker | null = null;
  let kind: FrameClockKind = 'worker';
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let ticked = false;

  const tick = () => {
    if (stopped) return;
    ticked = true;
    onTick();
  };

  const starters: [FrameClockKind, (fail: (reason: string) => void) => Ticker][] = [
    ['worker', (fail) => workerTicker(intervalMs, tick, fail)],
    ['web-audio', () => audioTicker(intervalMs, tick)],
    ['setInterval', () => intervalTicker(intervalMs, tick)],
  ];

  const start = (index: number, reason: string) => {
    if (stopped) return;
    const entry = starters[index];
    if (!entry) return;
    const [name, create] = entry;
    let failed = false;
    /** Passe à l'horloge suivante (une seule fois par horloge). */
    const fail = (why: string) => {
      if (failed || stopped) return;
      failed = true;
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      current?.stop();
      current = null;
      start(index + 1, why);
    };
    try {
      current = create((why) => fail(`${name} : ${why}`));
    } catch (error) {
      fail(`${name} refusé (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    if (failed) return;
    kind = name;
    ticked = false;
    onChange(name, reason);
    // Dernière horloge : pas de surveillance.
    if (index === starters.length - 1) return;
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!ticked) fail(`${name} muet après ${WATCHDOG_MS} ms`);
    }, WATCHDOG_MS);
  };
  if (skipWorker) start(1, `worker non tenté : ${skipWorker}`);
  else start(0, 'démarrage');

  return {
    kind: () => kind,
    stop() {
      stopped = true;
      if (watchdog) clearTimeout(watchdog);
      current?.stop();
      current = null;
    },
  };
}

function workerTicker(intervalMs: number, tick: () => void, fail: (reason: string) => void): Ticker {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
  let worker: Worker;
  try {
    // Chrome lève une exception tout de suite si la CSP refuse le blob ; sinon, le chien de garde tranche.
    worker = new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  worker.onmessage = tick;
  // CSP de la page : Chrome ne lève pas d'exception mais signale l'échec par un événement error.
  worker.onerror = (event) => {
    event.preventDefault();
    fail(`erreur du worker (${event.message || 'refusé par la page, CSP probable'})`);
  };
  worker.postMessage(intervalMs);
  return {
    stop() {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}

function audioTicker(intervalMs: number, tick: () => void): Ticker {
  const ctx = audioContext();
  const sink = ctx.createMediaStreamDestination();
  const period = intervalMs / AUDIO_CLOCK_STEPS / 1000;
  const live = new Set<ConstantSourceNode>();
  let stopped = false;
  /** Fin de la dernière source programmée, en temps de l'horloge audio. */
  let tail = ctx.currentTime;
  let next = performance.now();
  const schedule = () => {
    const source = ctx.createConstantSource();
    source.offset.value = 0;
    source.connect(sink);
    // Les sources se suivent sans trou sur l'horloge audio ; après un long retard, on repart de maintenant.
    const start = Math.max(tail, ctx.currentTime);
    tail = start + period;
    source.onended = () => {
      live.delete(source);
      source.disconnect();
      if (stopped) return;
      schedule();
      const now = performance.now();
      if (now < next) return;
      // Rattrape sans rafale si le fil principal a pris du retard.
      next = Math.max(next + intervalMs, now - intervalMs);
      tick();
    };
    source.start(start);
    source.stop(tail);
    live.add(source);
  };
  for (let i = 0; i < AUDIO_CLOCK_AHEAD; i += 1) schedule();
  return {
    stop() {
      stopped = true;
      for (const source of live) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // déjà arrêtée
        }
        source.disconnect();
      }
      live.clear();
      for (const track of sink.stream.getTracks()) track.stop();
    },
  };
}

function intervalTicker(intervalMs: number, tick: () => void): Ticker {
  const timer = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(timer) };
}
