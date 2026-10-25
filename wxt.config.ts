import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { checkLocales } from './scripts/check-locales';

const DEFAULT_LOCALE = 'fr';
const LOCAL_CONFIG = 'config.local.json';
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.webm', '.m4a'];
const TEXT_EXTENSIONS = ['.md', '.txt'];

// Fichiers d'exécution du pipeline voix, copiés depuis node_modules : une extension MV3
// ne peut pas charger de code (JS ou WASM) depuis un CDN.
const VENDOR_FILES: Record<string, string> = {
  'vendor/ort/ort-wasm-simd-threaded.mjs': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  'vendor/ort/ort-wasm-simd-threaded.wasm': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  'vendor/piper/piper_phonemize.wasm': 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm',
  'vendor/piper/piper_phonemize.data': 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data',
  'vendor/silero_vad_v5.onnx': 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
};

// Champs simples recopiés tels quels dans local/config.json (voir lib/config.ts et docs/config.md).
const PASSTHROUGH_FIELDS = [
  'debugSafeZone',
  'bargeInMs',
  'recruiterAudio',
  'candidateName',
  'monitorAvatar',
  'monitorVolume',
  'bannerText',
  'messageText',
  'language',
  'voice',
  'silenceMs',
  'openaiApiKey',
  'sttModel',
  'llmModel',
];

type Warn = (message: string) => void;

function readLocalConfig(root: string, warn: Warn): Record<string, unknown> | null {
  const configPath = resolve(root, LOCAL_CONFIG);
  if (!existsSync(configPath)) {
    warn(`${LOCAL_CONFIG} absent : copier config.example.json`);
    return null;
  }
  return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
}

// Démo : les fichiers déclarés dans config.local.json (jamais commité) sont copiés dans
// le build sous local/, avec local/config.json qui les référence. Ce dossier n'est pas
// accessible aux pages web (aucun web_accessible_resources).
function resolveLocalFile(
  root: string,
  config: Record<string, unknown> | null,
  field: string,
  extensions: string[],
  warn: Warn,
  required: boolean,
): string | null {
  const value = config?.[field];
  if (value === undefined && !required) return null;
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
    // Règle 6 : activeTab + scripting + offscreen + tabCapture, injection à la demande, jamais de
    // host_permissions (OpenAI et Hugging Face acceptent les requêtes CORS de l'extension).
    // tabCapture : son de l'onglet activé (ce qui est réellement joué), sur clic de l'utilisateur.
    permissions: ['activeTab', 'scripting', 'offscreen', 'tabCapture'],
    // WebAssembly (ONNX Runtime, phonémiseur Piper) dans les pages de l'extension.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  hooks: {
    'build:publicAssets': (wxt, files) => {
      checkLocales(wxt.config.publicDir, DEFAULT_LOCALE);
      const root = wxt.config.root;
      for (const [dest, src] of Object.entries(VENDOR_FILES)) {
        files.push({ absoluteSrc: resolve(root, src), relativeDest: dest });
      }

      const warn: Warn = (message) => wxt.logger.warn(message);
      const config = readLocalConfig(root, warn);
      const copy = (field: string, extensions: string[], name: string, required = false) => {
        const path = resolveLocalFile(root, config, field, extensions, warn, required);
        if (!path) return null;
        const dest = `/local/${name}${extname(path).toLowerCase()}`;
        files.push({ absoluteSrc: path, relativeDest: dest.slice(1) });
        return dest;
      };
      const output: Record<string, unknown> = {
        photo: copy('photo', PHOTO_EXTENSIONS, 'photo', true),
        // Son de test du micro injecté, utilisé seulement par rehearsal?inject.
        testAudio: copy('testAudio', AUDIO_EXTENSIONS, 'test-audio'),
        cv: copy('cv', TEXT_EXTENSIONS, 'cv', true),
      };
      for (const field of PASSTHROUGH_FIELDS) {
        if (config?.[field] !== undefined) output[field] = config[field];
      }
      if (config && !config.openaiApiKey) warn(`${LOCAL_CONFIG} : champ "openaiApiKey" manquant (pipeline voix inactif)`);
      files.push({ relativeDest: 'local/config.json', contents: JSON.stringify(output) });
    },
  },
});
