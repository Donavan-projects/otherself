// Préparation de l'avatar dans une page de l'extension (popup, aperçu, banc d'essai) : lit le SVG
// du personnage et celui du fond, applique la variante (palette, coiffure, accessoires) choisie dans
// config.local.json, rastérise les calques à l'échelle du cadre, écrit le slogan courbé sur le
// t-shirt. La page de la plateforme ne reçoit que des images (jamais la configuration ni la clé API).

import { composeFrame, mapAssets, AVATAR_HEIGHT, AVATAR_WIDTH, MOUTH_SHAPES, SLOGAN_BOTTOM_MAX, SLOGAN_BOTTOM_MIN, type AvatarAssets, type FrameLayout, type MouthShape, type Rect, type Sprite } from './avatar';
import type { DemoConfig } from './config';
import { createLogger } from './log';

const log = createLogger('avatar');

const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const SLOGAN_FONT_URL = '/fonts/NotoSans-Bold.ttf';
const SLOGAN_FONT = 'OtherSelfSlogan';
/** Comme pour le bandeau : resserrement maximal avant de réduire la police. */
const SLOGAN_MIN_SQUEEZE = 0.78;
/** Encre un peu transparente : aspect mat, le coton transparaît. */
const SLOGAN_INK_ALPHA = 0.94;
/** Nombre de lignes maximal accepté pour data-lignes-max (retours à la ligne selon la forme de la zone). */
export const SLOGAN_MAX_LINES = 6;
/**
 * Zone du slogan de l'avatar d'origine dans le cadre (288 x 84 à l'échelle 0,688) : référence de lisibilité.
 * Le journal signale un slogan dont les lettres seraient plus petites qu'avec cette zone et l'ancien calcul.
 */
const SLOGAN_REFERENCE_ZONE = { width: 198, height: 58 };
/** Marge autour des vignettes découpées (yeux, bouches, cheveux). */
const SPRITE_PAD = 2;

/** Calques composés une fois, sous et sur les parties animées (voir avatar/gabarit.svg). */
const UNDER_LAYERS = ['cheveux_arriere', 'corps', 'cou', 'vetements', 'tete'];
const OVERLAY_LAYERS = ['badge'];
const OVER_LAYERS = ['sourcils', 'cheveux_avant', 'accessoires'];
const MOUTH_LAYERS: Record<MouthShape, string> = { repos: 'bouche_repos', A: 'bouche_A', E: 'bouche_E', O: 'bouche_O', M: 'bouche_M' };

/** Slogan du personnage SVG, tel qu'imprimé dans le cadre : repris par l'avatar 3D (lib/vrm-assets.ts). */
export interface SloganStyle {
  /** Taille de la zone du slogan dans le cadre 1280×720 (pixels). */
  width: number;
  height: number;
  /** Encre : couleur badge-fond de la palette du personnage. */
  ink: string;
  /** data-lignes-max du SVG (undefined : une ou deux lignes). */
  maxLines: number | undefined;
  /** Taille de police obtenue dans le cadre (pixels), pour comparaison. */
  fontSize: number;
}

export type AvatarVariant = Pick<DemoConfig, 'avatar' | 'background' | 'palette' | 'hairstyle' | 'accessories' | 'bannerText' | 'bannerOffsetY'>;

const assetUrl = (path: string) => browser.runtime.getURL(path as '/');

export async function fetchText(path: string): Promise<string> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
}

/** Construit les images de l'avatar à partir des SVG et de la variante choisie. */
export async function buildAvatarAssets(variant: AvatarVariant): Promise<{ assets: AvatarAssets<Blob>; layout: FrameLayout; slogan: SloganStyle }> {
  const started = performance.now();
  const [characterSource, backgroundSource] = await Promise.all([
    fetchText(`/avatar-svg/${variant.avatar}.svg`),
    fetchText(`/avatar-svg/fonds/${variant.background}.svg`),
  ]);
  const character = new DOMParser().parseFromString(characterSource, 'image/svg+xml');
  const parseError = character.querySelector('parsererror');
  if (parseError) throw new Error(`${variant.avatar}.svg illisible : ${parseError.textContent ?? ''}`);
  applyPalette(character, variant.palette);
  chooseSubgroups(character, 'coiffure_', [variant.hairstyle]);
  chooseSubgroups(character, 'accessoire_', variant.accessories);

  const root = character.documentElement;
  const svgWidth = Number(root.getAttribute('width'));
  const svgHeight = Number(root.getAttribute('height'));
  const zone = character.getElementById('badge_zone_texte');
  if (!zone) throw new Error(`${variant.avatar}.svg : repère badge_zone_texte absent`);
  const slogan = {
    x: Number(zone.getAttribute('x')),
    y: Number(zone.getAttribute('y')),
    width: Number(zone.getAttribute('width')),
    height: Number(zone.getAttribute('height')),
    bend: Number(zone.getAttribute('data-courbure') ?? 0),
    bottomInFrame: optionalNumber(zone, 'data-bas-cadre'),
    maxLines: optionalNumber(zone, 'data-lignes-max'),
  };
  // Réglages optionnels : refusés hors limites (scripts/check-avatar-svg.ts les refuse aussi au build).
  if (slogan.bottomInFrame !== undefined && !(slogan.bottomInFrame >= SLOGAN_BOTTOM_MIN && slogan.bottomInFrame <= SLOGAN_BOTTOM_MAX)) {
    throw new Error(`${variant.avatar}.svg : data-bas-cadre = ${slogan.bottomInFrame} hors de [${SLOGAN_BOTTOM_MIN}, ${SLOGAN_BOTTOM_MAX}]`);
  }
  if (slogan.maxLines !== undefined && !(Number.isInteger(slogan.maxLines) && slogan.maxLines >= 1 && slogan.maxLines <= SLOGAN_MAX_LINES)) {
    throw new Error(`${variant.avatar}.svg : data-lignes-max = ${slogan.maxLines} (entier de 1 à ${SLOGAN_MAX_LINES} attendu)`);
  }

  // Haut de la tête mesuré sur le dessin (dépend de la coiffure), à l'échelle 1.
  const head = await rasterize(withLayers(character, ['cheveux_arriere', 'cheveux_avant', 'tete']), svgWidth, svgHeight);
  const hairTop = opaqueBounds(head)?.y ?? 0;
  const layout = composeFrame(
    { width: svgWidth, hairTop, sloganBottom: slogan.y + slogan.height, sloganBottomInFrame: slogan.bottomInFrame },
    variant.bannerOffsetY,
  );
  if (layout.clamped) log(`bannerOffsetY = ${variant.bannerOffsetY} hors limites : bandeau ramené à y = ${layout.banner.y} (zone de sécurité)`);
  const width = Math.round(svgWidth * layout.scale);
  const height = Math.round(svgHeight * layout.scale);
  const layer = (names: string[]) => rasterize(withLayers(character, names), width, height);

  // Plan du dessous : fond, personnage, slogan, surimpression du tissu.
  const under = canvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = context(under);
  ctx.drawImage(await rasterize(backgroundSource, AVATAR_WIDTH, AVATAR_HEIGHT), 0, 0);
  const body = await layer(UNDER_LAYERS);
  ctx.drawImage(body, layout.left, layout.top);
  // Buste plus court que le cadre (autre personnage ou coiffure plus haute) : prolongé jusqu'en bas.
  const bottom = layout.top + height;
  if (bottom < AVATAR_HEIGHT) ctx.drawImage(body, 0, height - 1, width, 1, layout.left, bottom, width, AVATAR_HEIGHT - bottom);
  const ink = paletteColor(character, 'badge-fond') ?? '#f2c62e';
  const printed = await drawSlogan(ctx, variant.bannerText, ink, {
    x: layout.left + slogan.x * layout.scale,
    y: layout.top + slogan.y * layout.scale,
    width: slogan.width * layout.scale,
    height: slogan.height * layout.scale,
  }, slogan.bend * layout.scale, slogan.maxLines);
  ctx.drawImage(await layer(OVERLAY_LAYERS), layout.left, layout.top);

  // Parties animées et plan du dessus, découpés à leur emprise.
  const sprite = async (names: string[]): Promise<Sprite<HTMLCanvasElement>> => crop(await layer(names), layout);
  const over = await sprite(OVER_LAYERS);
  const eyes = { open: await sprite(['yeux_ouverts']), closed: await sprite(['yeux_fermes']) };
  const mouths = {} as Record<MouthShape, Sprite<HTMLCanvasElement>>;
  for (const shape of MOUTH_SHAPES) mouths[shape] = await sprite([MOUTH_LAYERS[shape]]);
  const region = union([eyes.open, eyes.closed, ...MOUTH_SHAPES.map((shape) => mouths[shape])]);

  const assets = await mapAssets<HTMLCanvasElement, Blob>(
    { under, over, eyes, mouths, region, banner: layout.banner },
    (image) => toBlob(image),
  );
  log(
    `avatar préparé en ${Math.round(performance.now() - started)} ms : ${variant.avatar} sur ${variant.background}, ` +
      `échelle ${layout.scale.toFixed(3)}, bandeau y = ${layout.banner.y}, zone animée ${region.width}x${region.height}`,
  );
  const sloganStyle: SloganStyle = {
    width: slogan.width * layout.scale,
    height: slogan.height * layout.scale,
    ink,
    maxLines: slogan.maxLines,
    fontSize: printed.size,
  };
  return { assets, layout, slogan: sloganStyle };
}

/** Remplace les couleurs de la palette : { "peau": "#c68b62", "barbe": "none" }. */
function applyPalette(doc: Document, palette: Record<string, string>) {
  const style = doc.getElementById('palette');
  if (!style) throw new Error('bloc <style id="palette"> absent');
  let css = style.textContent ?? '';
  for (const [name, color] of Object.entries(palette)) {
    const rule = new RegExp(`(\\.${name}\\s*\\{[^}]*?\\b(?:fill|stop-color)\\s*:\\s*)([^;}]+)`);
    if (!rule.test(css)) {
      log(`palette : classe « ${name} » inconnue, ignorée`);
      continue;
    }
    css = css.replace(rule, `$1${color.trim()}`);
  }
  style.textContent = css;
}

/** Attribut numérique facultatif : undefined s'il est absent, NaN s'il est illisible (refusé ensuite). */
function optionalNumber(element: Element, name: string): number | undefined {
  const value = element.getAttribute(name);
  return value === null ? undefined : Number(value);
}

function paletteColor(doc: Document, name: string): string | null {
  const match = new RegExp(`\\.${name}\\s*\\{[^}]*?\\bfill\\s*:\\s*([^;}\\s]+)`).exec(doc.getElementById('palette')?.textContent ?? '');
  return match?.[1] ?? null;
}

/** Ne garde visibles que les sous-groupes <prefix><nom> choisis (coiffures, accessoires). */
function chooseSubgroups(doc: Document, prefix: string, chosen: string[]) {
  const shown = new Set(chosen.map((name) => `${prefix}${name}`));
  const found = new Set<string>();
  for (const group of doc.querySelectorAll('g')) {
    const label = group.getAttributeNS(INKSCAPE_NS, 'label') ?? '';
    if (!label.startsWith(prefix)) continue;
    found.add(label);
    if (!shown.has(label)) group.setAttribute('style', 'display:none');
  }
  for (const name of shown) if (!found.has(name)) log(`variante : sous-groupe « ${name} » absent du SVG`);
}

/** SVG où seuls les calques nommés sont visibles (les autres, et les repères, sont masqués). */
function withLayers(doc: Document, names: string[]): string {
  const copy = doc.cloneNode(true) as Document;
  for (const group of copy.querySelectorAll('g')) {
    if (group.getAttributeNS(INKSCAPE_NS, 'groupmode') !== 'layer') continue;
    const name = group.getAttributeNS(INKSCAPE_NS, 'label') ?? group.id;
    // Le style d'Inkscape (display:inline) est remplacé : visibilité décidée ici.
    group.setAttribute('style', names.includes(name) ? 'display:inline' : 'display:none');
  }
  return new XMLSerializer().serializeToString(copy);
}

export async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const result = canvas(width, height);
    context(result).drawImage(image, 0, 0, width, height);
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

export function context(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = target.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('contexte 2D indisponible');
  return ctx;
}

/** Emprise des pixels visibles (alpha > 0), ou null si le calque est vide. */
function opaqueBounds(source: HTMLCanvasElement): Rect | null {
  const { width, height } = source;
  const data = context(source).getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Découpe un calque rastérisé à son emprise ; position exprimée dans le cadre. */
function crop(source: HTMLCanvasElement, layout: FrameLayout): Sprite<HTMLCanvasElement> {
  const bounds = opaqueBounds(source) ?? { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.max(0, bounds.x - SPRITE_PAD);
  const y = Math.max(0, bounds.y - SPRITE_PAD);
  const width = Math.min(source.width - x, bounds.width + 2 * SPRITE_PAD);
  const height = Math.min(source.height - y, bounds.height + 2 * SPRITE_PAD);
  const image = canvas(width, height);
  context(image).drawImage(source, x, y, width, height, 0, 0, width, height);
  return { image, x: layout.left + x, y: layout.top + y };
}

function union(sprites: Sprite<HTMLCanvasElement>[]): Rect {
  const left = Math.min(...sprites.map((s) => s.x));
  const top = Math.min(...sprites.map((s) => s.y));
  const right = Math.max(...sprites.map((s) => s.x + s.image.width));
  const bottom = Math.max(...sprites.map((s) => s.y + s.image.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function toBlob(source: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encodage PNG impossible'))), 'image/png');
  });
}

let fontLoaded: Promise<void> | null = null;

/** Police du slogan, embarquée dans l'extension (OFL), jamais chargée depuis le web. */
function loadSloganFont(): Promise<void> {
  fontLoaded ??= (async () => {
    const font = new FontFace(SLOGAN_FONT, `url(${assetUrl(SLOGAN_FONT_URL)})`, { weight: '700' });
    await font.load();
    document.fonts.add(font);
    // Sans elle, le canvas prendrait une police de remplacement (sans-serif) sans le dire.
    if (!document.fonts.check(`700 20px ${SLOGAN_FONT}`)) throw new Error(`police du slogan (${SLOGAN_FONT_URL}) non chargée`);
    log(`police du slogan chargée : ${SLOGAN_FONT_URL} (Noto Sans Bold)`);
  })();
  return fontLoaded;
}

/**
 * Slogan imprimé sur le t-shirt : deux lignes centrées (une seule si le texte y reste assez grand), ou, si le SVG
 * donne data-lignes-max, de 1 à maxLines lignes choisies selon la forme de la zone ; écrites à plat puis recopiées
 * colonne par colonne avec la courbure du torse (bouts relevés de bend).
 */
export async function drawSlogan(
  ctx: CanvasRenderingContext2D,
  text: string,
  ink: string,
  zone: Rect,
  bend: number,
  maxLines?: number,
): Promise<{ lines: string[]; size: number }> {
  await loadSloganFont();
  const width = Math.round(zone.width);
  const height = Math.round(zone.height);
  const pad = Math.ceil(bend) + 2;
  const flat = canvas(width, height + 2 * pad);
  const f = context(flat);
  const font = (size: number) => `700 ${size}px ${SLOGAN_FONT}, sans-serif`;
  const fitWidth = (lines: string[], maxSize: number, w: number) => {
    let size = Math.floor(maxSize);
    f.font = font(size);
    while (size > 6 && Math.max(...lines.map((line) => f.measureText(line).width)) * SLOGAN_MIN_SQUEEZE > w) {
      size -= 1;
      f.font = font(size);
    }
    return size;
  };
  // Ancien calcul (une ou deux lignes), inchangé : il sert aussi de référence de lisibilité.
  const legacy = (w: number, h: number) => {
    const oneLine = fitWidth([text], h * 0.9, w);
    const lines = oneLine >= h * 0.55 ? [text] : splitInTwo(text);
    return { lines, size: lines.length === 1 ? oneLine : fitWidth(lines, (h / 2) * 1.05, w) };
  };
  const { lines, size } = maxLines === undefined ? legacy(width, height) : wrapToShape(text, maxLines, width, height, fitWidth, f);
  const reference = legacy(SLOGAN_REFERENCE_ZONE.width, SLOGAN_REFERENCE_ZONE.height).size;
  log(`slogan : ${lines.length} ligne(s), police ${size} px (référence ${reference} px)` + (size < reference ? ' : LETTRES PLUS PETITES QUE LA RÉFÉRENCE' : ''));
  f.font = font(size);
  f.fillStyle = ink;
  f.textAlign = 'center';
  f.textBaseline = 'middle';
  const lineHeight = size * 1.02;
  lines.forEach((line, index) => {
    const squeeze = Math.min(1, width / f.measureText(line).width);
    f.save();
    f.translate(width / 2, pad + height / 2 + (index - (lines.length - 1) / 2) * lineHeight + size * 0.04);
    f.scale(squeeze, 1);
    f.fillText(line, 0, 0);
    f.restore();
  });
  ctx.save();
  ctx.globalAlpha = SLOGAN_INK_ALPHA;
  for (let x = 0; x < width; x += 1) {
    const u = (x - width / 2) / (width / 2);
    ctx.drawImage(flat, x, 0, 1, flat.height, zone.x + x, zone.y - pad - bend * u * u, 1, flat.height);
  }
  ctx.restore();
  return { lines, size };
}

/**
 * Retours à la ligne selon la forme de la zone : pour n = 1..maxLines, découpage aux espaces qui minimise la ligne
 * la plus longue (à 2 % près, on préfère les coupures après une virgule, deux-points ou point-virgule), puis la plus grande
 * police qui tient en largeur (resserrement compris) et en hauteur (n lignes d'interligne 1,02). On garde le n qui donne
 * la plus grande police ; à égalité, le moins de lignes.
 */
function wrapToShape(
  text: string,
  maxLines: number,
  width: number,
  height: number,
  fitWidth: (lines: string[], maxSize: number, w: number) => number,
  f: CanvasRenderingContext2D,
): { lines: string[]; size: number } {
  // Typographie française : « : ; ! ? » » restent avec le mot précédent et « « » avec le suivant (jamais en début
  // ou fin de ligne seuls), même séparés par une espace.
  const words: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const last = words.length - 1;
    if (last >= 0 && (/^[:;!?»]+$/.test(token) || words[last] === '«')) words[last] += ` ${token}`;
    else words.push(token);
  }
  // Largeurs mesurées à 100 px (la police du contexte est modifiée par fitWidth entre deux essais).
  const measure = new Map<string, number>();
  const at100 = (line: string) => {
    if (!measure.has(line)) {
      f.font = `700 100px ${SLOGAN_FONT}, sans-serif`;
      measure.set(line, f.measureText(line).width);
    }
    return measure.get(line)!;
  };
  const widest = (lines: string[]) => Math.max(...lines.map(at100));
  const pauses = (lines: string[]) => lines.slice(0, -1).filter((line) => /[,:;]$/.test(line)).length;
  let best: { lines: string[]; size: number } | null = null;
  for (let n = 1; n <= Math.min(maxLines, words.length); n += 1) {
    const all = [...splits(words, n)];
    const narrowest = Math.min(...all.map(widest));
    // Parmi les découpages à 2 % de la ligne la plus courte possible : le plus de coupures après une ponctuation.
    const chosen = all
      .filter((lines) => widest(lines) <= narrowest * 1.02)
      .sort((a, b) => pauses(b) - pauses(a) || widest(a) - widest(b))[0];
    // Jamais vide en pratique (n ≤ nombre de mots) ; sinon, nombre de lignes suivant, puis repli sur une ligne.
    if (!chosen) continue;
    const size = fitWidth(chosen, height / (n * 1.02), width);
    if (!best || size > best.size) best = { lines: chosen, size };
  }
  return best ?? { lines: [text], size: fitWidth([text], height * 0.9, width) };
}

/** Toutes les façons de répartir les mots, dans l'ordre, sur n lignes non vides. */
function* splits(words: string[], n: number): Generator<string[]> {
  if (n === 1) {
    yield [words.join(' ')];
    return;
  }
  for (let i = 1; i <= words.length - n + 1; i += 1) {
    for (const rest of splits(words.slice(i), n - 1)) yield [words.slice(0, i).join(' '), ...rest];
  }
}

/** Coupe le slogan en deux lignes : après la virgule si elle existe, sinon à l'espace le plus proche du milieu. */
function splitInTwo(text: string): string[] {
  const comma = text.indexOf(', ');
  if (comma > 0) return [text.slice(0, comma + 1), text.slice(comma + 2)];
  const middle = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i += 1) if (text[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  return best > 0 ? [text.slice(0, best), text.slice(best + 1)] : [text];
}
