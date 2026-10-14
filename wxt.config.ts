import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig } from 'wxt';

const LOCAL_CONFIG = 'config.local.json';
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// Démo : la photo est lue depuis config.local.json (jamais commité) et copiée
// dans le build sous local/. La page avatar lit local/avatar.json pour la trouver.
function resolvePhoto(root: string, warn: (message: string) => void): string | null {
  const configPath = resolve(root, LOCAL_CONFIG);
  if (!existsSync(configPath)) {
    warn(`${LOCAL_CONFIG} absent : copier config.example.json pour configurer la photo`);
    return null;
  }
  const config: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  const photo = (config as { photo?: unknown }).photo;
  if (typeof photo !== 'string' || photo === '') {
    warn(`${LOCAL_CONFIG} : champ "photo" manquant`);
    return null;
  }
  const photoPath = resolve(root, photo);
  if (!PHOTO_EXTENSIONS.includes(extname(photoPath).toLowerCase())) {
    warn(`${LOCAL_CONFIG} : photo au format non pris en charge (${PHOTO_EXTENSIONS.join(', ')})`);
    return null;
  }
  if (!existsSync(photoPath)) {
    warn(`${LOCAL_CONFIG} : photo introuvable (${photoPath})`);
    return null;
  }
  return photoPath;
}

export default defineConfig({
  // Manifest V3 pour toutes les cibles (WXT utilise MV2 par défaut sur Firefox).
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'fr',
    // Règle 6 : activeTab + injection à la demande, jamais de host_permissions.
    permissions: ['activeTab'],
  },
  hooks: {
    'build:publicAssets': (wxt, files) => {
      const photoPath = resolvePhoto(wxt.config.root, (message) => wxt.logger.warn(message));
      let photo: string | null = null;
      if (photoPath) {
        photo = `/local/photo${extname(photoPath).toLowerCase()}`;
        files.push({ absoluteSrc: photoPath, relativeDest: photo.slice(1) });
      }
      files.push({ relativeDest: 'local/avatar.json', contents: JSON.stringify({ photo }) });
    },
  },
});
