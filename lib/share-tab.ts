// Son du recruteur : la page de l'entretien partage son propre onglet, son compris, par la
// fenêtre de partage standard de Chrome (getDisplayMedia). Aucune permission d'extension
// (règle 6). Chrome exige un clic dans la page : un bouton est injecté. Le flux n'est jamais
// remis à la plateforme : seul son son part vers le document offscreen, par le pont.
// Ni le micro de l'utilisateur ni la voix de l'avatar n'y sont : la plateforme ne rejoue pas
// le micro, et la voix de l'avatar ne sort que par le micro injecté (et par le retour audio
// du document offscreen), jamais par les haut-parleurs de l'onglet.
// Monde MAIN, cadre principal.

import { createLogger } from './log';
import { audioContext } from './page-audio';
import { bufferToBase64, floatToInt16, resample } from './pcm';

const log = createLogger('inject');

export const SHARE_SAMPLE_RATE = 24000;
const BLOCK_SAMPLES = 2048;
const REPORT_INTERVAL_MS = 15000;

// AudioWorklet chargé depuis une URL blob : un fichier de l'extension devrait être exposé aux
// sites (web_accessible_resources). Écrit en JavaScript pur parce qu'il est passé en texte.
const WORKLET_NAME = 'otherself-share';
const WORKLET_SOURCE = `registerProcessor('${WORKLET_NAME}', class extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(${BLOCK_SAMPLES}); this.filled = 0; }
  process(inputs) {
    const channels = inputs[0];
    const first = channels && channels[0];
    if (!first) return true;
    for (let i = 0; i < first.length; i += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] || 0;
      this.block[this.filled++] = sum / channels.length;
      if (this.filled === ${BLOCK_SAMPLES}) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(${BLOCK_SAMPLES});
        this.filled = 0;
      }
    }
    return true;
  }
});`;
const workletModules = new WeakMap<AudioContext, Promise<void>>();

/** Fournit le son de la piste par blocs mono ; renvoie de quoi arrêter. */
type BlockSource = (onBlock: (block: Float32Array, sampleRate: number) => void) => Promise<{ kind: string; stop(): void }>;

/** AudioWorklet (URL blob), sinon MediaStreamTrackProcessor si la CSP de la page refuse le blob. */
function blockSource(track: MediaStreamTrack): BlockSource {
  return async (onBlock) => {
    const ctx = audioContext();
    try {
      if (!workletModules.has(ctx)) {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        workletModules.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
      }
      await workletModules.get(ctx);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      // Aucune sortie : le son de l'onglet reste joué par la page elle-même (suppressLocalAudioPlayback: false).
      const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfOutputs: 0 });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onBlock(event.data, ctx.sampleRate);
      source.connect(node);
      return {
        kind: `AudioWorklet (${ctx.sampleRate} Hz)`,
        stop() {
          source.disconnect();
          node.port.onmessage = null;
        },
      };
    } catch (error) {
      workletModules.delete(ctx);
      log(`partage de l’onglet : AudioWorklet refusé par la page (${error instanceof Error ? error.message : String(error)}), essai de MediaStreamTrackProcessor`);
    }
    return trackProcessorSource(track, onBlock);
  };
}

interface AudioDataLike {
  numberOfFrames: number;
  sampleRate: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
  close(): void;
}
type TrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioDataLike> };

async function trackProcessorSource(track: MediaStreamTrack, onBlock: (block: Float32Array, sampleRate: number) => void) {
  const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorConstructor }).MediaStreamTrackProcessor;
  if (!Processor) throw new Error('ni AudioWorklet ni MediaStreamTrackProcessor disponibles dans cette page');
  const reader = new Processor({ track }).readable.getReader();
  let block = new Float32Array(BLOCK_SAMPLES);
  let filled = 0;
  let rate = 0;
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) return;
      rate = value.sampleRate;
      const frame = new Float32Array(value.numberOfFrames);
      value.copyTo(frame, { planeIndex: 0, format: 'f32-planar' });
      value.close();
      for (const sample of frame) {
        block[filled++] = sample;
        if (filled === BLOCK_SAMPLES) {
          onBlock(block, rate);
          block = new Float32Array(BLOCK_SAMPLES);
          filled = 0;
        }
      }
    }
  })().catch((error: unknown) => log(`partage de l’onglet : lecture interrompue (${error instanceof Error ? error.message : String(error)})`));
  return { kind: 'MediaStreamTrackProcessor', stop: () => void reader.cancel() };
}

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

export interface TabShare {
  /** Retire le bouton et arrête le partage en cours. */
  stop(): void;
}

/** Affiche le bouton ; au clic, partage de l'onglet et envoi de son son. */
export function offerTabShare(onChunk: (pcm: string, at: number) => void): TabShare {
  const getDisplayMedia = pristineGetDisplayMedia();
  let stopListening: (() => void) | null = null;
  let stopped = false;

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
    if (stopped) return;
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
        // Son brut, à ne jamais réactiver : l'annulation d'écho prend la sortie de l'onglet comme
        // référence, donc le son à capter lui-même, et le détruisait (VAD muet sur Meet et
        // InterviewCoach) ; réduction de bruit et gain auto restent coupés aussi.
        audio: {
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions)
      .then((stream) => {
        const [audio] = stream.getAudioTracks();
        const [video] = stream.getVideoTracks();
        if (stopped) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
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
        stopListening = listen(audio, onChunk, () => {
          stopListening = null;
          show('partage arrêté');
        });
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
  return {
    stop() {
      stopped = true;
      host.remove();
      stopListening?.();
      log('partage de l’onglet : bouton retiré et partage arrêté (désactivation)');
    },
  };
}

/** Envoie le son de la piste partagée ; renvoie de quoi l'arrêter. */
function listen(track: MediaStreamTrack, onChunk: (pcm: string, at: number) => void, onEnded: () => void): () => void {
  const ctx = audioContext();
  if (ctx.state !== 'running') void ctx.resume();
  const settings = track.getSettings() as MediaTrackSettings & { suppressLocalAudioPlayback?: boolean };
  log(
    `partage de l’onglet : contexte audio de la page ${ctx.state} (${ctx.sampleRate} Hz), piste ${track.muted ? 'muette' : 'active'}, ` +
      `son toujours joué pour vous : ${settings.suppressLocalAudioPlayback === true ? 'NON' : 'oui'} ; traitements : ` +
      `annulation d'écho ${String(settings.echoCancellation)}, réduction de bruit ${String(settings.noiseSuppression)}, ` +
      `gain auto ${String(settings.autoGainControl)} (attendu : false partout)`,
  );
  const level = { sumSquares: 0, samples: 0, peak: 0, blocks: 0 };
  let firstBlock = true;
  let stopBlocks: (() => void) | null = null;
  let ended = false;
  void blockSource(track)((input, sampleRate) => {
    if (firstBlock) {
      firstBlock = false;
      log(
        `partage de l’onglet : premier bloc audio traité par la page (${input.length} échantillons à ${sampleRate} Hz, ` +
          `envoyés à ${SHARE_SAMPLE_RATE} Hz vers le pipeline)`,
      );
    }
    level.blocks += 1;
    for (const sample of input) {
      level.sumSquares += sample * sample;
      level.peak = Math.max(level.peak, Math.abs(sample));
    }
    level.samples += input.length;
    onChunk(bufferToBase64(floatToInt16(resample(input, sampleRate, SHARE_SAMPLE_RATE)).buffer), Date.now());
  }).then(
    ({ kind, stop }) => {
      if (ended) return stop();
      stopBlocks = stop;
      log(`partage de l’onglet : son lu par ${kind}`);
    },
    (error: unknown) => log(`partage de l’onglet : ÉCHEC, son illisible dans la page (${error instanceof Error ? error.message : String(error)})`),
  );
  const report = setInterval(() => {
    const rms = level.samples ? Math.sqrt(level.sumSquares / level.samples) : 0;
    log(
      `bilan du partage de l’onglet sur ${REPORT_INTERVAL_MS / 1000} s : niveau ${rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dBFS` : 'silence'} ` +
        `(crête ${level.peak.toFixed(2)}), ${level.blocks} bloc(s) envoyé(s) au pont, contexte audio ${ctx.state}`,
    );
    level.blocks = 0;
    level.sumSquares = 0;
    level.samples = 0;
    level.peak = 0;
  }, REPORT_INTERVAL_MS);
  log(`partage de l’onglet : piste audio reçue (« ${track.label} », ${track.readyState}), envoyée au pipeline voix`);
  track.addEventListener('mute', () => log('partage de l’onglet : piste muette (Chrome ne transmet plus de son)'));
  track.addEventListener('unmute', () => log('partage de l’onglet : piste de nouveau active'));
  const cleanUp = () => {
    ended = true;
    clearInterval(report);
    stopBlocks?.();
  };
  track.addEventListener(
    'ended',
    () => {
      cleanUp();
      log('partage de l’onglet : terminé (« Arrêter le partage » dans Chrome, ou onglet rechargé)');
      onEnded();
    },
    { once: true },
  );
  return () => {
    cleanUp();
    track.stop();
  };
}
