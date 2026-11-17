// Page de l'avatar : aperçu du rendu animé, avec une voix simulée (syllabes et silences)
// pour voir bouche et clignements sans plateforme, avec les états enchaînés (?state= pour en imposer un).

import { AvatarRenderer, mapAssets } from '@/lib/avatar';
import { buildAvatarAssets, renderMarkingText } from '@/lib/avatar-assets';
import { DemoCycle, isAvatarState } from '@/lib/avatar-states';
import { AiMarking } from '@/lib/badge';
import { loadDemoConfig } from '@/lib/config';
import { createLogger } from '@/lib/log';

const FPS = 30;
const log = createLogger('avatar');
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;

const config = await loadDemoConfig();
const { assets } = await buildAvatarAssets(config);
const bitmaps = await mapAssets(assets, (blob) => createImageBitmap(blob));

// États enchaînés comme dans un entretien (lib/avatar-states.ts) ; ?state= impose un état.
const params = new URLSearchParams(location.search);
const forced = params.get('state');
const cycle = new DemoCycle();
let current = cycle.update(performance.now());
const renderer = new AvatarRenderer(
  canvas,
  bitmaps,
  { bannerText: config.bannerText, debugSafeZone: config.debugSafeZone },
  () => current.level,
);
// Marqueur IA (marquage et voyant) peint en dernier, comme dans la caméra injectée.
const marking = new AiMarking(await createImageBitmap(await renderMarkingText(config.badgeText)));
const ctx = canvas.getContext('2d')!;
let frames = 0;
let last = performance.now();
setInterval(() => {
  const demo = cycle.update(performance.now());
  current = isAvatarState(forced) ? { ...demo, state: forced, level: forced === 'parole' ? cycle.update(5300 + (performance.now() % 3500)).level : 0 } : demo;
  renderer.setState(current.state);
  renderer.draw();
  marking.setState(current.state);
  marking.draw(ctx, renderer.markingAnchors(), performance.now());
  frames += 1;
  const now = performance.now();
  if (now - last >= 5000) {
    log(`aperçu : ${((frames * 1000) / (now - last)).toFixed(1)} images/s`);
    frames = 0;
    last = now;
  }
}, 1000 / FPS);
log(`aperçu animé affiché (${canvas.width}x${canvas.height}, voix simulée)`);
