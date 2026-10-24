// Pont entre la page (monde MAIN, sans accès aux API d'extension) et le document
// offscreen qui fait tourner le pipeline voix. Injecté à la demande par le popup dans
// le cadre principal, monde isolé. Affiche aussi les logs du pipeline dans la console
// de la page.

import { PAGE_TAG, PORT_NAME, type FromOffscreen, type PageEnvelope, type ToPage } from '@/lib/bridge-messages';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    const flag = '__otherSelfBridge';
    const scope = window as unknown as Record<string, boolean>;
    if (scope[flag]) return;
    scope[flag] = true;

    const port = browser.runtime.connect({ name: PORT_NAME });
    console.log('[inject] pont relié au pipeline voix (document offscreen)');

    const toPage = (message: ToPage) => {
      const envelope: PageEnvelope = { [PAGE_TAG]: 'to-page', message };
      window.postMessage(envelope, location.origin);
    };
    const fromPage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const envelope = event.data as Partial<PageEnvelope> | null;
      if (envelope?.[PAGE_TAG] !== 'to-ext' || !envelope.message) return;
      port.postMessage(envelope.message);
    };
    window.addEventListener('message', fromPage);
    toPage({ type: 'hello' });

    port.onMessage.addListener((message: FromOffscreen) => {
      if (message.type === 'log') {
        console.log(message.line);
        return;
      }
      toPage(message);
    });

    // Un autre onglet a pris le pipeline : ce pont s'arrête, une réactivation en recrée un.
    port.onDisconnect.addListener(() => {
      console.log('[inject] pont déconnecté du pipeline voix (un autre onglet l’a pris, ou extension rechargée)');
      window.removeEventListener('message', fromPage);
      scope[flag] = false;
    });
  },
});
