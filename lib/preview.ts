// Aperçu de l'avatar en Picture-in-Picture, pour le tournage : certaines plateformes
// (InterviewCoach) n'affichent l'avatar qu'en petite vignette en miroir. La fenêtre montre une
// copie de la piste vidéo remise à la plateforme (même canvas : animation, bouche, slogan,
// bandeau), à l'endroit, sans son (la voix passe déjà par le retour audio du document
// offscreen). Ouverte depuis le popup ; fermée à la désactivation, l'onglet fermé la ferme aussi.
// Module autonome, retirable : seuls content.ts, inject.ts (deux accesseurs) et le popup y touchent.
// Monde MAIN.

import { createLogger } from './log';

const STATS_INTERVAL_MS = 5000;

const log = createLogger('preview');

export interface PreviewSource {
  /** Vrai si la plateforme a reçu une piste vidéo encore active. */
  sendingVideo(): boolean;
  /** Copie de la piste vidéo envoyée à la plateforme, ou null si elle n'a pas demandé la caméra. */
  previewTrack(): MediaStreamTrack | null;
  /** Images par seconde du flux envoyé sur la dernière période de statistiques, ou null. */
  sentFps(): number | null;
}

/** waiting : caméra pas encore demandée par la plateforme ; ready : aperçu possible ; open : aperçu ouvert. */
export type PreviewStatus = 'waiting' | 'ready' | 'open';

export interface Preview {
  status(): PreviewStatus;
  /** Ouvre la fenêtre (doit suivre un clic de l'utilisateur) ou la ferme si elle est ouverte. */
  toggle(): Promise<string>;
  close(): void;
}

export function createPreview(source: PreviewSource): Preview {
  let current: { video: HTMLVideoElement; close(): void } | null = null;

  const open = async (): Promise<string> => {
    const track = source.previewTrack();
    if (!track) return 'la plateforme n’a pas encore demandé la caméra : rejoindre l’entretien, puis réessayer';
    // Vidéo muette et invisible dans la page : seule la fenêtre Picture-in-Picture l'affiche.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    Object.assign(video.style, {
      position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none',
    });
    document.documentElement.append(video);

    // Images affichées par l'aperçu, et images par seconde du flux envoyé avant et pendant l'aperçu.
    const before = source.sentFps();
    let shown = 0;
    let minSent = Infinity;
    const countFrame = () => {
      shown += 1;
      if (current?.video === video) video.requestVideoFrameCallback(countFrame);
    };
    let last = performance.now();
    const stats = setInterval(() => {
      const now = performance.now();
      const sent = source.sentFps();
      if (sent !== null) minSent = Math.min(minSent, sent);
      log(
        `aperçu ouvert : flux envoyé ${sent?.toFixed(1) ?? '?'} images/s (avant l’ouverture : ${before?.toFixed(1) ?? '?'}), ` +
          `aperçu ${((shown * 1000) / (now - last)).toFixed(1)} images/s`,
      );
      shown = 0;
      last = now;
    }, STATS_INTERVAL_MS);

    /** Retire tout ; faux si l'aperçu était déjà fermé. */
    const teardown = () => {
      if (current?.video !== video) return false;
      current = null;
      clearInterval(stats);
      track.removeEventListener('ended', close);
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => undefined);
      track.stop();
      video.srcObject = null;
      video.remove();
      return true;
    };
    const close = () => {
      if (!teardown()) return;
      log(
        `aperçu fermé ; flux envoyé : ${before?.toFixed(1) ?? '?'} images/s avant l’ouverture, ` +
          `${Number.isFinite(minSent) ? minSent.toFixed(1) : '?'} au plus bas pendant l’aperçu`,
      );
    };
    current = { video, close };
    // Piste arrêtée (désactivation) ou fenêtre fermée par l'utilisateur : tout est retiré.
    track.addEventListener('ended', close);
    video.addEventListener('leavepictureinpicture', close);

    try {
      await video.play();
      video.requestVideoFrameCallback(countFrame);
      const window = await video.requestPictureInPicture();
      const { width, height } = track.getSettings();
      log(`aperçu ouvert en Picture-in-Picture (flux ${width}x${height}, fenêtre ${window.width}x${window.height}, sans son, sans miroir)`);
      return 'aperçu ouvert';
    } catch (error) {
      teardown();
      const message = error instanceof Error ? `${error.name} : ${error.message}` : String(error);
      log(`aperçu impossible : ${message}`);
      return `aperçu impossible : ${message}`;
    }
  };

  return {
    status: () => (current ? 'open' : source.sendingVideo() ? 'ready' : 'waiting'),
    toggle: async () => {
      if (!current) return open();
      current.close();
      return 'aperçu fermé';
    },
    close: () => current?.close(),
  };
}
