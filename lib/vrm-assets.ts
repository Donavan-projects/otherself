// Préparation de l'avatar 3D (prototype VRM) dans une page de l'extension : lit avatar/otherself.vrm (allégé par
// npm run vrm), imprime le slogan (bannerText) dans la texture du sweat, rastérise le fond. La page de la
// plateforme ne reçoit que le modèle modifié et des images (jamais la configuration ni la clé API).

import { composeFrame, SLOGAN_BOTTOM, type Rect } from './avatar';
import { canvas, context, drawSlogan, fetchText, rasterize, toBlob } from './avatar-assets';
import type { DemoConfig } from './config';
import { appendView, findPrimitive, readAccessor, readGlb, writeGlb, type Glb, type Primitive } from './glb';
import { createLogger } from './log';
import { AVATAR_HEIGHT, AVATAR_WIDTH } from './avatar';

const log = createLogger('avatar');

const MODEL_URL = '/avatar-vrm/otherself.vrm';
const TOPS_MATERIAL = /Tops/i;
/**
 * Zone du slogan sur le devant du sweat, en mètres dans l'espace du modèle (avatar/otherself.vrm, pose de repos) :
 * sous l'encolure en V, au milieu de la poitrine (cordons retirés par npm run vrm). Son bas est placé à
 * y = SLOGAN_BOTTOM dans le cadre (lib/avatar-vrm.ts), comme le slogan du personnage SVG.
 */
export const VRM_SLOGAN_ZONE = { centerX: 0, width: 0.3, top: 1.565, bottom: 1.375 };
const SLOGAN_LINES_MAX = 3;
/** Encre du slogan : jaune du badge du personnage SVG (classe badge-fond). */
const SLOGAN_INK = '#f2c62e';
/** Texture du sweat agrandie avant d'y écrire : lettres nettes même si le modèle allégé la garde en 1024. */
const SHIRT_TEXTURE_SIZE = 2048;
/** Écart maximal (en UV) toléré entre la projection plane et la texture réelle du sweat dans la zone. */
const MAX_UV_ERROR = 0.02;

export interface VrmAssets<T> {
  /** Modèle VRM, slogan imprimé sur le sweat. */
  model: T;
  /** Fond plein cadre 1280×720. */
  background: T;
  banner: Rect;
  /** Haut, bas et profondeur du devant du sweat au milieu du slogan (mètres, espace du modèle) : sert au cadrage. */
  slogan: { top: number; bottom: number; front: number };
}

export async function mapVrmAssets<A, B>(assets: VrmAssets<A>, convert: (file: A) => Promise<B>): Promise<VrmAssets<B>> {
  return { ...assets, model: await convert(assets.model), background: await convert(assets.background) };
}

export type VrmVariant = Pick<DemoConfig, 'background' | 'bannerText' | 'bannerOffsetY'>;

export async function buildVrmAssets(variant: VrmVariant): Promise<VrmAssets<Blob>> {
  const started = performance.now();
  const response = await fetch(browser.runtime.getURL(MODEL_URL as '/'));
  if (!response.ok) throw new Error(`${MODEL_URL} introuvable (${response.status})`);
  const glb = readGlb(new Uint8Array(await response.arrayBuffer()), 'otherself.vrm');
  const front = await printSlogan(glb, variant.bannerText);
  const background = await rasterize(await fetchText(`/avatar-svg/fonds/${variant.background}.svg`), AVATAR_WIDTH, AVATAR_HEIGHT);
  // Bandeau placé comme pour le personnage SVG : bas du slogan à SLOGAN_BOTTOM, bandeau dessous (bannerOffsetY borné).
  const layout = composeFrame({ width: 1, hairTop: 0, sloganBottom: 1, sloganBottomInFrame: SLOGAN_BOTTOM }, variant.bannerOffsetY);
  if (layout.clamped) log(`bannerOffsetY = ${variant.bannerOffsetY} hors limites : bandeau ramené à y = ${layout.banner.y} (zone de sécurité)`);
  const assets: VrmAssets<Blob> = {
    model: new Blob([writeGlb(glb)], { type: 'model/gltf-binary' }),
    background: await toBlob(background),
    banner: layout.banner,
    slogan: { top: VRM_SLOGAN_ZONE.top, bottom: VRM_SLOGAN_ZONE.bottom, front },
  };
  log(`avatar 3D préparé en ${Math.round(performance.now() - started)} ms : modèle ${(assets.model.size / 1e6).toFixed(1)} Mo, fond ${variant.background}, bandeau y = ${layout.banner.y}`);
  return assets;
}

/**
 * Écrit le slogan dans la texture du sweat. Le devant du sweat est déplié à plat dans la texture : la correspondance
 * (x, y) du modèle → (u, v) y est ajustée par moindres carrés sur les sommets de la zone, puis le slogan, dessiné à
 * plat, est posé dans la texture par cette transformation. La texture d'ombre de MToon est la même image.
 */
async function printSlogan(glb: Glb, text: string): Promise<number> {
  const { json } = glb;
  const found = findPrimitive(json, TOPS_MATERIAL);
  if (!found) throw new Error('otherself.vrm : matériau du sweat (Tops) introuvable');
  const material = json.materials[found.material]!;
  const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
  const imageIndex = textureIndex === undefined ? undefined : json.textures?.[textureIndex]?.source;
  const image = imageIndex === undefined ? undefined : json.images?.[imageIndex];
  if (!image || image.bufferView === undefined) throw new Error('otherself.vrm : texture du sweat introuvable');

  const map = fitUvMap(glb, found.primitive);
  const source = await createImageBitmap(new Blob([viewCopy(glb, image.bufferView)], { type: image.mimeType ?? 'image/png' }));
  const size = SHIRT_TEXTURE_SIZE;
  const texture = canvas(size, size);
  const ctx = context(texture);
  ctx.drawImage(source, 0, 0, size, size);
  source.close();

  // Slogan dessiné à plat en pixels « locaux » (L par mètre), puis posé dans la texture : locaux → mètres → UV → pixels.
  const zone = VRM_SLOGAN_ZONE;
  const L = map.u[0] * size;
  const left = zone.centerX - zone.width / 2;
  ctx.save();
  ctx.setTransform(
    (map.u[0] * size) / L,
    (map.v[0] * size) / L,
    (-map.u[1] * size) / L,
    (-map.v[1] * size) / L,
    (map.u[0] * left + map.u[1] * zone.top + map.u[2]) * size,
    (map.v[0] * left + map.v[1] * zone.top + map.v[2]) * size,
  );
  await drawSlogan(ctx, text, SLOGAN_INK, { x: 0, y: 0, width: zone.width * L, height: (zone.top - zone.bottom) * L }, 0, SLOGAN_LINES_MAX);
  ctx.restore();

  const png = new Uint8Array(await (await toBlob(texture)).arrayBuffer());
  image.bufferView = appendView(glb, png);
  image.mimeType = 'image/png';
  log(`slogan imprimé sur le sweat : texture ${size}×${size}, écart de la projection ${map.error.toFixed(4)} (UV)`);
  return map.front;
}

/** Copie des octets d'une vue (Blob exige un ArrayBuffer non partagé). */
function viewCopy(glb: Glb, index: number): Uint8Array<ArrayBuffer> {
  const view = glb.json.bufferViews[index]!;
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0);
  return new Uint8Array(glb.bin.buffer.slice(start, start + view.byteLength) as ArrayBuffer);
}

type Affine = [number, number, number];

/**
 * u = a·x + b·y + c et v = d·x + e·y + f sur les sommets tournés vers l'avant dans la zone du slogan, pris sur la seule
 * pièce du devant du sweat (composante connexe du sommet avant le plus proche du centre de la zone) : col, capuche et
 * autres pièces superposées ont leurs propres coordonnées de texture.
 */
function fitUvMap(glb: Glb, primitive: Primitive): { u: Affine; v: Affine; error: number; front: number } {
  const { attributes } = primitive;
  if (attributes.POSITION === undefined || attributes.NORMAL === undefined || attributes.TEXCOORD_0 === undefined || primitive.indices === undefined) {
    throw new Error('otherself.vrm : sweat sans positions, normales, coordonnées de texture ou indices');
  }
  const positions = readAccessor(glb, attributes.POSITION);
  const normals = readAccessor(glb, attributes.NORMAL);
  const uvs = readAccessor(glb, attributes.TEXCOORD_0);
  const indices = readAccessor(glb, primitive.indices).map((value) => value[0]!);
  const zone = VRM_SLOGAN_ZONE;
  const margin = 0.03;
  const facing = (index: number) => (normals[index]?.[2] ?? 0) >= 0.8;

  // Pièce du devant : composantes connexes par les triangles.
  const parent = positions.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  for (let t = 0; t + 2 < indices.length; t += 3) {
    parent[root(indices[t]!)] = root(indices[t + 1]!);
    parent[root(indices[t + 1]!)] = root(indices[t + 2]!);
  }
  const middle = (zone.top + zone.bottom) / 2;
  let nearest = -1;
  let nearestDistance = Infinity;
  positions.forEach(([x = 0, y = 0], index) => {
    if (!facing(index)) return;
    const distance = (x - zone.centerX) ** 2 + (y - middle) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  });
  if (nearest < 0) throw new Error('otherself.vrm : devant du sweat introuvable');
  const panel = root(nearest);

  const points: { x: number; y: number; u: number; v: number }[] = [];
  let front = -Infinity;
  positions.forEach(([x = 0, y = 0, z = 0], index) => {
    if (root(index) !== panel) return;
    if (Math.abs(x - zone.centerX) > zone.width / 2 + margin || y < zone.bottom - margin || y > zone.top + margin) return;
    if (!facing(index)) return;
    const [u = 0, v = 0] = uvs[index] ?? [];
    points.push({ x, y, u, v });
    if (Math.abs(x - zone.centerX) < 0.05) front = Math.max(front, z);
  });
  if (points.length < 12) throw new Error(`otherself.vrm : ${points.length} sommets du sweat dans la zone du slogan (12 au moins attendus)`);
  const solve = (key: 'u' | 'v'): Affine => {
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const r = [0, 0, 0];
    for (const point of points) {
      const row = [point.x, point.y, 1];
      for (let i = 0; i < 3; i += 1) {
        r[i]! += row[i]! * point[key];
        for (let j = 0; j < 3; j += 1) m[i]![j]! += row[i]! * row[j]!;
      }
    }
    return solve3(m, r);
  };
  const u = solve('u');
  const v = solve('v');
  let error = 0;
  for (const point of points) {
    error = Math.max(error, Math.abs(u[0] * point.x + u[1] * point.y + u[2] - point.u), Math.abs(v[0] * point.x + v[1] * point.y + v[2] - point.v));
  }
  if (error > MAX_UV_ERROR) throw new Error(`otherself.vrm : devant du sweat trop déformé dans la texture (écart ${error.toFixed(3)} > ${MAX_UV_ERROR})`);
  if (u[0] <= 0) throw new Error('otherself.vrm : texture du sweat inversée horizontalement, slogan illisible');
  return { u, v, error, front };
}

/** Système 3×3 par la règle de Cramer. */
function solve3(m: number[][], r: number[]): Affine {
  const det = (a: number[][]) =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-12) throw new Error('otherself.vrm : sommets du sweat mal répartis dans la zone du slogan');
  const column = (c: number) => det(m.map((row, i) => row.map((value, j) => (j === c ? r[i]! : value))));
  return [column(0) / d, column(1) / d, column(2) / d];
}
