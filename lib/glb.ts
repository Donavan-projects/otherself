// Lecture et écriture des fichiers GLB (VRM) sans dépendance : utilisé par le script manuel d'allègement
// (scripts/optimize-vrm.ts, Node) et par la préparation de l'avatar 3D dans l'extension (lib/vrm-assets.ts).

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export type Json = Record<string, unknown>;
export interface BufferView extends Json { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
export interface Accessor extends Json { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }
export interface Primitive extends Json { attributes: Record<string, number>; indices?: number; material?: number; targets?: Record<string, number>[] }
export interface Mesh extends Json { name?: string; primitives: Primitive[]; weights?: number[]; extras?: { targetNames?: string[] } }
export interface GltfImage extends Json { name?: string; bufferView?: number; mimeType?: string; uri?: string }
export interface GltfTexture extends Json { source?: number; sampler?: number; name?: string }
export interface GltfMaterial extends Json { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }
export interface GltfNode extends Json { mesh?: number }
export interface Skin extends Json { inverseBindMatrices?: number }
export interface Bind extends Json { node?: number; index?: number; material?: number }
export interface Expression extends Json { morphTargetBinds?: Bind[]; materialColorBinds?: Bind[]; textureTransformBinds?: Bind[] }
export interface Vrm extends Json {
  specVersion?: string;
  meta: Json & { thumbnailImage?: number; commercialUsage?: string };
  humanoid: { humanBones: Record<string, unknown> };
  expressions?: { preset?: Record<string, Expression>; custom?: Record<string, Expression> };
  lookAt?: { type?: string };
}
export interface Gltf extends Json {
  buffers: Json[];
  bufferViews: BufferView[];
  accessors: Accessor[];
  meshes: Mesh[];
  nodes: GltfNode[];
  materials: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
  samplers?: Json[];
  skins?: Skin[];
  animations?: { samplers: { input: number; output: number }[] }[];
  extensions?: { VRMC_vrm?: Vrm; VRMC_springBone?: { springs?: { joints: unknown[] }[] } };
}

export interface Glb {
  json: Gltf;
  bin: Uint8Array;
}

export function readGlb(data: Uint8Array, name = 'modèle'): Glb {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${name} : pas un fichier GLB/VRM`);
  let offset = 12;
  let json: Gltf | null = null;
  let bin: Uint8Array = new Uint8Array();
  while (offset + 8 <= data.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    else if (type === CHUNK_BIN) bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error(`${name} : bloc JSON absent`);
  if (json.buffers.length !== 1 || json.buffers[0]?.uri !== undefined) throw new Error(`${name} : un seul tampon intégré attendu`);
  return { json, bin };
}

export function writeGlb(glb: Glb): Uint8Array<ArrayBuffer> {
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
  return out;
}

export function vrmOf(json: Gltf): Vrm {
  const vrm = json.extensions?.VRMC_vrm;
  if (!vrm) throw new Error('extension VRMC_vrm absente (VRM 0.x non pris en charge)');
  return vrm;
}

/** Octets d'une vue du tampon. */
export function viewBytes(glb: Glb, index: number): Uint8Array {
  const view = glb.json.bufferViews[index];
  if (!view) throw new Error(`vue ${index} absente`);
  const start = view.byteOffset ?? 0;
  return glb.bin.subarray(start, start + view.byteLength);
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Valeurs d'un accesseur (flottants ou entiers non signés, sans normalisation), par élément. */
export function readAccessor(glb: Glb, index: number): number[][] {
  const accessor = glb.json.accessors[index];
  if (!accessor || accessor.bufferView === undefined || accessor.sparse) throw new Error(`accesseur ${index} illisible`);
  const view = glb.json.bufferViews[accessor.bufferView]!;
  const size = COMPONENTS[accessor.type] ?? 1;
  const bytes = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[accessor.componentType];
  if (!bytes) throw new Error(`accesseur ${index} : type ${accessor.componentType} non pris en charge`);
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
  const stride = view.byteStride ?? size * bytes;
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const element: number[] = [];
    for (let c = 0; c < size; c += 1) {
      const at = i * stride + c * bytes;
      element.push(
        accessor.componentType === 5126 ? data.getFloat32(at, true)
        : accessor.componentType === 5125 ? data.getUint32(at, true)
        : accessor.componentType === 5123 ? data.getUint16(at, true)
        : data.getUint8(at),
      );
    }
    out.push(element);
  }
  return out;
}

/** Ajoute des octets à la fin du tampon binaire, dans une nouvelle vue ; renvoie son indice. */
export function appendView(glb: Glb, bytes: Uint8Array): number {
  const start = glb.bin.byteLength + ((4 - (glb.bin.byteLength % 4)) % 4);
  const bin = new Uint8Array(start + bytes.byteLength);
  bin.set(glb.bin, 0);
  bin.set(bytes, start);
  glb.bin = bin;
  glb.json.buffers[0] = { ...glb.json.buffers[0], byteLength: bin.byteLength };
  glb.json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: bytes.byteLength });
  return glb.json.bufferViews.length - 1;
}

/** Primitive du matériau dont le nom correspond (vêtements VRoid : « Tops », « Bottoms »…). */
export function findPrimitive(json: Gltf, materialName: RegExp): { primitive: Primitive; material: number } | null {
  const material = json.materials.findIndex((item) => materialName.test(item.name ?? ''));
  if (material < 0) return null;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) if (primitive.material === material) return { primitive, material };
  return null;
}
