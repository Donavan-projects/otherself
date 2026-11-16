import { mapAssets } from '@/lib/avatar';
import { buildAvatarAssets } from '@/lib/avatar-assets';
import { buildVrmAssets, mapVrmAssets } from '@/lib/vrm-assets';
import { loadDemoConfig } from '@/lib/config';
import { blobToFile, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { setupPreviewButton } from '@/lib/preview-popup';

const pages = [
  { id: '#open-rehearsal', label: 'popupOpenRehearsal', url: '/rehearsal.html' },
  { id: '#open-rehearsal-injected', label: 'popupOpenRehearsalInjected', url: '/rehearsal.html?inject' },
  { id: '#open-avatar', label: 'popupOpenAvatar', url: '/avatar.html' },
  { id: '#open-voices', label: 'popupOpenVoices', url: '/voices.html' },
] as const;

for (const page of pages) {
  const button = document.querySelector<HTMLButtonElement>(page.id)!;
  button.textContent = browser.i18n.getMessage(page.label);
  button.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL(page.url) });
  });
}

// Injection sur l'onglet actif de la plateforme (voie A).
const log = createLogger('inject');
const activateButton = document.querySelector<HTMLButtonElement>('#activate')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
activateButton.textContent = browser.i18n.getMessage('popupActivate');
const deactivateButton = document.querySelector<HTMLButtonElement>('#deactivate')!;
deactivateButton.textContent = browser.i18n.getMessage('popupDeactivate');

const status = (message: string) => {
  log(message);
  statusEl.textContent = message;
};
// Aperçu de l'avatar en Picture-in-Picture (tournage) : lib/preview-popup.ts.
const preview = setupPreviewButton(document.querySelector<HTMLButtonElement>('#preview')!, status);

// Pause / Reprendre : l'avatar s'arrête (voix, écoute, puis image fixe « Avatar en pause ») sans
// toucher aux pistes remises à la plateforme ; le document offscreen reste ouvert (Piper chargé).
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
let pauseState: 'inactive' | 'active' | 'paused' = 'inactive';

async function refreshPause() {
  let state: typeof pauseState = 'inactive';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        func: () => window.__otherSelf?.state() ?? 'inactive',
      });
      const states = results.map((result) => result.result);
      state = states.includes('paused') ? 'paused' : states.includes('active') ? 'active' : 'inactive';
    }
  } catch {
    // Page où l'extension ne peut pas s'injecter : bouton inactif.
  }
  pauseState = state;
  pauseButton.disabled = state === 'inactive';
  pauseButton.textContent = browser.i18n.getMessage(state === 'paused' ? 'popupResume' : 'popupPause');
}

async function togglePause(clickAt: number) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
  const pause = pauseState !== 'paused';
  const results = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    world: 'MAIN',
    func: (paused: boolean, at: number) => window.__otherSelf?.setPaused(paused, at) ?? 'jamais activé',
    args: [pause, clickAt],
  });
  status(
    `${pause ? 'pause' : 'reprise'} ${Date.now() - clickAt} ms après le clic\n` +
      results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`).join('\n'),
  );
}

pauseButton.addEventListener('click', () => {
  const clickAt = Date.now();
  pauseButton.disabled = true;
  togglePause(clickAt)
    .catch((error: unknown) => status(`échec : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => void refreshPause());
});
void refreshPause();

/** Avatar préparé ici (page de l'extension), puis remis à la page sous forme d'images seulement. */
async function loadSources(): Promise<SerializedSources> {
  const config = await loadDemoConfig();
  const { assets, slogan } = await buildAvatarAssets(config);
  // Avatar 3D (prototype) : préparé en plus du SVG, qui reste le secours dans la page.
  let vrm: SerializedSources['vrm'];
  if (config.avatarRenderer === 'vrm') {
    try {
      vrm = await mapVrmAssets(await buildVrmAssets(config, slogan), blobToFile);
    } catch (error) {
      log(`avatar 3D indisponible (${error instanceof Error ? error.message : String(error)}) : avatar SVG utilisé`);
    }
  }
  return {
    avatar: await mapAssets(assets, blobToFile),
    vrm,
    bannerText: config.bannerText,
    debugSafeZone: config.debugSafeZone,
    language: config.language,
  };
}

/** Pipeline voix (VAD, transcription, LLM, Piper) : document offscreen, un seul à la fois. */
async function ensureOffscreen() {
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

async function activate() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
  status('préparation de l’avatar…');
  const sources = await loadSources();
  const pipeline = await ensureOffscreen();
  // allFrames : seuls les cadres couverts par activeTab (même origine que l'onglet) sont atteints.
  const target = { tabId: tab.id, allFrames: true };
  await browser.scripting.executeScript({ target, world: 'MAIN', files: ['/content-scripts/content.js'] });
  const results = await browser.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (serialized: SerializedSources) => window.__otherSelf?.install(serialized) ?? 'script absent',
    args: [sources],
  });
  // Pont vers le pipeline voix : cadre principal seulement, monde isolé.
  await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/bridge.js'] });
  const frames = results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`);
  status(
    `injection sur ${tab.url} (${results.length} cadre(s))\n${frames.join('\n')}\n` +
      `pipeline voix : ${pipeline}\nson du recruteur : cliquez sur le bouton OtherSelf dans la page (partage de l'onglet, son compris)`,
  );
}

/**
 * Retrait complet : injection et partage de l'onglet retirés, pipeline voix arrêté. Les pistes
 * remises à la plateforme sont arrêtées : elle devra reprendre la vraie caméra et le vrai micro
 * (Pause, elle, ne coupe rien côté plateforme).
 */
async function deactivate() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
  const lines: string[] = [];
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: () => window.__otherSelf?.uninstall() ?? 'jamais activé',
    });
    lines.push(...results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`));
  } catch (error) {
    // Onglet rechargé ou fermé entre-temps : il n'y a plus rien à retirer dans la page.
    lines.push(`onglet : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (await browser.offscreen.hasDocument()) {
    // Ferme le document offscreen : VAD, transcription, worker Piper et retour audio s'arrêtent.
    await browser.offscreen.closeDocument();
    lines.push('pipeline voix : arrêté');
  } else {
    lines.push('pipeline voix : déjà arrêté');
  }
  status(`désactivation sur ${tab.url}\n${lines.join('\n')}\nRéactivez la vraie caméra et le vrai micro dans les réglages de la plateforme.`);
}

deactivateButton.addEventListener('click', () => {
  deactivateButton.disabled = true;
  status('désactivation en cours…');
  deactivate()
    .catch((error: unknown) => status(`échec de la désactivation : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      deactivateButton.disabled = false;
      void preview.refresh();
      void refreshPause();
    });
});

activateButton.addEventListener('click', () => {
  activateButton.disabled = true;
  status('injection en cours…');
  activate()
    .catch((error: unknown) => status(`échec : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      activateButton.disabled = false;
      void preview.refresh();
      void refreshPause();
    });
});
