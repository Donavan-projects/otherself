// Génère les images de l'avatar de secours depuis le modèle 3D (sous-étape 3e). Script MANUEL :
//   npm run build && npm run vrm -- fallback
// Ouvre le build de production (.output/chrome-mv3) dans un Chromium sans interface, avec le GPU de la machine, sur la
// page fallback.html (entrypoints/fallback/), qui rend avatar/otherself.vrm et renvoie images et positions. Écrit
// avatar/secours/ (WebP + secours.json), commité ; le build le copie dans avatar-secours/.
//
// Chromium : une extension non empaquetée ne se charge plus en ligne de commande dans Chrome de marque (depuis la
// version 137). Il faut un Chromium « for Testing » ou un Chromium de distribution, désigné par OTHERSELF_CHROMIUM ;
// sinon le script essaie celui de Playwright (npx playwright install chromium), puis chromium et chromium-browser.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXTENSION = resolve('.output/chrome-mv3');
const OUTPUT = resolve('avatar/secours');
const PORT = 9341;
const TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function findChromium(): string {
  const fromEnv = process.env.OTHERSELF_CHROMIUM;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`OTHERSELF_CHROMIUM = ${fromEnv} : fichier introuvable`);
    return fromEnv;
  }
  const playwright = join(homedir(), '.cache/ms-playwright');
  if (existsSync(playwright)) {
    const builds = readdirSync(playwright).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const candidate = join(playwright, build, sub);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const name of ['chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim();
    if (found) return found;
  }
  throw new Error('aucun Chromium trouvé : npx playwright install chromium, ou OTHERSELF_CHROMIUM=/chemin/vers/chrome');
}

/** Identifiant d'une extension non empaquetée : dérivé du chemin absolu de son dossier. */
function extensionId(path: string): string {
  return [...createHash('sha256').update(path).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  close(): void;
}

async function connect(url: string, onConsole: (line: string) => void): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = fail;
  });
  let next = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: unknown; method?: string; params?: { args?: { value?: unknown }[] } };
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result ?? {});
    } else if (message.method === 'Runtime.consoleAPICalled') {
      onConsole((message.params?.args ?? []).map((arg) => String(arg.value ?? '')).join(' '));
    }
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolveCall, rejectCall) => {
        next += 1;
        pending.set(next, { resolve: resolveCall, reject: rejectCall });
        ws.send(JSON.stringify({ id: next, method, params, sessionId }));
      }),
    close: () => ws.close(),
  };
}

/** window.__fallback, déposé par entrypoints/fallback/main.ts. */
interface PageResult {
  ok: boolean;
  error?: string;
  data?: unknown;
  images?: Record<string, string>;
  timings?: Record<string, number>;
}

export async function renderFallback(): Promise<void> {
  if (!existsSync(join(EXTENSION, 'fallback.html'))) throw new Error(`${EXTENSION}/fallback.html absent : lancer d'abord npm run build`);
  const chromium = findChromium();
  const profile = mkdtempSync(join(tmpdir(), 'otherself-secours-'));
  console.log(`Chromium : ${chromium}`);
  const started = Date.now();
  let browser: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  try {
    browser = spawn(chromium, [
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--no-first-run',
      // GPU de la machine : sans accélération, le rendu 3D refuse le WebGL logiciel et la génération échoue.
      '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', 'about:blank',
    ], { stdio: 'ignore' });
    let endpoint: string | undefined;
    for (let i = 0; i < 50 && !endpoint; i += 1) {
      await sleep(200);
      try {
        endpoint = ((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      } catch {
        // Chromium démarre encore.
      }
    }
    if (!endpoint) throw new Error('Chromium ne répond pas sur le port de débogage');
    cdp = await connect(endpoint, (line) => console.log(`  ${line}`));
    await sleep(1000);
    const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId(EXTENSION)}/fallback.html` });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId as string);
    let result: PageResult | null = null;
    for (const deadline = Date.now() + TIMEOUT_MS; Date.now() < deadline && result === null; ) {
      await sleep(500);
      const reply = await cdp.send('Runtime.evaluate', { expression: 'window.__fallback', returnByValue: true }, sessionId as string);
      result = (reply.result as { value?: PageResult }).value ?? null;
    }
    if (result === null) throw new Error('génération trop longue (page fallback.html sans réponse)');
    if (!result.ok) throw new Error(result.error);

    rmSync(OUTPUT, { recursive: true, force: true });
    mkdirSync(OUTPUT, { recursive: true });
    let total = 0;
    for (const [name, url] of Object.entries(result.images ?? {})) {
      const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      writeFileSync(join(OUTPUT, name), bytes);
      total += bytes.byteLength;
    }
    writeFileSync(join(OUTPUT, 'secours.json'), `${JSON.stringify(result.data, null, 2)}\n`);
    total += statSync(join(OUTPUT, 'secours.json')).size;
    console.log(
      `secours généré dans ${OUTPUT} en ${((Date.now() - started) / 1000).toFixed(1)} s ` +
        `(page : ${JSON.stringify(result.timings)}) ; ${Object.keys(result.images ?? {}).length} images, ${(total / 1024).toFixed(0)} Ko au total`,
    );
  } finally {
    cdp?.close();
    if (browser && browser.exitCode === null) {
      const exited = new Promise((done) => browser!.once('exit', done));
      browser.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    // Profil temporaire : Chromium peut y écrire encore un instant après sa fin.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {
      console.warn(`profil temporaire laissé en place : ${profile}`);
    }
  }
}
