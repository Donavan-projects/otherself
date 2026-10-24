// Injection sur la plateforme (voie A). Injecté à la demande par le popup dans le monde
// MAIN de l'onglet (activeTab + scripting), jamais déclaré dans le manifest. Expose un
// installeur que le popup appelle avec la photo et le son.

import { installFakeGetUserMedia } from '@/lib/inject';
import { fileToBlob, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { createTestAudioTrack } from '@/lib/test-audio';

declare global {
  interface Window {
    __otherSelf?: { install(sources: SerializedSources): Promise<string> };
  }
}

const log = createLogger('inject');

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const frame = window === window.top ? 'cadre principal' : 'iframe';
    if (window.__otherSelf) {
      log(`script déjà présent (${frame} ${location.href})`);
      return;
    }
    let installed = false;
    window.__otherSelf = {
      async install(sources) {
        if (installed) return 'déjà actif';
        installed = true;
        const photo = sources.photo
          ? await createImageBitmap(fileToBlob(sources.photo), { imageOrientation: 'from-image' })
          : null;
        const audio = sources.audio ? await fileToBlob(sources.audio).arrayBuffer() : null;
        log(
          `installation (${frame} ${location.href}) : photo ${photo ? `${photo.width}x${photo.height}` : 'absente'}, ` +
            `son ${audio ? `${Math.round(audio.byteLength / 1024)} Ko` : 'absent (bip)'}`,
        );
        if (sources.debugSafeZone) log('débogage : contour de la zone de sécurité affiché');
        installFakeGetUserMedia({
          photo,
          avatarOptions: { debugSafeZone: sources.debugSafeZone },
          createAudioTrack: () => createTestAudioTrack(audio),
        });
        return 'actif';
      },
    };
    log(`script injecté (${frame} ${location.href})`);
  },
});
