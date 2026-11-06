// Injection sur la plateforme (voie A). Injecté à la demande par le popup dans le monde
// MAIN de l'onglet (activeTab + scripting), jamais déclaré dans le manifest. Remplace
// caméra et micro par l'avatar et joue la voix de l'avatar dans le micro injecté.
// Communique avec l'extension par window.postMessage via le pont (bridge.content.ts).

import { PAGE_TAG, type FromPage, type PageEnvelope } from '@/lib/bridge-messages';
import { installFakeGetUserMedia } from '@/lib/inject';
import { mapAssets } from '@/lib/avatar';
import { fileToBlob, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { createVoiceOutput, type VoiceOutput } from '@/lib/page-audio';
import { createPreview, type Preview } from '@/lib/preview';
import { offerTabShare } from '@/lib/share-tab';

declare global {
  interface Window {
    __otherSelf?: { install(sources: SerializedSources): Promise<string>; uninstall(): string; preview?: Preview | undefined };
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
    let uninstallers: (() => void)[] = [];
    window.__otherSelf = {
      uninstall() {
        if (!installed) return 'déjà inactif';
        for (const undo of uninstallers.reverse()) undo();
        uninstallers = [];
        installed = false;
        log(`désactivé (${frame} ${location.href})`);
        return 'désactivé';
      },
      async install(sources) {
        if (installed) return 'déjà actif';
        installed = true;
        const avatar = await mapAssets(sources.avatar, (file) => createImageBitmap(fileToBlob(file)));
        const vrm = sources.vrm && {
          model: await fileToBlob(sources.vrm.model).arrayBuffer(),
          background: await createImageBitmap(fileToBlob(sources.vrm.background)),
          banner: sources.vrm.banner,
          camera: sources.vrm.camera,
          slogan: { image: await createImageBitmap(fileToBlob(sources.vrm.slogan)), ...sources.vrm.sloganPlacement },
        };
        if (vrm) log(`avatar 3D reçu : modèle ${(vrm.model.byteLength / 1e6).toFixed(1)} Mo, l'avatar SVG sert de secours`);
        log(`installation (${frame} ${location.href}) : avatar ${avatar.under.width}x${avatar.under.height}, bandeau « ${sources.bannerText} » à y = ${avatar.banner.y}`);
        if (sources.debugSafeZone) log('débogage : contour de la zone de sécurité affiché');

        let voice: VoiceOutput | null = null;
        const media = installFakeGetUserMedia({
          avatar,
          vrm,
          avatarOptions: { bannerText: sources.bannerText, debugSafeZone: sources.debugSafeZone },
          createAudioTrack: async () => {
            voice = createVoiceOutput(
              (responseId, at) => sendToExtension({ type: 'playback-started', responseId, at }),
              (responseId) => sendToExtension({ type: 'playback-idle', responseId }),
            );
            log('micro demandé par la plateforme : la voix de l’avatar peut partir');
            sendToExtension({ type: 'mic-ready' });
            return voice.track;
          },
        });

        uninstallers.push(() => {
          voice?.stop();
          media.uninstall();
        });
        // Aperçu Picture-in-Picture pour le tournage (lib/preview.ts), fermé avant le reste.
        const preview = createPreview(media);
        window.__otherSelf!.preview = preview;
        uninstallers.push(() => {
          preview.close();
          window.__otherSelf!.preview = undefined;
        });
        // Le pipeline voix n'est relié qu'au cadre principal. Son du recruteur : partage de
        // l'onglet par la page, son compris (bouton, getDisplayMedia), sans permission d'extension.
        if (isTop) {
          const share = offerTabShare((pcm, at) => sendToExtension({ type: 'audio', pcm, at }));
          uninstallers.push(() => share.stop());
        }
        if (isTop) {
          const onMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const envelope = event.data as Partial<PageEnvelope> | null;
            if (envelope?.[PAGE_TAG] !== 'to-page' || !envelope.message) return;
            const message = envelope.message;
            if (message.type === 'hello') {
              if (voice) sendToExtension({ type: 'mic-ready' });
            } else if (message.type === 'speak') {
              if (voice) voice.speak(message.responseId, message.pcm, message.sampleRate);
              else log('voix reçue avant que la plateforme ait demandé le micro : ignorée');
            } else if (message.type === 'stop') {
              voice?.stop();
            }
          };
          window.addEventListener('message', onMessage);
          uninstallers.push(() => window.removeEventListener('message', onMessage));
        }
        return 'actif';
      },
    };
    log(`script injecté (${frame} ${location.href})`);
  },
});
