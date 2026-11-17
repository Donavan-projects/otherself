// Préparation de l'avatar 3D (VRM) dans une page de l'extension : lit avatar/otherself.vrm (allégé par
// npm run vrm), calcule le cadrage (plan serré, lib/vrm-frame.ts), rastérise le fond. La page de la plateforme ne reçoit
// que le modèle et des images (jamais la configuration ni la clé API). Pas de slogan sur la veste depuis la sous-étape 3b.

import { AVATAR_HEIGHT, AVATAR_WIDTH } from './avatar';
import { fetchText, rasterize, toBlob } from './avatar-assets';
import type { DemoConfig } from './config';
import { findPrimitive, readAccessor, readGlb, vrmOf, type Glb, type Primitive } from './glb';
import { createLogger } from './log';
import { solveVrmCamera, VRM_COLLAR_Y, VRM_DEPTH_REFERENCE, VRM_FRAME_ANCHOR, VRM_HEAD_TOP, type BoneLandmark, type VrmCamera } from './vrm-frame';

const log = createLogger('avatar');

const MODEL_URL = '/avatar-vrm/otherself.vrm';
const TOPS_MATERIAL = /Tops/i;

export interface VrmAssets<T> {
  /** Modèle VRM (avatar/otherself.vrm, tel quel). */
  model: T;
  /** Fond plein cadre 1280×720. */
  background: T;
  camera: VrmCamera;
}

export async function mapVrmAssets<A, B>(assets: VrmAssets<A>, convert: (file: A) => Promise<B>): Promise<VrmAssets<B>> {
  return { ...assets, model: await convert(assets.model), background: await convert(assets.background) };
}

export type VrmVariant = Pick<DemoConfig, 'background'>;

/**
 * Prépare l'avatar 3D. modelName : page de test seulement (vrm.html?model=), autre fichier copié à la main dans avatar-vrm/
 * du build (ex. android-source) ; jamais dans la caméra injectée, qui prend toujours otherself.vrm.
 */
export async function buildVrmAssets(variant: VrmVariant, modelName?: string): Promise<VrmAssets<Blob>> {
  const started = performance.now();
  if (modelName !== undefined && !/^[\w-]+$/.test(modelName)) throw new Error(`nom de modèle invalide : ${modelName}`);
  const url = modelName ? `/avatar-vrm/${modelName}.vrm` : MODEL_URL;
  const response = await fetch(browser.runtime.getURL(url as '/'));
  if (!response.ok) throw new Error(`${url} introuvable (${response.status})`);
  const model = await response.blob();
  const glb = readGlb(new Uint8Array(await model.arrayBuffer()), 'otherself.vrm');
  const anchorY = boneHeight(glb, VRM_FRAME_ANCHOR);
  const shirt = readShirt(glb, anchorY);
  const top = hairTop(glb);
  // Profondeur du repère prise au devant de la veste à la hauteur de upperChest, zone plate : au bord du col, la
  // veste recule de plusieurs centimètres en quelques millimètres et la caméra sautait d'un réglage à l'autre.
  const camera = solveVrmCamera(top, { y: anchorY, z: shirt.frontZ(boneHeight(glb, VRM_DEPTH_REFERENCE)) });
  log(`repères : haut des cheveux ${top.y.toFixed(3)} m (y = ${VRM_HEAD_TOP}), languette du col ${anchorY.toFixed(3)} m (y = ${VRM_COLLAR_Y})`);
  const background = await rasterize(await fetchText(`/avatar-svg/fonds/${variant.background}.svg`), AVATAR_WIDTH, AVATAR_HEIGHT);
  const assets: VrmAssets<Blob> = {
    model,
    background: await toBlob(background),
    camera,
  };
  log(
    `avatar 3D préparé en ${Math.round(performance.now() - started)} ms : modèle ${(assets.model.size / 1e6).toFixed(1)} Mo, ` +
      `caméra à ${camera.distance.toFixed(2)} m, fond ${variant.background}`,
  );
  return assets;
}

/** Hauteur (mètres, pose de repos) d'un repère placé entre deux os : positions des os par leurs matrices glTF. */
function boneHeight(glb: Glb, landmark: BoneLandmark): number {
  const bones = vrmOf(glb.json).humanoid.humanBones as Record<string, { node?: number } | undefined>;
  const at = (name: string) => {
    const node = bones[name]?.node;
    if (node === undefined) throw new Error(`otherself.vrm : os ${name} absent`);
    return nodeWorldMatrix(glb, node)[13]!;
  };
  const from = at(landmark.from);
  return from + (at(landmark.to) - from) * landmark.at;
}

type Mat4 = number[];

/** Matrice du nœud dans la scène (ordre de glTF : colonnes), produit des matrices locales depuis la racine. */
function nodeWorldMatrix(glb: Glb, index: number): Mat4 {
  const nodes = glb.json.nodes as { children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  const parent = new Map<number, number>();
  nodes.forEach((node, i) => node.children?.forEach((child) => parent.set(child, i)));
  const local = (node: (typeof nodes)[number]): Mat4 => {
    if (node.matrix) return node.matrix;
    const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [];
    const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
    const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const multiply = (a: Mat4, b: Mat4): Mat4 => {
    const out: Mat4 = [];
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[column * 4 + k]!;
        out[column * 4 + row] = sum;
      }
    }
    return out;
  };
  let matrix = local(nodes[index]!);
  for (let up = parent.get(index); up !== undefined; up = parent.get(up)) matrix = multiply(local(nodes[up]!), matrix);
  return matrix;
}

/** Haut des cheveux en pose de repos : sommet le plus haut de tous les maillages (y, et sa profondeur z). */
function hairTop(glb: Glb): { y: number; z: number } {
  let best = { y: -Infinity, z: 0 };
  for (const mesh of glb.json.meshes) {
    for (const primitive of mesh.primitives) {
      const index = primitive.attributes.POSITION;
      const max = index === undefined ? undefined : (glb.json.accessors[index]?.max as number[] | undefined);
      if (index === undefined || !max || (max[1] ?? -Infinity) <= best.y) continue;
      for (const [, y = -Infinity, z = 0] of readAccessor(glb, index)) if (y > best.y) best = { y, z };
    }
  }
  if (!Number.isFinite(best.y)) throw new Error('otherself.vrm : aucun sommet');
  return best;
}

interface Shirt {
  /** Profondeur du devant du sweat au milieu du torse à la hauteur y. */
  frontZ(y: number): number;
}

/** Sweat : pièce du devant (composante connexe du triangle avant le plus proche du milieu de la poitrine, à y = chestY). */
function readShirt(glb: Glb, chestY: number): Shirt {
  const found = findPrimitive(glb.json, TOPS_MATERIAL);
  if (!found) throw new Error('otherself.vrm : matériau du sweat (Tops) introuvable');
  const primitive: Primitive = found.primitive;
  const { attributes, indices: indicesAccessor } = primitive;
  if (attributes.POSITION === undefined || indicesAccessor === undefined) throw new Error('otherself.vrm : sweat sans positions ou indices');
  const positions = readAccessor(glb, attributes.POSITION);
  const indices = readAccessor(glb, indicesAccessor).map((value) => value[0]!);

  const parent = positions.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  const triangles: [number, number, number][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const triangle: [number, number, number] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    triangles.push(triangle);
    parent[root(triangle[0])] = root(triangle[1]);
    parent[root(triangle[1])] = root(triangle[2]);
  }
  // Composante z de la normale d'un triangle (glTF : sommets dans le sens trigonométrique vus de devant).
  const facing = ([a, b, c]: [number, number, number]) => {
    const [ax = 0, ay = 0, az = 0] = positions[a]!;
    const [bx = 0, by = 0, bz = 0] = positions[b]!;
    const [cx = 0, cy = 0, cz = 0] = positions[c]!;
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return nz / (Math.hypot(nx, ny, nz) || 1);
  };
  let nearest: [number, number, number] | null = null;
  let nearestDistance = Infinity;
  for (const triangle of triangles) {
    if (facing(triangle) < 0.8) continue;
    const [x = 0, y = 0] = positions[triangle[0]]!;
    const distance = x * x + (y - chestY) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = triangle;
    }
  }
  if (!nearest) throw new Error('otherself.vrm : devant du sweat introuvable');
  const panel = root(nearest[0]);
  return {
    frontZ(height: number) {
      let z = -Infinity;
      positions.forEach(([x = 0, y = 0, depth = 0], index) => {
        if (root(index) === panel && Math.abs(x) < 0.05 && Math.abs(y - height) < 0.03) z = Math.max(z, depth);
      });
      if (!Number.isFinite(z)) throw new Error(`otherself.vrm : devant du sweat introuvable à y = ${height} m`);
      return z;
    },
  };
}
