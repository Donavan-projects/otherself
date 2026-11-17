// Pastille « ● IA » (règle 1) : marqueur IA et voyant d'état, dessinée en dernier dans le canvas 2D de chaque image
// (avatar 3D, avatar SVG de secours, image de pause), jamais dans la texture du modèle : ni assombrie par l'éclairage
// ni masquée par les cheveux ou un bras. Le texte et la forme sont préparés une fois ; le voyant (couleur de l'état,
// fondue, halo, pulsation en réflexion) est redessiné à chaque image. Réglages : BADGE dans lib/avatar-states.ts.
// Sans API d'extension : tourne dans le monde MAIN comme dans les pages de l'extension.

import { BADGE, STATE_FADE, type AvatarState } from './avatar-states';

type Rgb = [number, number, number];

export interface BadgeOptions {
  /** Planche de comparaison seulement : voyant gris au lieu de blanc pendant la pause. */
  pauseGray?: boolean;
}

/** Point du cadre (pixels) où centrer la pastille. */
export interface BadgeAnchor {
  x: number;
  y: number;
}

export class StatusBadge {
  private readonly label: OffscreenCanvas;
  private readonly options: BadgeOptions;
  private state: AvatarState = 'inactif';
  private color: Rgb;
  private previous: number | null = null;

  constructor(text: string, options: BadgeOptions = {}) {
    this.options = options;
    this.label = renderLabel(text);
    this.color = this.target();
  }

  /** Largeur et hauteur de la pastille dans le cadre (pixels). */
  get size(): { width: number; height: number } {
    return { width: this.label.width, height: this.label.height };
  }

  setState(state: AvatarState) {
    this.state = state;
  }

  /** Dessine la pastille centrée sur anchor ; à appeler en dernier, après tout le reste de l'image. */
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, anchor: BadgeAnchor, now = performance.now()) {
    const dt = this.previous === null ? 1 : Math.min(0.5, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    const target = this.target();
    const k = 1 - Math.exp(-dt / STATE_FADE);
    this.color = this.color.map((value, i) => value + (target[i]! - value) * k) as Rgb;
    // Réflexion : la luminosité du voyant respire doucement, sans jamais s'éteindre.
    const phase = this.state === 'reflexion' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * BADGE.pulseHz * (now / 1000)) : 0;
    const [r, g, b] = this.color.map((value) => Math.round(value * (1 - BADGE.pulseDepth * phase))) as Rgb;
    const left = Math.round(anchor.x - this.label.width / 2);
    const top = Math.round(anchor.y - this.label.height / 2);
    ctx.save();
    ctx.drawImage(this.label, left, top);
    const cx = left + BADGE.padX + BADGE.dot / 2;
    const cy = top + this.label.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, BADGE.dot / 2, 0, 2 * Math.PI);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
    ctx.shadowBlur = BADGE.glow * (1 - BADGE.pulseGlow * phase);
    ctx.fill();
    ctx.restore();
  }

  private target(): Rgb {
    const hex = this.state === 'pause' && this.options.pauseGray ? BADGE.pauseGray : BADGE.colors[this.state];
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  }
}

/** Forme et texte de la pastille (sans le voyant), rendus une fois. */
function renderLabel(text: string): OffscreenCanvas {
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  if (!probe) throw new Error('contexte 2D hors écran indisponible');
  // Taille de police telle que les capitales mesurent BADGE.capHeight, quelle que soit la police système.
  const font = (size: number) => `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  probe.font = font(100);
  const capAt100 = probe.measureText('I').actualBoundingBoxAscent || 72;
  const size = Math.round((BADGE.capHeight / capAt100) * 100);
  probe.font = font(size);
  const textWidth = Math.ceil(probe.measureText(text).width);
  const width = BADGE.padX + BADGE.dot + BADGE.gap + textWidth + BADGE.padX + 4;
  const height = BADGE.height;
  const label = new OffscreenCanvas(width, height);
  const ctx = label.getContext('2d');
  if (!ctx) throw new Error('contexte 2D hors écran indisponible');
  const radius = height / 2;
  const inset = BADGE.border / 2;
  ctx.beginPath();
  ctx.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, radius - inset);
  ctx.fillStyle = BADGE.fill;
  ctx.fill();
  ctx.lineWidth = BADGE.border;
  ctx.strokeStyle = BADGE.borderColor;
  ctx.stroke();
  ctx.font = font(size);
  ctx.fillStyle = BADGE.text;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, BADGE.padX + BADGE.dot + BADGE.gap, height / 2 + BADGE.capHeight / 2);
  return label;
}

/** Texte de la pastille : celui de la configuration, sinon « IA » ou « AI » selon la langue ; jamais vide (règle 1). */
export function badgeTextOrDefault(text: unknown, language: 'fr' | 'en'): string {
  const value = typeof text === 'string' ? text.trim().slice(0, 12) : '';
  return value || (language === 'fr' ? 'IA' : 'AI');
}
