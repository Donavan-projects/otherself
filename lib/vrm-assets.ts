// Préparation de l'avatar 3D (VRM) dans une page de l'extension : lit avatar/otherself.vrm (allégé par
// npm run vrm), calcule le cadrage, dessine le slogan (bannerText) à plat dans les coordonnées du cadre, rastérise le
// fond. Le slogan est imprimé dans la texture du sweat par la page (lib/avatar-vrm.ts), sur le personnage posé. La page
// de la plateforme ne reçoit que le modèle et des images (jamais la configuration ni la clé API).

import { AVATAR_HEIGHT, AVATAR_WIDTH, composeFrame, SLOGAN_BOTTOM, type Rect } from './avatar';
import { canvas, context, drawSlogan, fetchText, rasterize, toBlob, type SloganStyle } from './avatar-assets';
import type { DemoConfig } from './config';
import { findPrimitive, readAccessor, readGlb, vrmOf, type Glb, type Primitive } from './glb';
import { createLogger } from './log';
import { frameY, solveVrmCamera, VRM_FRAME_ANCHOR, VRM_SLOGAN_TOP, type BoneLandmark, type VrmCamera } from './vrm-frame';

const log = createLogger('avatar');

const MODEL_URL = '/avatar-vrm/otherself.vrm';
const TOPS_MATERIAL = /Tops/i;
/** Slogan dessiné à plat avec 3 pixels par pixel du cadre (netteté une fois imprimé dans la texture agrandie). */
const FLAT_OVERSAMPLING = 3;
const FLAT_PAD = 4;

/** Slogan à plat : zone qu'il occupe dans le cadre (pixels), et échelle et marge de son image. */
export interface VrmSloganPlacement {
  zone: Rect;
  scale: number;
  pad: number;
}

export interface VrmAssets<T> {
  /** Modèle VRM (avatar/otherself.vrm, tel quel). */
  model: T;
  /** Slogan dessiné à plat (PNG transparent), à imprimer sur le sweat dans la page. */
  slogan: T;
  sloganPlacement: VrmSloganPlacement;
  /** Fond plein cadre 1280×720. */
  background: T;
  banner: Rect;
  camera: VrmCamera;
}

export async function mapVrmAssets<A, B>(assets: VrmAssets<A>, convert: (file: A) => Promise<B>): Promise<VrmAssets<B>> {
  return { ...assets, model: await convert(assets.model), slogan: await convert(assets.slogan), background: await convert(assets.background) };
}

export type VrmVariant = Pick<DemoConfig, 'background' | 'bannerText' | 'bannerOffsetY'>;

/**
 * Prépare l'avatar 3D. Le slogan reprend celui du personnage SVG (sloganStyle, de buildAvatarAssets) : même zone dans
 * le cadre, mêmes lignes, même police, même encre.
 */
export async function buildVrmAssets(variant: VrmVariant, sloganStyle: SloganStyle): Promise<VrmAssets<Blob>> {
  const started = performance.now();
  const response = await fetch(browser.runtime.getURL(MODEL_URL as '/'));
  if (!response.ok) throw new Error(`${MODEL_URL} introuvable (${response.status})`);
  const model = await response.blob();
  const glb = readGlb(new Uint8Array(await model.arrayBuffer()), 'otherself.vrm');
  const anchorY = boneHeight(glb, VRM_FRAME_ANCHOR);
  const sloganTop = boneHeight(glb, VRM_SLOGAN_TOP);
  const shirt = readShirt(glb, anchorY);
  const top = hairTop(glb);
  const camera = solveVrmCamera(top, { y: anchorY, z: shirt.frontZ(anchorY) });
  const sloganTopInFrame = Math.round(frameY(camera, sloganTop, shirt.frontZ(sloganTop)));
  log(`repères : haut des cheveux ${top.y.toFixed(3)} m, cadrage ${anchorY.toFixed(3)} m (y = 517), haut du slogan ${sloganTop.toFixed(3)} m (y = ${sloganTopInFrame})`);
  const slogan = await drawFlatSlogan(variant.bannerText, sloganStyle, sloganTopInFrame);
  const background = await rasterize(await fetchText(`/avatar-svg/fonds/${variant.background}.svg`), AVATAR_WIDTH, AVATAR_HEIGHT);
  // Bandeau placé comme pour le personnage SVG : sous y = SLOGAN_BOTTOM, bannerOffsetY borné.
  const layout = composeFrame({ width: 1, hairTop: 0, sloganBottom: 1, sloganBottomInFrame: SLOGAN_BOTTOM }, variant.bannerOffsetY);
  if (layout.clamped) log(`bannerOffsetY = ${variant.bannerOffsetY} hors limites : bandeau ramené à y = ${layout.banner.y} (zone de sécurité)`);
  const assets: VrmAssets<Blob> = {
    model,
    slogan: slogan.image,
    sloganPlacement: slogan.placement,
    background: await toBlob(background),
    banner: layout.banner,
    camera,
  };
  log(
    `avatar 3D préparé en ${Math.round(performance.now() - started)} ms : modèle ${(assets.model.size / 1e6).toFixed(1)} Mo, ` +
      `caméra à ${camera.distance.toFixed(2)} m, fond ${variant.background}, bandeau y = ${layout.banner.y}`,
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

/**
 * Slogan à plat, comme sur le personnage SVG : zone de même taille dans le cadre, mêmes lignes, même police, même
 * encre, centrée, son haut à y = top (haut du torse, sous l'encolure). Pas de courbure : le torse 3D la donne.
 */
async function drawFlatSlogan(text: string, style: SloganStyle, top: number): Promise<{ image: Blob; placement: VrmSloganPlacement }> {
  const zone: Rect = { x: (AVATAR_WIDTH - style.width) / 2, y: top, width: style.width, height: style.height };
  const scale = FLAT_OVERSAMPLING;
  const pad = FLAT_PAD;
  const flat = canvas(Math.ceil(zone.width * scale) + 2 * pad, Math.ceil(zone.height * scale) + 2 * pad);
  const drawn = await drawSlogan(context(flat), text, style.ink, { x: pad, y: pad, width: zone.width * scale, height: zone.height * scale }, 0, style.maxLines);
  log(
    `slogan du sweat : ${drawn.lines.map((line) => `« ${line} »`).join(' / ')}, police ${(drawn.size / scale).toFixed(1)} px dans le cadre ` +
      `(SVG : ${style.fontSize} px), y = ${Math.round(zone.y)} à ${Math.round(zone.y + zone.height)}, encre ${style.ink}`,
  );
  return { image: await toBlob(flat), placement: { zone, scale, pad } };
}
