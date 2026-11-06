// Inspecte et allège le modèle VRM exporté par VRoid Studio. Script MANUEL : le fichier source
// (avatar/Otherself.vrm) n'est pas commité, seul le résultat (avatar/otherself.vrm) l'est.
//   npm run vrm -- inspect [fichier]                 rapport seul (licence, expressions, poids)
//   npm run vrm -- optimize [source] [destination]   allège puis affiche les deux rapports
//
// Allègement, sans toucher au squelette ni à la physique :
// - miniature retirée (meta.thumbnailImage), inutile au rendu ;
// - primitives des vêtements jamais à l'image retirées (pantalon, chaussures : cadrage en buste) ;
// - morph targets que n'utilise aucune expression retirés (VRoid en exporte 57 sur le visage) ;
// - textures ramenées à 1024 px au plus (PNG, sans perte au-delà de la réduction) ;
// - accesseurs, matériaux, textures et images devenus inutiles retirés, binaire réempaqueté.
// gltf-transform n'est pas utilisé : il supprime les extensions qu'il ne connaît pas (VRMC_*), dont les
// indices (nœuds, matériaux, morph targets) sont ici renumérotés à la main.

import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const DEFAULT_SOURCE = 'avatar/Otherself.vrm';
const DEFAULT_DESTINATION = 'avatar/otherself.vrm';
/** Matériaux dont les primitives sont retirées : jamais visibles dans un cadrage en buste. */
const DROPPED_MATERIALS = [/Bottoms/i, /Shoes/i];
const MAX_TEXTURE_SIZE = 1024;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

type Json = Record<string, unknown>;
interface BufferView extends Json { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
interface Accessor extends Json { bufferView?: number; count: number; sparse?: unknown }
interface Primitive extends Json { attributes: Record<string, number>; indices?: number; material?: number; targets?: Record<string, number>[] }
interface Mesh extends Json { name?: string; primitives: Primitive[]; weights?: number[]; extras?: { targetNames?: string[] } }
interface Image extends Json { name?: string; bufferView?: number; mimeType?: string; uri?: string }
interface Texture extends Json { source?: number }
interface Material extends Json { name?: string }
interface Node extends Json { mesh?: number }
interface Skin extends Json { inverseBindMatrices?: number }
interface Bind extends Json { node?: number; index?: number; material?: number }
interface Expression extends Json { morphTargetBinds?: Bind[]; materialColorBinds?: Bind[]; textureTransformBinds?: Bind[] }
interface Gltf extends Json {
  buffers: Json[];
  bufferViews: BufferView[];
  accessors: Accessor[];
  meshes: Mesh[];
  nodes: Node[];
  materials: Material[];
  textures?: Texture[];
  images?: Image[];
  skins?: Skin[];
  animations?: { samplers: { input: number; output: number }[] }[];
  extensions?: { VRMC_vrm?: Vrm; VRMC_springBone?: { springs?: { joints: unknown[] }[] } };
}
interface Vrm extends Json {
  specVersion?: string;
  meta: Json & { thumbnailImage?: number; commercialUsage?: string };
  humanoid: { humanBones: Record<string, unknown> };
  expressions?: { preset?: Record<string, Expression>; custom?: Record<string, Expression> };
  lookAt?: { type?: string };
}

interface Glb {
  json: Gltf;
  bin: Uint8Array;
}

function readGlb(path: string): Glb {
  const data = readFileSync(path);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${path} : pas un fichier GLB/VRM`);
  let offset = 12;
  let json: Gltf | null = null;
  let bin = new Uint8Array();
  while (offset < data.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    else if (type === CHUNK_BIN) bin = new Uint8Array(chunk);
    offset += 8 + length;
  }
  if (!json) throw new Error(`${path} : bloc JSON absent`);
  if (json.buffers.length !== 1 || json.buffers[0]?.uri !== undefined) throw new Error(`${path} : un seul tampon intégré attendu`);
  return { json, bin };
}

function writeGlb(path: string, glb: Glb): number {
  const pad = (length: number) => (4 - (length % 4)) % 4;
  let jsonText = JSON.stringify(glb.json);
  jsonText += ' '.repeat(pad(new TextEncoder().encode(jsonText).byteLength));
  const jsonBytes = new TextEncoder().encode(jsonText);
  const binLength = glb.bin.byteLength + pad(glb.bin.byteLength);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.byteLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  out.set(glb.bin, binStart + 8);
  writeFileSync(path, out);
  return total;
}

const vrmOf = (json: Gltf): Vrm => {
  const vrm = json.extensions?.VRMC_vrm;
  if (!vrm) throw new Error('extension VRMC_vrm absente (VRM 0.x non pris en charge)');
  return vrm;
};

function expressionsOf(vrm: Vrm): [string, Expression][] {
  return [...Object.entries(vrm.expressions?.preset ?? {}), ...Object.entries(vrm.expressions?.custom ?? {})];
}

/** Toutes les références de texture des matériaux (dont extensions MToon) : objets `…Texture` avec un index. */
function textureRefs(value: unknown, visit: (ref: { index: number }) => void, key = '') {
  if (Array.isArray(value)) {
    for (const item of value) textureRefs(item, visit);
  } else if (value && typeof value === 'object') {
    const record = value as Json;
    if (/texture$/i.test(key) && typeof record.index === 'number') visit(record as { index: number });
    for (const [childKey, child] of Object.entries(record)) textureRefs(child, visit, childKey);
  }
}

function isOutlined(material: Material): boolean {
  const mtoon = (material.extensions as Json | undefined)?.VRMC_materials_mtoon as Json | undefined;
  return !!mtoon && mtoon.outlineWidthMode !== undefined && mtoon.outlineWidthMode !== 'none' && Number(mtoon.outlineWidthFactor ?? 0) > 0;
}

function imageSize(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return `${view.getUint32(16)}×${view.getUint32(20)}`;
  }
  return '?';
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} Mo`;

function report(label: string, glb: Glb, fileSize: number) {
  const { json, bin } = glb;
  const vrm = vrmOf(json);
  const lines: string[] = [`=== ${label} : ${mb(fileSize)} ===`];
  const { thumbnailImage, ...meta } = vrm.meta;
  lines.push(`VRM ${vrm.specVersion ?? '?'}, licence : ${JSON.stringify(meta)}`);
  lines.push(`miniature : ${thumbnailImage === undefined ? 'aucune' : `image ${thumbnailImage}`}`);
  lines.push(`expressions : ${expressionsOf(vrm).map(([name]) => name).join(', ')}`);
  lines.push(`regard : ${vrm.lookAt?.type ?? '?'}, os : ${Object.keys(vrm.humanoid.humanBones).length}, ` +
    `articulations de physique : ${(json.extensions?.VRMC_springBone?.springs ?? []).reduce((sum, spring) => sum + spring.joints.length, 0)}`);

  let triangles = 0;
  let outlined = 0;
  const targetAccessors = new Set<number>();
  for (const mesh of json.meshes) {
    let meshTriangles = 0;
    for (const primitive of mesh.primitives) {
      const count = primitive.indices === undefined ? 0 : Math.floor((json.accessors[primitive.indices]?.count ?? 0) / 3);
      meshTriangles += count;
      const material = primitive.material === undefined ? undefined : json.materials[primitive.material];
      if (material && isOutlined(material)) outlined += count;
      for (const target of primitive.targets ?? []) for (const accessor of Object.values(target)) targetAccessors.add(accessor);
    }
    triangles += meshTriangles;
    const materials = mesh.primitives.map((primitive) => json.materials[primitive.material ?? -1]?.name?.replace(/ \(Instance\)$/, '') ?? '?');
    lines.push(`maillage « ${mesh.name ?? '?'} » : ${meshTriangles} triangles, ${mesh.primitives[0]?.targets?.length ?? 0} morph targets, matériaux ${materials.join(', ')}`);
  }
  lines.push(`triangles : ${triangles}, dont ${outlined} avec contour MToon (dessinés deux fois : ${triangles + outlined} par image)`);

  const viewBytes = (index: number | undefined) => (index === undefined ? 0 : json.bufferViews[index]?.byteLength ?? 0);
  let imageBytes = 0;
  const imageLines: string[] = [];
  (json.images ?? []).forEach((image, index) => {
    const view = json.bufferViews[image.bufferView ?? -1];
    const bytes = view ? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) : new Uint8Array();
    imageBytes += bytes.byteLength;
    imageLines.push(`  ${index} ${image.name ?? ''} ${imageSize(bytes)} ${mb(bytes.byteLength)}`);
  });
  const morphBytes = [...new Set([...targetAccessors].map((accessor) => json.accessors[accessor]?.bufferView))].reduce<number>((sum, view) => sum + viewBytes(view), 0);
  lines.push(`poids : images ${mb(imageBytes)}, morph targets ${mb(morphBytes)}, reste de la géométrie ${mb(bin.byteLength - imageBytes - morphBytes)}`);
  lines.push(...imageLines);
  console.log(lines.join('\n'));
}

/** Renumérote une liste en ne gardant que les éléments utilisés ; renvoie l'ancien → nouvel indice. */
function compact<T>(items: T[], used: Set<number>): { kept: T[]; map: Map<number, number> } {
  const map = new Map<number, number>();
  const kept: T[] = [];
  items.forEach((item, index) => {
    if (!used.has(index)) return;
    map.set(index, kept.length);
    kept.push(item);
  });
  return { kept, map };
}

function remap(map: Map<number, number>, index: number): number {
  const value = map.get(index);
  if (value === undefined) throw new Error(`indice ${index} retiré mais encore référencé`);
  return value;
}

async function optimize(source: Glb): Promise<Glb> {
  const json = structuredClone(source.json);
  const vrm = vrmOf(json);
  const expressions = expressionsOf(vrm).map(([, expression]) => expression);

  // 1. Miniature.
  delete vrm.meta.thumbnailImage;

  // 2. Primitives des vêtements jamais à l'image.
  for (const mesh of json.meshes) {
    mesh.primitives = mesh.primitives.filter((primitive) => {
      const name = json.materials[primitive.material ?? -1]?.name ?? '';
      return !DROPPED_MATERIALS.some((pattern) => pattern.test(name));
    });
  }

  // 3. Morph targets utilisés par au moins une expression, par maillage.
  const usedTargets = new Map<number, Set<number>>();
  for (const expression of expressions) {
    for (const bind of expression.morphTargetBinds ?? []) {
      const mesh = json.nodes[bind.node ?? -1]?.mesh;
      if (mesh === undefined || bind.index === undefined) continue;
      if (!usedTargets.has(mesh)) usedTargets.set(mesh, new Set());
      usedTargets.get(mesh)!.add(bind.index);
    }
  }
  const targetMaps = new Map<number, Map<number, number>>();
  json.meshes.forEach((mesh, meshIndex) => {
    const count = mesh.primitives[0]?.targets?.length ?? 0;
    if (count === 0) return;
    const { map } = compact(Array.from({ length: count }), usedTargets.get(meshIndex) ?? new Set());
    targetMaps.set(meshIndex, map);
    const keep = <T>(list: T[] | undefined) => list?.filter((_, index) => map.has(index));
    for (const primitive of mesh.primitives) primitive.targets = keep(primitive.targets);
    mesh.weights = keep(mesh.weights);
    if (mesh.extras?.targetNames) mesh.extras.targetNames = keep(mesh.extras.targetNames);
  });
  for (const expression of expressions) {
    for (const bind of expression.morphTargetBinds ?? []) {
      const map = targetMaps.get(json.nodes[bind.node ?? -1]?.mesh ?? -1);
      if (map && bind.index !== undefined) bind.index = remap(map, bind.index);
    }
  }

  // 4. Matériaux encore utilisés (les liaisons d'expressions vers un matériau retiré disparaissent).
  const usedMaterials = new Set(json.meshes.flatMap((mesh) => mesh.primitives.map((primitive) => primitive.material ?? -1)));
  const materials = compact(json.materials, usedMaterials);
  json.materials = materials.kept;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) if (primitive.material !== undefined) primitive.material = remap(materials.map, primitive.material);
  for (const expression of expressions) {
    for (const key of ['materialColorBinds', 'textureTransformBinds'] as const) {
      const binds = expression[key];
      if (!binds) continue;
      expression[key] = binds.filter((bind) => materials.map.has(bind.material ?? -1));
      for (const bind of expression[key]!) bind.material = remap(materials.map, bind.material!);
    }
  }

  // 5. Textures puis images encore utilisées.
  const usedTextures = new Set<number>();
  textureRefs(json.materials, (ref) => usedTextures.add(ref.index));
  const textures = compact(json.textures ?? [], usedTextures);
  json.textures = textures.kept;
  textureRefs(json.materials, (ref) => (ref.index = remap(textures.map, ref.index)));
  const usedImages = new Set(json.textures.map((texture) => texture.source ?? -1));
  const images = compact(json.images ?? [], usedImages);
  json.images = images.kept;
  for (const texture of json.textures) if (texture.source !== undefined) texture.source = remap(images.map, texture.source);

  // 6. Accesseurs encore utilisés.
  const usedAccessors = new Set<number>();
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      for (const accessor of Object.values(primitive.attributes)) usedAccessors.add(accessor);
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets ?? []) for (const accessor of Object.values(target)) usedAccessors.add(accessor);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) usedAccessors.add(sampler.input).add(sampler.output);
  const accessors = compact(json.accessors, usedAccessors);
  json.accessors = accessors.kept;
  if (json.accessors.some((accessor) => accessor.sparse)) throw new Error('accesseurs creux (sparse) non pris en charge');
  const reindex = (record: Record<string, number>) => {
    for (const key of Object.keys(record)) record[key] = remap(accessors.map, record[key]!);
  };
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      reindex(primitive.attributes);
      if (primitive.indices !== undefined) primitive.indices = remap(accessors.map, primitive.indices);
      for (const target of primitive.targets ?? []) reindex(target);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(accessors.map, skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers) {
      sampler.input = remap(accessors.map, sampler.input);
      sampler.output = remap(accessors.map, sampler.output);
    }
  }

  // 7. Binaire réempaqueté : vues encore utilisées, images réduites à MAX_TEXTURE_SIZE.
  const chunks: Uint8Array[] = [];
  const views: BufferView[] = [];
  let length = 0;
  const append = (bytes: Uint8Array, view: Omit<BufferView, 'byteOffset' | 'byteLength' | 'buffer'>) => {
    const padding = (4 - (length % 4)) % 4;
    if (padding) chunks.push(new Uint8Array(padding));
    length += padding;
    views.push({ ...view, buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    chunks.push(bytes);
    length += bytes.byteLength;
    return views.length - 1;
  };
  const sourceBytes = (index: number) => {
    const view = source.json.bufferViews[index]!;
    return source.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  };
  const viewMap = new Map<number, number>();
  for (const accessor of json.accessors) {
    if (accessor.bufferView === undefined) continue;
    const old = accessor.bufferView;
    if (!viewMap.has(old)) {
      const { buffer: _buffer, byteOffset: _offset, byteLength: _length, ...rest } = source.json.bufferViews[old]!;
      viewMap.set(old, append(sourceBytes(old), rest));
    }
    accessor.bufferView = viewMap.get(old)!;
  }
  for (const image of json.images) {
    if (image.bufferView === undefined) continue;
    let bytes: Uint8Array = sourceBytes(image.bufferView);
    const picture = sharp(bytes);
    const { width = 0, height = 0 } = await picture.metadata();
    if (Math.max(width, height) > MAX_TEXTURE_SIZE) {
      bytes = new Uint8Array(await picture.resize({ width: MAX_TEXTURE_SIZE, height: MAX_TEXTURE_SIZE, fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer());
      image.mimeType = 'image/png';
    }
    image.bufferView = append(bytes, {});
  }
  json.bufferViews = views;
  const bin = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bin.set(chunk, offset);
    offset += chunk.byteLength;
  }
  json.buffers = [{ byteLength: length }];
  return { json, bin };
}

const [command = 'inspect', first, second] = process.argv.slice(2);
if (command === 'inspect') {
  const path = first ?? DEFAULT_DESTINATION;
  report(path, readGlb(path), readFileSync(path).byteLength);
} else if (command === 'optimize') {
  const sourcePath = first ?? DEFAULT_SOURCE;
  const destination = second ?? DEFAULT_DESTINATION;
  if (sourcePath === destination) throw new Error('la destination doit différer de la source');
  const source = readGlb(sourcePath);
  report(sourcePath, source, readFileSync(sourcePath).byteLength);
  const size = writeGlb(destination, await optimize(source));
  report(destination, readGlb(destination), size);
} else {
  console.error('usage : npm run vrm -- inspect [fichier] | optimize [source] [destination]');
  process.exit(1);
}
