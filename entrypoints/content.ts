// Injection sur la plateforme (voie A). Injecté à la demande par le popup dans le monde
// MAIN de l'onglet (activeTab + scripting), jamais déclaré dans le manifest. Remplace
// caméra et micro par l'avatar et joue la voix de l'avatar dans le micro injecté.
// Communique avec l'extension par window.postMessage via le pont (bridge.content.ts).

import { PAGE_TAG, type FromPage, type PageEnvelope } from '@/lib/bridge-messages';
import { installFakeGetUserMedia } from '@/lib/inject';
import { mapAssets } from '@/lib/avatar';
import { fileToBlob, pauseText, type SerializedSources } from '@/lib/injection-sources';
import { createLogger } from '@/lib/log';
import { createVoiceOutput, type VoiceOutput } from '@/lib/page-audio';
import { createPageControls } from '@/lib/page-controls';
import { createPreview, type Preview } from '@/lib/preview';
import { offerTabShare } from '@/lib/share-tab';
import { trustedTypesEnforcement } from '@/lib/trusted-types';

declare global {
  interface Window {
    __otherSelf?: {
      install(sources: SerializedSources): Promise<string>;
      uninstall(): string;
      /** Pause (vrai) ou reprise (faux) ; clickAt : Date.now du clic, pour mesurer les délais. */
      setPaused(paused: boolean, clickAt: number): string;
      state(): OtherSelfState;
      /** Popup : vrai si le son de l'onglet est partagé (cadre principal). */
      sharing?(): boolean;
      preview?: Preview | undefined;
    };
  }
}

type OtherSelfState = 'inactive' | 'active' | 'paused';

const log = createLogger('inject');
const logState = createLogger('etat');

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
    /** Pause / reprise de l'installation en cours ; null tant qu'elle n'est pas prête. */
    let pauseControl: { paused: boolean; set(paused: boolean, clickAt: number): string } | null = null;
    window.__otherSelf = {
      state: () => (!installed ? 'inactive' : pauseControl?.paused ? 'paused' : 'active'),
      setPaused(paused, clickAt) {
        if (!pauseControl) return installed ? 'installation en cours' : 'jamais activé';
        return pauseControl.set(paused, clickAt);
      },
      uninstall() {
        if (!installed) return 'déjà inactif';
        for (const undo of uninstallers.reverse()) undo();
        uninstallers = [];
        installed = false;
        pauseControl = null;
        log(`désactivé (${frame} ${location.href})`);
        return 'désactivé';
      },
      async install(sources) {
        if (installed) return 'déjà actif';
        installed = true;
        // Politique de la page lue dès l'activation : le rythme du dessin en dépend (lib/frame-clock.ts).
        void trustedTypesEnforcement();
        const avatar = await mapAssets(sources.avatar, (file) => createImageBitmap(fileToBlob(file)));
        const vrm = sources.vrm && {
          model: await fileToBlob(sources.vrm.model).arrayBuffer(),
          background: await createImageBitmap(fileToBlob(sources.vrm.background)),
          camera: sources.vrm.camera,
        };
        if (vrm) log(`avatar 3D reçu : modèle ${(vrm.model.byteLength / 1e6).toFixed(1)} Mo, l'avatar de secours prend le relais`);
        log(`installation (${frame} ${location.href}) : avatar ${avatar.under.width}x${avatar.under.height}, marquage IA ${sources.marking ? 'reçu' : 'absent'}`);

        let voice: VoiceOutput | null = null;
        const media = installFakeGetUserMedia({
          avatar,
          vrm,
          marking: await createImageBitmap(fileToBlob(sources.marking)),
          pauseText: pauseText(sources.language),
          createAudioTrack: async () => {
            voice = createVoiceOutput(
              (responseId, at) => sendToExtension({ type: 'playback-started', responseId, at }),
              (responseId) => sendToExtension({ type: 'playback-idle', responseId }),
              (responseId, startAt, endAt) => sendToExtension({ type: 'playback-chunk', responseId, startAt, endAt }),
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
        // Pause : la voix se tait, le son du recruteur ne part plus (partage gardé ouvert), puis
        // l'image « Avatar en pause » remplace l'avatar. Les pistes de la plateforme restent vivantes.
        let paused = false;
        const controls = isTop ? createPageControls(sources.labels, (clickAt) => void pauseControl?.set(!paused, clickAt)) : null;
        uninstallers.push(() => controls?.remove());
        pauseControl = {
          get paused() {
            return paused;
          },
          set(value, clickAt) {
            if (value === paused) return value ? 'déjà en pause' : 'déjà actif';
            if (value) {
              // 1. Voix en cours coupée dans le micro injecté.
              const hadVoice = voice !== null;
              voice?.stop();
              paused = true;
              if (hadVoice) log(`pause : voix coupée dans le micro injecté ${Date.now() - clickAt} ms après le clic`);
              // 2. Pipeline d'écoute : plus de son envoyé, le document offscreen s'arrête.
              if (isTop) sendToExtension({ type: 'pause', at: clickAt });
              // 3. Rendu : image fixe.
              media.setPaused(true, clickAt);
            } else {
              paused = false;
              media.setPaused(false, clickAt);
              if (isTop) sendToExtension({ type: 'resume', at: clickAt });
            }
            controls?.update(paused);
            log(`${paused ? 'pause' : 'reprise'} (${frame}) : traitée ${Date.now() - clickAt} ms après le clic`);
            return paused ? 'en pause' : 'actif';
          },
        };
        if (isTop) {
          const share = offerTabShare(sources.labels.share, (pcm, at) => sendToExtension({ type: 'audio', pcm, at }), () => !paused);
          window.__otherSelf!.sharing = () => share.listening();
          uninstallers.push(() => {
            share.stop();
            window.__otherSelf!.sharing = undefined;
          });
        }
        if (isTop) {
          const onMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const envelope = event.data as Partial<PageEnvelope> | null;
            if (envelope?.[PAGE_TAG] !== 'to-page' || !envelope.message) return;
            const message = envelope.message;
            if (message.type === 'hello') {
              if (voice) sendToExtension({ type: 'mic-ready' });
              // Pont relié de nouveau (réactivation) : le pipeline apprend que l'avatar est en pause.
              if (paused) sendToExtension({ type: 'pause', at: Date.now() });
            } else if (message.type === 'speak') {
              // Voix déjà en route au moment de la pause : jamais jouée.
              if (paused) log('pause : voix reçue du pipeline ignorée');
              else if (voice) voice.speak(message.responseId, message.pcm, message.sampleRate);
              else log('voix reçue avant que la plateforme ait demandé le micro : ignorée');
            } else if (message.type === 'stop') {
              voice?.stop();
            } else if (message.type === 'state') {
              logState(`${message.previous} → ${message.state} reçu ${Date.now() - message.at} ms après le changement (${message.reason})`);
              media.setAvatarState(message.state);
            } else if (message.type === 'nod') {
              media.nod();
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
