// Image fixe de la pause (lib/inject.ts, et page de test vrm.html?pause=1) : fond sombre, texte centré, bandeau à sa
// place habituelle (retiré à la fin de la sous-étape 3c). La pastille « ● IA » est dessinée par-dessus à chaque image
// (lib/badge.ts), voyant de pause compris.

import { AVATAR_HEIGHT, AVATAR_WIDTH, drawBanner, type Rect } from './avatar';

export function createPauseFrame(text: string, banner: Rect, bannerText: string): OffscreenCanvas {
  const frame = new OffscreenCanvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = frame.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('contexte 2D hors écran indisponible');
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  ctx.fillStyle = '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 72px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(text, AVATAR_WIDTH / 2, AVATAR_HEIGHT * 0.45, banner.width);
  drawBanner(ctx, banner, bannerText);
  return frame;
}
