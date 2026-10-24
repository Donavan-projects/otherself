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

const status = (message: string) => {
  log(message);
  statusEl.textContent = message;
};

// Les fichiers de local/ sont générés au build : absents des chemins typés par WXT.
const localUrl = (path: string) => new URL(path, browser.runtime.getURL('/')).href;

async function loadFile(path: string | null | undefined): Promise<SerializedFile | null> {
  if (!path) return null;
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`${path} introuvable (${response.status})`);
  const blob = await response.blob();
  return { base64: bytesToBase64(await blob.arrayBuffer()), type: blob.type };
}

async function loadSources(): Promise<SerializedSources> {
  const config = (await (await fetch(localUrl('/local/avatar.json'))).json()) as {
    photo?: string | null;
    testAudio?: string | null;
  };
  return { photo: await loadFile(config.photo), audio: await loadFile(config.testAudio) };
}

async function activate() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('aucun onglet actif');
  const sources = await loadSources();
  // allFrames : seuls les cadres couverts par activeTab (même origine que l'onglet) sont atteints.
  const target = { tabId: tab.id, allFrames: true };
  await browser.scripting.executeScript({ target, world: 'MAIN', files: ['/content-scripts/content.js'] });
  const results = await browser.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (serialized: SerializedSources) => window.__otherSelf?.install(serialized) ?? 'script absent',
    args: [sources],
  });
  const frames = results.map((result) => `cadre ${result.frameId} : ${String(result.result)}`);
  status(`injection sur ${tab.url} (${results.length} cadre(s))\n${frames.join('\n')}`);
}

activateButton.addEventListener('click', () => {
  activateButton.disabled = true;
  status('injection en cours…');
  activate()
    .catch((error: unknown) => status(`échec : ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      activateButton.disabled = false;
    });
});
