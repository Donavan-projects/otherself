// Banc d'essai des voix : compare des voix Piper et leurs réglages (length_scale, noise_scale,
// noise_w), et la synthèse OpenAI, sur les mêmes phrases. Mesure le délai avant le premier son,
// la vitesse de synthèse et la variation de hauteur (indice de l'intonation), et permet d'écouter.

import { loadDemoConfig } from '@/lib/config';
import { openingText } from '@/lib/prompt';
import { createLogger } from '@/lib/log';
import { encodeWav, floatToInt16 } from '@/lib/pcm';
import { PiperVoice, type PiperScales, type SpeechAudio } from '@/lib/tts';
import { OpenAiVoice } from '@/lib/tts-openai';
import { configureOnnxRuntime } from '@/lib/vad';

const log = createLogger('tts');
const DEFAULT_SENTENCES = [
  // Premier morceau typique d'une réponse : c'est lui qui fixe le délai avant que l'avatar parle.
  "That's a good question:",
  'Donavan led a team of four engineers on a logistics platform.',
  "He's comfortable with TypeScript, and he enjoys explaining technical choices to non-technical people.",
];

const params = new URLSearchParams(location.search);
const list = (name: string, fallback: string) => (params.get(name) ?? fallback).split(',').map((item) => item.trim()).filter(Boolean);
const parseScales = (item: string): PiperScales => {
  const [lengthScale, noiseScale, noiseW] = item.split('/').map(Number);
  return { lengthScale: lengthScale!, noiseScale: noiseScale!, noiseW: noiseW! };
};
/**
 * Voix Piper : « voix[:locuteur][@length/noise/noise_w] », par exemple en_US-libritts-high:p3922 ou
 * en_US-john-medium@0.85/0.8/1. Sans « @ », chaque réglage de &reglages est essayé.
 */
const piperVoices = list('voix', 'en_US-norman-medium,en_US-john-medium').map((item) => {
  const [name = item, scales] = item.split('@');
  // « : » ou « # » (encodé %23 dans une adresse) avant le locuteur.
  const [voiceId = name, speaker] = name.split(/[#:]/);
  return { label: name, voiceId, speaker, scales: scales ? parseScales(scales) : undefined };
});
const openaiVoices = list('openai', '');
const settings: PiperScales[] = list('reglages', '1/0.667/0.8').map(parseScales);

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const tbody = document.querySelector<HTMLTableSectionElement>('#results')!;
const status = (message: string) => {
  log(message);
  statusEl.textContent = message;
};

export interface BenchResult {
  engine: string;
  settings: string;
  sentence: number;
  firstAudioMs: number;
  totalMs: number;
  audioMs: number;
  medianHz: number;
  spreadSemitones: number;
  wav: Blob;
}
const results: BenchResult[] = [];
declare global {
  interface Window {
    __bench?: { done: boolean; results: BenchResult[] };
  }
}
window.__bench = { done: false, results };

/** Hauteur de la voix par autocorrélation (trames de 40 ms) : médiane et écart-type en demi-tons. */
function pitchStats({ samples, sampleRate }: SpeechAudio): { medianHz: number; spreadSemitones: number } {
  const frame = Math.round(sampleRate * 0.04);
  const hop = Math.round(sampleRate * 0.01);
  const minLag = Math.floor(sampleRate / 300);
  const maxLag = Math.ceil(sampleRate / 70);
  let loudest = 0;
  for (let start = 0; start + frame < samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + frame; i += 1) energy += samples[i]! ** 2;
    loudest = Math.max(loudest, energy);
  }
  const pitches: number[] = [];
  for (let start = 0; start + frame + maxLag < samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + frame; i += 1) energy += samples[i]! ** 2;
    if (energy < loudest * 0.05) continue;
    let bestLag = 0;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      let norm = 0;
      for (let i = start; i < start + frame; i += 1) {
        sum += samples[i]! * samples[i + lag]!;
        norm += samples[i + lag]! ** 2;
      }
      const r = sum / Math.sqrt(energy * norm || 1);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.6) pitches.push(sampleRate / bestLag);
  }
  if (pitches.length < 5) return { medianHz: 0, spreadSemitones: 0 };
  const sorted = [...pitches].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const semitones = pitches.map((hz) => 12 * Math.log2(hz / median));
  const mean = semitones.reduce((sum, value) => sum + value, 0) / semitones.length;
  const spread = Math.sqrt(semitones.reduce((sum, value) => sum + (value - mean) ** 2, 0) / semitones.length);
  return { medianHz: median, spreadSemitones: spread };
}

function addRow(result: BenchResult) {
  const row = tbody.insertRow();
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = URL.createObjectURL(result.wav);
  const cells = [
    result.engine,
    result.settings,
    String(result.sentence),
    `${Math.round(result.firstAudioMs)} ms`,
    `${Math.round(result.totalMs)} ms`,
    `${(result.audioMs / 1000).toFixed(2)} s`,
    (result.totalMs / result.audioMs).toFixed(2),
    result.medianHz ? `${Math.round(result.medianHz)} Hz` : '-',
    result.spreadSemitones.toFixed(2),
  ];
  cells.forEach((text, index) => {
    const cell = row.insertCell();
    cell.textContent = text;
    if (index >= 3) cell.className = 'num';
  });
  row.insertCell().append(audio);
}

async function measure(engine: string, label: string, sentence: number, run: (onAudio: (audio: SpeechAudio) => void) => Promise<void>) {
  const pieces: Float32Array[] = [];
  let sampleRate = 22050;
  let firstAudioMs = 0;
  const started = performance.now();
  await run((audio) => {
    if (pieces.length === 0) firstAudioMs = performance.now() - started;
    pieces.push(audio.samples);
    sampleRate = audio.sampleRate;
  });
  const totalMs = performance.now() - started;
  const samples = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    samples.set(piece, offset);
    offset += piece.length;
  }
  const result: BenchResult = {
    engine,
    settings: label,
    sentence,
    firstAudioMs,
    totalMs,
    audioMs: (samples.length / sampleRate) * 1000,
    ...pitchStats({ samples, sampleRate }),
    wav: encodeWav(floatToInt16(samples), sampleRate),
  };
  results.push(result);
  addRow(result);
}

const config = await loadDemoConfig();
// &jeu=entretien : l'ouverture réelle (révélation et messageText de config.local.json), une réponse type sur le
// parcours du candidat et la phrase des noms de projets. &phrases=… : phrases libres, séparées par « | ».
const interviewSet = [
  openingText(config.language, config.messageText, config.candidateName),
  "Donavan has fourteen years of operational experience. He now builds AI products and automation workflows.",
  'His recent projects include ADELIN, Curator Agent, IntelAgent, Familiar.dev, and Loupe.',
];
const SENTENCES =
  params.get('jeu') === 'entretien'
    ? interviewSet
    : (params.get('phrases')?.split('|').map((item) => item.trim()).filter(Boolean) ?? DEFAULT_SENTENCES);
configureOnnxRuntime();
// Voix consécutives sur le même modèle (locuteurs d'une voix libritts) : un seul chargement.
let loaded = null as { voiceId: string; voice: PiperVoice } | null;
for (const item of piperVoices) {
  if (loaded?.voiceId !== item.voiceId) {
    loaded?.voice.dispose();
    status(`chargement de ${item.voiceId} (téléchargée une seule fois)…`);
    const voice = await PiperVoice.load(item.speaker ? `${item.voiceId}#${item.speaker}` : item.voiceId, item.scales ?? settings[0]);
    // Première phrase de chauffe, non mesurée : la première inférence est toujours plus lente.
    await voice.synthesize('Hello.');
    loaded = { voiceId: item.voiceId, voice };
  }
  const { voice } = loaded;
  for (const scales of item.scales ? [item.scales] : settings) {
    const label = `${scales.lengthScale} / ${scales.noiseScale} / ${scales.noiseW}`;
    for (const [index, sentence] of SENTENCES.entries()) {
      status(`${item.label}, ${label}, phrase ${index + 1}`);
      await measure(`Piper ${item.label}`, label, index + 1, async (onAudio) => onAudio(await voice.synthesize(sentence, scales, item.speaker)));
    }
  }
}
loaded?.voice.dispose();
for (const voiceName of openaiVoices) {
  if (!config.openaiApiKey) break;
  const voice = new OpenAiVoice({ apiKey: config.openaiApiKey, model: config.openaiTtsModel, voice: voiceName });
  for (const [index, sentence] of SENTENCES.entries()) {
    status(`OpenAI ${voiceName}, phrase ${index + 1}`);
    await measure(`OpenAI ${voiceName}`, config.openaiTtsModel, index + 1, (onAudio) => voice.stream(sentence, onAudio));
  }
}
window.__bench.done = true;
status(`terminé : ${results.length} mesure(s)`);
