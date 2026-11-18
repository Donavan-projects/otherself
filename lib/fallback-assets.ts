// Avatar de secours (sous-étape 3e) : images rendues à l'avance depuis le modèle 3D (npm run vrm -- fallback,
// entrypoints/fallback/), dans avatar/secours/, copiées dans le build (avatar-secours/). Le popup compose le fond et le
// personnage, et fournit au rendu (lib/avatar.ts, AvatarRenderer) les zones des yeux et de la bouche et la position
// du marqueur IA relevée sur le modèle au repos. Pages de l'extension seulement.

import { AVATAR_HEIGHT, AVATAR_WIDTH, MOUTH_SHAPES, type AvatarAssets, type MouthShape, type Rect, type Sprite } from './avatar';
import { canvas, context, fetchText, rasterize, toBlob } from './avatar-assets';
import type { MarkingAnchors } from './badge';
import type { DemoConfig } from './config';
import { createLogger } from './log';

const log = createLogger('avatar');
const DIRECTORY = '/avatar-secours/';

/** Contenu de avatar/secours/secours.json, écrit par la génération. */
export interface FallbackData {
  generator: string;
  frame: { width: number; height: number };
  /** Personnage entier au repos (yeux ouverts, bouche fermée), fond transparent, plein cadre. */
  character: string;
  eyes: { rect: Rect; open: string; closed: string; aside: string };
  mouth: { rect: Rect; shapes: Record<MouthShape, string> };
  /** Marqueur IA relevé sur le modèle au repos : voyant (languette) et repère du marquage. */
  marking: MarkingAnchors;
}

export type FallbackVariant = Pick<DemoConfig, 'background'>;

async function loadImage(name: string): Promise<ImageBitmap> {
  const response = await fetch(browser.runtime.getURL(`${DIRECTORY}${name}` as '/'));
  if (!response.ok) throw new Error(`${DIRECTORY}${name} introuvable (${response.status}) : lancer npm run vrm -- fallback`);
  return createImageBitmap(await response.blob());
}

/** Prépare l'avatar de secours : fond et personnage composés, yeux et bouches, marqueur. */
export async function buildFallbackAssets(variant: FallbackVariant): Promise<AvatarAssets<Blob>> {
  const started = performance.now();
  const response = await fetch(browser.runtime.getURL(`${DIRECTORY}secours.json` as '/'));
  if (!response.ok) throw new Error(`${DIRECTORY}secours.json introuvable (${response.status}) : lancer npm run vrm -- fallback`);
  const data = (await response.json()) as FallbackData;
  if (data.frame.width !== AVATAR_WIDTH || data.frame.height !== AVATAR_HEIGHT) throw new Error('secours.json : cadre inattendu');

  const background = await rasterize(await fetchText(`/avatar-svg/fonds/${variant.background}.svg`), AVATAR_WIDTH, AVATAR_HEIGHT);
  const under = canvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = context(under);
  ctx.drawImage(background, 0, 0);
  ctx.drawImage(await loadImage(data.character), 0, 0);

  const sprite = async (name: string, rect: Rect): Promise<Sprite<Blob>> => {
    const piece = canvas(rect.width, rect.height);
    // Le fond seul sous chaque zone, puis la zone rendue (personnage compris) : opaque, elle remplace exactement le
    // plan du dessous, bords adoucis compris.
    context(piece).drawImage(background, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    context(piece).drawImage(await loadImage(name), 0, 0);
    return { image: await toBlob(piece), x: rect.x, y: rect.y };
  };
  const mouths = {} as Record<MouthShape, Sprite<Blob>>;
  for (const shape of MOUTH_SHAPES) mouths[shape] = await sprite(data.mouth.shapes[shape], data.mouth.rect);
  const { eyes: e, mouth: m } = data;
  const region: Rect = {
    x: Math.min(e.rect.x, m.rect.x),
    y: Math.min(e.rect.y, m.rect.y),
    width: Math.max(e.rect.x + e.rect.width, m.rect.x + m.rect.width) - Math.min(e.rect.x, m.rect.x),
    height: Math.max(e.rect.y + e.rect.height, m.rect.y + m.rect.height) - Math.min(e.rect.y, m.rect.y),
  };
  const assets: AvatarAssets<Blob> = {
    under: await toBlob(under),
    eyes: { open: await sprite(e.open, e.rect), closed: await sprite(e.closed, e.rect), aside: await sprite(e.aside, e.rect) },
    mouths,
    region,
    marking: data.marking,
  };
  log(`avatar de secours préparé en ${Math.round(performance.now() - started)} ms (images rendues depuis le modèle 3D), fond ${variant.background}`);
  return assets;
}
