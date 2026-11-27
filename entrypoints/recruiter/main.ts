// Recruteur IA fictif (démo publique, sans plateforme réelle) : personnage inventé, Maren (recruteur/entretien.json), visuel
// abstrait sans visage, voix Piper différente de celle de l'avatar. Le recruteur annonce lui-même être une IA.
//
// La page sert de plateforme : l'avatar y est injecté par le même code que sur Meet (entrypoints/content.ts et
// bridge.content.ts, appelés ici au lieu d'être injectés par le popup, impossible sur une page d'extension ; préparation
// et pipeline : lib/activation.ts). Le recruteur joue ses répliques dans le son de l'onglet, que l'avatar entend par le
// vrai partage de l'onglet (bouton OtherSelf) ; il écoute l'avatar sur la piste du micro injecté, comme une plateforme,
// et enchaîne après un silence réglable (impatient : 700 ms ; patient : 2,5 s).
//
// Répliques fixes : synthétisées une seule fois, gardées dans le Cache Storage de l'extension (prises identiques, et
// jamais deux voix Piper en même temps pendant l'entretien : la voix du recruteur est libérée avant l'activation).

import bridgeScript from '@/entrypoints/bridge.content';
import contentScript from '@/entrypoints/content';
import { ensureOffscreen, loadSources } from '@/lib/activation';
import type { AvatarState } from '@/lib/avatar-states';
import { PAGE_TAG, type PageEnvelope } from '@/lib/bridge-messages';
import { createLogger } from '@/lib/log';
import { PiperVoice } from '@/lib/tts';
import { loadDemoConfig } from '@/lib/config';
import { configureOnnxRuntime } from '@/lib/vad';
import { chooseFolder, Recording } from './recording';
import { drawRecruiterFrame } from './visual';
import { onRenderEvent } from '@/lib/render-random';
import type { RenderJournalEvent } from './recording';
import script from '@/recruteur/entretien.json';

const log = createLogger('recruteur');

type TurnKind = 'intro' | 'question' | 'fin';
interface Turn {
  kind: TurnKind;
  text: string;
}
// ?tours=n : entretien court (n − 1 premières répliques, puis la clôture), pour les essais.
const ALL_TURNS = script.turns as Turn[];
const shortened = Number(new URLSearchParams(location.search).get('tours'));
const TURNS = shortened >= 2 && shortened < ALL_TURNS.length ? [...ALL_TURNS.slice(0, shortened - 1), ALL_TURNS[ALL_TURNS.length - 1]!] : ALL_TURNS;
const PATIENCE_MS = { impatient: 700, patient: 2500 } as const;
type Patience = keyof typeof PATIENCE_MS;
/** Attente maximale du début de la réponse (la première comprend la révélation et la déclaration). */
const START_TIMEOUT_MS = 30_000;
/** Niveau RMS au-dessus duquel l'avatar parle (voix normalisée à −18 dBFS ≈ 0,126). */
const VOICE_RMS = 0.01;
const POLL_MS = 20;
const CACHE_NAME = 'otherself-recruteur';

// Textes de la page : public/_locales (langue du navigateur).
type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];
const t = (key: MessageKey, ...substitutions: (string | number)[]) => browser.i18n.getMessage(key, substitutions.map(String));
document.documentElement.lang = browser.i18n.getUILanguage();
document.title = t('recruiterTitle');
for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.dataset.i18n as MessageKey);
const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#recruiter')!;
const video = document.querySelector<HTMLVideoElement>('#candidate')!;
const tbody = document.querySelector<HTMLTableSectionElement>('#turns')!;
const buttons = {
  prepare: document.querySelector<HTMLButtonElement>('#prepare')!,
  activate: document.querySelector<HTMLButtonElement>('#activate')!,
  start: document.querySelector<HTMLButtonElement>('#start')!,
  stop: document.querySelector<HTMLButtonElement>('#stop')!,
};
const patienceSelect = document.querySelector<HTMLSelectElement>('#patience')!;
document.querySelector('#recruiter-name')!.textContent = `${script.name} · AI Recruiter`;

const status = (message: string) => {
  statusEl.textContent = message;
  log(message);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Résultat d'un tour, pour la page et pour le banc (window.__recruiter). */
interface TurnResult {
  index: number;
  kind: TurnKind;
  text: string;
  /** Fin de la réplique du recruteur → début de la voix de l'avatar (ms) ; null : pas de réponse. */
  answerDelayMs: number | null;
  voiceMs: number;
  /** Plus long silence entendu au milieu de la réponse (entre deux passages de voix), comme le perçoit la plateforme. */
  longestSilenceMs: number;
  /** L'avatar n'avait pas fini quand le recruteur a enchaîné (état réflexion ou parole). */
  cutOff: boolean;
  stateAtNext: AvatarState | null;
}

declare global {
  interface Window {
    __recruiter?: {
      prepare(): Promise<string>;
      activate(): Promise<string>;
      start(patience: Patience, options?: { record?: boolean }): Promise<TurnResult[]>;
      /** Fichiers de la dernière prise (emplacements). */
      saved: string[];
      shareButtonRect(): DOMRect | null;
      sharing(): boolean;
      results: TurnResult[];
      done: boolean;
    };
  }
}

// ——— Son du recruteur : joué dans l'onglet (donc dans le partage), analysé pour le visuel ———

let context: AudioContext | null = null;
let recruiterAnalyser: AnalyserNode | null = null;
let recruiterOut: GainNode | null = null;
const lines: AudioBuffer[] = [];

function audioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
    recruiterOut = context.createGain();
    recruiterAnalyser = context.createAnalyser();
    recruiterAnalyser.fftSize = 1024;
    recruiterOut.connect(context.destination);
    recruiterOut.connect(recruiterAnalyser);
  }
  if (context.state !== 'running') void context.resume();
  return context;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Répliques en cache, ou synthétisées une fois (voix du script, réglages du modèle) puis mises en cache. */
async function prepare(): Promise<string> {
  const started = performance.now();
  const ctx = audioContext();
  const cache = await caches.open(CACHE_NAME);
  let voice: PiperVoice | null = null;
  let synthesized = 0;
  lines.length = 0;
  try {
    for (const [index, turn] of TURNS.entries()) {
      const key = `https://otherself.invalid/recruteur/${script.voice}/${await sha256(turn.text)}`;
      let response = await cache.match(key);
      if (!response) {
        status(t('recruiterStatusSynth', index + 1, TURNS.length, script.voice));
        if (!voice) {
          configureOnnxRuntime();
          // Réglages propres au modèle (pas ceux retenus pour la voix de l'avatar).
          voice = await PiperVoice.load(script.voice, {});
        }
        const audio = await voice.synthesize(turn.text);
        await cache.put(key, new Response(audio.samples.slice().buffer, { headers: { 'x-sample-rate': String(audio.sampleRate) } }));
        synthesized += 1;
        response = await cache.match(key);
      }
      const sampleRate = Number(response!.headers.get('x-sample-rate'));
      const samples = new Float32Array(await response!.arrayBuffer());
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      lines.push(buffer);
    }
  } finally {
    // Une seule voix Piper à la fois : celle du recruteur est libérée avant l'entretien.
    voice?.dispose();
  }
  const total = lines.reduce((sum, buffer) => sum + buffer.duration, 0);
  return t('recruiterStatusPrepared', lines.length, synthesized, lines.length - synthesized, total.toFixed(1), Math.round(performance.now() - started));
}

let currentLine: AudioBufferSourceNode | null = null;
/** Pistes de l'avatar reçues par la page (getUserMedia), pour l'enregistrement. */
let avatarTracks: { video: MediaStreamTrack; voice: MediaStreamTrack } | null = null;
let recruiterSpeaking = false;

/** Joue une réplique ; résout à sa fin (Date.now de début et de fin). */
function speak(index: number): Promise<{ startedAt: number; endedAt: number }> {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = lines[index]!;
  source.connect(recruiterOut!);
  currentLine = source;
  recruiterSpeaking = true;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    source.addEventListener('ended', () => {
      recruiterSpeaking = false;
      currentLine = null;
      resolve({ startedAt, endedAt: Date.now() });
    });
    source.start();
  });
}

// ——— Visuel abstrait : onde du recruteur, sans visage (visual.ts, partagé avec le rendu après coup) ———

const recruiterBins = new Uint8Array(512);
function drawRecruiter(now: number) {
  recruiterAnalyser?.getByteFrequencyData(recruiterBins);
  drawRecruiterFrame(canvas.getContext('2d')!, recruiterBins, recruiterSpeaking, now);
}
// Minuterie régulière plutôt que requestAnimationFrame, que Chromium ralentit sous charge (mesuré : vidéo du recruteur
// enregistrée à 11,6 images/s, trous jusqu'à 1,5 s) ; 30 images/s comme la caméra de l'avatar.
setInterval(() => drawRecruiter(performance.now()), 1000 / 30);

// ——— L'avatar : injecté dans cette page, écouté sur la piste du micro injecté ———

let avatarAnalyser: AnalyserNode | null = null;
/**
 * Journal du rendu de l'avatar, dès sa création (graine, états, hochements, clignements, saccades, pause) : le rendu
 * après coup d'une prise refait les mêmes images (entrypoints/render). L'avatar est injecté dans cette page, même module.
 */
const renderEvents: RenderJournalEvent[] = [];
onRenderEvent((kind, at, detail) => renderEvents.push({ kind, at, ...detail }));
let avatarState: AvatarState = 'inactif';
/** Pipeline de l'avatar préchauffé (ouverture, rappel, phrases d'attente synthétisés) : signal 'warm' de l'offscreen. */
let pipelineWarm = false;
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const envelope = event.data as Partial<PageEnvelope> | null;
  if (envelope?.[PAGE_TAG] !== 'to-page') return;
  if (envelope.message?.type === 'state') avatarState = envelope.message.state;
  if (envelope.message?.type === 'warm' && !pipelineWarm) {
    pipelineWarm = true;
    log('avatar préchauffé (ouverture, rappel et phrases d’attente synthétisés)');
  }
});
/** Délai après le préchauffage avant de démarrer : processeur revenu au calme (logs : temps de dessin). */
const SETTLE_AFTER_WARM_MS = 3000;

async function activate(): Promise<string> {
  const started = performance.now();
  const sources = await loadSources();
  const pipeline = await ensureOffscreen();
  // Même code que l'injection sur une plateforme (popup → content.js, monde MAIN, puis bridge.js).
  (contentScript.main as () => void)();
  const installed = await window.__otherSelf!.install(sources);
  (bridgeScript.main as () => void)();
  // La page demande caméra et micro, comme une plateforme : elle reçoit l'avatar et sa voix.
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
  video.srcObject = new MediaStream(stream.getVideoTracks());
  const [voiceTrack] = stream.getAudioTracks();
  const [videoTrack] = stream.getVideoTracks();
  if (!voiceTrack || !videoTrack) throw new Error('caméra ou micro injectés absents');
  avatarTracks = { video: videoTrack, voice: voiceTrack };
  // Écoute seulement (jamais vers les haut-parleurs de l'onglet : la voix de l'avatar reviendrait dans le partage).
  const ctx = audioContext();
  avatarAnalyser = ctx.createAnalyser();
  avatarAnalyser.fftSize = 512;
  ctx.createMediaStreamSource(new MediaStream([voiceTrack])).connect(avatarAnalyser);
  return t('recruiterStatusActivated', installed, pipeline, stream.getVideoTracks()[0]?.label ?? '', Math.round(performance.now() - started));
}

function avatarLevel(): number {
  if (!avatarAnalyser) return 0;
  const buffer = new Float32Array(avatarAnalyser.fftSize);
  avatarAnalyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const value of buffer) sum += value * value;
  return Math.sqrt(sum / buffer.length);
}

let stopped = false;

/** Écoute la réponse : attend le début de la voix, puis un silence de `patienceMs`. */
async function listen(patienceMs: number, lineEndedAt: number) {
  let firstVoiceAt: number | null = null;
  let lastVoiceAt = 0;
  let voiceMs = 0;
  let longestSilenceMs = 0;
  for (;;) {
    if (stopped) break;
    await sleep(POLL_MS);
    const now = Date.now();
    if (avatarLevel() > VOICE_RMS) {
      if (firstVoiceAt === null) firstVoiceAt = now;
      else longestSilenceMs = Math.max(longestSilenceMs, now - lastVoiceAt - POLL_MS);
      lastVoiceAt = now;
      voiceMs += POLL_MS;
      continue;
    }
    if (firstVoiceAt === null) {
      if (now - lineEndedAt > START_TIMEOUT_MS) break;
      continue;
    }
    if (now - lastVoiceAt >= patienceMs) break;
  }
  return { answerDelayMs: firstVoiceAt === null ? null : firstVoiceAt - lineEndedAt, voiceMs, longestSilenceMs: Math.max(0, longestSilenceMs) };
}

const results: TurnResult[] = [];

function addRow(result: TurnResult) {
  const row = tbody.insertRow();
  if (result.cutOff) row.className = 'late';
  const cells = [
    String(result.index + 1),
    result.text,
    result.answerDelayMs === null ? t('recruiterNoAnswer') : `${(result.answerDelayMs / 1000).toFixed(1)} s`,
    `${(result.voiceMs / 1000).toFixed(1)} s`,
    `${Math.round(result.longestSilenceMs)} ms`,
    result.cutOff ? t('recruiterCutOff', result.stateAtNext ?? '') : t('recruiterAnswerFinished'),
  ];
  for (const [index, text] of cells.entries()) {
    const cell = row.insertCell();
    cell.textContent = text;
    if (index >= 2 && index <= 4) cell.className = 'num';
  }
}

async function start(patience: Patience, options: { record?: boolean } = {}): Promise<TurnResult[]> {
  stopped = false;
  results.length = 0;
  tbody.textContent = '';
  window.__recruiter!.done = false;
  window.__recruiter!.saved = [];
  const patienceMs = PATIENCE_MS[patience];
  // Prise : toutes les pistes démarrent avant la première réplique, dans le même instant.
  let recording: Recording | null = null;
  if (options.record && avatarTracks) {
    const config = await loadDemoConfig();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    recording = new Recording(
      {
        avatarVoice: avatarTracks.voice,
        recruiterVoice: recruiterOut!,
        context: audioContext(),
        renderEvents,
        recruiterName: script.name,
        avatarName: config.avatarName || 'AI avatar',
      },
      `prise-${stamp}`,
      { patience, patienceMs, recruiter: script.name, role: script.role, voice: script.voice, avatarName: config.avatarName, llmModel: config.llmModel },
    );
    recording.start();
  }
  log(`entretien démarré : recruteur ${patience} (${patienceMs} ms de silence avant d'enchaîner), ${TURNS.length} répliques`);
  for (const [index, turn] of TURNS.entries()) {
    if (stopped) break;
    status(t('recruiterStatusLine', index + 1, TURNS.length));
    const { startedAt, endedAt } = await speak(index);
    recording?.recruiterLine(turn.text, startedAt, endedAt);
    log(`réplique ${index + 1} dite : « ${turn.text} »`);
    const heard = await listen(patienceMs, endedAt);
    const stateAtNext = avatarState;
    // L'avatar prépare encore (réflexion) ou parle : le recruteur enchaîne sur une réponse inachevée.
    const cutOff = heard.answerDelayMs !== null && (stateAtNext === 'reflexion' || stateAtNext === 'parole');
    const result: TurnResult = { index, kind: turn.kind, text: turn.text, ...heard, cutOff, stateAtNext };
    results.push(result);
    addRow(result);
    if (heard.answerDelayMs === null) log(`réplique ${index + 1} : pas de réponse de l'avatar en ${START_TIMEOUT_MS / 1000} s`);
    else
      log(
        `réplique ${index + 1} : réponse après ${heard.answerDelayMs} ms, ${(heard.voiceMs / 1000).toFixed(1)} s de voix, ` +
          `plus long silence entendu ${heard.longestSilenceMs} ms` +
          (cutOff ? ` ; ENCHAÎNE ALORS QUE L'AVATAR N'AVAIT PAS FINI (état ${stateAtNext}, ${patienceMs} ms de silence)` : ''),
      );
  }
  // Laisse la dernière réponse finir et ses mesures arriver (logs [tts] de l'offscreen) avant de conclure.
  await sleep(4000);
  if (recording) window.__recruiter!.saved = await recording.stop();
  const cut = results.filter((result) => result.cutOff).length;
  const longest = Math.max(0, ...results.map((result) => result.longestSilenceMs));
  status(t('recruiterStatusDone', results.length, cut, longest));
  window.__recruiter!.done = true;
  return results;
}

// ——— Commandes ———

const run = (button: HTMLButtonElement, action: () => Promise<string | void>, after: () => void) => {
  button.addEventListener('click', () => {
    button.disabled = true;
    action().then(
      (message) => {
        if (message) status(message);
        after();
      },
      (error: unknown) => {
        status(t('recruiterStatusError', error instanceof Error ? error.message : String(error)));
        button.disabled = false;
      },
    );
  });
};
run(buttons.prepare, prepare, () => (buttons.activate.disabled = false));
run(buttons.activate, activate, () => (buttons.start.disabled = false));
run(
  buttons.start,
  async () => {
    buttons.stop.disabled = false;
    await start(patienceSelect.value as Patience, { record: document.querySelector<HTMLInputElement>('#record')!.checked });
  },
  () => {
    buttons.start.disabled = false;
    buttons.stop.disabled = true;
  },
);
buttons.stop.addEventListener('click', () => {
  stopped = true;
  currentLine?.stop();
  status(t('recruiterStatusStopped'));
});

window.__recruiter = {
  prepare,
  activate,
  start,
  // Banc : le bouton OtherSelf est dans un shadow DOM fermé ; on clique à ses coordonnées (vrai geste).
  shareButtonRect: () => {
    const host = [...document.documentElement.children].find((element) => element instanceof HTMLDivElement && element.shadowRoot === null && element.style.position === 'fixed' && element.style.bottom === '64px');
    return host ? host.getBoundingClientRect() : null;
  },
  sharing: () => window.__otherSelf?.sharing?.() ?? false,
  results,
  saved: [],
  done: false,
};
document.querySelector('#folder')!.addEventListener('click', () => {
  chooseFolder().then(status, (error: unknown) => status(t('recruiterStatusNoFolder', error instanceof Error ? error.message : String(error))));
});
status(t('recruiterStatusReady'));
