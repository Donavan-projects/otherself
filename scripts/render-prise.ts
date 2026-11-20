// Rendu après coup d'une prise de la page recruteur (vidéos de Nova, du recruteur et aperçu composé), à partir de son
// journal et des voix enregistrées : page render.html de l'extension construite, dans un Chromium sans interface avec
// le GPU (avatar 3D). Hors temps réel, à 30 images/s exactes. Aucun appel au LLM ni à aucune API.
//   npm run build && npm run rendu:prise -- local/prises/prise-AAAAMMJJ-HHMMSS [--remplacer] [--images 15,62]
// --images : images de contrôle de l'aperçu composé à ces secondes (PNG, -image-XXs.png, à côté de la prise).
// Vidéos écrites à côté de la prise, mêmes noms qu'avant (-avatar, -recruteur, -apercu .webm) ; --remplacer efface
// d'abord celles qui existent (sinon refus : Chromium les renommerait).

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { BenchBrowser, parseArgs, sleep } from './bench-chromium.ts';

const argv = process.argv.slice(2);
const prefix = argv.find((arg) => !arg.startsWith('--'));
const args = parseArgs(argv.filter((arg) => arg !== prefix));
if (!prefix || !existsSync(`${prefix}-journal.json`)) {
  console.error('usage : npm run rendu:prise -- local/prises/prise-AAAAMMJJ-HHMMSS [--remplacer] (journal introuvable)');
  process.exit(1);
}
const outputs = ['avatar', 'recruteur', 'apercu'].map((name) => `${prefix}-${name}.webm`);
const existing = outputs.filter((path) => existsSync(path));
if (existing.length && !args.has('remplacer')) {
  console.error(`vidéos déjà présentes (${existing.map((path) => basename(path)).join(', ')}) : ajouter --remplacer`);
  process.exit(1);
}
for (const path of existing) rmSync(path);

const name = basename(prefix);
const read64 = (suffix: string) => readFileSync(`${prefix}${suffix}`).toString('base64');
const browser = await BenchBrowser.launch({ maxLlmCalls: 0, downloadDir: dirname(prefix) });
let stats: Record<string, unknown> | null = null;
try {
  const page = await browser.openPage('render.html');
  const call = `__render.run(${JSON.stringify(name)}, ${JSON.stringify(readFileSync(`${prefix}-journal.json`, 'utf8'))}, ${JSON.stringify(read64('-voix-avatar.webm'))}, ${JSON.stringify(read64('-voix-recruteur.webm'))}, ${JSON.stringify((args.get('images') ?? '').split(',').filter(Boolean).map(Number))})`;
  stats = JSON.parse(await browser.evaluate<string>(page, call)) as Record<string, unknown>;
  // Téléchargements : attendre que les trois fichiers existent et ne grossissent plus.
  for (let i = 0, stable = 0, last = ''; i < 600 && stable < 3; i += 1) {
    await sleep(500);
    const sizes = outputs.map((path) => (existsSync(path) ? statSync(path).size : -1)).join(',');
    stable = !sizes.includes('-1') && sizes === last ? stable + 1 : 0;
    last = sizes;
  }
} catch (error) {
  console.log(`ÉCHEC : ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
for (const line of browser.logs.filter((line) => /\[rendu\]|\[avatar|ERREUR|EXCEPTION/.test(line))) console.log(line);
if (stats) console.log(JSON.stringify(stats, null, 1));
const missing = outputs.filter((path) => !existsSync(path));
if (missing.length) console.log(`fichiers manquants : ${missing.join(', ')}`);
process.exit(stats && !missing.length ? 0 : 1);
