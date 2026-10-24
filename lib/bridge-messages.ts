// Messages entre la page (monde MAIN), le pont (content script isolé) et le document
// offscreen. Les données audio voyagent en base64 (les ports d'extension sérialisent en JSON).

export const PORT_NAME = 'otherself-tab';
/** Clé des messages window.postMessage entre monde MAIN et monde isolé. */
export const PAGE_TAG = '__otherSelfBridge';

/** De la page vers l'extension. */
export type FromPage =
  /** Son du recruteur : PCM 16 bits mono à 24 kHz. */
  | { type: 'audio'; pcm: string; at: number }
  | { type: 'playback-started'; responseId: number; at: number }
  | { type: 'playback-idle'; responseId: number };

/** De l'extension vers la page. */
export type ToPage =
  /** Voix de l'avatar : PCM float 32 bits mono. */
  | { type: 'speak'; responseId: number; pcm: string; sampleRate: number }
  | { type: 'stop' };

/** Du document offscreen vers le pont (en plus de ToPage). */
export type FromOffscreen = ToPage | { type: 'log'; line: string };

export interface PageEnvelope {
  [PAGE_TAG]: 'to-ext' | 'to-page';
  message: FromPage | ToPage;
}
