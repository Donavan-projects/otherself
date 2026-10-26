// Document offscreen : fait tourner le pipeline voix (VAD, transcription, LLM, Piper)
// pour l'onglet activé. Un seul document offscreen par extension (garanti par Chrome),
// donc un seul pipeline ; un seul onglet relié à la fois (le dernier activé). Créé par le
// popup. Il reçoit par le pont (bridge.content.ts) le son de l'onglet, partagé par la page
// (share-tab.ts), et renvoie la voix de l'avatar par le même pont. Ses logs sont recopiés
// dans la console de la page de la plateforme.

import type { Browser } from 'wxt/browser';
import { PORT_NAME, type FromOffscreen, type FromPage } from '@/lib/bridge-messages';
import { avatarVoices, loadDemoConfig, loadLocalText } from '@/lib/config';
import { Conversation } from '@/lib/conversation';
import { createLogger } from '@/lib/log';
import { AvatarMonitor } from '@/lib/monitor';
import { base64ToBuffer, bufferToBase64 } from '@/lib/pcm';
import { DEFAULT_PIPER_SCALES, PiperVoice, type TtsEngine } from '@/lib/tts';
import { OpenAiVoice } from '@/lib/tts-openai';
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
const logInject = createLogger('inject');

// Son reçu du pont : un bilan par seconde, nombre de blocs et niveau, pour voir
// tout de suite si le partage de l'onglet alimente le pipeline.
const bridgeAudio = { blocks: 0, sumSquares: 0, samples: 0, peak: 0, total: 0, silentReported: true };
setInterval(() => {
  const { blocks, sumSquares, samples, peak } = bridgeAudio;
  if (blocks === 0) {
    if (!bridgeAudio.silentReported && bridgeAudio.total > 0) logInject('son reçu du pont : plus aucun bloc depuis 1 s');
    bridgeAudio.silentReported = true;
    return;
  }
  bridgeAudio.silentReported = false;
  const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
  logInject(
    `son reçu du pont : ${blocks} bloc(s) en 1 s, niveau ${rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dBFS` : 'silence'} ` +
      `(crête ${peak.toFixed(2)})`,
  );
  Object.assign(bridgeAudio, { blocks: 0, sumSquares: 0, samples: 0, peak: 0 });
}, 1000);

function measureBridgeAudio(samples: Int16Array) {
  if (bridgeAudio.total === 0) logInject(`son reçu du pont : premier bloc (${samples.length} échantillons à 24 kHz)`);
  bridgeAudio.total += 1;
  bridgeAudio.blocks += 1;
  for (const value of samples) {
    const sample = value / 0x8000;
    bridgeAudio.sumSquares += sample * sample;
    bridgeAudio.peak = Math.max(bridgeAudio.peak, Math.abs(sample));
  }
  bridgeAudio.samples += samples.length;
}
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
      case 'audio': {
        // Son de l'onglet partagé par la page, déjà à 24 kHz.
        const samples = new Int16Array(base64ToBuffer(message.pcm));
        measureBridgeAudio(samples);
        onTabAudio(samples, message.at);
        break;
      }
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
    if (port !== connected) return;
    port = null;
    // Onglet fermé ou rechargé : le pont disparaît avec la page, et Chrome arrête le partage.
    logInject('onglet fermé ou rechargé : pont déconnecté, partage de l’onglet arrêté (réactiver l’extension pour reprendre)');
  });
});

function onTabAudio(samples: Int16Array, at: number) {
  if (conversation) {
    conversation.onAudio(samples, at);
  } else if (!warnedNotReady) {
    warnedNotReady = true;
    log('son du recruteur reçu, mais le pipeline n’est pas encore prêt');
  }
}

async function start() {
  const config = await loadDemoConfig();
  if (!config.openaiApiKey) {
    log('openaiApiKey manquant dans config.local.json : pipeline voix inactif');
    return;
  }
  const cv = await loadLocalText(config.cv);
  log(`CV et notes chargés (${cv.length} caractères), langue ${config.language}`);
  configureOnnxRuntime();
  // Voix : champ voice / openaiVoice de config.local.json, sinon celle du personnage (SVG).
  const defaults = await avatarVoices(config.avatar);
  let voice: TtsEngine;
  if (config.ttsProvider === 'openai') {
    voice = new OpenAiVoice({ apiKey: config.openaiApiKey, model: config.openaiTtsModel, voice: config.openaiVoice || defaults.openai || 'ash' });
  } else {
    voice = await PiperVoice.load(config.voice || defaults.piper || 'en_US-ljspeech-medium', { ...DEFAULT_PIPER_SCALES, ...config.piperScales });
  }
  log(`synthèse vocale : ${voice.description}${config.voice || config.openaiVoice ? '' : ` (voix du personnage ${config.avatar})`}`);
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
