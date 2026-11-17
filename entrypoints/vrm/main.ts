// Page de l'avatar 3D (VRM) : aperçu animé et mesure du coût du rendu, par le même chemin que la caméra injectée
// (lib/vrm-assets.ts puis lib/avatar-vrm.ts, bandeau peint en dernier). Sans paramètre, les états s'enchaînent comme
// dans un entretien (écoute avec hochements, réflexion, parole avec une voix simulée, inactif : lib/avatar-states.ts).
// Paramètres de l'adresse :
// - ?state=inactif|ecoute|reflexion|parole : état imposé (voix simulée en « parole ») ;
// - ?speak=0 : aucune voix simulée ;
// - ?mouth=repos|M|E|A|O : forme de bouche imposée ; ?still=1 : ni clignement, ni saccade, ni dérive (posture de l'état
//   gardée) ; ?blink=1|0 : paupières fermées ou ouvertes imposées ; ?angry=0.1 : poids d'angry imposé ;
// - ?model=android-source : autre modèle copié à la main dans avatar-vrm/ du build (essais seulement) ;
// - ?software=1 : accepte le rendu WebGL logiciel (contrôle visuel sans carte graphique, trop lent pour un vrai usage) ;
// - ?pause=1 : image de pause de la caméra injectée (sans avatar, donc sans marqueur) ;
// - ?marking=cote|sous : placement du marquage (à côté de la languette, ou juste dessous).
// Le marqueur IA (marquage et voyant de la languette, lib/badge.ts) est peint en dernier, comme dans la caméra injectée.

import { MOUTH_SHAPES } from '@/lib/avatar';
import { DemoCycle, isAvatarState } from '@/lib/avatar-states';
import { renderMarkingText } from '@/lib/avatar-assets';
import { AiMarking } from '@/lib/badge';
import { pauseText } from '@/lib/injection-sources';
import { createPauseFrame } from '@/lib/pause-frame';
import { createVrmRenderer } from '@/lib/avatar-vrm';
import { loadDemoConfig } from '@/lib/config';
import { createLogger } from '@/lib/log';
import { buildVrmAssets } from '@/lib/vrm-assets';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;
const log = createLogger('vrm');
const params = new URLSearchParams(location.search);
const speak = params.get('speak') !== '0';
const allowSoftware = params.get('software') === '1';
const mouthParam = params.get('mouth');
const mouth = MOUTH_SHAPES.find((shape) => shape === mouthParam);
const still = params.get('still') === '1';
const stateParam = params.get('state');
const state = isAvatarState(stateParam) ? stateParam : undefined;
const angryParam = params.get('angry');
const angry = angryParam === null ? undefined : Number(angryParam);
const blinkParam = params.get('blink');
const blink = blinkParam === null ? undefined : blinkParam === '1';
const model = params.get('model') ?? undefined;
const showPause = params.get('pause') === '1';
const markingParam = params.get('marking');
const markingPlacement = markingParam === 'cote' || markingParam === 'sous' ? markingParam : undefined;
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;
const statsBox = document.querySelector<HTMLPreElement>('#stats')!;

const cycle = new DemoCycle();
/** État et voix simulés : cycle d'entretien, ou état imposé (voix simulée seulement en « parole »). */
function simulated(now: number) {
  const demo = cycle.update(now);
  if (!state) return { ...demo, level: speak ? demo.level : 0 };
  // État imposé : la voix simulée suit le rythme de la phase « parole » du cycle.
  const voice = new DemoCycle().update(3500 + 1800 + (now % 3500)).level;
  return { state, level: speak && state === 'parole' ? voice : 0, nod: false };
}

try {
  const config = await loadDemoConfig();
  const assets = await buildVrmAssets(config, model);
  let current = simulated(performance.now());
  const renderer = await createVrmRenderer(
    canvas,
    {
      model: await assets.model.arrayBuffer(),
      background: await createImageBitmap(assets.background),
      banner: assets.banner,
      camera: assets.camera,
    },
    { bannerText: config.bannerText, debugSafeZone: config.debugSafeZone },
    () => current.level,
    log,
    {
      allowSoftwareRendering: allowSoftware,
      mouth,
      still,
      state,
      ...(angry !== undefined && Number.isFinite(angry) ? { angry } : {}),
      ...(blink !== undefined ? { blink } : {}),
      ...(markingPlacement ? { marking: markingPlacement } : {}),
    },
  );
  renderer.setState(current.state);
  const marking = new AiMarking(await createImageBitmap(await renderMarkingText(config.badgeText)));
  const ctx = canvas.getContext('2d')!;
  const pauseFrame = showPause ? createPauseFrame(pauseText(config.language), assets.banner, config.bannerText) : null;

  let frames = 0;
  let total = 0;
  let max = 0;
  let last = performance.now();
  setInterval(() => {
    const start = performance.now();
    const next = simulated(start);
    if (next.state !== current.state) log(`[etat] ${current.state} → ${next.state}`);
    current = next;
    renderer.setState(current.state);
    if (current.nod) renderer.nod();
    if (pauseFrame) {
      ctx.drawImage(pauseFrame, 0, 0);
    } else {
      renderer.draw(start);
      marking.setState(current.state);
      marking.draw(ctx, renderer.markingAnchors(), start);
    }
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
  log(`aperçu 3D affiché (${model ?? 'otherself'}, ${state ? `état imposé : ${state}` : 'cycle des états'}${still ? ', figé' : ''})`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`avatar 3D indisponible : ${message}`);
  statsBox.textContent = `avatar 3D indisponible : ${message}`;
}
