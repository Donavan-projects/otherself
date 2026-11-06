// Banc VRM (prototype-vrm, étape 0) : mesure le coût d'un rendu 3D de l'avatar sur la machine, par le même
// chemin que le rendu final prévu : three.js dessine le modèle dans un canvas WebGL transparent, recopié
// dans le canvas 2D de 1280×720 par-dessus le fond, bandeau peint en dernier (règle 1).
// Paramètres de l'adresse : physics=0 (cheveux sans physique), aa=0 (sans anticrénelage),
// scale=0.75 (rendu 3D à une résolution réduite, agrandi à la recopie), file=<nom>.vrm.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMExpressionPresetName } from '@pixiv/three-vrm';
import { AVATAR_HEIGHT, AVATAR_WIDTH, BANNER_HEIGHT, BlinkAnimator, MouthAnimator, SAFE_ZONE, drawBanner, type MouthShape } from '@/lib/avatar';
import { loadDemoConfig } from '@/lib/config';
import { createLogger } from '@/lib/log';

const FPS = 30;
const STATS_INTERVAL_MS = 5000;
const log = createLogger('vrm');
const params = new URLSearchParams(location.search);
const physics = params.get('physics') !== '0';
const antialias = params.get('aa') !== '0';
const renderScale = Math.min(1, Math.max(0.25, Number(params.get('scale') ?? 1) || 1));
const file = params.get('file') ?? 'Otherself.vrm';

const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;
const statsBox = document.querySelector<HTMLPreElement>('#stats')!;
canvas.width = AVATAR_WIDTH;
canvas.height = AVATAR_HEIGHT;
const ctx = canvas.getContext('2d', { alpha: false })!;

const config = await loadDemoConfig();

// Fond : le même SVG que l'avatar actuel, rastérisé une fois.
async function loadBackground(name: string): Promise<HTMLImageElement> {
  const image = new Image(AVATAR_WIDTH, AVATAR_HEIGHT);
  image.src = browser.runtime.getURL(`/avatar-svg/fonds/${name}.svg` as '/');
  await image.decode();
  return image;
}
const background = await loadBackground(config.background);

// Bandeau : mêmes dimensions que le rendu actuel (580 × 62, bas de la zone de sécurité).
const banner = { x: (AVATAR_WIDTH - 580) / 2, y: SAFE_ZONE.bottom - BANNER_HEIGHT, width: 580, height: BANNER_HEIGHT };
const bannerImage = new OffscreenCanvas(banner.width, banner.height);
drawBanner(bannerImage.getContext('2d')!, { x: 0, y: 0, width: banner.width, height: banner.height }, config.bannerText);

// Chargement du modèle.
const loadStart = performance.now();
const response = await fetch(browser.runtime.getURL(`/avatar-vrm/${file}` as '/'));
if (!response.ok) throw new Error(`avatar-vrm/${file} introuvable (${response.status}) : placer le fichier dans avatar/ puis reconstruire`);
const bytes = await response.arrayBuffer();
const fetched = performance.now();
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const gltf = await loader.parseAsync(bytes, '');
const vrm = gltf.userData.vrm as VRM;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.combineSkeletons(gltf.scene);
vrm.scene.traverse((object) => (object.frustumCulled = false));
const parsed = performance.now();
log(`modèle ${file} : ${(bytes.byteLength / 1e6).toFixed(1)} Mo, lecture ${(fetched - loadStart).toFixed(0)} ms, analyse ${(parsed - fetched).toFixed(0)} ms`);
log(`licence du modèle : ${JSON.stringify(vrm.meta)}`);

// Rendu WebGL hors DOM, fond transparent.
const glCanvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(Math.round(AVATAR_WIDTH * renderScale), Math.round(AVATAR_HEIGHT * renderScale), false);
renderer.setClearColor(0x000000, 0);
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
log(`WebGL : ${gpu}${/swiftshader|llvmpipe|software/i.test(gpu) ? ' (RENDU LOGICIEL : trop lent pour l’avatar 3D)' : ''}`);

const scene = new THREE.Scene();
scene.add(vrm.scene);
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(0.5, 1.5, 2);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

// Pose : bras le long du corps (VRoid exporte en T-pose).
const bone = (name: Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]) => vrm.humanoid.getNormalizedBoneNode(name);
bone('leftUpperArm')!.rotation.z = -1.25;
bone('rightUpperArm')!.rotation.z = 1.25;
bone('leftLowerArm')!.rotation.z = -0.1;
bone('rightLowerArm')!.rotation.z = 0.1;
vrm.update(0);
vrm.scene.updateMatrixWorld(true);

// Cadrage provisoire : haut des cheveux à y = 94 comme aujourd'hui, poitrine (upperChest) vers y = 470.
const HEAD_TOP_PX = 94;
const CHEST_PX = 470;
const FOV = 18;
const top = new THREE.Box3().setFromObject(vrm.scene, true).max.y;
const chestY = bone('upperChest')!.getWorldPosition(new THREE.Vector3()).y;
const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const pxPerMeter = (CHEST_PX - HEAD_TOP_PX) / (top - chestY);
const distance = AVATAR_HEIGHT / 2 / (pxPerMeter * tanHalf);
const cameraY = top - (AVATAR_HEIGHT / 2 - HEAD_TOP_PX) / pxPerMeter;
const camera = new THREE.PerspectiveCamera(FOV, AVATAR_WIDTH / AVATAR_HEIGHT, 0.1, 20);
camera.position.set(0, cameraY, distance);
camera.lookAt(0, cameraY, 0);
log(`cadrage : haut ${top.toFixed(3)} m, poitrine ${chestY.toFixed(3)} m, caméra à ${distance.toFixed(2)} m`);
if (vrm.lookAt) vrm.lookAt.target = camera;

// Bouche : formes actuelles → expressions VRM (M : lèvres fermées, donc presque rien).
const MOUTH_EXPRESSIONS: Record<MouthShape, Partial<Record<VRMExpressionPresetName, number>>> = {
  repos: {},
  M: {},
  E: { ee: 0.6, ih: 0.3 },
  A: { aa: 0.8 },
  O: { oh: 0.7, ou: 0.2 },
};
const VISEMES: VRMExpressionPresetName[] = ['aa', 'ih', 'ou', 'ee', 'oh'];
const MOUTH_TIME_CONSTANT = 0.06;
const BLINK_TIME_CONSTANT = 0.03;
const weights = new Map<VRMExpressionPresetName, number>();
const mouth = new MouthAnimator();
const blink = new BlinkAnimator(performance.now());

/** Voix simulée, comme la page avatar : 3 s de parole, 1,5 s de silence. */
function simulatedLevel(now: number): number {
  const t = (now / 1000) % 4.5;
  if (t > 3) return 0;
  const syllable = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6 + Math.sin(t * 7) * 1.5));
  return syllable * (0.08 + 0.12 * Math.abs(Math.sin(t * 1.7 + 1)));
}

function smooth(name: VRMExpressionPresetName, target: number, dt: number, timeConstant: number) {
  const current = weights.get(name) ?? 0;
  const next = current + (target - current) * (1 - Math.exp(-dt / timeConstant));
  weights.set(name, next);
  vrm.expressionManager?.setValue(name, next);
}

const neck = bone('neck')!;
const head = bone('head')!;
const chest = bone('upperChest')!;
function animate(now: number, dt: number): MouthShape {
  const t = now / 1000;
  const shape = mouth.update(simulatedLevel(now), now);
  const targets = MOUTH_EXPRESSIONS[shape];
  for (const name of VISEMES) smooth(name, targets[name] ?? 0, dt, MOUTH_TIME_CONSTANT);
  smooth('blink', blink.closed(now) ? 1 : 0, dt, BLINK_TIME_CONSTANT);
  // Respiration et mouvements de tête provisoires : seulement pour un coût représentatif.
  chest.rotation.x = Math.sin(t * Math.PI * 2 * 0.25) * 0.015;
  neck.rotation.y = Math.sin(t * 0.37) * 0.04;
  head.rotation.x = Math.sin(t * 0.53) * 0.03;
  head.rotation.z = Math.sin(t * 0.29 + 1) * 0.02;
  return shape;
}

function updateVrm(dt: number) {
  if (physics) {
    vrm.update(dt);
    return;
  }
  vrm.humanoid.update();
  vrm.lookAt?.update(dt);
  vrm.expressionManager?.update();
  vrm.materials?.forEach((material) => (material as { update?: (dt: number) => void }).update?.(dt));
}

// Boucle de rendu, comme lib/inject.ts : setInterval à 30 images/s.
let frames = 0;
let last = performance.now();
let previous = last;
const time = { animate: 0, update: 0, render: 0, composite: 0, total: 0, max: 0 };
function frame() {
  const start = performance.now();
  const dt = Math.min(0.1, (start - previous) / 1000);
  previous = start;
  animate(start, dt);
  const animated = performance.now();
  updateVrm(dt);
  const updated = performance.now();
  renderer.render(scene, camera);
  const rendered = performance.now();
  ctx.drawImage(background, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  ctx.drawImage(glCanvas, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  ctx.drawImage(bannerImage, banner.x, banner.y);
  const end = performance.now();
  time.animate += animated - start;
  time.update += updated - animated;
  time.render += rendered - updated;
  time.composite += end - rendered;
  time.total += end - start;
  time.max = Math.max(time.max, end - start);
  frames += 1;
}
frame();
setInterval(frame, 1000 / FPS);

const settings = `physique ${physics ? 'oui' : 'non'}, anticrénelage ${antialias ? 'oui' : 'non'}, échelle ${renderScale}`;
const triangles = () => renderer.info.render.triangles;
statsBox.textContent = `${gpu}\n${settings}\nmesure en cours…`;
setInterval(() => {
  const now = performance.now();
  const fps = (frames * 1000) / (now - last);
  const avg = (value: number) => (value / Math.max(1, frames)).toFixed(2);
  const line =
    `${fps.toFixed(1)} images/s, image ${avg(time.total)} ms (max ${time.max.toFixed(1)}) : animation ${avg(time.animate)}, ` +
    `vrm.update ${avg(time.update)}, render ${avg(time.render)}, recopie ${avg(time.composite)} ; ${triangles()} triangles`;
  log(`${line} [${settings}]`);
  statsBox.textContent = `${gpu}\n${settings}\n${line.replace(' : ', '\n').replaceAll(', ', '\n')}`;
  frames = 0;
  last = now;
  for (const key of Object.keys(time) as (keyof typeof time)[]) time[key] = 0;
}, STATS_INTERVAL_MS);
log(`banc VRM prêt (${settings})`);
