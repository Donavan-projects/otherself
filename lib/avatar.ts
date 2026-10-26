// Rendu de l'avatar cartoon dans un canvas 1280×720 : images préparées par l'extension
// (lib/avatar-assets.ts), yeux et bouche animés, bandeau incrusté. Tourne dans le monde MAIN
// de l'onglet (voie A) comme dans les pages de l'extension (aperçu, banc d'essai).

export const AVATAR_WIDTH = 1280;
export const AVATAR_HEIGHT = 720;

// Zone de sécurité (règle 1) : survit à un recadrage central en 4:3 et en carré (x 280 à 1000) et,
// en haut et en bas, à la coupe 2:1 mesurée sur Meet sans cadrage automatique (36 px), avec 14 px
// de marge. Décision du 26/10/2026 : la coupe 21:9 (86 px) n'est plus couverte.
export const SAFE_ZONE = { left: 290, right: 990, top: 50, bottom: 670 };
// 62 px plutôt que 80 : avec le cadrage automatique, Meet coupe vers y = 605, et un bandeau plus haut
// laissait dépasser une ligne jaune. Sur 580 px de large, c'est la largeur qui limite la police,
// pas la hauteur : le texte garde sa taille.
export const BANNER_HEIGHT = 62;
// Bandeau centré et moins large que la zone : le nom affiché par Meet en bas à gauche de la
// vignette ne masque pas le début du texte.
const BANNER_WIDTH = 580;
/** Taille de police maximale (avant resserrement et réduction à la largeur). */
const BANNER_FONT_SIZE = 50;
const BANNER_BORDER = 3;
const BANNER_PADDING_X = 14;
// Resserrement horizontal maximal du texte avant de réduire la police : garde des
// lettres hautes, lisibles dans une vignette de 320×180.
const BANNER_MIN_SQUEEZE = 0.78;

// Cadrage de webcam : haut de la tête vers 13 % du cadre, slogan du t-shirt au milieu de la
// poitrine (bas du slogan à y = 517). Bandeau en bas du cadre, au bas de la zone de sécurité
// (réglable par bannerOffsetY, sans jamais remonter sur le slogan).
const HEAD_TOP = 94;
const SLOGAN_BOTTOM = 517;
const SLOGAN_GAP = 12;
const DEFAULT_BANNER_TOP = SAFE_ZONE.bottom - BANNER_HEIGHT;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLayout {
  /** Échelle du SVG du personnage dans le cadre, et position de son coin haut gauche. */
  scale: number;
  left: number;
  top: number;
  banner: Rect;
  /** Décalage demandé hors des limites (zone de sécurité, slogan) : ramené dedans. */
  clamped: boolean;
}

/**
 * Compose personnage, slogan et bandeau : le personnage est mis à l'échelle pour que le haut de sa
 * tête soit à HEAD_TOP et le bas du slogan à SLOGAN_BOTTOM ; le bandeau est en bas de la zone de
 * sécurité, décalé de bannerOffsetY (pixels, négatif vers le haut), jamais sur le slogan.
 */
export function composeFrame(svg: { width: number; hairTop: number; sloganBottom: number }, bannerOffsetY = 0): FrameLayout {
  const scale = (SLOGAN_BOTTOM - HEAD_TOP) / (svg.sloganBottom - svg.hairTop);
  const wanted = DEFAULT_BANNER_TOP + Math.round(bannerOffsetY);
  const bannerTop = Math.min(SAFE_ZONE.bottom - BANNER_HEIGHT, Math.max(SLOGAN_BOTTOM + SLOGAN_GAP, wanted));
  return {
    scale,
    left: Math.round(AVATAR_WIDTH / 2 - (svg.width / 2) * scale),
    top: Math.round(HEAD_TOP - svg.hairTop * scale),
    banner: { x: Math.round((AVATAR_WIDTH - BANNER_WIDTH) / 2), y: bannerTop, width: BANNER_WIDTH, height: BANNER_HEIGHT },
    clamped: bannerTop !== wanted,
  };
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
  /** Plein cadre fixe : fond, corps, vêtements, tête sans yeux ni bouche, slogan et sa surimpression. */
  under: T;
  /** Sourcils et cheveux de devant, par-dessus les yeux. */
  over: Sprite<T>;
  eyes: { open: Sprite<T>; closed: Sprite<T> };
  mouths: Record<MouthShape, Sprite<T>>;
  /** Zone redessinée à chaque image : yeux et bouches. */
  region: Rect;
  banner: Rect;
}

export async function mapAssets<A, B>(assets: AvatarAssets<A>, convert: (image: A) => Promise<B>): Promise<AvatarAssets<B>> {
  const sprite = async (item: Sprite<A>): Promise<Sprite<B>> => ({ ...item, image: await convert(item.image) });
  const mouths = await Promise.all(MOUTH_SHAPES.map(async (shape) => [shape, await sprite(assets.mouths[shape])] as const));
  return {
    under: await convert(assets.under),
    over: await sprite(assets.over),
    eyes: { open: await sprite(assets.eyes.open), closed: await sprite(assets.eyes.closed) },
    mouths: Object.fromEntries(mouths) as Record<MouthShape, Sprite<B>>,
    region: assets.region,
    banner: assets.banner,
  };
}

export interface AvatarOptions {
  /** Texte du bandeau (bannerText), déjà vérifié : jamais vide (règle 1). */
  bannerText: string;
  /** Dessine le contour de la zone de sécurité (debugSafeZone dans config.local.json). */
  debugSafeZone?: boolean;
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

  constructor(now: number) {
    this.next = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
  }

  closed(now: number): boolean {
    if (now >= this.next) {
      this.closedUntil = now + BLINK_CLOSED_MS;
      const double = Math.random() < DOUBLE_BLINK_CHANCE;
      this.next = double ? this.closedUntil + DOUBLE_BLINK_GAP_MS : now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
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
  private readonly options: AvatarOptions;
  /** Bandeau rendu une fois, recopié à chaque image. */
  private readonly banner: OffscreenCanvas;
  private readonly mouth = new MouthAnimator();
  private readonly blink: BlinkAnimator;
  private readonly level: () => number;
  private complete = false;

  constructor(canvas: HTMLCanvasElement, assets: AvatarAssets<ImageBitmap>, options: AvatarOptions, level: () => number = () => 0) {
    canvas.width = AVATAR_WIDTH;
    canvas.height = AVATAR_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('contexte 2D indisponible');
    this.canvas = canvas;
    this.ctx = ctx;
    this.assets = assets;
    this.options = options;
    this.level = level;
    this.blink = new BlinkAnimator(performance.now());
    this.banner = new OffscreenCanvas(assets.banner.width, assets.banner.height);
    const bannerCtx = this.banner.getContext('2d');
    if (!bannerCtx) throw new Error('contexte 2D hors écran indisponible');
    drawBanner(bannerCtx, { x: 0, y: 0, width: assets.banner.width, height: assets.banner.height }, options.bannerText);
  }

  /**
   * Dessine une image : le cadre entier la première fois, ensuite seulement la zone des yeux
   * et de la bouche (le reste ne bouge pas). Le bandeau est toujours peint en dernier.
   */
  draw(now = performance.now()): MouthShape {
    const { ctx, assets } = this;
    const region = assets.region;
    if (this.complete) {
      ctx.drawImage(assets.under, region.x, region.y, region.width, region.height, region.x, region.y, region.width, region.height);
    } else {
      ctx.drawImage(assets.under, 0, 0);
      if (this.options.debugSafeZone) drawSafeZone(ctx);
    }
    const eyes = this.blink.closed(now) ? assets.eyes.closed : assets.eyes.open;
    const shape = this.mouth.update(this.level(), now);
    const mouth = assets.mouths[shape];
    ctx.drawImage(eyes.image, eyes.x, eyes.y);
    ctx.drawImage(mouth.image, mouth.x, mouth.y);
    if (this.complete) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.width, region.height);
      ctx.clip();
      ctx.drawImage(assets.over.image, assets.over.x, assets.over.y);
      ctx.restore();
    } else {
      ctx.drawImage(assets.over.image, assets.over.x, assets.over.y);
      this.complete = true;
    }
    ctx.drawImage(this.banner, assets.banner.x, assets.banner.y);
    return shape;
  }
}

/** Débogage : contour pointillé de la zone de sécurité, hors de la zone redessinée. */
function drawSafeZone(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 10]);
  ctx.strokeRect(SAFE_ZONE.left, SAFE_ZONE.top, SAFE_ZONE.right - SAFE_ZONE.left, SAFE_ZONE.bottom - SAFE_ZONE.top);
  ctx.fillStyle = '#ff00ff';
  ctx.font = bannerFont(18);
  ctx.textBaseline = 'top';
  ctx.fillText('zone de sécurité (debugSafeZone)', SAFE_ZONE.left + 10, SAFE_ZONE.top + 8);
  ctx.restore();
}

/**
 * Bandeau jaune bordé de noir, sur une ligne, sur toute la largeur de la zone de sécurité.
 * Le texte est resserré horizontalement plutôt que réduit.
 */
export function drawBanner(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, banner: Rect, text: string) {
  const { x, y, width, height } = banner;
  const maxTextWidth = width - 2 * (BANNER_BORDER + BANNER_PADDING_X);
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(x + BANNER_BORDER, y + BANNER_BORDER, width - 2 * BANNER_BORDER, height - 2 * BANNER_BORDER);

  let fontSize = Math.min(BANNER_FONT_SIZE, Math.round(height * 0.8));
  ctx.font = bannerFont(fontSize);
  // Réduit la police seulement si le resserrement maximal ne suffit pas (police de repli).
  while (fontSize > 24 && ctx.measureText(text).width * BANNER_MIN_SQUEEZE > maxTextWidth) {
    fontSize -= 2;
    ctx.font = bannerFont(fontSize);
  }
  const squeeze = Math.min(1, maxTextWidth / ctx.measureText(text).width);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(x + width / 2, y + height / 2 + 2);
  ctx.scale(squeeze, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function bannerFont(size: number) {
  return `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}
