// Rendu de l'avatar « carton » dans un canvas 1280×720 : photo de l'utilisateur
// et bandeau incrusté. Sert aux deux voies (injection dans l'onglet ou page OBS).

import { createLogger } from './log';

export const AVATAR_WIDTH = 1280;
export const AVATAR_HEIGHT = 720;

// Règle 1 : texte dessiné dans chaque image, jamais en superposition DOM.
export const BANNER_TEXT = 'Candidat automatisé, comme vous';

// Zone de sécurité : survit à un recadrage central en 4:3, en carré (x 280 à 1000),
// et à une coupe du haut et du bas jusqu'à environ 21:9 (vignettes Meet).
// Toute l'image utile y tient : photo en haut, bandeau dessous, sans chevauchement.
const SAFE_ZONE = { left: 290, right: 990, top: 100, bottom: 610 };
const BANNER_HEIGHT = 80;
const BANNER_FONT_SIZE = 50;
const BANNER_BORDER = 3;
const BANNER_PADDING_X = 14;
// Resserrement horizontal maximal du texte avant de réduire la police : garde des
// lettres hautes, lisibles dans une vignette de 320×180.
const BANNER_MIN_SQUEEZE = 0.78;
const BANNER_GAP = 14;
const PHOTO_BORDER = 8;

// Zone de la photo (bordure comprise), au-dessus du bandeau.
const PHOTO_AREA = {
  left: SAFE_ZONE.left,
  top: SAFE_ZONE.top,
  width: SAFE_ZONE.right - SAFE_ZONE.left,
  height: SAFE_ZONE.bottom - BANNER_HEIGHT - BANNER_GAP - SAFE_ZONE.top,
};

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

/** Photo entière, bordée de blanc comme un tirage découpé, dans la zone de la photo. */
function drawPhotoCard(ctx: OffscreenCanvasRenderingContext2D, photo: ImageBitmap) {
  const maxWidth = PHOTO_AREA.width - 2 * PHOTO_BORDER;
  const maxHeight = PHOTO_AREA.height - 2 * PHOTO_BORDER;
  const scale = Math.min(maxWidth / photo.width, maxHeight / photo.height);
  const width = Math.round(photo.width * scale);
  const height = Math.round(photo.height * scale);
  const x = Math.round(PHOTO_AREA.left + (PHOTO_AREA.width - width) / 2);
  const y = PHOTO_AREA.top + PHOTO_BORDER;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - PHOTO_BORDER, y - PHOTO_BORDER, width + 2 * PHOTO_BORDER, height + 2 * PHOTO_BORDER);
  ctx.restore();
  ctx.drawImage(photo, x, y, width, height);
}

/** Silhouette neutre quand aucune photo n'est configurée. */
function drawPlaceholder(ctx: OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  const centerX = PHOTO_AREA.left + PHOTO_AREA.width / 2;
  const bottom = PHOTO_AREA.top + PHOTO_AREA.height;
  ctx.fillStyle = '#4a505a';
  ctx.beginPath();
  ctx.arc(centerX, PHOTO_AREA.top + 140, 85, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX, bottom, 170, 150, 0, Math.PI, 0);
  ctx.fill();
}

/**
 * Bandeau jaune bordé de noir, sur une ligne, sous la photo et sur toute la largeur
 * de la zone de sécurité. Le texte est resserré horizontalement plutôt que réduit.
 */
function drawBanner(ctx: CanvasRenderingContext2D) {
  const width = SAFE_ZONE.right - SAFE_ZONE.left;
  const x = SAFE_ZONE.left;
  const y = SAFE_ZONE.bottom - BANNER_HEIGHT;
  const maxTextWidth = width - 2 * (BANNER_BORDER + BANNER_PADDING_X);
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, width, BANNER_HEIGHT);
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(x + BANNER_BORDER, y + BANNER_BORDER, width - 2 * BANNER_BORDER, BANNER_HEIGHT - 2 * BANNER_BORDER);

  let fontSize = BANNER_FONT_SIZE;
  ctx.font = bannerFont(fontSize);
  // Réduit la police seulement si le resserrement maximal ne suffit pas (police de repli).
  while (fontSize > 24 && ctx.measureText(BANNER_TEXT).width * BANNER_MIN_SQUEEZE > maxTextWidth) {
    fontSize -= 2;
    ctx.font = bannerFont(fontSize);
  }
  const squeeze = Math.min(1, maxTextWidth / ctx.measureText(BANNER_TEXT).width);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(AVATAR_WIDTH / 2, y + BANNER_HEIGHT / 2 + 2);
  ctx.scale(squeeze, 1);
  ctx.fillText(BANNER_TEXT, 0, 0);
  ctx.restore();
}

function bannerFont(size: number) {
  return `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}
