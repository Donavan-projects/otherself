// Marqueur IA (règle 1) : marquage « IA » imprimé sur la veste et voyant d'état sur la languette du col, dessinés en
// dernier dans le canvas 2D de chaque image où l'avatar est visible (avatar 3D, avatar de secours), jamais dans
// la texture du modèle : ni assombris par l'éclairage, ni masqués par les cheveux ou un bras. L'image de pause, sans
// avatar, n'en a pas : son texte l'identifie. Le texte est rendu à l'avance par une page de l'extension
// (renderMarkingText, lib/avatar-assets.ts), la page de la plateforme ne pouvant pas charger la police de l'extension ;
// le voyant (couleur de l'état, fondue, halo, respiration en réflexion) est redessiné à chaque image.
// Réglages : MARKING dans lib/avatar-states.ts. Sans API d'extension : tourne aussi dans le monde MAIN.

import { renderClock } from './render-random';
import { MARKING, STATE_FADE, type AvatarState } from './avatar-states';

type Rgb = [number, number, number];

/** Position du marqueur dans l'image dessinée (pixels du cadre). */
export interface MarkingAnchors {
  /** Centre du voyant : languette du col. */
  light: { x: number; y: number };
  /** Centre du marquage « IA ». */
  text: { x: number; y: number };
  /**
   * Repère du tissu sous le marquage (avatar 3D), projeté à chaque image : centre du texte, et points situés à unit
   * pixels (au repos) vers la droite et vers le bas le long de la surface de la veste. Le texte suit ainsi la pente du
   * tissu, les mouvements du buste et la respiration (rotation et légère déformation) ; l'avatar de secours en garde
   * celui du repos. Absent : texte droit sur text.
   */
  textFrame?: { center: { x: number; y: number }; right: { x: number; y: number }; down: { x: number; y: number }; unit: number };
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class AiMarking {
  private readonly text: CanvasImageSource & { width: number; height: number };
  private state: AvatarState = 'inactif';
  private color: Rgb;
  private previous: number | null = null;

  /** text : marquage déjà rendu (encre pleine, fond transparent). */
  constructor(text: CanvasImageSource & { width: number; height: number }) {
    this.text = text;
    this.color = this.target();
  }

  setState(state: AvatarState) {
    this.state = state;
  }

  /** Dessine voyant et marquage ; à appeler en dernier, après tout le reste de l'image. */
  draw(ctx: Context2D, anchors: MarkingAnchors, now = renderClock.now()) {
    const dt = this.previous === null ? 1 : Math.min(0.5, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    const target = this.target();
    const k = 1 - Math.exp(-dt / STATE_FADE);
    this.color = this.color.map((value, i) => value + (target[i]! - value) * k) as Rgb;
    // Réflexion : le voyant respire doucement (luminosité et halo), sans jamais s'éteindre.
    const phase = this.state === 'reflexion' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * MARKING.pulseHz * (now / 1000)) : 0;
    const [r, g, b] = this.color.map((value) => Math.round(value * (1 - MARKING.pulseDepth * phase))) as Rgb;
    const { light } = anchors;

    ctx.save();
    // Halo : lumière qui déborde un peu sur le tissu autour de la languette.
    const radius = MARKING.haloRadius * (1 - MARKING.pulseGlow * phase * 0.5);
    const halo = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
    halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${MARKING.haloAlpha})`);
    halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(light.x - radius, light.y - radius, 2 * radius, 2 * radius);
    // Languette allumée, à sa forme, bords adoucis par une ombre de la même couleur.
    ctx.beginPath();
    MARKING.tab.corners.forEach(([dx, dy], index) => (index === 0 ? ctx.moveTo(light.x + dx, light.y + dy) : ctx.lineTo(light.x + dx, light.y + dy)));
    ctx.closePath();
    ctx.globalAlpha = MARKING.lightAlpha;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
    ctx.shadowBlur = 6;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Marquage : ton d'impression (« multiply », opacité réduite) qui laisse transparaître les ombres du tissu.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = MARKING.inkAlpha;
    const { width, height } = this.text;
    const frame = anchors.textFrame;
    if (frame) {
      // Transformation affine image → cadre : axes du tissu projetés, centre de l'image sur le centre du repère.
      const a = (frame.right.x - frame.center.x) / frame.unit;
      const b = (frame.right.y - frame.center.y) / frame.unit;
      const c = (frame.down.x - frame.center.x) / frame.unit;
      const d = (frame.down.y - frame.center.y) / frame.unit;
      ctx.transform(a, b, c, d, frame.center.x - (a * width) / 2 - (c * height) / 2, frame.center.y - (b * width) / 2 - (d * height) / 2);
      ctx.drawImage(this.text, 0, 0);
    } else {
      ctx.drawImage(this.text, Math.round(anchors.text.x - width / 2), Math.round(anchors.text.y - height / 2));
    }
    ctx.restore();
  }

  private target(): Rgb {
    const hex = MARKING.colors[this.state];
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  }
}

/** Texte du marquage : celui de la configuration, sinon « IA » ou « AI » selon la langue ; jamais vide (règle 1). */
export function badgeTextOrDefault(text: unknown, language: 'fr' | 'en'): string {
  const value = typeof text === 'string' ? text.trim().slice(0, 12) : '';
  return value || (language === 'fr' ? 'IA' : 'AI');
}
