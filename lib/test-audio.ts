// Source provisoire du micro injecté : son préenregistré en boucle (testAudio dans
// config.local.json) ou bip de 440 Hz. À remplacer par la voix générée à l'étape 4.

import { createLogger } from './log';

const log = createLogger('inject');

export async function createTestAudioTrack(encoded: ArrayBuffer | null): Promise<MediaStreamTrack> {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();

  if (encoded) {
    const buffer = await context.decodeAudioData(encoded);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    source.start();
    log(`son préenregistré en boucle (${buffer.duration.toFixed(1)} s, ${buffer.sampleRate} Hz)`);
  } else {
    startBeeps(context, destination);
    log('aucun son préenregistré (testAudio) : bip de 440 Hz chaque seconde');
  }

  // Sans geste de l'utilisateur, le navigateur peut laisser le contexte suspendu : piste muette.
  log(`contexte audio créé : ${context.state}`);
  context.addEventListener('statechange', () => log(`contexte audio : ${context.state}`));
  if (context.state !== 'running') await context.resume().catch(() => undefined);

  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error('aucune piste audio créée');
  return track;
}

function startBeeps(context: AudioContext, destination: AudioNode) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  setInterval(() => {
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.setValueAtTime(0, now + 0.2);
  }, 1000);
}
