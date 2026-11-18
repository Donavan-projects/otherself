// Avatar de secours dans un canvas 1280×720 : images rendues à l'avance depuis le modèle 3D (avatar/secours/, préparées
// par lib/fallback-assets.ts), yeux et bouche animés, sans respiration ni mouvement de tête ; le marqueur IA
// (lib/badge.ts) est peint ensuite par l'appelant, à la position relevée sur le modèle. Tourne dans le monde MAIN de
// l'onglet (voie A) comme dans les pages de l'extension (aperçu, banc d'essai). Formes de bouche et clignements
// (MouthAnimator, BlinkAnimator) sont partagés avec l'avatar 3D.

import { MARKING, STATE_STYLES, type AvatarState } from './avatar-states';
import type { MarkingAnchors } from './badge';

export const AVATAR_WIDTH = 1280;
export const AVATAR_HEIGHT = 720;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MOUTH_SHAPES = ['repos', 'A', 'E', 'O', 'M'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** Image placée dans le cadre (coordonnées du canvas 1280×720). */
export interface Sprite<T> {
  image: T;
  x: number;
  y: number;
}

/**
 * Images de l'avatar, prêtes à composer. T : Blob dans l'extension, fichier sérialisé pour
 * passer au monde MAIN, ImageBitmap pour dessiner.
 */
export interface AvatarAssets<T> {
  /** Plein cadre fixe : fond et personnage au repos (yeux ouverts, bouche fermée). */
  under: T;
  /** Zones opaques (fond compris) : yeux ouverts, fermés, regard de côté (état « en réflexion »). */
  eyes: { open: Sprite<T>; closed: Sprite<T>; aside: Sprite<T> };
  mouths: Record<MouthShape, Sprite<T>>;
  /** Zone redessinée à chaque image : yeux et bouches. */
  region: Rect;
  /** Position du marqueur IA relevée sur le modèle 3D au repos. */
  marking: MarkingAnchors;
}

export async function mapAssets<A, B>(assets: AvatarAssets<A>, convert: (image: A) => Promise<B>): Promise<AvatarAssets<B>> {
  const sprite = async (item: Sprite<A>): Promise<Sprite<B>> => ({ ...item, image: await convert(item.image) });
  const mouths = await Promise.all(MOUTH_SHAPES.map(async (shape) => [shape, await sprite(assets.mouths[shape])] as const));
  return {
    under: await convert(assets.under),
    eyes: {
      open: await sprite(assets.eyes.open),
      closed: await sprite(assets.eyes.closed),
      aside: await sprite(assets.eyes.aside),
    },
    mouths: Object.fromEntries(mouths) as Record<MouthShape, Sprite<B>>,
    region: assets.region,
    marking: assets.marking,
  };
}

// Bouche : niveau (RMS) de la voix réellement jouée dans le micro injecté. La voix est normalisée
// à −18 dBFS RMS (≈ 0,126) : les seuils sont placés autour de ce niveau.
const LEVEL_SILENCE = 0.015;
const LEVEL_LOW = 0.035;
const LEVEL_HIGH = 0.095;
const LEVEL_ATTACK = 0.6;
const LEVEL_RELEASE = 0.35;
/** Durée minimale d'une forme de bouche : évite le scintillement. */
const MOUTH_HOLD_MS = 70;

/** Choisit la forme de bouche d'après le niveau lissé : repos, M, E, puis A et O en alternance. */
export class MouthAnimator {
  private level = 0;
  private shape: MouthShape = 'repos';
  private since = 0;
  private nextOpen: 'A' | 'O' = 'A';

  /** Bouche au repos, niveau oublié : rien ne bouge en sortant de l'état « en parole ». */
  reset() {
    this.level = 0;
    this.shape = 'repos';
    this.since = 0;
  }

  update(rawLevel: number, now: number): MouthShape {
    this.level += (rawLevel - this.level) * (rawLevel > this.level ? LEVEL_ATTACK : LEVEL_RELEASE);
    let wanted: MouthShape;
    if (this.level < LEVEL_SILENCE) wanted = 'repos';
    else if (this.level < LEVEL_LOW) wanted = 'M';
    else if (this.level < LEVEL_HIGH) wanted = 'E';
    else wanted = this.shape === 'A' || this.shape === 'O' ? this.shape : this.nextOpen;
    if (wanted !== this.shape && now - this.since >= MOUTH_HOLD_MS) {
      // Chaque nouvelle ouverture alterne A et O : la bouche ne répète pas la même forme.
      if (wanted === 'A' || wanted === 'O') this.nextOpen = wanted === 'A' ? 'O' : 'A';
      this.shape = wanted;
      this.since = now;
    }
    return this.shape;
  }
}

// Clignements : toutes les 2,5 à 6 s, yeux fermés 110 ms, parfois deux de suite.
const BLINK_MIN_MS = 2500;
const BLINK_MAX_MS = 6000;
const BLINK_CLOSED_MS = 110;
const DOUBLE_BLINK_CHANCE = 0.15;
const DOUBLE_BLINK_GAP_MS = 180;

export class BlinkAnimator {
  private next: number;
  private closedUntil = 0;
  private min = BLINK_MIN_MS;
  private max = BLINK_MAX_MS;

  constructor(now: number) {
    this.next = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
  }

  /** Intervalle entre deux clignements (état de l'avatar) ; le prochain clignement est retiré dans ce nouvel intervalle. */
  setRange(min: number, max: number, now: number) {
    this.min = min;
    this.max = max;
    this.next = Math.min(this.next, now + randomBetween(min, max));
  }

  closed(now: number): boolean {
    if (now >= this.next) {
      this.closedUntil = now + BLINK_CLOSED_MS;
      const double = Math.random() < DOUBLE_BLINK_CHANCE;
      this.next = double ? this.closedUntil + DOUBLE_BLINK_GAP_MS : now + randomBetween(this.min, this.max);
    }
    return now < this.closedUntil;
  }
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export class AvatarRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly assets: AvatarAssets<ImageBitmap>;
  private readonly mouth = new MouthAnimator();
  private readonly blink: BlinkAnimator;
  private readonly level: () => number;
  private complete = false;
  /** État de l'avatar (lib/avatar-states.ts), version réduite : bouche, clignements, regard de côté. */
  private state: AvatarState;

  constructor(
    canvas: HTMLCanvasElement,
    assets: AvatarAssets<ImageBitmap>,
    level: () => number = () => 0,
    state: AvatarState = 'inactif',
  ) {
    canvas.width = AVATAR_WIDTH;
    canvas.height = AVATAR_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('contexte 2D indisponible');
    this.canvas = canvas;
    this.ctx = ctx;
    this.assets = assets;
    this.level = level;
    this.blink = new BlinkAnimator(performance.now());
    this.state = state;
    this.blink.setRange(STATE_STYLES[state].blinkMinMs, STATE_STYLES[state].blinkMaxMs, performance.now());
  }

  /** Marqueur IA : position relevée sur le modèle 3D au repos (secours.json), fixe. */
  markingAnchors(): MarkingAnchors {
    return this.assets.marking;
  }

  setState(state: AvatarState) {
    if (state === this.state) return;
    this.state = state;
    if (state !== 'parole') this.mouth.reset();
    this.blink.setRange(STATE_STYLES[state].blinkMinMs, STATE_STYLES[state].blinkMaxMs, performance.now());
  }

  /** La prochaine image sera entière (le canvas a reçu autre chose entre-temps, l'image de pause par exemple). */
  invalidate() {
    this.complete = false;
  }

  /**
   * Dessine une image : le cadre entier la première fois, ensuite seulement la zone des yeux
   * et de la bouche (le reste ne bouge pas), et la zone du marqueur IA, que l'appelant peint ensuite par-dessus.
   */
  draw(now = performance.now()): MouthShape {
    const { ctx, assets } = this;
    const region = assets.region;
    if (this.complete) {
      ctx.drawImage(assets.under, region.x, region.y, region.width, region.height, region.x, region.y, region.width, region.height);
      // Sous le marqueur IA, peint ensuite par l'appelant : fond d'origine, pour qu'il ne s'empile pas.
      const clear = markingClearance(assets.marking);
      ctx.drawImage(assets.under, clear.x, clear.y, clear.width, clear.height, clear.x, clear.y, clear.width, clear.height);
    } else {
      ctx.drawImage(assets.under, 0, 0);
    }
    const aside = STATE_STYLES[this.state].gazeAsideYaw > 0;
    const eyes = this.blink.closed(now) ? assets.eyes.closed : aside ? assets.eyes.aside : assets.eyes.open;
    // La bouche ne vit qu'en parlant.
    const shape = this.state === 'parole' ? this.mouth.update(this.level(), now) : 'repos';
    const mouth = assets.mouths[shape];
    ctx.drawImage(eyes.image, eyes.x, eyes.y);
    ctx.drawImage(mouth.image, mouth.x, mouth.y);
    this.complete = true;
    return shape;
  }
}

/** Zone redessinée sous le marqueur IA (voyant et halo, marquage), pour qu'il ne s'empile pas d'une image à l'autre. */
function markingClearance(marking: MarkingAnchors): Rect {
  const halo = MARKING.haloRadius + 4;
  const textHalfWidth = 50;
  const textHalfHeight = MARKING.capHeight;
  const x0 = Math.floor(Math.min(marking.light.x - halo, marking.text.x - textHalfWidth));
  const y0 = Math.floor(Math.min(marking.light.y - halo, marking.text.y - textHalfHeight));
  const x1 = Math.ceil(Math.max(marking.light.x + halo, marking.text.x + textHalfWidth));
  const y1 = Math.ceil(Math.max(marking.light.y + halo, marking.text.y + textHalfHeight));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
