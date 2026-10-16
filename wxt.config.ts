import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { checkLocales } from './scripts/check-locales';

const DEFAULT_LOCALE = 'fr';
const LOCAL_CONFIG = 'config.local.json';
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.webm', '.m4a'];

type Warn = (message: string) => void;

function readLocalConfig(root: string, warn: Warn): Record<string, unknown> | null {
  const configPath = resolve(root, LOCAL_CONFIG);
  if (!existsSync(configPath)) {
    warn(`${LOCAL_CONFIG} absent : copier config.example.json pour configurer la photo`);
    return null;
  }
  return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
}

// Démo : les fichiers déclarés dans config.local.json (jamais commité) sont
// copiés dans le build sous local/. Les pages lisent local/avatar.json pour les trouver.
function resolveLocalFile(
  root: string,
  config: Record<string, unknown> | null,
  field: string,
  extensions: string[],
  warn: Warn,
): string | null {
  const value = config?.[field];
  if (value === undefined && field !== 'photo') return null;
  if (typeof value !== 'string' || value === '') {
    if (config) warn(`${LOCAL_CONFIG} : champ "${field}" manquant`);
    return null;
  }
  const path = resolve(root, value);
  if (!extensions.includes(extname(path).toLowerCase())) {
    warn(`${LOCAL_CONFIG} : "${field}" au format non pris en charge (${extensions.join(', ')})`);
    return null;
  }
  if (!existsSync(path)) {
    warn(`${LOCAL_CONFIG} : "${field}" introuvable (${path})`);
    return null;
  }
  return path;
}

export default defineConfig({
  // Manifest V3 pour toutes les cibles (WXT utilise MV2 par défaut sur Firefox).
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: DEFAULT_LOCALE,
    // Règle 6 : activeTab + injection à la demande, jamais de host_permissions.
    permissions: ['activeTab', 'scripting'],
  },
  hooks: {
    'build:publicAssets': (wxt, files) => {
      checkLocales(wxt.config.publicDir, DEFAULT_LOCALE);
      const warn: Warn = (message) => wxt.logger.warn(message);
      const config = readLocalConfig(wxt.config.root, warn);
      const copy = (field: string, extensions: string[], name: string) => {
        const path = resolveLocalFile(wxt.config.root, config, field, extensions, warn);
        if (!path) return null;
        const dest = `/local/${name}${extname(path).toLowerCase()}`;
        files.push({ absoluteSrc: path, relativeDest: dest.slice(1) });
        return dest;
      };
      const photo = copy('photo', PHOTO_EXTENSIONS, 'photo');
      // Étape 3 (test d'injection, jetable) : son préenregistré qui remplace le micro.
      const testAudio = copy('testAudio', AUDIO_EXTENSIONS, 'test-audio');
      files.push({ relativeDest: 'local/avatar.json', contents: JSON.stringify({ photo, testAudio }) });
    },
  },
});
