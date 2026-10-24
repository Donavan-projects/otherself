// Injection sur la plateforme (voie A). Injecté à la demande par le popup dans le monde
// MAIN de l'onglet (activeTab + scripting), jamais déclaré dans le manifest. Remplace
// caméra et micro par l'avatar, capte le son du recruteur et joue la voix de l'avatar.
// Communique avec l'extension par window.postMessage via le pont (bridge.content.ts).

import { PAGE_TAG, type FromPage, type PageEnvelope } from '@/lib/bridge-messages';
import { installFakeGetUserMedia } from '@/lib/inject';
import { fileToBlob, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { captureRemoteAudio, createVoiceOutput, type VoiceOutput } from '@/lib/page-audio';

declare global {
  interface Window {
    __otherSelf?: { install(sources: SerializedSources): Promise<string> };
  }
}

const log = createLogger('inject');

function sendToExtension(message: FromPage) {
  const envelope: PageEnvelope = { [PAGE_TAG]: 'to-ext', message };
  window.postMessage(envelope, location.origin);
}

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const isTop = window === window.top;
    const frame = isTop ? 'cadre principal' : 'iframe';
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
        log(`installation (${frame} ${location.href}) : photo ${photo ? `${photo.width}x${photo.height}` : 'absente'}, bandeau « ${sources.bannerText} »`);
        if (sources.debugSafeZone) log('débogage : contour de la zone de sécurité affiché');

        let voice: VoiceOutput | null = null;
        installFakeGetUserMedia({
          photo,
          avatarOptions: { bannerText: sources.bannerText, debugSafeZone: sources.debugSafeZone },
          createAudioTrack: async () => {
            voice = createVoiceOutput(
              (responseId, at) => sendToExtension({ type: 'playback-started', responseId, at }),
              (responseId) => sendToExtension({ type: 'playback-idle', responseId }),
            );
            return voice.track;
          },
        });

        // Le pipeline voix n'est relié qu'au cadre principal.
        if (isTop) {
          captureRemoteAudio((pcm, at) => sendToExtension({ type: 'audio', pcm, at }));
          window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const envelope = event.data as Partial<PageEnvelope> | null;
            if (envelope?.[PAGE_TAG] !== 'to-page' || !envelope.message) return;
            const message = envelope.message;
            if (message.type === 'speak') {
              if (voice) voice.speak(message.responseId, message.pcm, message.sampleRate);
              else log('voix reçue avant que la plateforme ait demandé le micro : ignorée');
            } else if (message.type === 'stop') {
              voice?.stop();
            }
          });
        }
        return 'actif';
      },
    };
    log(`script injecté (${frame} ${location.href})`);
  },
});
