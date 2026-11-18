// Préparation des images dans une page de l'extension (popup, aperçu, banc d'essai) : utilitaires de dessin
// (rastérisation d'un SVG de fond, canvas, encodage) et rendu du marquage « IA » (règle 1). La page de la plateforme ne
// reçoit que des images (jamais la configuration ni la clé API).

import { MARKING } from './avatar-states';
import { createLogger } from './log';

const log = createLogger('avatar');

const assetUrl = (path: string) => browser.runtime.getURL(path as '/');

export async function fetchText(path: string): Promise<string> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  return response.text();
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

export function toBlob(source: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encodage PNG impossible'))), 'image/png');
  });
}

let markingFontLoaded: Promise<void> | null = null;

/**
 * Marquage « IA » (règle 1, lib/badge.ts), rendu ici parce que la page de la plateforme ne peut pas charger la police
 * de l'extension : lettres pleines gris anthracite, police technique à chasse fixe embarquée (DejaVu Sans Mono Bold),
 * capitales de MARKING.capHeight pixels, fond transparent.
 */
export async function renderMarkingText(text: string): Promise<Blob> {
  const { url, family } = MARKING.font;
  markingFontLoaded ??= (async () => {
    const font = new FontFace(family, `url(${assetUrl(url)})`, { weight: '700' });
    await font.load();
    document.fonts.add(font);
    if (!document.fonts.check(`700 20px ${family}`)) throw new Error(`police du marquage (${url}) non chargée`);
  })();
  await markingFontLoaded;
  const probe = context(canvas(1, 1));
  probe.font = `700 100px ${family}`;
  const capAt100 = probe.measureText('I').actualBoundingBoxAscent;
  const size = (MARKING.capHeight / capAt100) * 100;
  probe.font = `700 ${size}px ${family}`;
  const metrics = probe.measureText(text);
  const pad = 2;
  const target = canvas(Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + 2 * pad, Math.ceil(MARKING.capHeight) + 2 * pad);
  const ctx = context(target);
  ctx.font = `700 ${size}px ${family}`;
  // Bords adoucis : flou très léger, une fois pour toutes (le dessin dans la page ne fait que transformer l'image).
  ctx.filter = `blur(${MARKING.inkBlur}px)`;
  ctx.fillStyle = MARKING.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad + metrics.actualBoundingBoxLeft, pad + MARKING.capHeight);
  log(`marquage « ${text} » : police ${size.toFixed(1)} px (capitales ${MARKING.capHeight} px), ${target.width}x${target.height}`);
  return toBlob(target);
}
