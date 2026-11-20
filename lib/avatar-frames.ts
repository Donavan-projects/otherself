// Images de l'avatar, une à la fois : avatar 3D ou secours (repli automatique dans le même canvas), marqueur IA peint en
// dernier sur chaque image où l'avatar est visible (règle 1), image de pause sans avatar. Même code pour la caméra
// injectée (lib/inject.ts, au rythme de l'horloge du dessin) et pour le rendu après coup d'une prise (page render, à
// 30 images/s exactes d'un temps virtuel). Chaque événement qui pilote l'image (création avec la graine du hasard,
// états, hochements, pause, repli) est signalé à lib/render-random.ts, qui le transmet au journal d'une prise.
// Sans API d'extension : monde MAIN et pages.

import { AvatarRenderer, type AvatarAssets, type MouthShape } from './avatar';
import { createVrmRenderer, type FrameRenderer, type VrmSources } from './avatar-vrm';
import type { AvatarState } from './avatar-states';
import { AiMarking } from './badge';
import { createPauseFrame } from './pause-frame';
import { renderClock, renderEvent, renderSeed, setRenderSeed } from './render-random';

export interface AvatarFrameSources {
  avatar: AvatarAssets<ImageBitmap>;
  vrm?: VrmSources | undefined;
  pauseText: string;
  marking: ImageBitmap;
  initialState?: AvatarState;
}

export interface AvatarFrames {
  readonly canvas: HTMLCanvasElement;
  /** Rendu en service : 'vrm' (avatar 3D) ou 'secours'. */
  kind(): 'vrm' | 'secours';
  /** Dessine l'image de l'instant `now` (horloge du rendu) ; 'pause' pour l'image de pause. */
  draw(now: number): MouthShape | 'pause';
  setPaused(paused: boolean): void;
  setState(state: AvatarState): void;
  nod(): void;
  dispose(): void;
}

export interface AvatarFrameOptions {
  /** Graine du hasard du rendu (rendu après coup) ; en direct, tirée au hasard et signalée dans l'événement 'create'. */
  seed?: number;
  /** Rendu imposé (rendu après coup : celui de la prise). */
  renderer?: 'vrm' | 'secours';
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function createAvatarFrames(
  sources: AvatarFrameSources,
  level: () => number,
  log: (message: string) => void,
  options: AvatarFrameOptions = {},
): Promise<AvatarFrames> {
  setRenderSeed(options.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const canvas = document.createElement('canvas');
  const fallback = (): FrameRenderer => new AvatarRenderer(canvas, sources.avatar, level);
  let renderer: FrameRenderer;
  if (sources.vrm && options.renderer !== 'secours') {
    try {
      renderer = await createVrmRenderer(canvas, sources.vrm, level, log);
      log('rendu : avatar 3D (VRM)');
    } catch (error) {
      log(`avatar 3D indisponible (${errorMessage(error)}) : avatar de secours utilisé`);
      renderer = fallback();
    }
  } else {
    renderer = fallback();
  }
  const kind = () => (renderer instanceof AvatarRenderer ? 'secours' : 'vrm');
  /** État courant, redonné au secours en cas de repli. */
  let state: AvatarState = sources.initialState ?? 'inactif';
  renderEvent('create', renderClock.now(), { seed: renderSeed(), renderer: kind(), state });
  renderer.setState?.(state);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('contexte 2D indisponible');
  // Image de pause, préparée une fois : sans avatar, ni marquage ni voyant ; son texte l'identifie (règle 1).
  const pauseFrame = createPauseFrame(sources.pauseText);
  let paused = false;
  // Marqueur IA (règle 1) : peint en dernier sur chaque image où l'avatar est visible, voyant à la couleur de l'état.
  const marking = new AiMarking(sources.marking);
  marking.setState(state);

  /** Image de l'avatar ; si l'avatar 3D tombe en panne (contexte WebGL perdu…), repli définitif sur le secours. */
  const drawAvatar = (now: number): MouthShape => {
    try {
      return renderer.draw(now);
    } catch (error) {
      if (renderer instanceof AvatarRenderer) throw error;
      log(`avatar 3D en panne (${errorMessage(error)}) : repli sur l'avatar de secours`);
      renderEvent('repli', now);
      renderer.dispose?.();
      renderer = fallback();
      renderer.setState?.(state);
      return renderer.draw(now);
    }
  };

  return {
    canvas,
    kind,
    draw(now) {
      if (paused) {
        ctx.drawImage(pauseFrame, 0, 0);
        return 'pause';
      }
      const shape = drawAvatar(now);
      const anchors = renderer.markingAnchors?.();
      if (anchors) marking.draw(ctx, anchors, now);
      return shape;
    },
    setPaused(value) {
      if (value === paused) return;
      paused = value;
      renderEvent('pause', renderClock.now(), { paused: value ? 1 : 0 });
      // L'avatar de secours ne redessine que la zone du visage : il repart d'une image entière.
      if (!value) renderer.invalidate?.();
    },
    setState(value) {
      state = value;
      renderEvent('state', renderClock.now(), { state: value });
      renderer.setState?.(value);
      marking.setState(value);
    },
    nod() {
      renderEvent('nod', renderClock.now());
      renderer.nod?.();
    },
    dispose() {
      renderer.dispose?.();
    },
  };
}
