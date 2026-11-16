// Popup : bouton « Aperçu de l'avatar » (lib/preview.ts). Masqué si previewWindow est à false
// dans config.local.json ou si l'extension n'est pas activée sur l'onglet ; actif seulement quand
// la plateforme a reçu la caméra. Le clic part directement vers la page : Chrome transmet le geste
// de l'utilisateur au script injecté, ce qu'exige l'ouverture d'une fenêtre Picture-in-Picture.
// L'état de l'onglet est relu par le popup (entrypoints/popup/main.ts), qui appelle update().

import { loadDemoConfig } from './config';
import { createLogger } from './log';
import type { PreviewStatus } from './preview';

export type { PreviewStatus };

const log = createLogger('preview');

/** Onglet activé ; frameId et status absents tant que la plateforme n'a pas demandé la caméra. */
export interface PreviewTarget {
  tabId: number;
  frameId?: number;
  status?: PreviewStatus;
}

export function setupPreviewButton(
  button: HTMLButtonElement,
  onError: (message: string) => void,
): { update(target: PreviewTarget | null): void } {
  let target: PreviewTarget | null = null;
  let enabled = false;

  const render = () => {
    const status = target?.status ?? 'waiting';
    button.hidden = !enabled || target === null;
    // Cible gardée jusqu'à la relecture suivante : un clic pendant la mise à jour doit encore partir.
    button.disabled = target?.frameId === undefined || status === 'waiting';
    button.textContent = browser.i18n.getMessage(status === 'open' ? 'popupPreviewClose' : 'popupPreview');
    button.title = browser.i18n.getMessage(
      status === 'open' ? 'popupPreviewHintClose' : status === 'ready' ? 'popupPreviewHintOpen' : 'popupPreviewHintWaiting',
    );
  };

  button.addEventListener('click', () => {
    if (target?.frameId === undefined) return;
    // Appel immédiat, sans attente avant : le geste de l'utilisateur doit accompagner l'injection.
    browser.scripting
      .executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        world: 'MAIN',
        func: () => window.__otherSelf?.preview?.toggle() ?? 'extension non activée sur cet onglet',
      })
      .then(([result]) => log(`aperçu de l’avatar : ${String(result?.result)}`))
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  });

  void loadDemoConfig().then((config) => {
    enabled = config.previewWindow;
    render();
  });
  return {
    update(next) {
      target = next;
      render();
    },
  };
}
