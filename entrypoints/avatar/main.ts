// Page de l'avatar : aperçu du rendu.

import { AvatarRenderer, loadAvatarConfig, type AvatarOptions } from '@/lib/avatar';
import { createLogger } from '@/lib/log';

const log = createLogger('avatar');
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;

let photo: ImageBitmap | null = null;
let options: AvatarOptions = {};
try {
  ({ photo, options } = await loadAvatarConfig());
} catch (error) {
  log(`chargement de la photo impossible : ${error instanceof Error ? error.message : String(error)}`);
}

const renderer = new AvatarRenderer(canvas, photo, options);
renderer.draw();
log(`rendu affiché (${canvas.width}x${canvas.height})`);
