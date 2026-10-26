// Vérifie et corrige les SVG de personnage (avatar/*.svg) au build, ou à la main :
//   npm run check:avatar
//
// - Corrige : une forme qui porte une classe de la palette et une couleur en ligne (fill ou
//   stroke, en attribut ou dans style) perd la couleur en ligne ; c'est la classe qui compte,
//   pour que les variantes (peau, cheveux, vêtements) changent sans redessiner. Inkscape ajoute
//   ces couleurs en ligne dès qu'on touche au panneau « Fond et contour ».
// - Refuse : un calque obligatoire manquant, une forme colorable sans classe de la palette.
// - Signale seulement : repères ou coiffure manquants, texte dans le dessin.
//
// Lecture des balises par expressions régulières (fichiers Inkscape réguliers), sans dépendance.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_LAYERS = [
  'cheveux_arriere',
  'corps',
  'cou',
  'vetements',
  'tete',
  'yeux_ouverts',
  'yeux_fermes',
  'bouche_repos',
  'bouche_A',
  'bouche_E',
  'bouche_O',
  'bouche_M',
  'sourcils',
  'cheveux_avant',
  'badge',
];
const OPTIONAL_LAYERS = ['accessoires', 'reperes'];
const MARKERS = ['badge_zone_texte', 'zone_visage', 'ancre_yeux_gauche', 'ancre_yeux_droit', 'ancre_bouche'];

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan']);
/** Contenu jamais rendu tel quel : définitions, masques, dégradés, métadonnées. */
const NON_RENDERED = new Set([
  'defs', 'clipPath', 'mask', 'filter', 'pattern', 'linearGradient', 'radialGradient', 'symbol', 'marker',
  'style', 'metadata', 'title', 'desc', 'sodipodi:namedview',
]);

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name.replace(/[:.]/g, '\\$&')}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? (match[2] ?? match[3]) : undefined;
}

function styleDeclarations(style: string | undefined): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return declarations;
}

/** Retire fill et stroke en ligne (attributs et propriétés de style) ; renvoie les attributs corrigés. */
function stripInlineColors(attrs: string): { attrs: string; removed: string[] } {
  const removed: string[] = [];
  let result = attrs.replace(/\s(fill|stroke)\s*=\s*("[^"]*"|'[^']*')/g, (_whole, name: string, value: string) => {
    removed.push(`${name}=${value}`);
    return '';
  });
  const style = attribute(result, 'style');
  if (style !== undefined) {
    const declarations = styleDeclarations(style);
    for (const property of ['fill', 'stroke']) {
      if (declarations.has(property)) {
        removed.push(`style ${property}:${declarations.get(property)}`);
        declarations.delete(property);
      }
    }
    const rebuilt = [...declarations].map(([key, value]) => `${key}:${value}`).join(';');
    result = result.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/, rebuilt ? ` style="${rebuilt}"` : '');
  }
  return { attrs: result, removed };
}

/** Une forme est colorable si elle peut être vue : pas de fill et de stroke tous deux à none. */
function isColorable(attrs: string): boolean {
  const declarations = styleDeclarations(attribute(attrs, 'style'));
  const fill = declarations.get('fill') ?? attribute(attrs, 'fill');
  const stroke = declarations.get('stroke') ?? attribute(attrs, 'stroke');
  const display = declarations.get('display') ?? attribute(attrs, 'display');
  if (display === 'none') return false;
  return !(fill === 'none' && (stroke === undefined || stroke === 'none'));
}

export interface AvatarSvgReport {
  file: string;
  fixes: string[];
  errors: string[];
  warnings: string[];
}

export function checkAvatarSvg(file: string, write = true): AvatarSvgReport {
  const report: AvatarSvgReport = { file, fixes: [], errors: [], warnings: [] };
  const source = readFileSync(file, 'utf8');
  const name = basename(file);

  const palette = new Set<string>();
  const styleBlock = /<style[^>]*\bid\s*=\s*"palette"[^>]*>([\s\S]*?)<\/style>/.exec(source);
  if (!styleBlock) report.errors.push(`${name} : bloc <style id="palette"> absent`);
  for (const match of (styleBlock?.[1] ?? '').matchAll(/\.([A-Za-z][\w-]*)/g)) palette.add(match[1]!);

  const layers = new Set<string>();
  const ids = new Set<string>();
  const coiffures = new Set<string>();
  // Pile des éléments ouverts : nom, calque, et si leur contenu est hors rendu.
  const stack: { tag: string; layer?: string; ignored: boolean }[] = [];
  let output = '';
  let last = 0;

  for (const match of source.matchAll(TAG)) {
    const [whole, closing, tag, attrs = '', selfClosing] = match;
    if (!tag) continue;
    if (closing) {
      while (stack.length && stack.pop()!.tag !== tag);
      continue;
    }
    const parent = stack.at(-1);
    const id = attribute(attrs, 'id');
    if (id) ids.add(id);
    const label = attribute(attrs, 'inkscape:label');
    const isLayer = tag === 'g' && attribute(attrs, 'inkscape:groupmode') === 'layer';
    if (isLayer && label) layers.add(label);
    const layer = isLayer ? label : parent?.layer;
    const classes = (attribute(attrs, 'class') ?? '').split(/\s+/).filter(Boolean);
    if (tag === 'g' && label?.startsWith('coiffure_')) coiffures.add(`${parent?.layer ?? '?'}/${label}`);
    const ignored =
      Boolean(parent?.ignored) || NON_RENDERED.has(tag) || (isLayer && label === 'reperes') || classes.includes('repere');

    if (SHAPES.has(tag) && !ignored) {
      const where = `${name}, calque ${layer ?? 'hors calque'}, <${tag}${id ? ` id="${id}"` : ''}>`;
      const known = classes.filter((cls) => palette.has(cls));
      if (tag === 'text' || tag === 'tspan') report.warnings.push(`${where} : texte dans le dessin (le slogan est écrit par le code)`);
      if (known.length > 0) {
        const { attrs: cleaned, removed } = stripInlineColors(attrs);
        if (removed.length > 0) {
          report.fixes.push(`${where} : couleur en ligne retirée (${removed.join(', ')}), classe ${known.join(' ')} conservée`);
          output += source.slice(last, match.index) + whole.replace(attrs, cleaned);
          last = match.index! + whole.length;
        }
      } else if (isColorable(attrs)) {
        report.errors.push(
          `${where} : forme colorable sans classe de la palette${classes.length ? ` (classe inconnue : ${classes.join(' ')})` : ''}`,
        );
      }
    }
    if (!selfClosing) stack.push({ tag, layer, ignored });
  }
  output += source.slice(last);

  for (const required of REQUIRED_LAYERS) if (!layers.has(required)) report.errors.push(`${name} : calque obligatoire « ${required} » manquant`);
  for (const layer of layers) {
    if (!REQUIRED_LAYERS.includes(layer) && !OPTIONAL_LAYERS.includes(layer)) report.warnings.push(`${name} : calque inattendu « ${layer} »`);
  }
  for (const marker of MARKERS) if (!ids.has(marker)) report.warnings.push(`${name} : repère « ${marker} » absent`);
  for (const hairLayer of ['cheveux_arriere', 'cheveux_avant']) {
    if (![...coiffures].some((entry) => entry.startsWith(`${hairLayer}/`))) {
      report.warnings.push(`${name} : aucun sous-groupe coiffure_* dans « ${hairLayer} »`);
    }
  }
  if (write && report.fixes.length > 0) writeFileSync(file, output);
  return report;
}

/** Tous les personnages d'un dossier (les fonds, dans fonds/, ne suivent pas ces règles). */
export function checkAvatarSvgs(dir: string, log: (message: string) => void = console.log): AvatarSvgReport[] {
  if (!existsSync(dir)) return [];
  const reports = readdirSync(dir)
    .filter((entry) => entry.endsWith('.svg'))
    .map((entry) => checkAvatarSvg(join(dir, entry)));
  for (const report of reports) {
    for (const fix of report.fixes) log(`[avatar] corrigé : ${fix}`);
    for (const warning of report.warnings) log(`[avatar] attention : ${warning}`);
  }
  const errors = reports.flatMap((report) => report.errors);
  if (errors.length > 0) throw new Error(`SVG d'avatar invalides :\n  - ${errors.join('\n  - ')}`);
  return reports;
}

// Lancement direct : node --experimental-strip-types scripts/check-avatar-svg.ts [dossier]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? 'avatar');
  try {
    const reports = checkAvatarSvgs(dir);
    for (const report of reports) {
      console.log(`${basename(report.file)} : ${report.fixes.length} correction(s), ${report.warnings.length} avertissement(s), aucune erreur`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
