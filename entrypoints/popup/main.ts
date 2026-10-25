import type { CaptureReply, ToOffscreen } from '@/lib/bridge-messages';
import { loadDemoConfig, localUrl } from '@/lib/config';
import { bytesToBase64, type SerializedFile, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';

const pages = [
  { id: '#open-rehearsal', label: 'popupOpenRehearsal', url: '/rehearsal.html' },
  { id: '#open-rehearsal-injected', label: 'popupOpenRehearsalInjected', url: '/rehearsal.html?inject' },
  { id: '#open-avatar', label: 'popupOpenAvatar', url: '/avatar.html' },
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

async function loadFile(path: string | null | undefined): Promise<SerializedFile | null> {
  if (!path) return null;
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  const blob = await response.blob();
  return { base64: bytesToBase64(await blob.arrayBuffer()), type: blob.type };
}

async function loadSources(): Promise<SerializedSources> {
  const config = await loadDemoConfig();
  return {
    photo: await loadFile(config.photo),
    bannerText: config.bannerText,
    debugSafeZone: config.debugSafeZone,
    shareTab: config.recruiterAudio === 'shareTab',
  };
}

/** Pipeline voix (VAD, transcription, LLM, Piper) : document offscreen, un seul à la fois. */
async function ensureOffscreen() {
  if (await browser.offscreen.hasDocument()) return 'déjà actif (pipeline unique, relié à cet onglet)';
  try {
    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [browser.offscreen.Reason.WORKERS, browser.offscreen.Reason.USER_MEDIA],
      justification:
        "Pipeline voix local de l'avatar : son de l'onglet activé (tabCapture), détection de parole, synthèse Piper en WebAssembly.",
    });
  } catch (error) {
    // Chrome refuse un second document offscreen : celui qui existe sert.
    if (await browser.offscreen.hasDocument()) return 'déjà actif (pipeline unique, relié à cet onglet)';
    throw error;
  }
  return 'démarré';
}

async function sendToOffscreen(message: ToOffscreen): Promise<CaptureReply> {
  // Document offscreen tout juste créé : son écouteur peut ne pas être encore en place.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await browser.runtime.sendMessage(message)) as CaptureReply;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Son du recruteur : son de l'onglet (tabCapture), autorisé par ce clic sur l'onglet actif. */
async function startTabCapture(tabId: number) {
  if ((await sendToOffscreen({ target: 'offscreen', type: 'capture-status', tabId })).live) return 'déjà en cours';
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const reply = await sendToOffscreen({ target: 'offscreen', type: 'capture-start', tabId, streamId });
  if (!reply.live) throw new Error(`capture du son de l'onglet impossible : ${reply.error ?? 'raison inconnue'}`);
  return 'démarrée';
}

async function activate() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
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
  const capture = sources.shareTab
    ? (await sendToOffscreen({ target: 'offscreen', type: 'capture-stop', tabId: tab.id }),
      'par le partage de l’onglet : cliquez sur le bouton OtherSelf dans la page')
    : `tabCapture ${await startTabCapture(tab.id)}`;
  const frames = results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`);
  status(
    `injection sur ${tab.url} (${results.length} cadre(s))\n${frames.join('\n')}\n` +
      `pipeline voix : ${pipeline}\nson du recruteur : ${capture}`,
  );
}

/** Arrêt propre : injection retirée de l'onglet, capture et pipeline voix arrêtés. */
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
    await sendToOffscreen({ target: 'offscreen', type: 'capture-stop', tabId: tab.id }).catch(() => undefined);
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
    });
});

activateButton.addEventListener('click', () => {
  activateButton.disabled = true;
  status('injection en cours…');
  activate()
    .catch((error: unknown) => status(`échec : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      activateButton.disabled = false;
    });
});
