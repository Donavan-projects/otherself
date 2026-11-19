// Pauses de la voix de l'avatar : silence du début et de la fin de chaque morceau rendu par Piper retiré, pause fixe
// ajoutée à la fin, et silences trop longs à l'intérieur (pause à une virgule) raccourcis. Mesuré (lib/silences.ts et
// page recruteur) : le début d'un morceau dure d'ordinaire 50 ms mais parfois 500 à 800 ms, et une pause à une virgule
// a dépassé 700 ms (durées de Piper aléatoires, noise_w), assez pour qu'un recruteur automatisé croie la réponse finie.
// Les pauses deviennent courtes et régulières. Sans dépendance : offscreen et pages.

import type { SpeechAudio } from './tts';

/** Pause après une fin de phrase, et après une coupure à une virgule (phrase de plus de 30 mots, rare). */
export const SENTENCE_PAUSE_MS = 250;
export const SOFT_PAUSE_MS = 150;
/** Silence gardé avant la première syllabe et après la dernière : attaques et fins de mots douces intactes. */
const KEEP_MS = 30;
/** Silence intérieur au-delà duquel il est raccourci, et durée gardée. */
const INNER_MAX_MS = 350;
const INNER_KEEP_MS = 300;
/** Seuil du silence (RMS sur 10 ms), comme lib/silences.ts. */
const SILENCE_RMS = 0.008;
const FRAME_MS = 10;

/** Pause à ajouter après ce texte : fin de phrase, virgule, ou rien. */
export function pauseAfter(text: string): number {
  if (/[.!?…]["')\]»]*$/.test(text.trim())) return SENTENCE_PAUSE_MS;
  if (/[,;:]["')\]»]*$/.test(text.trim())) return SOFT_PAUSE_MS;
  return 0;
}

/** Audio rogné de ses silences extrêmes (moins KEEP_MS de chaque côté), suivi de `pauseMs` de silence. */
export function paceSpeech(audio: SpeechAudio, pauseMs: number): SpeechAudio {
  const { samples, sampleRate } = audio;
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const loud = (start: number) => {
    let sum = 0;
    const end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i += 1) sum += samples[i]! ** 2;
    return Math.sqrt(sum / Math.max(1, end - start)) >= SILENCE_RMS;
  };
  let first = 0;
  while (first < samples.length && !loud(first)) first += frame;
  if (first >= samples.length) return audio;
  let last = Math.floor((samples.length - 1) / frame) * frame;
  while (last > first && !loud(last)) last -= frame;
  const keep = Math.round((sampleRate * KEEP_MS) / 1000);
  const start = Math.max(0, first - keep);
  const end = Math.min(samples.length, last + frame + keep);
  // Silences intérieurs trop longs : on garde leurs bords (INNER_KEEP_MS en tout), le milieu est retiré.
  const innerMax = Math.round((sampleRate * INNER_MAX_MS) / 1000);
  const innerKeep = Math.round((sampleRate * INNER_KEEP_MS) / 1000);
  const parts: [number, number][] = [];
  let from = start;
  let silentSince = -1;
  for (let at = first; at <= last; at += frame) {
    if (!loud(at)) {
      if (silentSince < 0) silentSince = at;
      continue;
    }
    if (silentSince >= 0 && at - silentSince > innerMax) {
      parts.push([from, silentSince + Math.floor(innerKeep / 2)]);
      from = at - Math.floor(innerKeep / 2);
    }
    silentSince = -1;
  }
  parts.push([from, end]);
  const pause = Math.round((sampleRate * pauseMs) / 1000);
  const out = new Float32Array(parts.reduce((sum, [a, b]) => sum + (b - a), 0) + pause);
  let offset = 0;
  for (const [a, b] of parts) {
    out.set(samples.subarray(a, b), offset);
    offset += b - a;
  }
  return { ...audio, samples: out };
}
