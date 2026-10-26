// Page de l'avatar : aperçu du rendu animé, avec une voix simulée (syllabes et silences)
// pour voir bouche et clignements sans plateforme.

import { AvatarRenderer, mapAssets } from '@/lib/avatar';
import { buildAvatarAssets } from '@/lib/avatar-assets';
import { loadDemoConfig } from '@/lib/config';
import { createLogger } from '@/lib/log';

const FPS = 30;
const log = createLogger('avatar');
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;

const config = await loadDemoConfig();
const { assets } = await buildAvatarAssets(config);
const bitmaps = await mapAssets(assets, (blob) => createImageBitmap(blob));

/** Niveau simulé : 3 s de parole (4 à 6 syllabes par seconde), puis 1,5 s de silence. */
function simulatedLevel(now: number): number {
  const t = (now / 1000) % 4.5;
  if (t > 3) return 0;
  const syllable = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6 + Math.sin(t * 7) * 1.5));
  return syllable * (0.08 + 0.12 * Math.abs(Math.sin(t * 1.7 + 1)));
}

const renderer = new AvatarRenderer(canvas, bitmaps, { bannerText: config.bannerText, debugSafeZone: config.debugSafeZone }, () =>
  simulatedLevel(performance.now()),
);
let frames = 0;
let last = performance.now();
setInterval(() => {
  renderer.draw();
  frames += 1;
  const now = performance.now();
  if (now - last >= 5000) {
    log(`aperçu : ${((frames * 1000) / (now - last)).toFixed(1)} images/s`);
    frames = 0;
    last = now;
  }
}, 1000 / FPS);
log(`aperçu animé affiché (${canvas.width}x${canvas.height}, voix simulée)`);
