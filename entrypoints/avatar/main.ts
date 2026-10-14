// Page de l'avatar : aperçu du rendu, et source de la caméra virtuelle OBS en voie B.

import { AvatarRenderer, loadConfiguredPhoto } from '@/lib/avatar';
import { createLogger } from '@/lib/log';

const log = createLogger('avatar');
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;

let photo: ImageBitmap | null = null;
try {
  photo = await loadConfiguredPhoto();
} catch (error) {
  log(`chargement de la photo impossible : ${error instanceof Error ? error.message : String(error)}`);
}

const renderer = new AvatarRenderer(canvas, photo);
renderer.draw();
log(`rendu affiché (${canvas.width}x${canvas.height})`);
