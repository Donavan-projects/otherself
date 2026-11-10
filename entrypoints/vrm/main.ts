// Page de l'avatar 3D (prototype VRM) : aperçu animé avec une voix simulée et mesure du coût du rendu, par le même
// chemin que la caméra injectée (lib/vrm-assets.ts puis lib/avatar-vrm.ts, bandeau peint en dernier).
// Paramètres de l'adresse : ?speak=0 pour l'avatar silencieux (regard, respiration, clignements seuls) ; ?software=1
// accepte le rendu WebGL logiciel (contrôle visuel sans carte graphique, trop lent pour un vrai usage) ; ?mouth=A et
// ?still=1 : voir plus bas.

import { MOUTH_SHAPES } from '@/lib/avatar';
import { createVrmRenderer } from '@/lib/avatar-vrm';
import { loadDemoConfig } from '@/lib/config';
import { createLogger } from '@/lib/log';
import { buildAvatarAssets } from '@/lib/avatar-assets';
import { buildVrmAssets } from '@/lib/vrm-assets';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;
const log = createLogger('vrm');
const params = new URLSearchParams(location.search);
const speak = params.get('speak') !== '0';
const allowSoftware = params.get('software') === '1';
// Contrôle visuel des formes de bouche : ?mouth=repos|M|E|A|O impose la forme, ?still=1 fige clignements et mouvements.
const mouthParam = params.get('mouth');
const mouth = MOUTH_SHAPES.find((shape) => shape === mouthParam);
const still = params.get('still') === '1';
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;
const statsBox = document.querySelector<HTMLPreElement>('#stats')!;

/** Voix simulée, comme la page avatar : 3 s de parole (4 à 6 syllabes par seconde), puis 1,5 s de silence. */
function simulatedLevel(now: number): number {
  if (!speak) return 0;
  const t = (now / 1000) % 4.5;
  if (t > 3) return 0;
  const syllable = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6 + Math.sin(t * 7) * 1.5));
  return syllable * (0.08 + 0.12 * Math.abs(Math.sin(t * 1.7 + 1)));
}

try {
  const config = await loadDemoConfig();
  // Le slogan reprend celui du personnage SVG : zone, lignes, police, encre.
  const { slogan } = await buildAvatarAssets(config);
  const assets = await buildVrmAssets(config, slogan);
  const renderer = await createVrmRenderer(
    canvas,
    {
      model: await assets.model.arrayBuffer(),
      background: await createImageBitmap(assets.background),
      banner: assets.banner,
      camera: assets.camera,
      slogan: { image: await createImageBitmap(assets.slogan), ...assets.sloganPlacement },
    },
    { bannerText: config.bannerText, debugSafeZone: config.debugSafeZone },
    () => simulatedLevel(performance.now()),
    log,
    { allowSoftwareRendering: allowSoftware, mouth, still },
  );

  let frames = 0;
  let total = 0;
  let max = 0;
  let last = performance.now();
  setInterval(() => {
    const start = performance.now();
    renderer.draw(start);
    const spent = performance.now() - start;
    frames += 1;
    total += spent;
    max = Math.max(max, spent);
  }, 1000 / FPS);
  setInterval(() => {
    const now = performance.now();
    const line = `${((frames * 1000) / (now - last)).toFixed(1)} images/s, image ${(total / Math.max(1, frames)).toFixed(2)} ms (max ${max.toFixed(1)})`;
    log(line);
    statsBox.textContent = line;
    frames = 0;
    total = 0;
    max = 0;
    last = now;
  }, STATS_INTERVAL_MS);
  statsBox.textContent = 'mesure en cours…';
  log(`aperçu 3D affiché (${speak ? 'voix simulée' : 'silencieux'})`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`avatar 3D indisponible : ${message}`);
  statsBox.textContent = `avatar 3D indisponible : ${message}`;
}
