// Rendu de l'avatar « carton » dans un canvas 1280×720 : photo de l'utilisateur
// et bandeau incrusté. Sert aux deux voies (injection dans l'onglet ou page OBS).

import { createLogger } from './log';

export const AVATAR_WIDTH = 1280;
export const AVATAR_HEIGHT = 720;

// Règle 1 : texte dessiné dans chaque image, jamais en superposition DOM.
export const BANNER_TEXT = 'Candidat automatisé, comme vous';

// Zone de sécurité : survit à un recadrage central en 4:3, en carré, et à une coupe
// du haut et du bas jusqu'à environ 21:9 (vignettes Meet). Le bandeau y tient en entier.
const SAFE_ZONE = { left: 310, right: 970, top: 110, bottom: 600 };
const BANNER_FONT_SIZE = 48;
const BANNER_PADDING_X = 28;
const BANNER_PADDING_Y = 16;
const BANNER_LINE_HEIGHT = 1.15;
const BANNER_BORDER = 4;
const PHOTO_MARGIN = 32;
const PHOTO_BORDER = 10;

const log = createLogger('avatar');

interface AvatarConfig {
  photo: string | null;
}

// Les fichiers de local/ sont générés au build : absents des chemins typés par WXT.
const localUrl = (path: string) => new URL(path, browser.runtime.getURL('/')).href;

/** Charge la photo déclarée dans config.local.json (copiée dans le build sous local/). */
export async function loadConfiguredPhoto(): Promise<ImageBitmap | null> {
  const configResponse = await fetch(localUrl('/local/avatar.json'));
  const config = (await configResponse.json()) as AvatarConfig;
  if (!config.photo) {
    log('aucune photo configurée (config.local.json), silhouette affichée');
    return null;
  }
  const photoResponse = await fetch(localUrl(config.photo));
  if (!photoResponse.ok) throw new Error(`photo introuvable : ${config.photo} (${photoResponse.status})`);
  const photo = await createImageBitmap(await photoResponse.blob(), { imageOrientation: 'from-image' });
  log(`photo chargée : ${config.photo} (${photo.width}x${photo.height})`);
  if (Math.max(photo.width, photo.height) < AVATAR_HEIGHT) {
    log(`photo de petite taille, l'image risque d'être floue (au moins ${AVATAR_HEIGHT} px conseillés)`);
  }
  return photo;
}

export class AvatarRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  // Fond et photo ne changent pas : rendus une fois, recopiés à chaque image.
  private readonly base: OffscreenCanvas;

  constructor(canvas: HTMLCanvasElement, photo: ImageBitmap | null) {
    canvas.width = AVATAR_WIDTH;
    canvas.height = AVATAR_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('contexte 2D indisponible');
    this.canvas = canvas;
    this.ctx = ctx;
    this.base = renderBase(photo);
  }

  /** Dessine une image complète. Le bandeau est toujours peint en dernier. */
  draw() {
    this.ctx.drawImage(this.base, 0, 0);
    drawBanner(this.ctx);
  }
}

function renderBase(photo: ImageBitmap | null): OffscreenCanvas {
  const base = new OffscreenCanvas(AVATAR_WIDTH, AVATAR_HEIGHT);
  const ctx = base.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('contexte 2D hors écran indisponible');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (photo) {
    drawBlurredBackground(ctx, photo);
    drawPhotoCard(ctx, photo);
  } else {
    drawPlaceholder(ctx);
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

/** Photo entière, bordée de blanc comme un tirage découpé. */
function drawPhotoCard(ctx: OffscreenCanvasRenderingContext2D, photo: ImageBitmap) {
  const maxWidth = AVATAR_WIDTH - 2 * (PHOTO_MARGIN + PHOTO_BORDER);
  const maxHeight = AVATAR_HEIGHT - 2 * (PHOTO_MARGIN + PHOTO_BORDER);
  const scale = Math.min(maxWidth / photo.width, maxHeight / photo.height);
  const width = Math.round(photo.width * scale);
  const height = Math.round(photo.height * scale);
  const x = Math.round((AVATAR_WIDTH - width) / 2);
  const y = Math.round((AVATAR_HEIGHT - height) / 2);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - PHOTO_BORDER, y - PHOTO_BORDER, width + 2 * PHOTO_BORDER, height + 2 * PHOTO_BORDER);
  ctx.restore();
  ctx.drawImage(photo, x, y, width, height);
}

/** Silhouette neutre quand aucune photo n'est configurée. */
function drawPlaceholder(ctx: OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  const centerX = AVATAR_WIDTH / 2;
  const centerY = AVATAR_HEIGHT / 2 - 40;
  ctx.fillStyle = '#4a505a';
  ctx.beginPath();
  ctx.arc(centerX, centerY - 70, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 170, 190, 130, 0, Math.PI, 0);
  ctx.fill();
}

/**
 * Bandeau jaune sur deux lignes, texte noir, posé en bas de la zone de sécurité :
 * au niveau du buste, sous le visage, et visible malgré le recadrage des vignettes.
 */
function drawBanner(ctx: CanvasRenderingContext2D) {
  const lines = BANNER_TEXT.split(/(?<=,)\s+/);
  const maxTextWidth = SAFE_ZONE.right - SAFE_ZONE.left - 2 * (BANNER_PADDING_X + BANNER_BORDER);
  ctx.save();
  let fontSize = BANNER_FONT_SIZE;
  ctx.font = bannerFont(fontSize);
  const widest = () => Math.max(...lines.map((line) => ctx.measureText(line).width));
  // Réduit la taille si une police de repli rend le texte plus large que prévu.
  while (fontSize > 24 && widest() > maxTextWidth) {
    fontSize -= 2;
    ctx.font = bannerFont(fontSize);
  }
  const lineHeight = Math.round(fontSize * BANNER_LINE_HEIGHT);
  const width = Math.ceil(widest()) + 2 * (BANNER_PADDING_X + BANNER_BORDER);
  const height = lines.length * lineHeight + 2 * (BANNER_PADDING_Y + BANNER_BORDER);
  const x = Math.round(AVATAR_WIDTH / 2 - width / 2);
  const y = SAFE_ZONE.bottom - height;

  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(x + BANNER_BORDER, y + BANNER_BORDER, width - 2 * BANNER_BORDER, height - 2 * BANNER_BORDER);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    const lineY = y + BANNER_BORDER + BANNER_PADDING_Y + lineHeight * (index + 0.5);
    ctx.fillText(line, AVATAR_WIDTH / 2, lineY);
  });
  ctx.restore();
}

function bannerFont(size: number) {
  return `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}
