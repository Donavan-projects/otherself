// Messages entre la page (monde MAIN), le pont (content script isolé), le popup et le
// document offscreen. Les données audio voyagent en base64 (les ports d'extension
// sérialisent en JSON).

export const PORT_NAME = 'otherself-tab';
/** Clé des messages window.postMessage entre monde MAIN et monde isolé. */
export const PAGE_TAG = '__otherSelfBridge';

/** De la page vers l'extension. */
export type FromPage =
  /** Son du recruteur partagé par la page (option C) : PCM 16 bits mono à 24 kHz. */
  | { type: 'audio'; pcm: string; at: number }
  /** La plateforme a demandé le micro : la voix de l'avatar peut être entendue. */
  | { type: 'mic-ready' }
  /** La voix de l'avatar (re)commence à sortir dans le micro injecté. */
  | { type: 'playback-started'; responseId: number; at: number }
  | { type: 'playback-idle'; responseId: number };

/** De l'extension vers la page. */
export type ToPage =
  /** Pont tout juste relié : la page renvoie son état (mic-ready). */
  | { type: 'hello' }
  /** Voix de l'avatar : PCM float 32 bits mono. */
  | { type: 'speak'; responseId: number; pcm: string; sampleRate: number }
  | { type: 'stop' };

/** Du document offscreen vers le pont (en plus de ToPage). */
export type FromOffscreen = ToPage | { type: 'log'; line: string };

export interface PageEnvelope {
  [PAGE_TAG]: 'to-ext' | 'to-page';
  message: FromPage | ToPage;
}

/** Du popup vers le document offscreen (runtime.sendMessage) : capture du son de l'onglet. */
export type ToOffscreen =
  | { target: 'offscreen'; type: 'capture-status'; tabId: number }
  | { target: 'offscreen'; type: 'capture-start'; tabId: number; streamId: string }
  /** Option C : le son vient de la page, la capture tabCapture éventuelle s'arrête. */
  | { target: 'offscreen'; type: 'capture-stop'; tabId: number };

export interface CaptureReply {
  live: boolean;
  error?: string;
}
