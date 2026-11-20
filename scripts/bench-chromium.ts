// Banc automatisé des pages de l'extension dans un Chromium sans interface (scripts/bench-*.ts), avec les protections
// décidées après l'incident du 19/11 (un profil réutilisé rouvrait les onglets des passages précédents : jusqu'à
// quinze pages de banc tournaient en même temps, avec leurs appels au LLM sur la clé) :
// - profil Chromium neuf à chaque passage, supprimé à la fin ;
// - arrêt si plus d'une page de banc ou d'entretien est ouverte (recruiter.html, voices.html?silences) ;
// - appels au LLM comptés sur toutes les cibles (pages, document offscreen) et plafonnés : au-delà, arrêt ;
// - charge processeur (si demandée) lancée par le banc lui-même et arrêtée avec lui.
// Utilise le build de production (.output/chrome-mv3) tel quel, clé API comprise : jamais publié, jamais commité.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { extensionId, findChromium } from './render-fallback.ts';

const PORT = 9350;
/** Pages qui font tourner un entretien ou un banc : une seule à la fois. */
const BENCH_PAGE = /\/(recruiter\.html|voices\.html\?silences)/;
/** Appels au LLM (Chat Completions) ; la transcription n'est pas comptée. */
const LLM_URL = /api\.openai\.com\/v1\/chat\/completions/;

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export interface BenchOptions {
  /** Plafond d'appels au LLM pour ce passage. */
  maxLlmCalls: number;
  /** Accélération graphique (rendu 3D de l'avatar). */
  gpu?: boolean;
  /** Dossier où Chromium dépose les téléchargements (prises). */
  downloadDir?: string;
  /** Charge : nombre de cœurs occupés à 100 % pendant le passage. */
  load?: number;
  extension?: string;
}

interface Message {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
}

export class BenchBrowser {
  llmCalls = 0;
  readonly logs: string[] = [];
  /** Raison de l'arrêt forcé (protections), sinon null. */
  failure: string | null = null;
  private next = 0;
  private readonly pending = new Map<number, (message: Message) => void>();
  private readonly attached = new Map<string, (sessionId: string) => void>();
  /** Sessions déjà rattachées (cible → session) : l'annonce peut précéder la réponse à Target.createTarget. */
  private readonly sessions = new Map<string, string>();
  private readonly benchPages = new Set<string>();
  private readonly loadWorkers: Worker[] = [];
  private onFailure: ((reason: string) => void) | null = null;
  /** Promesse rejetée dès qu'une protection arrête le passage : à mettre en course avec les attentes. */
  readonly stopped: Promise<never>;

  private readonly chrome: ChildProcess;
  private readonly ws: WebSocket;
  private readonly profile: string;
  readonly extensionId: string;
  private readonly options: BenchOptions;

  // Champs explicites : Node (types retirés, sans compilation) refuse les propriétés déclarées en paramètres.
  private constructor(chrome: ChildProcess, ws: WebSocket, profile: string, id: string, options: BenchOptions) {
    this.chrome = chrome;
    this.ws = ws;
    this.profile = profile;
    this.extensionId = id;
    this.options = options;
    this.stopped = new Promise<never>((_, reject) => (this.onFailure = (reason) => reject(new Error(reason))));
    this.stopped.catch(() => undefined);
    ws.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as Message);
  }

  static async launch(options: BenchOptions): Promise<BenchBrowser> {
    const extension = resolve(options.extension ?? '.output/chrome-mv3');
    const profile = mkdtempSync(join(tmpdir(), 'otherself-banc-'));
    const chrome = spawn(
      findChromium(),
      [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profile}`,
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        // Partage de l'onglet accepté sans fenêtre de choix (option de test de Chromium).
        '--auto-accept-this-tab-capture',
        '--window-size=1600,1000',
        ...(options.gpu === false ? [] : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl']),
        'about:blank',
      ],
      { stdio: 'ignore', detached: true },
    );
    let endpoint: string | undefined;
    for (let i = 0; i < 50 && !endpoint; i += 1) {
      await sleep(200);
      try {
        endpoint = ((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      } catch {
        // Chromium démarre encore.
      }
    }
    if (!endpoint) throw new Error('Chromium ne répond pas sur le port de débogage (un autre banc tourne-t-il déjà ?)');
    const ws = new WebSocket(endpoint);
    await new Promise((done, fail) => {
      ws.onopen = done;
      ws.onerror = fail;
    });
    const browser = new BenchBrowser(chrome, ws, profile, extensionId(extension), options);
    // Toutes les cibles (pages, document offscreen, workers) : réseau observé pour compter les appels au LLM.
    await browser.send('Target.setDiscoverTargets', { discover: true });
    await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const { targetInfos } = (await browser.send('Target.getTargets')) as { targetInfos: { url: string }[] };
    const already = targetInfos.filter((target) => BENCH_PAGE.test(target.url));
    if (already.length > 0) {
      await browser.close();
      throw new Error(`banc refusé : ${already.length} page(s) de banc déjà ouverte(s) (${already.map((target) => target.url).join(', ')})`);
    }
    if (options.downloadDir) await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(options.downloadDir), eventsEnabled: true });
    for (let i = 0; i < (options.load ?? 0); i += 1) browser.loadWorkers.push(new Worker('for (;;) {}', { eval: true }));
    if (options.load) browser.note(`[banc] charge : ${options.load} cœur(s) occupé(s) à 100 %`);
    await sleep(1500);
    return browser;
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    return new Promise((done, fail) => {
      this.next += 1;
      this.pending.set(this.next, (message) => (message.error ? fail(new Error(JSON.stringify(message.error))) : done(message.result ?? {})));
      this.ws.send(JSON.stringify({ id: this.next, method, params, sessionId }));
    });
  }

  private note(line: string) {
    this.logs.push(line);
    console.log(line);
  }

  private fail(reason: string) {
    if (this.failure) return;
    this.failure = reason;
    this.note(`[banc] ARRÊT : ${reason}`);
    this.onFailure?.(reason);
    void this.close();
  }

  private receive(message: Message) {
    if (process.env.BANC_DEBUG) console.log("RECU", message.id ?? "", message.method ?? "", message.sessionId?.slice(0, 6) ?? "", JSON.stringify(message.params ?? message.result ?? message.error ?? {}).slice(0, 140));
    if (message.id !== undefined) {
      this.pending.get(message.id)?.(message);
      this.pending.delete(message.id);
      return;
    }
    const params = message.params ?? {};
    if (message.method === 'Target.attachedToTarget') {
      const sessionId = params.sessionId as string;
      const info = params.targetInfo as { targetId: string; type: string; url: string };
      void this.send('Network.enable', {}, sessionId).catch(() => undefined);
      if (info.type === 'page' || info.type === 'other') {
        void this.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        void this.send('Log.enable', {}, sessionId).catch(() => undefined);
      }
      // Les cibles filles (workers, iframes) s'attachent aussi.
      void this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => undefined);
      void this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
      this.watchPage(info.targetId, info.url);
      this.sessions.set(info.targetId, sessionId);
      this.attached.get(info.targetId)?.(sessionId);
      return;
    }
    if (message.method === 'Target.targetInfoChanged' || message.method === 'Target.targetCreated') {
      const info = params.targetInfo as { targetId: string; url: string };
      this.watchPage(info.targetId, info.url);
      return;
    }
    if (message.method === 'Target.targetDestroyed') {
      this.benchPages.delete(params.targetId as string);
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request as { url: string; method: string };
      if (request.method === 'POST' && LLM_URL.test(request.url)) {
        this.llmCalls += 1;
        this.note(`[banc] appel au LLM n°${this.llmCalls} (plafond ${this.options.maxLlmCalls})`);
        if (this.llmCalls > this.options.maxLlmCalls) this.fail(`plafond de ${this.options.maxLlmCalls} appels au LLM dépassé`);
      }
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const args = params.args as { value?: unknown; description?: string }[];
      this.logs.push(args.map((arg) => String(arg.value ?? arg.description ?? '')).join(' '));
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      this.note(`[banc] EXCEPTION ${JSON.stringify(params.exceptionDetails).slice(0, 300)}`);
      return;
    }
    if (message.method === 'Log.entryAdded') {
      const entry = params.entry as { level: string; text: string; url?: string };
      if (entry.level === 'error') this.note(`[banc] ERREUR ${entry.text} ${entry.url ?? ''}`);
    }
  }

  /** Une seule page de banc ou d'entretien à la fois. */
  private watchPage(targetId: string, url: string) {
    if (!BENCH_PAGE.test(url) || this.benchPages.has(targetId)) return;
    this.benchPages.add(targetId);
    if (this.benchPages.size > 1) this.fail(`${this.benchPages.size} pages de banc ou d'entretien ouvertes en même temps`);
  }

  /** Ouvre une page de l'extension et renvoie sa session (journal de la console recueilli dans `logs`). */
  async openPage(path: string): Promise<string> {
    const { targetId } = (await this.send('Target.createTarget', { url: `chrome-extension://${this.extensionId}/${path}` })) as { targetId: string };
    const known = this.sessions.get(targetId);
    const sessionId = known ?? (await Promise.race([new Promise<string>((done) => this.attached.set(targetId, done)), sleep(10_000).then(() => '')]));
    if (!sessionId) throw new Error('page ouverte, mais jamais rattachée au banc');
    await sleep(1500);
    return sessionId;
  }

  async evaluate<T>(sessionId: string, expression: string, options: { await?: boolean; gesture?: boolean } = {}): Promise<T> {
    const reply = (await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: options.await ?? true, returnByValue: true, userGesture: options.gesture ?? true }, sessionId),
      this.stopped,
    ])) as { result?: { value?: T }; exceptionDetails?: unknown };
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails).slice(0, 400));
    return reply.result?.value as T;
  }

  /** Vrai clic (geste de l'utilisateur) aux coordonnées données. */
  async click(sessionId: string, x: number, y: number) {
    for (const type of ['mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
  }

  /** Attend qu'une expression soit vraie (toutes les `every` ms), dans la limite de `timeoutMs`. */
  async waitFor(sessionId: string, expression: string, timeoutMs: number, every = 1000): Promise<boolean> {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
      if (await this.evaluate<boolean>(sessionId, expression, { await: true, gesture: false })) return true;
      await Promise.race([sleep(every), this.stopped]);
    }
    return false;
  }

  async close() {
    for (const worker of this.loadWorkers) void worker.terminate();
    this.loadWorkers.length = 0;
    try {
      this.ws.close();
    } catch {
      // Déjà fermé.
    }
    if (this.chrome.exitCode === null) {
      const exited = new Promise((done) => this.chrome.once('exit', done));
      try {
        process.kill(-this.chrome.pid!, 'SIGTERM');
      } catch {
        this.chrome.kill();
      }
      await Promise.race([exited, sleep(5000)]);
    }
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {
      console.warn(`profil temporaire laissé en place : ${this.profile}`);
    }
  }
}

/** Lecture simple des options `--nom valeur` et `--drapeau`. */
export function parseArgs(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value !== undefined && !value.startsWith('--')) {
      options.set(arg.slice(2), value);
      i += 1;
    } else options.set(arg.slice(2), 'true');
  }
  return options;
}
