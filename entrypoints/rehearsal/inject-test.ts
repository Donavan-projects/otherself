// Banc d'essai de l'injection : simule l'activation de l'extension sur la page rehearsal
// (ouverte avec ?inject) avant que la page n'appelle getUserMedia.

import { loadAvatarConfig } from '@/lib/avatar';
import { loadDemoConfig, localUrl } from '@/lib/config';
import { installFakeGetUserMedia } from '@/lib/inject';
import { createLogger } from '@/lib/log';
import { createTestAudioTrack } from '@/lib/test-audio';

const log = createLogger('inject');

async function loadTestAudio(): Promise<ArrayBuffer | null> {
  const { testAudio } = await loadDemoConfig();
  if (!testAudio) return null;
  const response = await fetch(localUrl(testAudio));
  if (!response.ok) throw new Error(`son introuvable : ${testAudio} (${response.status})`);
  log(`son préenregistré chargé : ${testAudio}`);
  return response.arrayBuffer();
}

export async function setupInjectionTest() {
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const { photo, options } = await loadAvatarConfig().catch((error: unknown) => {
    log(`photo indisponible : ${describe(error)}`);
    return { photo: null, options: {} };
  });
  const audio = await loadTestAudio().catch((error: unknown) => {
    log(`son indisponible : ${describe(error)}`);
    return null;
  });
  installFakeGetUserMedia({ photo, avatarOptions: options, createAudioTrack: () => createTestAudioTrack(audio) });
}
