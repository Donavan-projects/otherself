// Pont entre la page (monde MAIN, sans accès aux API d'extension) et le document
// offscreen qui fait tourner le pipeline voix. Injecté à la demande par le popup dans
// le cadre principal, monde isolé. Affiche aussi les logs du pipeline dans la console
// de la page.

import { PAGE_TAG, PORT_NAME, type FromOffscreen, type PageEnvelope } from '@/lib/bridge-messages';

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

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const envelope = event.data as Partial<PageEnvelope> | null;
      if (envelope?.[PAGE_TAG] !== 'to-ext' || !envelope.message) return;
      port.postMessage(envelope.message);
    });

    port.onMessage.addListener((message: FromOffscreen) => {
      if (message.type === 'log') {
        console.log(message.line);
        return;
      }
      const envelope: PageEnvelope = { [PAGE_TAG]: 'to-page', message };
      window.postMessage(envelope, location.origin);
    });

    port.onDisconnect.addListener(() => {
      console.log('[inject] pont déconnecté du pipeline voix');
      scope[flag] = false;
    });
  },
});
