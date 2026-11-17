// Image fixe de la pause (lib/inject.ts, et page de test vrm.html?pause=1) : fond sombre, texte centré. Sans avatar,
// elle n'a ni marquage ni voyant : son texte l'identifie (« Avatar IA en pause », règle 1).

import { AVATAR_HEIGHT, AVATAR_WIDTH } from './avatar';

/** Largeur maximale du texte (pixels) : il reste lisible et loin des bords recadrés par les plateformes. */
const MAX_TEXT_WIDTH = 900;

export function createPauseFrame(text: string): OffscreenCanvas {
  const frame = new OffscreenCanvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = frame.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('contexte 2D hors écran indisponible');
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  ctx.fillStyle = '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 72px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(text, AVATAR_WIDTH / 2, AVATAR_HEIGHT * 0.45, MAX_TEXT_WIDTH);
  return frame;
}
