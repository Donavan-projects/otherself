// Activation de l'avatar, partagée par le popup (onglet de la plateforme) et la page recruteur IA : préparation des
// images et du modèle 3D (la page ne reçoit que cela, jamais la configuration ni la clé), et document offscreen du
// pipeline voix. Pages de l'extension seulement.

import { mapAssets } from './avatar';
import { renderMarkingText } from './avatar-assets';
import { loadDemoConfig } from './config';
import { buildFallbackAssets } from './fallback-assets';
import { blobToFile, type SerializedSources } from './injection-sources';
import { createLogger } from './log';
import { buildVrmAssets, mapVrmAssets } from './vrm-assets';

const log = createLogger('inject');

/** Avatar préparé ici (page de l'extension), puis remis à la page sous forme d'images seulement. */
export async function loadSources(): Promise<SerializedSources> {
  const config = await loadDemoConfig();
  // Secours (images rendues depuis le modèle 3D) : toujours préparé, il prend le relais dans la page si le 3D échoue.
  const assets = await buildFallbackAssets(config);
  let vrm: SerializedSources['vrm'];
  if (config.avatarRenderer === 'vrm') {
    try {
      vrm = await mapVrmAssets(await buildVrmAssets(config), blobToFile);
    } catch (error) {
      log(`avatar 3D indisponible (${error instanceof Error ? error.message : String(error)}) : avatar de secours utilisé`);
    }
  }
  return {
    avatar: await mapAssets(assets, blobToFile),
    vrm,
    marking: await blobToFile(await renderMarkingText(config.badgeText)),
    language: config.language,
    labels: {
      share: browser.i18n.getMessage('pageShareButton'),
      pause: browser.i18n.getMessage('pagePause'),
      resume: browser.i18n.getMessage('pageResume'),
    },
  };
}

/** Pipeline voix (VAD, transcription, LLM, Piper) : document offscreen, un seul à la fois. */
export async function ensureOffscreen() {
  if (await browser.offscreen.hasDocument()) return 'déjà actif (pipeline unique, relié à cet onglet)';
  try {
    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [browser.offscreen.Reason.WORKERS],
      justification: "Pipeline voix local de l'avatar : détection de parole, transcription, synthèse Piper en WebAssembly.",
    });
  } catch (error) {
    // Chrome refuse un second document offscreen : celui qui existe sert.
    if (await browser.offscreen.hasDocument()) return 'déjà actif (pipeline unique, relié à cet onglet)';
    throw error;
  }
  return 'démarré';
}
