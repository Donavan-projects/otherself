// États de l'avatar (étape 2 de docs/feuille-de-route.md) et table unique de leurs réglages.
// L'état est décidé par lib/conversation.ts (document offscreen), seule source de vérité, puis
// transmis à la page par le pont ; le rendu (lib/avatar-vrm.ts, lib/avatar.ts pour le SVG de
// secours) ne fait que réagir. Sans dépendance : utilisé par l'offscreen, la page et les pages de test.

export const AVATAR_STATES = ['inactif', 'ecoute', 'reflexion', 'parole', 'pause'] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

export function isAvatarState(value: unknown): value is AvatarState {
  return (AVATAR_STATES as readonly unknown[]).includes(value);
}

/** Réglages d'un état. Angles en degrés, durées en ms, poids d'expression VRM de 0 à 1. */
export interface StateStyle {
  /** Saccades autour de la direction visée : amplitude horizontale et verticale. */
  gazeJitterYaw: number;
  gazeJitterPitch: number;
  /** Intervalle entre deux saccades. */
  saccadeMinMs: number;
  saccadeMaxMs: number;
  /** Probabilité, à chaque saccade, d'un bref coup d'œil ailleurs (5 à 9° de côté). */
  glanceChance: number;
  /**
   * Regard posé hors de la caméra pour tout l'état : côté (signe tiré à l'entrée) et vers le haut. Angle de la cible
   * vue de la tête, pas des yeux : le regard VRoid (lookAt « bone ») ne tourne les yeux que de 8 à 12° pour 90°
   * (androïde : 8 à 10,2°, réglages vérifiés en capture sur lui comme sur l'ancien modèle).
   */
  gazeAsideYaw: number;
  gazeAsideUp: number;
  /** Inclinaison de la tête sur le côté (roulis) et vers l'avant, tenue pendant l'état. */
  headTilt: number;
  headPitch: number;
  /** Amplitude de la dérive lente de la tête (1 : comme aujourd'hui au repos). */
  headDrift: number;
  /** Amplitude d'un hochement (courte pause du recruteur). 0 : jamais. */
  nod: number;
  /** Intervalle entre deux clignements. */
  blinkMinMs: number;
  blinkMaxMs: number;
  /** Respirations par seconde. */
  breathRate: number;
  /** Expressions VRM (fondues sur l'état). relaxed est atténué quand la bouche s'ouvre. */
  relaxed: number;
  angry: number;
}

/** Fondu entre deux états : constante de temps (s) ; ≈ 300 ms pour faire 95 % du chemin. */
export const STATE_FADE = 0.1;
/** Durée d'un hochement (descente puis retour). */
export const NOD_MS = 450;
/** Atténuation de relaxed par l'ouverture de la bouche (1 : supprimé bouche grande ouverte). */
export const RELAXED_MOUTH_DAMPING = 0.8;
/**
 * Fermeture des paupières déjà apportée par les expressions (VRoid : Fcl_ALL_Fun et Fcl_ALL_Angry
 * plissent les yeux) : le clignement est réduit d'autant pour ne pas fermer deux fois.
 */
export const BLINK_EXPRESSION_COMPENSATION = { relaxed: 0.6, angry: 0.3 } as const;
/**
 * Marqueur IA (règle 1, lib/badge.ts) : marquage « IA » imprimé sur la veste (lettres pleines, police technique) et
 * voyant d'état sur la languette du col, dessinés en dernier dans le canvas 2D. Couleurs, dimensions et positions au
 * repos dans le cadre 1280×720.
 */
export const MARKING = {
  /** Couleur du voyant par état (jamais éteint tant que l'avatar est visible). Bleu franc, distinct des bandes
   * turquoise (≈ #3ad4e0) du fond Atrium. Pas de couleur de pause : l'image de pause n'a ni avatar ni voyant. */
  colors: {
    inactif: '#3b6cff',
    ecoute: '#3b6cff',
    reflexion: '#ffaa1f',
    parole: '#2fd36b',
    pause: '#3b6cff',
  } satisfies Record<AvatarState, string>,
  /** Réflexion : respiration lente (Hz) de la luminosité du voyant (profondeur de 0 à 1) et de son halo. */
  pulseHz: 0.8,
  pulseDepth: 0.15,
  pulseGlow: 0.5,
  /** Voyant : opacité de la languette allumée, rayon et opacité du halo autour (pixels). */
  lightAlpha: 0.92,
  haloRadius: 26,
  haloAlpha: 0.5,
  /** Marquage : police (fichier de l'extension, rendu à l'avance par le popup), encre gris anthracite, hauteur des
   * capitales (lisible réduit à 320×180), opacité en mode « multiply » (le tissu transparaît à peine). */
  font: { url: '/fonts/DejaVuSansMono-Bold.ttf', family: 'OtherSelfMarking' },
  ink: '#4b5361',
  capHeight: 38,
  inkAlpha: 0.78,
  /** Bords adoucis du marquage (flou appliqué une fois par le popup, pixels) : netteté proche du rendu 3D. */
  inkBlur: 0.5,
  /** Avatar 3D : centre de la languette (relevé sur le personnage posé, plan serré de 3b) et contour de la languette
   * (coins relatifs au centre, pixels), centre du marquage juste à côté. */
  tab: { x: 578, y: 470, corners: [[-4, -11], [13, -10], [5, 10], [-15, 8]] as const },
  /** Centre du marquage au repos : à côté de la languette, sur le panneau de poitrine, entre les coutures de la veste
   * (couture horizontale du bas du col à y ≈ 485-488, couture verticale du milieu à x ≈ 600-608) : aucune ne touche
   * les lettres. Le bas du texte descend vers y ≈ 537, toléré jusqu'à 545 (Meet ne recadre plus depuis le plan serré ;
   * la coupe 2:1 commence à y = 684). */
  text: { x: 652, y: 516 },
  /** Avatar SVG de secours (cadrage plus large, jusqu'à 3e) : voyant rond sur le revers de la veste, au plus près
   * d'un col ; marquage sur la poitrine, sous le revers. */
  svg: { light: { x: 768, y: 404, radius: 8 }, text: { x: 800, y: 466 } },
} as const;

/**
 * Avatar SVG : zone redessinée sous le marqueur à chaque image (il ne redessine sinon que le visage), pour que voyant,
 * halo et marquage ne s'empilent pas d'une image à l'autre. Couvre le voyant et le marquage de MARKING.svg.
 */
export const MARKING_SVG_CLEARANCE = { x: 730, y: 370, width: 150, height: 140 } as const;

/** Part de l'écart du regard de côté suivie par la tête (le reste vient des yeux). */
export const HEAD_FOLLOW_ASIDE = 0.12;
/** Avatar SVG : décalage des iris quand le regard part de côté (fraction du rayon de l'iris). */
export const SVG_GAZE_ASIDE = { x: 0.35, y: -0.3 } as const;

const BASE: StateStyle = {
  gazeJitterYaw: 1.5,
  gazeJitterPitch: 1,
  saccadeMinMs: 1200,
  saccadeMaxMs: 3500,
  glanceChance: 0.15,
  gazeAsideYaw: 0,
  gazeAsideUp: 0,
  headTilt: 0,
  headPitch: 0,
  headDrift: 1,
  nod: 0,
  blinkMinMs: 2500,
  blinkMaxMs: 6000,
  breathRate: 0.24,
  relaxed: 0,
  angry: 0,
};

/** La table : tout réglage d'état se fait ici. */
export const STATE_STYLES: Record<AvatarState, StateStyle> = {
  // Personne ne parle : regard qui flâne un peu plus, respiration lente, visage détendu.
  inactif: { ...BASE, gazeJitterYaw: 3, gazeJitterPitch: 1.8, glanceChance: 0.3, breathRate: 0.2, relaxed: 0.1 },
  // Le recruteur parle : regard fixé sur la caméra, tête inclinée, hochements aux courtes pauses.
  ecoute: {
    ...BASE,
    gazeJitterYaw: 0.6,
    gazeJitterPitch: 0.4,
    saccadeMinMs: 1500,
    saccadeMaxMs: 4000,
    glanceChance: 0,
    headTilt: 3,
    headPitch: 1,
    headDrift: 0.6,
    nod: 2.5,
    blinkMinMs: 2800,
    blinkMaxMs: 6500,
    relaxed: 0.25,
  },
  // Transcription et LLM : regard posé de côté et vers le haut, bouche fermée, clignements plus rares.
  reflexion: {
    ...BASE,
    gazeJitterYaw: 0.5,
    gazeJitterPitch: 0.4,
    glanceChance: 0,
    gazeAsideYaw: 40,
    gazeAsideUp: 25,
    headTilt: 1.5,
    headPitch: -1.5,
    headDrift: 0.5,
    blinkMinMs: 3500,
    blinkMaxMs: 7000,
    relaxed: 0,
    angry: 0,
  },
  // L'avatar parle : bouche synchronisée, mouvements de tête actuels, regard sur la caméra.
  parole: { ...BASE, gazeJitterYaw: 1, gazeJitterPitch: 0.7, glanceChance: 0.08, breathRate: 0.32, relaxed: 0.15 },
  // Pause : l'image de pause remplace l'avatar ; réglages neutres pour la reprise.
  pause: { ...BASE },
};

/** Clés numériques fondues d'un état à l'autre. */
export const STYLE_KEYS = Object.keys(BASE) as (keyof StateStyle)[];

/**
 * Pages de test (avatar, vrm) : enchaîne les états comme dans un entretien, avec une voix simulée
 * pendant « en parole » et deux hochements pendant l'écoute. Jamais dans la caméra injectée.
 */
export class DemoCycle {
  private static readonly PHASES: [AvatarState, number][] = [
    ['ecoute', 3500],
    ['reflexion', 1800],
    ['parole', 3500],
    ['inactif', 2500],
  ];
  private static readonly NODS_MS = [1200, 2600];
  private readonly total = DemoCycle.PHASES.reduce((sum, [, ms]) => sum + ms, 0);
  private previous = -1;

  /** État et niveau de voix simulés à l'instant now ; nod vrai au moment d'un hochement. */
  update(now: number): { state: AvatarState; level: number; nod: boolean } {
    let t = now % this.total;
    for (const [state, duration] of DemoCycle.PHASES) {
      if (t >= duration) {
        t -= duration;
        continue;
      }
      const nod = state === 'ecoute' && DemoCycle.NODS_MS.some((at) => this.previous >= 0 && this.previous < at && t >= at);
      this.previous = state === 'ecoute' ? t : -1;
      return { state, level: state === 'parole' ? simulatedVoice(t) : 0, nod };
    }
    return { state: 'inactif', level: 0, nod: false };
  }
}

/** Voix simulée : 4 à 6 syllabes par seconde, niveau RMS proche de la voix normalisée. */
function simulatedVoice(ms: number): number {
  const t = ms / 1000;
  const syllable = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6 + Math.sin(t * 7) * 1.5));
  return syllable * (0.08 + 0.12 * Math.abs(Math.sin(t * 1.7 + 1)));
}
