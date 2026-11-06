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
  SLOGAN_BOTTOM,
  drawBanner,
  drawSafeZone,
  type AvatarOptions,
  type MouthShape,
  type Rect,
} from './avatar';

/** Ce que le rendu reçoit dans la page : modèle (slogan déjà imprimé), fond, bandeau, zone du slogan (mètres). */
export interface VrmSources {
  model: ArrayBuffer;
  background: ImageBitmap;
  banner: Rect;
  slogan: { top: number; bottom: number; front: number };
}

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
const FOV = 18;
const DEG = Math.PI / 180;

export async function createVrmRenderer(
  canvas: HTMLCanvasElement,
  sources: VrmSources,
  options: AvatarOptions,
  level: () => number = () => 0,
  log: (message: string) => void = () => {},
  /** Pages de l'extension seulement (aperçu, contrôles automatiques) : accepte le rendu WebGL logiciel. */
  allowSoftwareRendering = false,
): Promise<VrmAvatarRenderer> {
  // WebGL d'abord : sans accélération graphique, inutile de charger le modèle (l'appelant revient au SVG).
  const glCanvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    log(`WebGL : ${gpu}`);
    if (!allowSoftwareRendering && /swiftshader|llvmpipe|softpipe|software/i.test(gpu)) throw new Error(`rendu WebGL logiciel (${gpu}) : trop lent pour l’avatar 3D`);
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
    return new VrmAvatarRenderer(canvas, renderer, vrm, sources, options, level, log);
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
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(0.5, 1.5, 2);
    this.scene.add(light, new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

    for (const [name, [x, y, z]] of Object.entries(POSE) as [VRMHumanBoneName, [number, number, number]][]) {
      vrm.humanoid.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
    }
    vrm.update(0);
    // Cheveux au repos avant le cadrage et la première image.
    for (let i = 0; i < WARMUP_FRAMES; i += 1) vrm.update(1 / 30);
    vrm.scene.updateMatrixWorld(true);

    this.camera = frameCamera(vrm, sources.slogan, log);
    this.motion = new VrmMotion(vrm, this.camera);

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
  }
}

/**
 * Caméra fixe, horizontale, face au personnage : haut des cheveux à y = HEAD_TOP et bas du slogan à y = SLOGAN_BOTTOM,
 * comme le cadrage du personnage SVG (le bandeau est placé en conséquence par lib/vrm-assets.ts). Résolu exactement
 * en tenant compte de la profondeur (le slogan est sur le devant du torse, plus près que le haut de la tête).
 */
function frameCamera(vrm: VRM, slogan: VrmSources['slogan'], log: (message: string) => void): THREE.PerspectiveCamera {
  const top = highestVertex(vrm.scene);
  const f = AVATAR_HEIGHT / 2 / Math.tan((FOV / 2) * DEG);
  // y_px = H/2 − (Y − cameraY)·f / (D − Z) pour un point (Y, Z) et une caméra en (0, cameraY, D) regardant vers −Z.
  const k1 = (AVATAR_HEIGHT / 2 - HEAD_TOP) / f;
  const k2 = (AVATAR_HEIGHT / 2 - SLOGAN_BOTTOM) / f;
  const distance = (top.y - slogan.bottom + k1 * top.z - k2 * slogan.front) / (k1 - k2);
  const cameraY = top.y - k1 * (distance - top.z);
  const camera = new THREE.PerspectiveCamera(FOV, AVATAR_WIDTH / AVATAR_HEIGHT, 0.1, 20);
  camera.position.set(0, cameraY, distance);
  camera.lookAt(0, cameraY, 0);
  camera.updateMatrixWorld(true);
  const sloganTop = new THREE.Vector3(0, slogan.top, slogan.front).project(camera);
  log(
    `cadrage : haut des cheveux ${top.y.toFixed(3)} m → y = ${HEAD_TOP}, slogan ${slogan.top}–${slogan.bottom} m → ` +
      `y = ${Math.round(((1 - sloganTop.y) / 2) * AVATAR_HEIGHT)}–${SLOGAN_BOTTOM}, caméra à ${distance.toFixed(2)} m`,
  );
  return camera;
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

  constructor(vrm: VRM, camera: THREE.Camera) {
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
    const shape = this.mouth.update(level, now);
    this.speaking = approach(this.speaking, Math.min(1, level / SPEAKING_LEVEL), dt, 0.35);

    // Bouche et paupières.
    const targets = MOUTH_EXPRESSIONS[shape];
    for (const name of VISEMES) this.smooth(name, targets[name] ?? 0, dt, MOUTH_ATTACK, MOUTH_RELEASE);
    this.smooth('blink', this.blink.closed(now) ? 1 : 0, dt, BLINK_CLOSE, BLINK_OPEN);

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
