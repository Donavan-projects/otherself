// Banc de l'entretien avec le recruteur IA fictif (page recruiter.html), de bout en bout et sans intervention :
// préparation des répliques, activation de l'avatar, partage de l'onglet (vrai clic sur le bouton OtherSelf), entretien
// complet, éventuellement enregistré. Script MANUEL et payant (clé OpenAI de config.local.json, quelques centimes) :
//   npm run build && npm run bench:recruteur -- [--patience impatient|patient] [--tours n] [--charge n] [--prise]
//                                              [--plafond 30] [--sortie fichier.json]
// Protections (scripts/bench-chromium.ts) : profil neuf, une seule page d'entretien, appels au LLM plafonnés.
// --prise : fichiers de la prise dans local/prises/ (ignoré par git).

import { writeFileSync } from 'node:fs';
import { BenchBrowser, parseArgs, sleep } from './bench-chromium.ts';

interface TurnResult {
  index: number;
  text: string;
  answerDelayMs: number | null;
  voiceMs: number;
  longestSilenceMs: number;
  cutOff: boolean;
  stateAtNext: string | null;
}

const args = parseArgs(process.argv.slice(2));
const patience = args.get('patience') ?? 'impatient';
const tours = args.get('tours');
const record = args.has('prise');
const browser = await BenchBrowser.launch({
  maxLlmCalls: Number(args.get('plafond') ?? 30),
  load: Number(args.get('charge') ?? 0),
  downloadDir: record ? 'local/prises' : undefined,
});
let results: TurnResult[] = [];
let saved: string[] = [];
try {
  const page = await browser.openPage(`recruiter.html${tours ? `?tours=${tours}` : ''}`);
  console.log(`préparation : ${await browser.evaluate<string>(page, '__recruiter.prepare()')}`);
  console.log(`activation : ${await browser.evaluate<string>(page, '__recruiter.activate()')}`);
  type Rect = { x: number; y: number; width: number; height: number };
  const findButton = async (): Promise<Rect | null> => {
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      const found = JSON.parse(await browser.evaluate<string>(page, 'JSON.stringify(__recruiter.shareButtonRect())')) as Rect | null;
      if (found) return found;
    }
    return null;
  };
  const rect = await findButton();
  if (!rect) throw new Error('bouton OtherSelf introuvable');
  await browser.click(page, rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (!(await browser.waitFor(page, '__recruiter.sharing()', 10_000, 250))) throw new Error('partage de l’onglet refusé');
  console.log('partage de l’onglet : actif');
  await browser.evaluate(page, `void __recruiter.start('${patience}', { record: ${record} })`, { await: false });
  if (!(await browser.waitFor(page, '__recruiter.done', 20 * 60_000))) throw new Error('entretien trop long');
  results = JSON.parse(await browser.evaluate<string>(page, 'JSON.stringify(__recruiter.results)')) as TurnResult[];
  if (record) {
    await sleep(3000);
    saved = JSON.parse(await browser.evaluate<string>(page, 'JSON.stringify(__recruiter.saved)')) as string[];
  }
} catch (error) {
  console.log(`ÉCHEC : ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}

// Synthèse : réponses coupées, silences, attentes avant de jouer, phrases d'attente, délais.
const holds = browser.logs.flatMap((line) => [...line.matchAll(/attente de (\d+) ms avant de jouer/g)].map((match) => Number(match[1])));
const fillers = browser.logs.filter((line) => /phrase d.attente jouée/.test(line)).length;
const summary = [...browser.logs].reverse().find((line) => line.includes("silences de l'entretien"));
const delays = results.map((result) => result.answerDelayMs).filter((delay): delay is number => delay !== null);
console.log(
  `\n== ${patience}${args.get('charge') ? `, charge ${args.get('charge')}` : ''} : réponses coupées ${results.filter((result) => result.cutOff).length}/${results.length}, ` +
    `plus long silence entendu ${Math.max(0, ...results.map((result) => result.longestSilenceMs))} ms, attentes ${holds.length} (${holds.join(', ') || '-'}), ` +
    `phrases d'attente ${fillers}, début du premier son ${delays.length ? `${(Math.min(...delays) / 1000).toFixed(1)}-${(Math.max(...delays) / 1000).toFixed(1)} s` : '-'}, appels au LLM ${browser.llmCalls}`,
);
if (summary) console.log(`   ${summary.slice(summary.indexOf('silences'))}`);
for (const result of results.filter((item) => item.cutOff)) console.log(`   coupée : réplique ${result.index + 1}, après ${result.voiceMs} ms de voix (« ${result.text.slice(0, 50)} »)`);
if (saved.length) console.log(`   prise : ${saved.join(', ')}`);
if (browser.failure) console.log(`   arrêt forcé : ${browser.failure}`);
const output = args.get('sortie');
if (output) writeFileSync(output, JSON.stringify({ patience, results, llmCalls: browser.llmCalls, failure: browser.failure, saved, logs: browser.logs }, null, 1));
process.exit(browser.failure ? 1 : 0);
