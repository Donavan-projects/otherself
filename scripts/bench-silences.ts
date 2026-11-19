// Banc des silences dans la voix de l'avatar (page voices.html?silences), sans plateforme : vraies questions, moteur,
// découpe, voix et file de synthèse de l'entretien. Script MANUEL et payant (clé OpenAI de config.local.json) :
//   npm run build && npm run bench:silences -- [--charge n] [--voix-paralleles n] [--threads n]
//                                              [--questions "Q1|Q2"] [--plafond 30] [--sortie fichier.json]
// Protections (scripts/bench-chromium.ts) : profil neuf, une seule page de banc, appels au LLM plafonnés.

import { writeFileSync } from 'node:fs';
import { BenchBrowser, parseArgs } from './bench-chromium.ts';

interface Junction {
  totalMs: number;
  gapMs: number;
  cause: string;
}
interface Result {
  done: boolean;
  voice: string;
  responses: { question: string; pieces: { synthStartAt: number; synthEndAt: number; durationMs: number }[]; junctions: Junction[]; holds: number[] }[];
  summary: string;
}

const args = parseArgs(process.argv.slice(2));
const query = ['voix-paralleles', 'threads', 'questions']
  .filter((name) => args.has(name))
  .map((name) => `&${name}=${encodeURIComponent(args.get(name)!)}`)
  .join('');
const browser = await BenchBrowser.launch({ maxLlmCalls: Number(args.get('plafond') ?? 30), load: Number(args.get('charge') ?? 0), gpu: false });
let result: Result | null = null;
try {
  const page = await browser.openPage(`voices.html?silences${query}`);
  if (!(await browser.waitFor(page, 'window.__silences?.done === true', 15 * 60_000))) throw new Error('banc trop long');
  result = JSON.parse(await browser.evaluate<string>(page, 'JSON.stringify(window.__silences)')) as Result;
} catch (error) {
  console.log(`ÉCHEC : ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
if (result) {
  const ratios = result.responses.flatMap((response) => response.pieces.map((piece) => (piece.synthEndAt - piece.synthStartAt) / piece.durationMs)).sort((a, b) => a - b);
  const junctions = result.responses.flatMap((response) => response.junctions);
  const holds = result.responses.flatMap((response) => response.holds);
  console.log(
    `\n== ${result.voice}${args.get('charge') ? `, charge ${args.get('charge')}` : ''} : synthèse médiane ${ratios[Math.floor(ratios.length / 2)]?.toFixed(2)} ×, max ${ratios.at(-1)?.toFixed(2)} × ; ` +
      `plus long silence ${Math.round(Math.max(0, ...junctions.map((junction) => junction.totalMs)))} ms ; ≥ 700 ms : ${junctions.filter((junction) => junction.totalMs >= 700).length} ; ` +
      `trous ${junctions.filter((junction) => junction.cause !== 'pause voulue').length} ; attentes ${holds.length} (${holds.map((hold) => Math.round(hold)).join(', ') || '-'}) ; appels au LLM ${browser.llmCalls}`,
  );
}
if (browser.failure) console.log(`   arrêt forcé : ${browser.failure}`);
const output = args.get('sortie');
if (output) writeFileSync(output, JSON.stringify({ result, llmCalls: browser.llmCalls, failure: browser.failure, logs: browser.logs }, null, 1));
process.exit(browser.failure ? 1 : 0);
