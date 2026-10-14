// Étape 3, test d'injection (code jetable) : simule l'activation de l'extension sur
// la page rehearsal (ouverte avec ?inject) avant que la page n'appelle getUserMedia.

import { loadConfiguredPhoto } from '@/lib/avatar';
import { installFakeGetUserMedia } from '@/lib/inject';
import { createLogger } from '@/lib/log';

const log = createLogger('inject');

// Les fichiers de local/ sont générés au build : absents des chemins typés par WXT.
const localUrl = (path: string) => new URL(path, browser.runtime.getURL('/')).href;

async function loadTestAudio(): Promise<ArrayBuffer | null> {
  const config = (await (await fetch(localUrl('/local/avatar.json'))).json()) as { testAudio?: string | null };
  if (!config.testAudio) return null;
  const response = await fetch(localUrl(config.testAudio));
  if (!response.ok) throw new Error(`son introuvable : ${config.testAudio} (${response.status})`);
  log(`son préenregistré chargé : ${config.testAudio}`);
  return response.arrayBuffer();
}

export async function setupInjectionTest() {
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const photo = await loadConfiguredPhoto().catch((error: unknown) => {
    log(`photo indisponible : ${describe(error)}`);
    return null;
  });
  const audio = await loadTestAudio().catch((error: unknown) => {
    log(`son indisponible : ${describe(error)}`);
    return null;
  });
  installFakeGetUserMedia({ photo, audio });
}
