// Rendu de l'avatar 3D (prototype VRM) dans le canvas 1280×720 de la caméra injectée. Tourne dans le monde MAIN de
// l'onglet (voie A) comme dans les pages de l'extension. three.js dessine le modèle dans un canvas WebGL hors DOM, à
// fond transparent, recopié à chaque image dans le canvas 2D capturé, par-dessus le fond ; le bandeau est peint en
// dernier dans ce canvas 2D (règle 1), exactement comme pour l'avatar SVG (lib/avatar.ts).
//
// Animation : bouche pilotée par le niveau de la voix (mêmes formes que le SVG, traduites en expressions VRM, avec
// transitions lissées), clignements, regard vers la caméra avec petites saccades, respiration, mouvements de tête au
// repos et en parlant, physique des cheveux (spring bones du modèle).

import * as THREE from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMExpressionPresetName, type VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  AVATAR_HEIGHT,
  AVATAR_WIDTH,
  BlinkAnimator,
  HEAD_TOP,
  MouthAnimator,
  drawBanner,
  drawSafeZone,
  type AvatarOptions,
  type MouthShape,
  type Rect,
} from './avatar';
import { affine, frameY, VRM_FOV, type VrmCamera } from './vrm-frame';

/** Ce que le rendu reçoit dans la page : modèle (slogan déjà imprimé), fond, bandeau, caméra (lib/vrm-frame.ts). */
export interface VrmSources {
  model: ArrayBuffer;
  background: ImageBitmap;
  banner: Rect;
  camera: VrmCamera;
  /** Slogan dessiné à plat (lib/vrm-assets.ts) et la zone qu'il doit occuper dans le cadre (pixels). */
  slogan: { image: ImageBitmap; zone: Rect; scale: number; pad: number };
}

/** Matériau du sweat (VRoid : « Tops ») et taille de sa texture une fois le slogan imprimé. */
const SHIRT_MATERIAL = /Tops/i;
const SHIRT_TEXTURE_SIZE = 2048;
/** Débord de chaque triangle (pixels de texture) : pas de joint visible entre deux triangles voisins. */
const TRIANGLE_BLEED = 0.75;

/** Rendu d'une image du flux : SVG (AvatarRenderer) ou VRM, dans le même canvas de sortie. */
export interface FrameRenderer {
  readonly canvas: HTMLCanvasElement;
  draw(now?: number): MouthShape;
  dispose?(): void;
}

// Bouche : formes du SVG → expressions VRM. M : lèvres fermées, donc rien d'ouvert.
const MOUTH_EXPRESSIONS: Record<MouthShape, Partial<Record<VRMExpressionPresetName, number>>> = {
  repos: {},
  M: {},
  E: { ee: 0.6, ih: 0.3 },
  A: { aa: 0.8 },
  O: { oh: 0.7, ou: 0.2 },
};
const VISEMES: VRMExpressionPresetName[] = ['aa', 'ih', 'ou', 'ee', 'oh'];
/** Constantes de temps (s) : ouverture plus vive que la fermeture, comme une vraie bouche. */
const MOUTH_ATTACK = 0.045;
const MOUTH_RELEASE = 0.08;
const BLINK_CLOSE = 0.025;
const BLINK_OPEN = 0.05;
/** Niveau de voix (RMS, voix normalisée à −18 dBFS ≈ 0,126) considéré comme « parle franchement ». */
const SPEAKING_LEVEL = 0.1;

// Pose : VRoid exporte en T-pose ; bras le long du corps, coudes à peine pliés.
const POSE: Partial<Record<VRMHumanBoneName, [number, number, number]>> = {
  leftUpperArm: [0, 0, -1.25],
  rightUpperArm: [0, 0, 1.25],
  leftLowerArm: [0, -0.15, -0.1],
  rightLowerArm: [0, 0.15, 0.1],
};
/** Images de physique jouées avant la première image : les cheveux retombent depuis la T-pose. */
const WARMUP_FRAMES = 60;
const DEG = Math.PI / 180;

/** Pages de l'extension seulement (aperçu, contrôles automatiques), jamais dans la caméra injectée. */
export interface VrmPreviewOptions {
  /** Accepte le rendu WebGL logiciel (contrôle visuel sans carte graphique). */
  allowSoftwareRendering?: boolean;
  /** Forme de bouche imposée, quel que soit le niveau de la voix. */
  mouth?: MouthShape;
  /** Ni clignement, ni saccade, ni mouvement de tête : captures comparables d'une image à l'autre. */
  still?: boolean;
}

export async function createVrmRenderer(
  canvas: HTMLCanvasElement,
  sources: VrmSources,
  options: AvatarOptions,
  level: () => number = () => 0,
  log: (message: string) => void = () => {},
  preview: VrmPreviewOptions = {},
): Promise<VrmAvatarRenderer> {
  // WebGL d'abord : sans accélération graphique, inutile de charger le modèle (l'appelant revient au SVG).
  const glCanvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    log(`WebGL : ${gpu}`);
    if (!preview.allowSoftwareRendering && /swiftshader|llvmpipe|softpipe|software/i.test(gpu)) throw new Error(`rendu WebGL logiciel (${gpu}) : trop lent pour l’avatar 3D`);
    renderer.setPixelRatio(1);
    renderer.setSize(AVATAR_WIDTH, AVATAR_HEIGHT, false);
    renderer.setClearColor(0x000000, 0);

    const started = performance.now();
    const loader = new GLTFLoader();
    // Textures décodées depuis le fichier, sans URL blob ni fetch : la CSP de la plateforme ne peut pas les bloquer.
    loader.register((parser) => new EmbeddedTexturePlugin(parser));
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(sources.model, '');
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('le fichier n’est pas un modèle VRM');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    // Cadre fixe : tout le personnage est toujours à l'image, pas de test de visibilité.
    vrm.scene.traverse((object) => (object.frustumCulled = false));
    log(`modèle VRM chargé en ${Math.round(performance.now() - started)} ms`);
    return new VrmAvatarRenderer(canvas, renderer, vrm, sources, options, level, log, preview);
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
}

export class VrmAvatarRenderer implements FrameRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vrm: VRM;
  private readonly sources: VrmSources;
  private readonly options: AvatarOptions;
  private readonly banner: OffscreenCanvas;
  private readonly motion: VrmMotion;
  private readonly level: () => number;
  private lost = false;
  private previous: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: THREE.WebGLRenderer,
    vrm: VRM,
    sources: VrmSources,
    options: AvatarOptions,
    level: () => number,
    log: (message: string) => void,
    preview: VrmPreviewOptions = {},
  ) {
    canvas.width = AVATAR_WIDTH;
    canvas.height = AVATAR_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('contexte 2D indisponible');
    this.canvas = canvas;
    this.ctx = ctx;
    this.renderer = renderer;
    this.vrm = vrm;
    this.sources = sources;
    this.options = options;
    this.level = level;
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      log('contexte WebGL perdu');
    });

    this.scene.add(vrm.scene);
    // Une seule lumière directionnelle d'intensité π, comme les exemples de three-vrm : couleurs de VRoid retrouvées
    // (peau 241,212,191, comme la miniature rendue par VRoid). Une lumière ambiante s'ajoute à l'éclairage global de
    // MToon et délave le personnage (peau saturée au blanc avec 0,4π, encore trop claire avec 0,15π).
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(0.5, 1.5, 2);
    this.scene.add(light);

    for (const [name, [x, y, z]] of Object.entries(POSE) as [VRMHumanBoneName, [number, number, number]][]) {
      vrm.humanoid.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
    }
    vrm.update(0);
    // Cheveux au repos avant le cadrage et la première image.
    for (let i = 0; i < WARMUP_FRAMES; i += 1) vrm.update(1 / 30);
    vrm.scene.updateMatrixWorld(true);

    this.camera = createCamera(vrm, sources.camera, log);
    printSloganOnShirt(vrm, this.camera, sources.slogan, log);
    this.motion = new VrmMotion(vrm, this.camera, preview);

    this.banner = new OffscreenCanvas(sources.banner.width, sources.banner.height);
    const bannerCtx = this.banner.getContext('2d');
    if (!bannerCtx) throw new Error('contexte 2D hors écran indisponible');
    drawBanner(bannerCtx, { x: 0, y: 0, width: sources.banner.width, height: sources.banner.height }, options.bannerText);
  }

  /** Une image entière : fond, personnage, (zone de sécurité), bandeau en dernier. */
  draw(now = performance.now()): MouthShape {
    if (this.lost) throw new Error('contexte WebGL perdu');
    const dt = this.previous === null ? 1 / 30 : Math.min(0.1, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    const shape = this.motion.update(now, dt, this.level());
    this.vrm.update(dt);
    this.renderer.render(this.scene, this.camera);
    const { ctx, sources } = this;
    ctx.drawImage(sources.background, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
    ctx.drawImage(this.renderer.domElement, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
    if (this.options.debugSafeZone) drawSafeZone(ctx);
    ctx.drawImage(this.banner, sources.banner.x, sources.banner.y);
    return shape;
  }

  dispose() {
    VRMUtils.deepDispose(this.vrm.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.sources.background.close();
    this.sources.slogan.image.close();
  }
}

/** Caméra calculée à la préparation (lib/vrm-assets.ts) ; le journal vérifie le haut des cheveux une fois posés. */
function createCamera(vrm: VRM, frame: VrmCamera, log: (message: string) => void): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(VRM_FOV, AVATAR_WIDTH / AVATAR_HEIGHT, 0.1, 20);
  camera.position.set(0, frame.y, frame.distance);
  camera.lookAt(0, frame.y, 0);
  camera.updateMatrixWorld(true);
  const top = highestVertex(vrm.scene);
  log(`cadrage : caméra à ${frame.distance.toFixed(2)} m, haut des cheveux posés à y = ${Math.round(frameY(frame, top.y, top.z))} (visé : ${HEAD_TOP})`);
  return camera;
}

type Textured = THREE.Material & { map?: THREE.Texture | null; shadeMultiplyTexture?: THREE.Texture | null };

/**
 * Imprime le slogan dans la texture du sweat, sur le personnage posé (bras baissés, cheveux retombés) : chaque triangle
 * visible du sweat sous la zone du slogan est projeté par la caméra, et le morceau correspondant du slogan à plat est
 * recopié dans la texture par la transformation affine (cadre → texture) de ce triangle. Au repos, le slogan apparaît
 * donc exactement dans sa zone du cadre, à plat, comme sur le personnage SVG ; il suit ensuite le torse (respiration).
 */
function printSloganOnShirt(vrm: VRM, camera: THREE.Camera, slogan: VrmSources['slogan'], log: (message: string) => void) {
  const started = performance.now();
  const meshes: { mesh: THREE.Mesh; material: Textured }[] = [];
  vrm.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]) as Textured[];
    const material = materials.find((item) => SHIRT_MATERIAL.test(item.name) && item.map);
    if (material) meshes.push({ mesh: object, material });
  });
  const first = meshes[0];
  const original = first?.material.map?.image as CanvasImageSource | undefined;
  if (!first || !original) throw new Error('sweat (matériau Tops) ou sa texture introuvable');

  const size = SHIRT_TEXTURE_SIZE;
  const texture = document.createElement('canvas');
  texture.width = size;
  texture.height = size;
  const ctx = texture.getContext('2d');
  if (!ctx) throw new Error('contexte 2D indisponible');
  ctx.drawImage(original, 0, 0, size, size);

  // Triangles du sweat, posés : sommets dans le cadre (pixels), profondeur, coordonnées de texture.
  interface Piece { screen: [number, number][]; uv: [number, number][]; depth: number }
  const { zone } = slogan;
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const candidates: Piece[] = [];
  const world = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const normal = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  for (const { mesh } of meshes) {
    const index = mesh.geometry.getIndex();
    const uv = mesh.geometry.getAttribute('uv');
    if (!index || !uv) continue;
    for (let t = 0; t + 2 < index.count; t += 3) {
      const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      corners.forEach((vertex, k) => mesh.getVertexPosition(vertex, world[k]!).applyMatrix4(mesh.matrixWorld));
      normal.subVectors(world[1], world[0]).cross(toCamera.subVectors(world[2], world[0])).normalize();
      toCamera.subVectors(cameraPosition, world[0]).normalize();
      if (normal.dot(toCamera) < 0.2) continue;
      const screen = world.map((point) => {
        const ndc = point.clone().project(camera);
        return [((ndc.x + 1) / 2) * AVATAR_WIDTH, ((1 - ndc.y) / 2) * AVATAR_HEIGHT] as [number, number];
      });
      const xs = screen.map(([x]) => x);
      const ys = screen.map(([, y]) => y);
      if (Math.max(...xs) < zone.x - 2 || Math.min(...xs) > zone.x + zone.width + 2) continue;
      if (Math.max(...ys) < zone.y - 2 || Math.min(...ys) > zone.y + zone.height + 2) continue;
      const centroid = new THREE.Vector3().add(world[0]).add(world[1]).add(world[2]).divideScalar(3);
      candidates.push({
        screen,
        uv: corners.map((vertex) => [uv.getX(vertex) * size, uv.getY(vertex) * size] as [number, number]),
        depth: centroid.distanceTo(cameraPosition),
      });
    }
  }
  // Pièces cachées (doublure, capuche derrière le torse) : un triangle nettement plus proche recouvre leur centre.
  const visible = candidates.filter((piece) => {
    const [cx, cy] = centroid2d(piece.screen);
    return !candidates.some((other) => other.depth < piece.depth - 0.03 && insideTriangle(cx, cy, other.screen));
  });

  for (const piece of visible) {
    const from = piece.screen.map(([x, y]) => [(x - zone.x) * slogan.scale + slogan.pad, (y - zone.y) * slogan.scale + slogan.pad] as [number, number]);
    const transform = affine(from, piece.uv);
    if (!transform) continue;
    const [cx, cy] = centroid2d(piece.uv);
    ctx.save();
    ctx.beginPath();
    piece.uv.forEach(([u, v], corner) => {
      const length = Math.hypot(u - cx, v - cy) || 1;
      const x = u + ((u - cx) / length) * TRIANGLE_BLEED;
      const y = v + ((v - cy) / length) * TRIANGLE_BLEED;
      if (corner === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(...transform);
    ctx.drawImage(slogan.image, 0, 0);
    ctx.restore();
  }
  if (visible.length === 0) throw new Error('aucun triangle du sweat sous la zone du slogan');

  // Toutes les textures qui montrent cette image (couleur, ombre MToon) passent à la version avec le slogan.
  vrm.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material]) as Textured[]) {
      for (const map of [material.map, material.shadeMultiplyTexture]) {
        if (map && map.image === original) {
          map.image = texture;
          map.needsUpdate = true;
        }
      }
    }
  });
  log(`slogan imprimé sur le sweat posé : ${visible.length} triangles (${candidates.length - visible.length} cachés), ${Math.round(performance.now() - started)} ms`);
}

function centroid2d(points: [number, number][]): [number, number] {
  return [(points[0]![0] + points[1]![0] + points[2]![0]) / 3, (points[0]![1] + points[1]![1] + points[2]![1]) / 3];
}

function insideTriangle(x: number, y: number, [a, b, c]: [number, number][]): boolean {
  const side = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const d1 = side(a!, b!);
  const d2 = side(b!, c!);
  const d3 = side(c!, a!);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Sommet le plus haut du modèle posé (peau comprise) : haut des cheveux. */
function highestVertex(root: THREE.Object3D): THREE.Vector3 {
  const best = new THREE.Vector3(0, -Infinity, 0);
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      object.getVertexPosition(i, vertex);
      vertex.applyMatrix4(object.matrixWorld);
      if (vertex.y > best.y) best.copy(vertex);
    }
  });
  return best;
}

/** Bruit lent et doux : somme de sinusoïdes de fréquences sans rapport simple. */
function drift(t: number, phase: number, ...frequencies: number[]): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  for (const frequency of frequencies) {
    sum += weight * Math.sin(t * frequency * 2 * Math.PI + phase * (1 + frequency));
    total += weight;
    weight *= 0.55;
  }
  return sum / total;
}

const approach = (current: number, target: number, dt: number, timeConstant: number) =>
  current + (target - current) * (1 - Math.exp(-dt / timeConstant));

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

/** Mouvements du personnage, image par image. */
class VrmMotion {
  private readonly vrm: VRM;
  private readonly camera: THREE.Camera;
  private readonly mouth = new MouthAnimator();
  private readonly blink: BlinkAnimator;
  private readonly weights = new Map<VRMExpressionPresetName, number>();
  private readonly gazeTarget = new THREE.Object3D();
  private readonly bones: Partial<Record<VRMHumanBoneName, THREE.Object3D>> = {};
  private readonly rest = new Map<THREE.Object3D, THREE.Euler>();
  /** Parole lissée, de 0 à 1 : hochements et respiration plus rapide quand l'avatar parle. */
  private speaking = 0;
  private breathPhase = 0;
  // Regard : décalage courant (rad), visé, et date du prochain changement.
  private gaze = { yaw: 0, pitch: 0 };
  private gazeWanted = { yaw: 0, pitch: 0 };
  private nextSaccade: number;
  private gazeReturn = Infinity;

  private readonly preview: VrmPreviewOptions;

  constructor(vrm: VRM, camera: THREE.Camera, preview: VrmPreviewOptions = {}) {
    this.preview = preview;
    this.vrm = vrm;
    this.camera = camera;
    const now = performance.now();
    this.blink = new BlinkAnimator(now);
    this.nextSaccade = now + randomBetween(800, 2500);
    for (const name of ['neck', 'head', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm'] as const) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name);
      if (!bone) continue;
      this.bones[name] = bone;
      this.rest.set(bone, bone.rotation.clone());
    }
    camera.getWorldPosition(this.gazeTarget.position);
    if (vrm.lookAt) {
      vrm.lookAt.autoUpdate = true;
      vrm.lookAt.target = this.gazeTarget;
    }
  }

  update(now: number, dt: number, level: number): MouthShape {
    const t = now / 1000;
    const shape = this.preview.mouth ?? this.mouth.update(level, now);
    this.speaking = approach(this.speaking, Math.min(1, level / SPEAKING_LEVEL), dt, 0.35);

    // Bouche et paupières.
    const targets = MOUTH_EXPRESSIONS[shape];
    for (const name of VISEMES) this.smooth(name, targets[name] ?? 0, dt, MOUTH_ATTACK, MOUTH_RELEASE);
    this.smooth('blink', !this.preview.still && this.blink.closed(now) ? 1 : 0, dt, BLINK_CLOSE, BLINK_OPEN);
    if (this.preview.still) {
      // Aperçu immobile : regard droit vers la caméra, tête et buste au repos.
      this.camera.getWorldPosition(this.gazeTarget.position);
      return shape;
    }

    // Regard : vers la caméra, petites saccades ; de temps en temps un bref coup d'œil ailleurs (réflexion).
    if (now >= this.gazeReturn) {
      this.gazeWanted = { yaw: randomBetween(-1, 1) * DEG, pitch: randomBetween(-0.7, 0.7) * DEG };
      this.gazeReturn = Infinity;
    }
    if (now >= this.nextSaccade) {
      if (Math.random() < 0.15) {
        this.gazeWanted = { yaw: (Math.random() < 0.5 ? -1 : 1) * randomBetween(5, 9) * DEG, pitch: randomBetween(1, 5) * DEG };
        this.gazeReturn = now + randomBetween(500, 1100);
      } else {
        this.gazeWanted = { yaw: randomBetween(-1.5, 1.5) * DEG, pitch: randomBetween(-1, 1) * DEG };
      }
      this.nextSaccade = now + randomBetween(1200, 3500);
    }
    this.gaze.yaw = approach(this.gaze.yaw, this.gazeWanted.yaw, dt, 0.03);
    this.gaze.pitch = approach(this.gaze.pitch, this.gazeWanted.pitch, dt, 0.03);
    const head = this.bones.head;
    if (head) {
      head.getWorldPosition(this.gazeTarget.position);
      const toCamera = this.camera.getWorldPosition(new THREE.Vector3()).sub(this.gazeTarget.position);
      const distance = toCamera.length();
      this.gazeTarget.position.add(toCamera);
      this.gazeTarget.position.x += Math.tan(this.gaze.yaw) * distance;
      this.gazeTarget.position.y += Math.tan(this.gaze.pitch) * distance;
    }

    // Tête : dérive lente au repos, suit un peu le regard ; hochements et inclinaisons en parlant.
    const s = this.speaking;
    const yaw = 2.2 * DEG * drift(t, 0.3, 0.05, 0.13, 0.31) + 0.3 * this.gaze.yaw + s * 1.2 * DEG * drift(t, 2.1, 0.4, 0.9);
    const pitch = 1.4 * DEG * drift(t, 1.7, 0.07, 0.19) - 0.25 * this.gaze.pitch + s * 1.6 * DEG * drift(t, 0.8, 1.6, 2.7);
    const roll = 1.2 * DEG * drift(t, 4.2, 0.04, 0.11) + s * 1.0 * DEG * drift(t, 3.3, 0.35, 0.8);
    this.turn('neck', pitch * 0.4, yaw * 0.4, roll * 0.4);
    this.turn('head', pitch * 0.6, yaw * 0.6, roll * 0.6);

    // Respiration : environ 15 par minute au repos, un peu plus en parlant ; poitrine et épaules.
    this.breathPhase += dt * 2 * Math.PI * (0.24 + 0.08 * s);
    const breath = (1 - Math.cos(this.breathPhase)) / 2;
    this.turn('upperChest', -0.9 * DEG * breath, 0, 0);
    this.turn('chest', -0.4 * DEG * breath, 0, 0);
    this.turn('leftShoulder', 0, 0, 0.7 * DEG * breath);
    this.turn('rightShoulder', 0, 0, -0.7 * DEG * breath);
    // Bras compensés : les mains ne remontent pas avec les épaules.
    this.turn('leftUpperArm', 0, 0, -0.7 * DEG * breath);
    this.turn('rightUpperArm', 0, 0, 0.7 * DEG * breath);
    // Balancement du buste, très léger.
    this.turn('spine', 0, 0.8 * DEG * drift(t, 5.1, 0.03, 0.08), 0.6 * DEG * drift(t, 2.7, 0.04, 0.09));
    return shape;
  }

  private smooth(name: VRMExpressionPresetName, target: number, dt: number, rising: number, falling: number) {
    const current = this.weights.get(name) ?? 0;
    const next = approach(current, target, dt, target > current ? rising : falling);
    this.weights.set(name, next);
    this.vrm.expressionManager?.setValue(name, next);
  }

  /** Rotation ajoutée à la pose de repos de l'os. */
  private turn(name: VRMHumanBoneName, x: number, y: number, z: number) {
    const bone = this.bones[name];
    const rest = bone && this.rest.get(bone);
    if (!bone || !rest) return;
    bone.rotation.set(rest.x + x, rest.y + y, rest.z + z);
  }
}

/** Textures du fichier décodées directement (createImageBitmap), comme le ferait GLTFLoader, mais sans URL blob. */
class EmbeddedTexturePlugin implements GLTFLoaderPlugin {
  readonly name = 'otherself_embedded_textures';
  private readonly parser: GLTFParser;
  private readonly cache = new Map<string, Promise<THREE.Texture>>();

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
    const json = this.parser.json as {
      textures?: { source?: number; sampler?: number; name?: string }[];
      images?: { bufferView?: number; mimeType?: string; name?: string }[];
      samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
    };
    const definition = json.textures?.[textureIndex];
    const image = definition?.source === undefined ? undefined : json.images?.[definition.source];
    if (!definition || image?.bufferView === undefined) return null;
    const key = `${image.bufferView}:${definition.sampler}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const sampler = json.samplers?.[definition.sampler ?? -1] ?? {};
    const promise = (this.parser.getDependency('bufferView', image.bufferView) as Promise<ArrayBuffer>).then(async (buffer) => {
      const bitmap = await createImageBitmap(new Blob([buffer], { type: image.mimeType ?? 'image/png' }), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.name = definition.name || image.name || '';
      texture.magFilter = (FILTERS[sampler.magFilter ?? -1] as THREE.MagnificationTextureFilter | undefined) ?? THREE.LinearFilter;
      texture.minFilter = FILTERS[sampler.minFilter ?? -1] ?? THREE.LinearMipmapLinearFilter;
      texture.wrapS = WRAPPINGS[sampler.wrapS ?? -1] ?? THREE.RepeatWrapping;
      texture.wrapT = WRAPPINGS[sampler.wrapT ?? -1] ?? THREE.RepeatWrapping;
      texture.generateMipmaps = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
      texture.userData.mimeType = image.mimeType;
      texture.needsUpdate = true;
      this.parser.associations.set(texture, { textures: textureIndex });
      return texture;
    });
    this.cache.set(key, promise);
    return promise;
  }
}

const FILTERS: Record<number, THREE.MinificationTextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};
const WRAPPINGS: Record<number, THREE.Wrapping> = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};
