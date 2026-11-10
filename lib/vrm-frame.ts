// Cadrage de l'avatar 3D (prototype VRM), sans three.js : partagé par la préparation (lib/vrm-assets.ts, qui doit
// connaître l'échelle pour donner au slogan la taille de celui du SVG) et par le rendu (lib/avatar-vrm.ts).
// Caméra fixe, horizontale, face au personnage, en (0, cameraY, distance) regardant vers −Z.

import { AVATAR_HEIGHT, HEAD_TOP, SLOGAN_BOTTOM } from './avatar';

export const VRM_FOV = 18;
/** Hauteur placée entre deux os du squelette humanoïde (fraction at de from vers to), en pose de repos. */
export interface BoneLandmark {
  from: string;
  to: string;
  at: number;
}

/**
 * Point du devant du sweat placé à y = SLOGAN_BOTTOM (517), le haut des cheveux étant à y = HEAD_TOP (94) : cadrage
 * validé sur Meet le 06/11 (pas de recadrage, bandeau sous le personnage). Repéré par les os, pas en mètres, pour
 * suivre les proportions du modèle à chaque réexport. Fractions calculées sur le modèle validé le 06/11 : elles y
 * redonnent exactement 1,375 m (cadrage) et 1,565 m (haut du slogan).
 */
export const VRM_FRAME_ANCHOR: BoneLandmark = { from: 'chest', to: 'upperChest', at: 0.514 };
/** Haut du slogan : haut du torse, juste sous l'encolure en V. */
export const VRM_SLOGAN_TOP: BoneLandmark = { from: 'upperChest', to: 'neck', at: 0.663 };

export interface VrmCamera {
  /** Hauteur et distance de la caméra (mètres). */
  y: number;
  distance: number;
}

const focal = () => AVATAR_HEIGHT / 2 / Math.tan(((VRM_FOV / 2) * Math.PI) / 180);

/** Caméra qui place le haut des cheveux (y, z) à HEAD_TOP et le repère du sweat (y, z) à SLOGAN_BOTTOM. */
export function solveVrmCamera(top: { y: number; z: number }, anchor: { y: number; z: number }): VrmCamera {
  const f = focal();
  // y_px = H/2 − (Y − cameraY)·f / (distance − Z), écrit pour les deux points puis résolu.
  const k1 = (AVATAR_HEIGHT / 2 - HEAD_TOP) / f;
  const k2 = (AVATAR_HEIGHT / 2 - SLOGAN_BOTTOM) / f;
  const distance = (top.y - anchor.y + k1 * top.z - k2 * anchor.z) / (k1 - k2);
  return { y: top.y - k1 * (distance - top.z), distance };
}

/** Pixels du cadre par mètre à la profondeur z. */
export function pixelsPerMeter(camera: VrmCamera, z: number): number {
  return focal() / (camera.distance - z);
}

/** Ordonnée dans le cadre (pixels) d'un point (y, z) du modèle. */
export function frameY(camera: VrmCamera, y: number, z: number): number {
  return AVATAR_HEIGHT / 2 - (y - camera.y) * pixelsPerMeter(camera, z);
}

/** Transformation affine (a, b, c, d, e, f de setTransform) qui envoie les trois points from sur les trois points to. */
export function affine(from: [number, number][], to: [number, number][]): [number, number, number, number, number, number] | null {
  const [p0, p1, p2] = from as [[number, number], [number, number], [number, number]];
  const det = p0[0] * (p1[1] - p2[1]) - p0[1] * (p1[0] - p2[0]) + (p1[0] * p2[1] - p2[0] * p1[1]);
  if (Math.abs(det) < 1e-9) return null;
  // Résout t_i = α·x_i + β·y_i + γ pour une coordonnée de destination (règle de Cramer).
  const solve = (t: number[]): [number, number, number] => {
    const [t0, t1, t2] = t as [number, number, number];
    const alpha = (t0 * (p1[1] - p2[1]) - p0[1] * (t1 - t2) + (t1 * p2[1] - t2 * p1[1])) / det;
    const beta = (p0[0] * (t1 - t2) - t0 * (p1[0] - p2[0]) + (p1[0] * t2 - p2[0] * t1)) / det;
    const gamma = (p0[0] * (p1[1] * t2 - p2[1] * t1) - p0[1] * (p1[0] * t2 - p2[0] * t1) + t0 * (p1[0] * p2[1] - p2[0] * p1[1])) / det;
    return [alpha, beta, gamma];
  };
  const [a, c, e] = solve(to.map((point) => point[0]));
  const [b, d, f] = solve(to.map((point) => point[1]));
  return [a, b, c, d, e, f];
}
