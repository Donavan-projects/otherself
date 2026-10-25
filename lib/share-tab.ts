// Son du recruteur, option C (prototype) : la page de l'entretien partage son propre onglet,
// son compris, par la fenêtre de partage standard de Chrome (getDisplayMedia). Aucune
// permission d'extension. Chrome exige un clic dans la page : un bouton est injecté.
// Le flux n'est jamais remis à la plateforme : seul son son part vers le document offscreen
// (par le pont), comme avec tabCapture. Monde MAIN, cadre principal.

import { createLogger } from './log';
import { audioContext } from './page-audio';
import { bufferToBase64, floatToInt16, resample } from './pcm';

const log = createLogger('inject');

export const SHARE_SAMPLE_RATE = 24000;
// ScriptProcessorNode (obsolète) : un AudioWorklet demanderait un module servi à la page,
// donc des web_accessible_resources visibles des sites, ou une URL blob que la CSP des
// plateformes peut refuser. À revoir si l'option C est retenue.
const PROCESSOR_FRAMES = 2048;
const REPORT_INTERVAL_MS = 15000;

const BUTTON_TEXT = 'Autoriser OtherSelf à écouter le recruteur : Chrome va vous demander de partager cet onglet, son compris.';

type GetDisplayMedia = (this: MediaDevices, options?: DisplayMediaStreamOptions) => Promise<MediaStream>;

const isNative = (fn: unknown) => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');

/**
 * getDisplayMedia d'origine : si la plateforme l'a remplacé (pour suivre ses propres partages
 * d'écran), on prend celui d'un cadre vierge, pour qu'elle ne voie pas ce partage.
 */
function pristineGetDisplayMedia(): GetDisplayMedia {
  const current = MediaDevices.prototype.getDisplayMedia as GetDisplayMedia;
  if (isNative(current)) {
    log('partage de l’onglet : getDisplayMedia natif (la plateforme ne l’a pas remplacé)');
    return current;
  }
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  document.documentElement.append(frame);
  const pristine = (frame.contentWindow as (Window & typeof globalThis) | null)?.MediaDevices.prototype.getDisplayMedia as
    | GetDisplayMedia
    | undefined;
  frame.remove();
  log(`partage de l’onglet : getDisplayMedia remplacé par la plateforme, ${pristine ? 'version d’origine reprise d’un cadre vierge' : 'version d’origine introuvable'}`);
  return pristine ?? current;
}

/** Affiche le bouton ; au clic, partage de l'onglet et envoi de son son. */
export function offerTabShare(onChunk: (pcm: string, at: number) => void) {
  const getDisplayMedia = pristineGetDisplayMedia();

  // Shadow DOM : le style de la page ne touche pas le bouton.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const button = document.createElement('button');
  button.textContent = BUTTON_TEXT;
  button.style.cssText =
    'max-width:360px;padding:12px 16px;border:0;border-radius:10px;background:#1a56db;color:#fff;' +
    'font:500 14px/1.4 system-ui,sans-serif;text-align:left;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3);';
  shadow.append(button);

  const show = (reason: string) => {
    button.disabled = false;
    document.documentElement.append(host);
    log(`partage de l’onglet : bouton affiché (${reason})`);
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    log('partage de l’onglet : fenêtre de partage de Chrome ouverte');
    getDisplayMedia
      .call(navigator.mediaDevices, {
        // Chrome refuse un partage sans vidéo : la piste vidéo est arrêtée aussitôt.
        video: true,
        audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions)
      .then((stream) => {
        const [audio] = stream.getAudioTracks();
        const [video] = stream.getVideoTracks();
        const surface = (video?.getSettings() as MediaTrackSettings & { displaySurface?: string } | undefined)?.displaySurface;
        log(
          `partage de l’onglet : accepté (surface ${surface ?? 'inconnue'}, ${audio ? 'avec' : 'SANS'} son, ` +
            `piste vidéo ${video ? 'arrêtée aussitôt' : 'absente'})`,
        );
        video?.stop();
        if (!audio) {
          for (const track of stream.getTracks()) track.stop();
          show('partage sans son : cochez « Partager aussi l’audio de l’onglet » dans la fenêtre de Chrome');
          return;
        }
        if (surface && surface !== 'browser') log(`partage de l’onglet : ATTENTION, surface « ${surface} » au lieu de l’onglet`);
        host.remove();
        listen(audio, onChunk, () => show('partage arrêté'));
      })
      .catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        log(
          name === 'NotAllowedError'
            ? 'partage de l’onglet : refusé (fenêtre fermée ou « Annuler »)'
            : `partage de l’onglet : échec (${error instanceof Error ? error.message : String(error)})`,
        );
        show('nouvel essai possible');
      });
  });

  show('activation');
}

function listen(track: MediaStreamTrack, onChunk: (pcm: string, at: number) => void, onEnded: () => void) {
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const processor = ctx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  // Sortie muette : le son de l'onglet reste joué par la page elle-même (suppressLocalAudioPlayback: false).
  processor.connect(silent).connect(ctx.destination);
  const level = { sumSquares: 0, samples: 0, peak: 0 };
  processor.addEventListener('audioprocess', (event) => {
    const input = event.inputBuffer.getChannelData(0);
    for (const sample of input) {
      level.sumSquares += sample * sample;
      level.peak = Math.max(level.peak, Math.abs(sample));
    }
    level.samples += input.length;
    onChunk(bufferToBase64(floatToInt16(resample(input, ctx.sampleRate, SHARE_SAMPLE_RATE)).buffer), Date.now());
  });
  const report = setInterval(() => {
    const rms = level.samples ? Math.sqrt(level.sumSquares / level.samples) : 0;
    log(
      `bilan du partage de l’onglet sur ${REPORT_INTERVAL_MS / 1000} s : niveau ${rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dBFS` : 'silence'} ` +
        `(crête ${level.peak.toFixed(2)}), contexte audio ${ctx.state}`,
    );
    level.sumSquares = 0;
    level.samples = 0;
    level.peak = 0;
  }, REPORT_INTERVAL_MS);
  log(`partage de l’onglet : piste audio reçue (« ${track.label} », ${track.readyState}), envoyée au pipeline voix`);
  track.addEventListener(
    'ended',
    () => {
      clearInterval(report);
      processor.disconnect();
      source.disconnect();
      log('partage de l’onglet : terminé (« Arrêter le partage » dans Chrome, ou onglet rechargé)');
      onEnded();
    },
    { once: true },
  );
}
