// Popup : pilotage de l'avatar sur l'onglet actif pendant un appel. Une pastille d'état
// (Inactif, Actif, En pause), les boutons utiles dans cet état, et au plus une phrase courte
// (consigne ou erreur). Les détails techniques vont dans les logs [inject] de la console du popup.

import { mapAssets } from '@/lib/avatar';
import { buildAvatarAssets, renderMarkingText } from '@/lib/avatar-assets';
import { buildVrmAssets, mapVrmAssets } from '@/lib/vrm-assets';
import { loadDemoConfig } from '@/lib/config';
import { blobToFile, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { setupPreviewButton, type PreviewStatus } from '@/lib/preview-popup';

const REFRESH_MS = 1000;
const t = (key: Parameters<typeof browser.i18n.getMessage>[0]) => browser.i18n.getMessage(key);
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// Outils de développement : section repliée.
$('#dev-tools').textContent = t('popupDevTools');
const pages = [
  { id: '#open-rehearsal', label: 'popupOpenRehearsal', url: '/rehearsal.html' },
  { id: '#open-rehearsal-injected', label: 'popupOpenRehearsalInjected', url: '/rehearsal.html?inject' },
  { id: '#open-avatar', label: 'popupOpenAvatar', url: '/avatar.html' },
  { id: '#open-voices', label: 'popupOpenVoices', url: '/voices.html' },
] as const;
for (const page of pages) {
  const button = $<HTMLButtonElement>(page.id);
  button.textContent = t(page.label);
  button.addEventListener('click', () => void browser.tabs.create({ url: browser.runtime.getURL(page.url) }));
}

// Injection sur l'onglet actif de la plateforme (voie A).
const log = createLogger('inject');
const stateEl = $<HTMLSpanElement>('#state');
const messageEl = $<HTMLParagraphElement>('#message');
const activateButton = $<HTMLButtonElement>('#activate');
const pauseButton = $<HTMLButtonElement>('#pause');
const removeSection = $<HTMLDivElement>('#remove-section');
const deactivateButton = $<HTMLButtonElement>('#deactivate');
activateButton.textContent = t('popupActivate');
deactivateButton.textContent = t('popupDeactivate');

type TabState = 'inactive' | 'active' | 'paused';

/** Ce que le popup sait de l'onglet, relu toutes les secondes. */
interface View {
  /** null : page où l'extension ne peut pas agir (chrome://, boutique…). */
  tabId: number | null;
  state: TabState;
  /** Cadre où la plateforme a reçu la caméra, pour l'aperçu. */
  preview: { frameId: number; status: PreviewStatus } | null;
  /** Son de l'onglet partagé avec le pipeline (cadre principal). */
  sharing: boolean;
  /** Caméra et micro autorisés pour le site (permission réelle du navigateur). */
  permissionsGranted: boolean;
}

let view: View = { tabId: null, state: 'inactive', preview: null, sharing: false, permissionsGranted: true };
/** Opération en cours (activation, pause, retrait) : boutons d'action désactivés. */
let busy = false;
/** Phrase laissée par la dernière action (erreur ou consigne), prioritaire sur les consignes d'état. */
let notice: { text: string; kind: 'info' | 'error' } | null = null;

const preview = setupPreviewButton($<HTMLButtonElement>('#preview'), (error) => {
  log(`aperçu de l’avatar : ${error}`);
  notice = { text: t('popupErrorGeneric'), kind: 'error' };
  render();
});

function render() {
  const { state } = view;
  stateEl.dataset.state = state;
  stateEl.textContent = t(state === 'active' ? 'popupStateActive' : state === 'paused' ? 'popupStatePaused' : 'popupStateInactive');

  activateButton.hidden = state !== 'inactive';
  activateButton.disabled = busy || view.tabId === null;
  pauseButton.hidden = state === 'inactive';
  pauseButton.disabled = busy;
  pauseButton.textContent = t(state === 'paused' ? 'popupResume' : 'popupPause');
  removeSection.hidden = state === 'inactive';
  deactivateButton.disabled = busy;
  preview.update(state === 'inactive' || view.tabId === null ? null : { tabId: view.tabId, ...view.preview });

  // Une seule phrase : celle de la dernière action, sinon la consigne utile dans cet état.
  let text = '';
  let kind: 'info' | 'error' = 'info';
  if (notice) ({ text, kind } = notice);
  else if (view.tabId === null) text = t('popupUnavailable');
  else if (state !== 'inactive' && !view.permissionsGranted) ({ text, kind } = { text: t('popupHintPermissions'), kind: 'error' });
  else if (state === 'active' && !view.sharing) text = t('popupHintShare');
  messageEl.textContent = text;
  messageEl.dataset.kind = kind;
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
  return tab as typeof tab & { id: number };
}

/** Relit l'état de l'onglet dans tous ses cadres (lecture seule). */
async function refresh() {
  const next: View = { tabId: null, state: 'inactive', preview: null, sharing: false, permissionsGranted: true };
  try {
    const tab = await activeTab();
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: async () => {
        const otherSelf = window.__otherSelf;
        const granted = async (name: string) => {
          try {
            return (await navigator.permissions.query({ name: name as PermissionName })).state === 'granted';
          } catch {
            return true;
          }
        };
        return {
          state: otherSelf?.state() ?? 'inactive',
          preview: otherSelf?.preview?.status() ?? null,
          sharing: otherSelf?.sharing?.() ?? false,
          top: window === window.top,
          permissions: otherSelf ? (await granted('camera')) && (await granted('microphone')) : true,
        };
      },
    });
    next.tabId = tab.id;
    const frames = results.flatMap((result) => (result.result ? [{ frameId: result.frameId, ...result.result }] : []));
    const states = frames.map((frame) => frame.state);
    next.state = states.includes('paused') ? 'paused' : states.includes('active') ? 'active' : 'inactive';
    // Le cadre où la caméra a été remise à la plateforme (souvent le cadre principal).
    const withPreview =
      frames.find((frame) => frame.preview === 'open') ??
      frames.find((frame) => frame.preview === 'ready') ??
      frames.find((frame) => frame.preview === 'waiting');
    next.preview = withPreview?.preview ? { frameId: withPreview.frameId, status: withPreview.preview } : null;
    next.sharing = frames.some((frame) => frame.top && frame.sharing);
    const top = frames.find((frame) => frame.top);
    next.permissionsGranted = top?.permissions ?? true;
  } catch {
    // Page où l'extension ne peut pas s'injecter : rien à piloter.
  }
  view = next;
  render();
}

/** Lance une action : boutons désactivés pendant l'opération, phrase courte en cas d'échec, détails dans les logs. */
function run(action: () => Promise<{ text: string; kind: 'info' | 'error' } | null>) {
  busy = true;
  notice = null;
  render();
  action()
    .then((result) => (notice = result))
    .catch((error: unknown) => {
      log(`échec : ${error instanceof Error ? error.message : String(error)}`);
      notice = { text: t('popupErrorGeneric'), kind: 'error' };
    })
    .finally(() => {
      busy = false;
      void refresh();
    });
}

// Pause / Reprendre : l'avatar s'arrête (voix, écoute, puis image fixe « Avatar en pause ») sans
// toucher aux pistes remises à la plateforme ; le document offscreen reste ouvert (Piper chargé).
pauseButton.addEventListener('click', () => {
  const clickAt = Date.now();
  const pause = view.state !== 'paused';
  run(async () => {
    const tab = await activeTab();
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: (paused: boolean, at: number) => window.__otherSelf?.setPaused(paused, at) ?? 'jamais activé',
      args: [pause, clickAt],
    });
    log(
      `${pause ? 'pause' : 'reprise'} ${Date.now() - clickAt} ms après le clic ; ` +
        results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`).join(', '),
    );
    return null;
  });
});

/** Avatar préparé ici (page de l'extension), puis remis à la page sous forme d'images seulement. */
async function loadSources(): Promise<SerializedSources> {
  const config = await loadDemoConfig();
  const { assets } = await buildAvatarAssets(config);
  // Avatar 3D (prototype) : préparé en plus du SVG, qui reste le secours dans la page.
  let vrm: SerializedSources['vrm'];
  if (config.avatarRenderer === 'vrm') {
    try {
      vrm = await mapVrmAssets(await buildVrmAssets(config), blobToFile);
    } catch (error) {
      log(`avatar 3D indisponible (${error instanceof Error ? error.message : String(error)}) : avatar SVG utilisé`);
    }
  }
  return {
    avatar: await mapAssets(assets, blobToFile),
    vrm,
    marking: await blobToFile(await renderMarkingText(config.badgeText)),
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

activateButton.addEventListener('click', () => {
  run(async () => {
    const tab = await activeTab();
    notice = { text: t('popupActivating'), kind: 'info' };
    render();
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
    log(
      `injection sur ${tab.url} (${results.length} cadre(s)) : ` +
        `${results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`).join(', ')} ; pipeline voix : ${pipeline}`,
    );
    return null;
  });
});

/**
 * Retrait complet : injection et partage de l'onglet retirés, pipeline voix arrêté. Les pistes
 * remises à la plateforme sont arrêtées : elle devra reprendre la vraie caméra et le vrai micro
 * (Pause, elle, ne coupe rien côté plateforme).
 */
deactivateButton.addEventListener('click', () => {
  run(async () => {
    const tab = await activeTab();
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
    log(`retrait complet sur ${tab.url} : ${lines.join(', ')}`);
    return { text: t('popupRemoved'), kind: 'info' };
  });
});

render();
void refresh();
setInterval(() => void refresh(), REFRESH_MS);
