// Cadrage de l'avatar 3D (VRM), sans three.js : partagé par la préparation (lib/vrm-assets.ts, qui calcule la
// caméra) et par le rendu (lib/avatar-vrm.ts).
// Caméra fixe, horizontale, face au personnage, en (0, cameraY, distance) regardant vers −Z.

import { AVATAR_HEIGHT } from './avatar';

/**
 * Plan serré (tête et épaules, 3b) : angle de vue étroit plutôt que caméra rapprochée, pour ne pas déformer le
 * visage. 10,8° à environ 3,4 m (androïde) : même distance qu'en plan large (18°), image ≈ 1,67 fois plus grande.
 */
export const VRM_FOV = 10.8;
/** Haut des cheveux posés dans le cadre (pixels). */
export const VRM_HEAD_TOP = 54;
/**
 * Centre de la languette du col dans le cadre (pixels) : sous la coupe du cadrage automatique de Meet (vue partagée :
 * y 0 à ≈ 536 gardés), avec marge, pour le badge IA et le voyant d'état (3c).
 */
export const VRM_COLLAR_Y = 470;
/** Hauteur placée entre deux os du squelette humanoïde (fraction at de from vers to), en pose de repos. */
export interface BoneLandmark {
  from: string;
  to: string;
  at: number;
}

/**
 * Languette du col (motif de la texture de la veste, pas une pièce séparée), placée à y = VRM_COLLAR_Y, le haut des
 * cheveux étant à y = VRM_HEAD_TOP. Repérée par les os, pas en mètres, pour suivre les proportions du modèle à chaque
 * réexport : un peu au-dessus de l'os neck (androïde : languette à ≈ 1,56 m, upperChest 1,378 m, neck 1,549 m).
 */
export const VRM_FRAME_ANCHOR: BoneLandmark = { from: 'upperChest', to: 'neck', at: 1.027 };
/** Hauteur où est prise la profondeur du repère : devant de la veste au niveau de l'os upperChest (zone plate). */
export const VRM_DEPTH_REFERENCE: BoneLandmark = { from: 'upperChest', to: 'neck', at: 0 };

export interface VrmCamera {
  /** Hauteur et distance de la caméra (mètres). */
  y: number;
  distance: number;
}

const focal = () => AVATAR_HEIGHT / 2 / Math.tan(((VRM_FOV / 2) * Math.PI) / 180);

/** Caméra qui place le haut des cheveux (y, z) à VRM_HEAD_TOP et la languette du col (y, z) à VRM_COLLAR_Y. */
export function solveVrmCamera(top: { y: number; z: number }, anchor: { y: number; z: number }): VrmCamera {
  const f = focal();
  // y_px = H/2 − (Y − cameraY)·f / (distance − Z), écrit pour les deux points puis résolu.
  const k1 = (AVATAR_HEIGHT / 2 - VRM_HEAD_TOP) / f;
  const k2 = (AVATAR_HEIGHT / 2 - VRM_COLLAR_Y) / f;
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
