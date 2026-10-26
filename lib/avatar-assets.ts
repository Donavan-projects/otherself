// Préparation de l'avatar dans une page de l'extension (popup, aperçu, banc d'essai) : lit le SVG
// du personnage et celui du fond, applique la variante (palette, coiffure, accessoires) choisie dans
// config.local.json, rastérise les calques à l'échelle du cadre, écrit le slogan courbé sur le
// t-shirt. La page de la plateforme ne reçoit que des images (jamais la configuration ni la clé API).

import { composeFrame, mapAssets, AVATAR_HEIGHT, AVATAR_WIDTH, MOUTH_SHAPES, type AvatarAssets, type FrameLayout, type MouthShape, type Rect, type Sprite } from './avatar';
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
/** Marge autour des vignettes découpées (yeux, bouches, cheveux). */
const SPRITE_PAD = 2;

/** Calques composés une fois, sous et sur les parties animées (voir avatar/gabarit.svg). */
const UNDER_LAYERS = ['cheveux_arriere', 'corps', 'cou', 'vetements', 'tete'];
const OVERLAY_LAYERS = ['badge'];
const OVER_LAYERS = ['sourcils', 'cheveux_avant', 'accessoires'];
const MOUTH_LAYERS: Record<MouthShape, string> = { repos: 'bouche_repos', A: 'bouche_A', E: 'bouche_E', O: 'bouche_O', M: 'bouche_M' };

export type AvatarVariant = Pick<DemoConfig, 'avatar' | 'background' | 'palette' | 'hairstyle' | 'accessories' | 'bannerText' | 'bannerOffsetY'>;

const assetUrl = (path: string) => browser.runtime.getURL(path as '/');

async function fetchText(path: string): Promise<string> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
}

/** Construit les images de l'avatar à partir des SVG et de la variante choisie. */
export async function buildAvatarAssets(variant: AvatarVariant): Promise<{ assets: AvatarAssets<Blob>; layout: FrameLayout }> {
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
  };

  // Haut de la tête mesuré sur le dessin (dépend de la coiffure), à l'échelle 1.
  const head = await rasterize(withLayers(character, ['cheveux_arriere', 'cheveux_avant', 'tete']), svgWidth, svgHeight);
  const hairTop = opaqueBounds(head)?.y ?? 0;
  const layout = composeFrame({ width: svgWidth, hairTop, sloganBottom: slogan.y + slogan.height }, variant.bannerOffsetY);
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
  await drawSlogan(ctx, variant.bannerText, ink, {
    x: layout.left + slogan.x * layout.scale,
    y: layout.top + slogan.y * layout.scale,
    width: slogan.width * layout.scale,
    height: slogan.height * layout.scale,
  }, slogan.bend * layout.scale);
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
  return { assets, layout };
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

async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
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

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function context(target: HTMLCanvasElement): CanvasRenderingContext2D {
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

function toBlob(source: HTMLCanvasElement): Promise<Blob> {
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
  })();
  return fontLoaded;
}

/**
 * Slogan imprimé sur le t-shirt : deux lignes centrées (une seule si le texte y reste assez grand),
 * écrites à plat puis recopiées colonne par colonne avec la courbure du torse (bouts relevés de bend).
 */
async function drawSlogan(ctx: CanvasRenderingContext2D, text: string, ink: string, zone: Rect, bend: number) {
  await loadSloganFont();
  const width = Math.round(zone.width);
  const height = Math.round(zone.height);
  const pad = Math.ceil(bend) + 2;
  const flat = canvas(width, height + 2 * pad);
  const f = context(flat);
  const font = (size: number) => `700 ${size}px ${SLOGAN_FONT}, sans-serif`;
  const fit = (lines: string[], maxSize: number) => {
    let size = Math.floor(maxSize);
    f.font = font(size);
    while (size > 6 && Math.max(...lines.map((line) => f.measureText(line).width)) * SLOGAN_MIN_SQUEEZE > width) {
      size -= 1;
      f.font = font(size);
    }
    return size;
  };
  const oneLine = fit([text], height * 0.9);
  const lines = oneLine >= height * 0.55 ? [text] : splitInTwo(text);
  const size = lines.length === 1 ? oneLine : fit(lines, (height / 2) * 1.05);
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
