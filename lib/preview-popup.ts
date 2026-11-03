// Popup : bouton « Aperçu de l'avatar » (lib/preview.ts). Masqué si previewWindow est à false
// dans config.local.json ; actif seulement quand l'extension est activée sur l'onglet et que la
// plateforme a reçu la caméra. Le clic part directement vers la page : Chrome transmet le geste
// de l'utilisateur au script injecté, ce qu'exige l'ouverture d'une fenêtre Picture-in-Picture.

import { loadDemoConfig } from './config';

const REFRESH_MS = 1000;

type FrameStatus = 'inactive' | 'waiting' | 'ready' | 'open';

const HINTS: Record<FrameStatus, string> = {
  inactive: 'Activer d’abord l’extension sur cet onglet.',
  waiting: 'En attente : la plateforme n’a pas encore demandé la caméra.',
  ready: 'Ouvre une fenêtre avec le flux vidéo envoyé à la plateforme, à l’endroit et sans son.',
  open: 'Ferme la fenêtre d’aperçu.',
};

export function setupPreviewButton(button: HTMLButtonElement, status: (message: string) => void): { refresh(): Promise<void> } {
  let target: { tabId: number; frameId: number } | null = null;
  let enabled = false;

  const refresh = async () => {
    if (!enabled) return;
    let state: FrameStatus = 'inactive';
    // Cible gardée jusqu'à la réponse : un clic pendant la mise à jour doit encore partir.
    let found: { tabId: number; frameId: number } | null = null;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          world: 'MAIN',
          func: () => window.__otherSelf?.preview?.status() ?? 'inactive',
        });
        // Le cadre où la caméra a été remise à la plateforme (souvent le cadre principal).
        const frame = results.find((result) => result.result === 'open') ?? results.find((result) => result.result === 'ready');
        if (frame) {
          state = frame.result as FrameStatus;
          found = { tabId: tab.id, frameId: frame.frameId };
        } else if (results.some((result) => result.result === 'waiting')) {
          state = 'waiting';
        }
      }
    } catch {
      // Page où l'extension ne peut pas s'injecter (chrome://, boutique…) : bouton inactif.
    }
    target = found;
    button.disabled = target === null;
    button.textContent = browser.i18n.getMessage(state === 'open' ? 'popupPreviewClose' : 'popupPreview');
    button.title = HINTS[state];
  };

  button.addEventListener('click', () => {
    if (!target) return;
    // Appel immédiat, sans attente avant : le geste de l'utilisateur doit accompagner l'injection.
    browser.scripting
      .executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        world: 'MAIN',
        func: () => window.__otherSelf?.preview?.toggle() ?? 'extension non activée sur cet onglet',
      })
      .then(([result]) => status(`aperçu de l’avatar : ${String(result?.result)}`))
      .catch((error: unknown) => status(`aperçu de l’avatar : ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => void refresh());
  });

  void loadDemoConfig().then((config) => {
    if (!config.previewWindow) return;
    enabled = true;
    button.hidden = false;
    void refresh();
    setInterval(() => void refresh(), REFRESH_MS);
  });
  return { refresh };
}
