// Génération des images de l'avatar de secours (sous-étape 3e), pilotée par scripts/render-fallback.ts
// (npm run vrm -- fallback) : rend avatar/otherself.vrm avec le GPU de la machine, au cadrage du plan serré, sur fond
// transparent et sans marqueur, dans une pose figée (état inactif, tête immobile). Rendus : personnage au repos, cinq
// formes de bouche, yeux fermés et regard de côté. Les zones de la bouche et des yeux sont trouvées par différence avec
// le rendu au repos. Le résultat (images WebP en data URL, positions, marqueur) est déposé dans window.__fallback.

import { AVATAR_HEIGHT, AVATAR_WIDTH, MOUTH_SHAPES, type MouthShape, type Rect } from '@/lib/avatar';
import { STATE_STYLES } from '@/lib/avatar-states';
import { createVrmRenderer, type VrmPreviewOptions } from '@/lib/avatar-vrm';
import { loadDemoConfig } from '@/lib/config';
import type { FallbackData } from '@/lib/fallback-assets';
import { createLogger } from '@/lib/log';
import { buildVrmAssets } from '@/lib/vrm-assets';

const log = createLogger('secours');
/** Images rendues avant chaque capture : bouche et paupières lissées, cheveux au repos. */
const SETTLE_FRAMES = 45;
/** Écart de couleur (somme des canaux, alpha compris) au-delà duquel un pixel a changé. */
const DIFF_THRESHOLD = 24;
/** Marge autour de chaque zone (pixels). */
const PAD = 6;
/** Fenêtres où chercher les différences : yeux et bouche du plan serré (cheveux à y = 54, visage jusqu'à ≈ 407). */
const EYES_WINDOW: Rect = { x: 480, y: 150, width: 320, height: 160 };
const MOUTH_WINDOW: Rect = { x: 520, y: 300, width: 240, height: 120 };
const WEBP_QUALITY = 0.92;

declare global {
  interface Window {
    __fallback?: { ok: true; data: FallbackData; images: Record<string, string>; timings: Record<string, number> } | { ok: false; error: string };
  }
}

async function generate() {
  const started = performance.now();
  const config = await loadDemoConfig();
  const assets = await buildVrmAssets(config);
  const preview: VrmPreviewOptions = {
    still: true,
    state: 'inactif',
    relaxed: STATE_STYLES.inactif.relaxed,
    mouth: 'repos',
    blink: false,
    gazeAside: false,
  };
  const target = document.querySelector<HTMLCanvasElement>('#avatar')!;
  const renderer = await createVrmRenderer(
    target,
    { model: await assets.model.arrayBuffer(), background: await createImageBitmap(assets.background), camera: assets.camera },
    () => 0,
    log,
    preview,
  );
  const loaded = performance.now();

  let clock = performance.now();
  /** Rend la pose avec ces réglages et renvoie le personnage seul, sur fond transparent. */
  const render = (settings: Partial<VrmPreviewOptions>): HTMLCanvasElement => {
    Object.assign(preview, settings);
    for (let i = 0; i < SETTLE_FRAMES; i += 1) renderer.draw((clock += 1000 / 30));
    const copy = document.createElement('canvas');
    copy.width = AVATAR_WIDTH;
    copy.height = AVATAR_HEIGHT;
    copy.getContext('2d')!.drawImage(renderer.glCanvas, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
    return copy;
  };

  const base = render({ mouth: 'repos', blink: false, gazeAside: false });
  const marking = renderer.markingAnchors();
  const mouths = Object.fromEntries(MOUTH_SHAPES.map((shape) => [shape, shape === 'repos' ? base : render({ mouth: shape })])) as Record<MouthShape, HTMLCanvasElement>;
  render({ mouth: 'repos' });
  const closed = render({ blink: true });
  const aside = render({ blink: false, gazeAside: true });
  const rendered = performance.now();

  const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT).data;
  const basePixels = pixels(base);
  /** Rectangle des pixels qui diffèrent du rendu au repos, dans la fenêtre donnée. */
  const diffBox = (variants: HTMLCanvasElement[], window: Rect): Rect => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const variant of variants) {
      const data = pixels(variant);
      for (let y = window.y; y < window.y + window.height; y += 1) {
        for (let x = window.x; x < window.x + window.width; x += 1) {
          const i = (y * AVATAR_WIDTH + x) * 4;
          const d = Math.abs(data[i]! - basePixels[i]!) + Math.abs(data[i + 1]! - basePixels[i + 1]!) + Math.abs(data[i + 2]! - basePixels[i + 2]!) + Math.abs(data[i + 3]! - basePixels[i + 3]!);
          if (d <= DIFF_THRESHOLD) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    if (!Number.isFinite(x0)) throw new Error(`aucune différence dans la fenêtre ${JSON.stringify(window)}`);
    const x = Math.max(0, x0 - PAD), y = Math.max(0, y0 - PAD);
    return { x, y, width: Math.min(AVATAR_WIDTH, x1 + PAD + 1) - x, height: Math.min(AVATAR_HEIGHT, y1 + PAD + 1) - y };
  };
  const eyesRect = diffBox([closed, aside], EYES_WINDOW);
  const mouthRect = diffBox(MOUTH_SHAPES.filter((shape) => shape !== 'repos').map((shape) => mouths[shape]), MOUTH_WINDOW);
  const overlap = !(eyesRect.y + eyesRect.height <= mouthRect.y || mouthRect.y + mouthRect.height <= eyesRect.y);
  if (overlap) throw new Error(`zones des yeux et de la bouche qui se chevauchent : ${JSON.stringify({ eyesRect, mouthRect })}`);

  const crop = (canvas: HTMLCanvasElement, rect: Rect) => {
    const out = document.createElement('canvas');
    out.width = rect.width;
    out.height = rect.height;
    out.getContext('2d')!.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return out.toDataURL('image/webp', WEBP_QUALITY);
  };
  const images: Record<string, string> = {
    'personnage.webp': base.toDataURL('image/webp', WEBP_QUALITY),
    'yeux-ouverts.webp': crop(base, eyesRect),
    'yeux-fermes.webp': crop(closed, eyesRect),
    'yeux-cote.webp': crop(aside, eyesRect),
  };
  for (const shape of MOUTH_SHAPES) images[`bouche-${shape}.webp`] = crop(mouths[shape], mouthRect);

  const data: FallbackData = {
    generator: 'npm run vrm -- fallback',
    frame: { width: AVATAR_WIDTH, height: AVATAR_HEIGHT },
    character: 'personnage.webp',
    eyes: { rect: eyesRect, open: 'yeux-ouverts.webp', closed: 'yeux-fermes.webp', aside: 'yeux-cote.webp' },
    mouth: { rect: mouthRect, shapes: Object.fromEntries(MOUTH_SHAPES.map((shape) => [shape, `bouche-${shape}.webp`])) as Record<MouthShape, string> },
    marking,
  };
  const timings = { chargement: Math.round(loaded - started), rendus: Math.round(rendered - loaded), encodage: Math.round(performance.now() - rendered) };
  log(`secours généré : yeux ${JSON.stringify(eyesRect)}, bouche ${JSON.stringify(mouthRect)}, ${JSON.stringify(timings)}`);
  return { data, images, timings };
}

generate().then(
  (result) => (window.__fallback = { ok: true, ...result }),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`échec : ${message}`);
    window.__fallback = { ok: false, error: message };
  },
);
