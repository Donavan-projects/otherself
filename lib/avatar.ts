// Rendu de l'avatar « carton » dans un canvas 1280×720 : photo de l'utilisateur
// et bandeau incrusté. Sert aux deux voies (injection dans l'onglet ou page OBS).

import { bannerTextOrDefault, loadDemoConfig, localUrl } from './config';
import { createLogger } from './log';

export const AVATAR_WIDTH = 1280;
export const AVATAR_HEIGHT = 720;


// Zone de sécurité : survit à un recadrage central en 4:3, en carré (x 280 à 1000),
// et à une coupe du haut et du bas jusqu'à environ 21:9 (vignettes Meet, ~2:1 compris).
// Le bloc utile (contenu en haut, bandeau dessous, sans chevauchement) y tient en entier,
// centré verticalement. « Contenu » = la photo aujourd'hui, l'avatar cartoon à l'étape 5.
const SAFE_ZONE = { left: 290, right: 990, top: 100, bottom: 610 };
const BANNER_HEIGHT = 80;
const BANNER_FONT_SIZE = 50;
const BANNER_BORDER = 3;
const BANNER_PADDING_X = 14;
// Resserrement horizontal maximal du texte avant de réduire la police : garde des
// lettres hautes, lisibles dans une vignette de 320×180.
const BANNER_MIN_SQUEEZE = 0.78;
const BANNER_GAP = 14;
// Hauteur maximale du contenu (bordure comprise) : laisse une marge en haut et en bas
// de la zone de sécurité, au cas où la plateforme recadre plus que prévu.
const CONTENT_MAX_HEIGHT = 346;
const PHOTO_BORDER = 8;
const PLACEHOLDER_ASPECT = 3 / 4;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Composition {
  /** Emplacement du contenu, bordure comprise. */
  content: Rect;
  banner: Rect;
}

/** Place le contenu (largeur / hauteur = aspect) et le bandeau dans la zone de sécurité. */
export function composeLayout(aspect: number): Composition {
  const safeWidth = SAFE_ZONE.right - SAFE_ZONE.left;
  const safeHeight = SAFE_ZONE.bottom - SAFE_ZONE.top;
  const maxHeight = Math.min(CONTENT_MAX_HEIGHT, safeHeight - BANNER_GAP - BANNER_HEIGHT);
  const height = Math.round(Math.min(maxHeight, safeWidth / aspect));
  const width = Math.round(Math.min(safeWidth, height * aspect));
  const blockHeight = height + BANNER_GAP + BANNER_HEIGHT;
  const top = Math.round(SAFE_ZONE.top + (safeHeight - blockHeight) / 2);
  return {
    content: { x: Math.round((AVATAR_WIDTH - width) / 2), y: top, width, height },
    banner: { x: SAFE_ZONE.left, y: top + height + BANNER_GAP, width: safeWidth, height: BANNER_HEIGHT },
  };
}

export interface AvatarOptions {
  /** Texte du bandeau (bannerText) ; vide ou absent : texte par défaut (règle 1). */
  bannerText?: string;
  /** Dessine le contour de la zone de sécurité (debugSafeZone dans config.local.json). */
  debugSafeZone?: boolean;
}

const log = createLogger('avatar');

/** Charge la photo et les options déclarées dans config.local.json (copiées dans le build sous local/). */
export async function loadAvatarConfig(): Promise<{ photo: ImageBitmap | null; options: AvatarOptions }> {
  const config = await loadDemoConfig();
  const options: AvatarOptions = { bannerText: config.bannerText, debugSafeZone: config.debugSafeZone };
  log(`bandeau : « ${config.bannerText} »`);
  if (options.debugSafeZone) log('débogage : contour de la zone de sécurité affiché');
  if (!config.photo) {
    log('aucune photo configurée (config.local.json), silhouette affichée');
    return { photo: null, options };
  }
  const photoResponse = await fetch(localUrl(config.photo));
  if (!photoResponse.ok) throw new Error(`photo introuvable : ${config.photo} (${photoResponse.status})`);
  const photo = await createImageBitmap(await photoResponse.blob(), { imageOrientation: 'from-image' });
  log(`photo chargée : ${config.photo} (${photo.width}x${photo.height})`);
  if (Math.max(photo.width, photo.height) < AVATAR_HEIGHT) {
    log(`photo de petite taille, l'image risque d'être floue (au moins ${AVATAR_HEIGHT} px conseillés)`);
  }
  return { photo, options };
}

export class AvatarRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  // Fond et photo ne changent pas : rendus une fois, recopiés à chaque image.
  private readonly base: OffscreenCanvas;
  private readonly layout: Composition;
  private readonly options: AvatarOptions;
  private readonly bannerText: string;

  constructor(canvas: HTMLCanvasElement, photo: ImageBitmap | null, options: AvatarOptions = {}) {
    canvas.width = AVATAR_WIDTH;
    canvas.height = AVATAR_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('contexte 2D indisponible');
    this.canvas = canvas;
    this.ctx = ctx;
    this.options = options;
    this.bannerText = bannerTextOrDefault(options.bannerText);
    this.layout = composeLayout(photo ? photo.width / photo.height : PLACEHOLDER_ASPECT);
    this.base = renderBase(photo, this.layout.content);
  }

  /** Dessine une image complète. Le bandeau est toujours peint en dernier. */
  draw() {
    this.ctx.drawImage(this.base, 0, 0);
    if (this.options.debugSafeZone) drawSafeZone(this.ctx);
    drawBanner(this.ctx, this.layout.banner, this.bannerText);
  }
}

function renderBase(photo: ImageBitmap | null, content: Rect): OffscreenCanvas {
  const base = new OffscreenCanvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = base.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('contexte 2D hors écran indisponible');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (photo) {
    drawBlurredBackground(ctx, photo);
    drawPhotoCard(ctx, photo, content);
  } else {
    drawPlaceholder(ctx, content);
  }
  return base;
}

/** Fond : la photo agrandie, floutée et assombrie, pour remplir le 16:9. */
function drawBlurredBackground(ctx: OffscreenCanvasRenderingContext2D, photo: ImageBitmap) {
  const scale = Math.max(AVATAR_WIDTH / photo.width, AVATAR_HEIGHT / photo.height) * 1.1;
  const width = photo.width * scale;
  const height = photo.height * scale;
  ctx.save();
  ctx.filter = 'blur(40px) brightness(0.55)';
  ctx.drawImage(photo, (AVATAR_WIDTH - width) / 2, (AVATAR_HEIGHT - height) / 2, width, height);
  ctx.restore();
}

/** Photo entière, bordée de blanc comme un tirage découpé, à l'emplacement du contenu. */
function drawPhotoCard(ctx: OffscreenCanvasRenderingContext2D, photo: ImageBitmap, content: Rect) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  ctx.fillRect(content.x, content.y, content.width, content.height);
  ctx.restore();
  // Photo entière dans le cadre intérieur, sans déformation.
  const innerWidth = content.width - 2 * PHOTO_BORDER;
  const innerHeight = content.height - 2 * PHOTO_BORDER;
  const scale = Math.min(innerWidth / photo.width, innerHeight / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  ctx.drawImage(photo, content.x + (content.width - width) / 2, content.y + (content.height - height) / 2, width, height);
}

/** Silhouette neutre quand aucune photo n'est configurée. */
function drawPlaceholder(ctx: OffscreenCanvasRenderingContext2D, content: Rect) {
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  const centerX = content.x + content.width / 2;
  const unit = content.height / 400;
  ctx.fillStyle = '#4a505a';
  ctx.beginPath();
  ctx.arc(centerX, content.y + 140 * unit, 85 * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX, content.y + content.height, 170 * unit, 150 * unit, 0, Math.PI, 0);
  ctx.fill();
}

/** Débogage : contour pointillé de la zone de sécurité, sous le bandeau. */
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
 * Bandeau jaune bordé de noir, sur une ligne, sous le contenu et sur toute la largeur
 * de la zone de sécurité. Le texte est resserré horizontalement plutôt que réduit.
 */
function drawBanner(ctx: CanvasRenderingContext2D, banner: Rect, text: string) {
  const { x, y, width } = banner;
  const maxTextWidth = width - 2 * (BANNER_BORDER + BANNER_PADDING_X);
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, width, BANNER_HEIGHT);
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(x + BANNER_BORDER, y + BANNER_BORDER, width - 2 * BANNER_BORDER, BANNER_HEIGHT - 2 * BANNER_BORDER);

  let fontSize = BANNER_FONT_SIZE;
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
  ctx.translate(AVATAR_WIDTH / 2, y + BANNER_HEIGHT / 2 + 2);
  ctx.scale(squeeze, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function bannerFont(size: number) {
  return `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}
