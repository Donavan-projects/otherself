// Document offscreen : fait tourner le pipeline voix (VAD, transcription, LLM, Piper)
// pour l'onglet activé. Un seul document offscreen par extension (garanti par Chrome),
// donc un seul pipeline ; un seul onglet relié à la fois (le dernier activé). Créé par le
// popup. Il reçoit par le pont (bridge.content.ts) le son de l'onglet, partagé par la page
// (share-tab.ts), et renvoie la voix de l'avatar par le même pont. Ses logs sont recopiés
// dans la console de la page de la plateforme.

import type { Browser } from 'wxt/browser';
import { PORT_NAME, type FromOffscreen, type FromPage } from '@/lib/bridge-messages';
import { loadDemoConfig } from '@/lib/config';
import { llmEngine } from '@/lib/llm-engine';
import { localFileProfile } from '@/lib/profile';
import { createAvatarVoice } from '@/lib/avatar-voice';
import { Conversation } from '@/lib/conversation';
import { createLogger } from '@/lib/log';
import { AvatarMonitor } from '@/lib/monitor';
import { base64ToBuffer, bufferToBase64 } from '@/lib/pcm';
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
/** Pause reçue avant que le pipeline soit prêt : appliquée à sa création. */
let pausedAt: number | null = null;
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
  // La page (nouvelle ou rechargée) apprend l'état courant de l'avatar.
  if (conversation) post({ type: 'state', state: conversation.state, previous: conversation.state, at: Date.now(), reason: 'pont relié' });
  if (!samePage) {
    conversation?.reset('nouvelle page de la plateforme');
    // Nouvelle page : elle part sans pause (la page renvoie son état à chaque connexion du pont).
    pausedAt = null;
    conversation?.resume(Date.now());
  }
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
      case 'playback-chunk':
        conversation?.onPlaybackChunk(message.responseId, message.startAt, message.endAt);
        break;
      case 'pause':
        pausedAt = message.at;
        if (conversation) conversation.pause(message.at);
        else log(`pause ${Date.now() - message.at} ms après le clic, pipeline pas encore prêt : appliquée à sa création`);
        break;
      case 'resume':
        pausedAt = null;
        conversation?.resume(message.at);
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
  // Moteur conversationnel (contrat : lib/engine.ts) : reçoit son profil par la source du profil.
  const engine = await llmEngine({ apiKey: config.openaiApiKey, model: config.llmModel })(localFileProfile(config), config);
  log(`moteur conversationnel : ${engine.description}`);
  configureOnnxRuntime();
  // Voix : champs voice / openaiVoice / pitchSemitones de config.local.json, sinon celles de l'avatar (lib/config.ts) ;
  // deux synthèses en parallèle si la machine le permet (lib/voice-pool.ts).
  const voice = await createAvatarVoice(config);
  const spellings = Object.entries(config.pronunciations).map(([word, said]) => `${word} → ${said}`).join(', ');
  log(`synthèse vocale : ${voice.description}${config.ttsProvider === 'piper' && spellings ? ` (${spellings})` : ''} ; ${navigator.hardwareConcurrency} fils d'exécution`);
  // Retour pour l'utilisateur : joué ici, jamais dans l'onglet capturé.
  const monitor = config.monitorAvatar ? new AvatarMonitor(config.monitorVolume) : null;
  if (!monitor) log('retour audio de la voix de l’avatar désactivé (monitorAvatar: false)');
  conversation = await Conversation.create(config, voice, engine, {
    speak: (responseId, audio, text) => {
      post({ type: 'speak', responseId, pcm: bufferToBase64(audio.samples.buffer), sampleRate: audio.sampleRate, text });
      monitor?.play(audio);
    },
    stop: () => {
      post({ type: 'stop' });
      monitor?.stop();
    },
    state: (state, previous, reason) => post({ type: 'state', state, previous, at: Date.now(), reason }),
    nod: () => post({ type: 'nod', at: Date.now() }),
  });
  conversation.setMicReady(micReady);
  if (pausedAt !== null) conversation.pause(pausedAt);
  log('pipeline voix prêt : en attente du recruteur');
}

start().catch((error: unknown) => log(`erreur au démarrage : ${error instanceof Error ? error.message : String(error)}`));
