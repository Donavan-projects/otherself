// Document offscreen : fait tourner le pipeline voix (VAD, transcription, LLM, Piper)
// pour l'onglet activé. Un seul document offscreen par extension (garanti par Chrome),
// donc un seul pipeline ; un seul onglet relié à la fois (le dernier activé).
// Le son du recruteur est le son de cet onglet (chrome.tabCapture, tab-audio.ts) ; la
// voix de l'avatar repart vers la page par le pont. Créé par le popup ; reçoit le son du recruteur et renvoie la voix
// de l'avatar par le pont (bridge.content.ts). Ses logs sont recopiés dans la console de
// la page de la plateforme.

import type { Browser } from 'wxt/browser';
import { PORT_NAME, type CaptureReply, type FromOffscreen, type FromPage, type ToOffscreen } from '@/lib/bridge-messages';
import { loadDemoConfig, loadLocalText } from '@/lib/config';
import { Conversation } from '@/lib/conversation';
import { createLogger } from '@/lib/log';
import { AvatarMonitor } from '@/lib/monitor';
import { base64ToBuffer, bufferToBase64 } from '@/lib/pcm';
import { STT_SAMPLE_RATE } from '@/lib/stt';
import { TabAudioCapture } from '@/lib/tab-audio';
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
let micReady = false;
let connectionCount = 0;
/** Page (document) de la plateforme reliée en dernier : une autre page = un autre entretien. */
let currentPage: string | undefined;

browser.runtime.onConnect.addListener((connected) => {
  if (connected.name !== PORT_NAME) return;
  connectionCount += 1;
  const sender = connected.sender as (Browser.runtime.MessageSender & { documentId?: string }) | undefined;
  const page = sender?.documentId ?? sender?.url;
  const samePage = page !== undefined && page === currentPage;
  const previous = port;
  port = connected;
  previous?.disconnect();
  currentPage = page;
  log(
    `onglet ${sender?.tab?.id ?? '?'} relié au pipeline voix (connexion n°${connectionCount}, ` +
      `${samePage ? 'même page qu’avant' : connectionCount > 1 ? 'nouvelle page ou onglet rechargé' : 'première page'}` +
      `${previous ? ', connexion précédente fermée' : ''}) ; pipeline unique ${conversation ? 'déjà prêt' : 'en cours de chargement'}`,
  );
  micReady = false;
  conversation?.setMicReady(false);
  if (!samePage) conversation?.reset('nouvelle page de la plateforme');
  connected.onMessage.addListener((message: FromPage) => {
    switch (message.type) {
      case 'audio':
        // Option C : son de l'onglet partagé par la page (déjà à 24 kHz).
        if (capture?.isLive) break;
        onTabAudio(new Int16Array(base64ToBuffer(message.pcm)), message.at);
        break;
      case 'mic-ready':
        micReady = true;
        conversation?.setMicReady(true);
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

// Capture du son de l'onglet : une seule à la fois, celle de l'onglet activé en dernier.
let capture: TabAudioCapture | null = null;

function onTabAudio(samples: Int16Array, at: number) {
  if (conversation) {
    conversation.onAudio(samples, at);
  } else if (!warnedNotReady) {
    warnedNotReady = true;
    log('son du recruteur reçu, mais le pipeline n’est pas encore prêt');
  }
}

async function handle(message: ToOffscreen): Promise<CaptureReply> {
  if (message.type === 'capture-stop') {
    if (capture?.isLive) log('capture tabCapture arrêtée : le son du recruteur viendra du partage de l’onglet par la page');
    capture?.stop();
    capture = null;
    return { live: false };
  }
  const live = capture?.isLive === true && capture.tabId === message.tabId;
  if (message.type === 'capture-status' || live) return { live };
  capture?.stop();
  capture = null;
  try {
    capture = await TabAudioCapture.start(message.tabId, message.streamId, STT_SAMPLE_RATE, onTabAudio);
    return { live: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`capture du son de l'onglet impossible : ${reason}`);
    return { live: false, error: reason };
  }
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: CaptureReply) => void) => {
  if ((message as Partial<ToOffscreen> | null)?.target !== 'offscreen') return undefined;
  void handle(message as ToOffscreen).then(sendResponse);
  return true;
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
  // Retour pour l'utilisateur : joué ici, jamais dans l'onglet capturé.
  const monitor = config.monitorAvatar ? new AvatarMonitor(config.monitorVolume) : null;
  if (!monitor) log('retour audio de la voix de l’avatar désactivé (monitorAvatar: false)');
  conversation = await Conversation.create(config, voice, cv, {
    speak: (responseId, audio) => {
      post({ type: 'speak', responseId, pcm: bufferToBase64(audio.samples.buffer), sampleRate: audio.sampleRate });
      monitor?.play(audio);
    },
    stop: () => {
      post({ type: 'stop' });
      monitor?.stop();
    },
  });
  conversation.setMicReady(micReady);
  log('pipeline voix prêt : en attente du recruteur');
}

start().catch((error: unknown) => log(`erreur au démarrage : ${error instanceof Error ? error.message : String(error)}`));
