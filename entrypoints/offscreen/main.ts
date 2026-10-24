// Document offscreen : fait tourner le pipeline voix (VAD, transcription, LLM, Piper)
// pour l'onglet activé. Créé par le popup ; reçoit le son du recruteur et renvoie la voix
// de l'avatar par le pont (bridge.content.ts). Ses logs sont recopiés dans la console de
// la page de la plateforme.

import type { Browser } from 'wxt/browser';
import { PORT_NAME, type FromOffscreen, type FromPage } from '@/lib/bridge-messages';
import { loadDemoConfig, loadLocalText } from '@/lib/config';
import { Conversation } from '@/lib/conversation';
import { createLogger } from '@/lib/log';
import { base64ToBuffer, bufferToBase64 } from '@/lib/pcm';
import { PiperVoice } from '@/lib/tts';
import { configureOnnxRuntime } from '@/lib/vad';

let port: Browser.runtime.Port | null = null;
const post = (message: FromOffscreen) => port?.postMessage(message);

// Recopie les logs préfixés ([vad], [stt], [llm], [tts]…) vers la page.
const consoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  consoleLog(...args);
  if (typeof args[0] === 'string' && args[0].startsWith('[')) post({ type: 'log', line: args[0] });
};

const log = createLogger('llm');
let conversation: Conversation | null = null;
let warnedNotReady = false;

browser.runtime.onConnect.addListener((connected) => {
  if (connected.name !== PORT_NAME) return;
  port?.disconnect();
  port = connected;
  log(`onglet relié au pipeline voix${conversation ? '' : ' (pipeline en cours de chargement)'}`);
  connected.onMessage.addListener((message: FromPage) => {
    switch (message.type) {
      case 'audio':
        if (conversation) {
          conversation.onAudio(new Int16Array(base64ToBuffer(message.pcm)), message.at);
        } else if (!warnedNotReady) {
          warnedNotReady = true;
          log('son du recruteur reçu, mais le pipeline n’est pas encore prêt');
        }
        break;
      case 'playback-started':
        conversation?.onPlaybackStarted(message.responseId, message.at);
        break;
      case 'playback-idle':
        conversation?.onPlaybackIdle(message.responseId);
        break;
    }
  });
  connected.onDisconnect.addListener(() => {
    if (port === connected) port = null;
  });
});

async function start() {
  const config = await loadDemoConfig();
  if (!config.openaiApiKey) {
    log('openaiApiKey manquant dans config.local.json : pipeline voix inactif');
    return;
  }
  const cv = await loadLocalText(config.cv);
  log(`CV et notes chargés (${cv.length} caractères), langue ${config.language}, voix ${config.voice}`);
  configureOnnxRuntime();
  const voice = await PiperVoice.load(config.voice);
  conversation = await Conversation.create(config, voice, cv, {
    speak: (responseId, audio) =>
      post({ type: 'speak', responseId, pcm: bufferToBase64(audio.samples.buffer), sampleRate: audio.sampleRate }),
    stop: () => post({ type: 'stop' }),
  });
  log('pipeline voix prêt : en attente du recruteur');
}

start().catch((error: unknown) => log(`erreur au démarrage : ${error instanceof Error ? error.message : String(error)}`));
