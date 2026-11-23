// Vérification d'une prise de la page recruteur (local/prises/), sans dépendance :
//   npm run check:prise -- local/prises/prise-AAAAMMJJ-HHMMSS
// - fluidité de chaque vidéo : images par seconde et écarts anormaux entre images (> 60 ms), par tranche de 10 s ;
// - calage de chaque voix : piste continue (écarts entre paquets), durée comparée à la vidéo, et débuts de parole
//   (paquets Opus plus gros que ceux du fond quasi silencieux) comparés aux débuts des sous-titres du même
//   interlocuteur ;
// - prise sans le nom du candidat : occurrences de son prénom (candidateName de config.local.json) et de son nom de
//   famille (lu dans ses notes, après le prénom et d'éventuelles initiales) dans le SRT, objectif zéro.
// Lecteur EBML minimal : Segment, Cluster (taille connue ou non), Timecode, SimpleBlock et BlockGroup/Block, pistes.

import { existsSync, readFileSync } from 'node:fs';

interface Block {
  track: number;
  time: number;
  size: number;
}

function vint(bytes: Uint8Array, at: number, keepMarker = false): [number, number] {
  const first = bytes[at]!;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  let value = keepMarker ? first : first & (mask - 1);
  for (let k = 1; k < length; k += 1) value = value * 256 + bytes[at + k]!;
  return [value, length];
}

/** Blocs (piste, temps en ms, taille) et type de chaque piste (1 vidéo, 2 audio). */
function readWebm(path: string): { blocks: Block[]; types: Map<number, number> } {
  const bytes = new Uint8Array(readFileSync(path));
  const blocks: Block[] = [];
  const types = new Map<number, number>();
  let clusterTime = 0;
  let trackNumber = 0;
  const containers = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0]); // Segment, Cluster, Tracks, TrackEntry, BlockGroup
  const walk = (start: number, end: number) => {
    let at = start;
    while (at < end && at < bytes.length) {
      const [id, idLength] = vint(bytes, at, true);
      const [size, sizeLength] = vint(bytes, at + idLength);
      const data = at + idLength + sizeLength;
      const unknown = size === 2 ** (7 * sizeLength) - 1;
      const next = unknown ? end : data + size;
      if (containers.has(id)) {
        walk(data, Math.min(next, end));
        if (unknown) return;
      } else if (id === 0xe7) {
        clusterTime = Number([...bytes.subarray(data, data + size)].reduce((v, b) => v * 256 + b, 0));
      } else if (id === 0xd7) {
        trackNumber = bytes[data]!;
      } else if (id === 0x83) {
        types.set(trackNumber, bytes[data]!);
      } else if (id === 0xa3 || id === 0xa1) {
        // SimpleBlock, ou Block dans un BlockGroup (vidéos tirées d'un canvas).
        const [track, trackLength] = vint(bytes, data);
        const relative = (bytes[data + trackLength]! << 8) | bytes[data + trackLength + 1]!;
        blocks.push({ track, time: clusterTime + (relative > 0x7fff ? relative - 0x10000 : relative), size });
      }
      at = next;
    }
  };
  walk(0, bytes.length);
  return { blocks, types };
}

interface Cue {
  speaker: string;
  start: number;
  end: number;
}

function readSrt(path: string): Cue[] {
  const time = (text: string) => {
    const [h, m, rest] = text.split(':');
    const [s, ms] = rest!.split(',');
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
  };
  return readFileSync(path, 'utf8')
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n');
      const [from, to] = lines[1]!.split(' --> ');
      return { speaker: lines[2]!.split(':')[0]!, start: time(from!), end: time(to!) };
    });
}

/**
 * Silence qui sépare deux prises de parole, dans le son comme dans les sous-titres : au-dessus des pauses voulues entre
 * phrases (≈ 320 ms), au-dessous des pauses entre une phrase d'attente et la réponse (≈ 0,9 à 2 s).
 */
const SPEECH_GAP_MS = 600;

const prefix = process.argv[2];
if (!prefix || !existsSync(`${prefix}-avatar.webm`)) {
  console.error('usage : npm run check:prise -- local/prises/prise-AAAAMMJJ-HHMMSS');
  process.exit(1);
}
const info = JSON.parse(readFileSync(`${prefix}-infos.json`, 'utf8')) as { recruiter: string; avatarName: string; durationMs: number };
console.log(`prise ${prefix.split('/').pop()} : ${(info.durationMs / 1000).toFixed(1)} s`);

let videoEnd = 0;
for (const name of ['avatar', 'recruteur', 'apercu']) {
  const { blocks, types } = readWebm(`${prefix}-${name}.webm`);
  const video = [...types].find(([, type]) => type === 1)?.[0] ?? 1;
  const times = blocks.filter((block) => block.track === video).map((block) => block.time);
  const last = times.at(-1) ?? 0;
  if (name === 'avatar') videoEnd = last;
  const gaps = times.slice(1).map((time, i) => [times[i]!, time - times[i]!] as const).filter(([, gap]) => gap > 60);
  console.log(`  vidéo ${name} : ${times.length} images en ${(last / 1000).toFixed(1)} s, ${(times.length / (last / 1000)).toFixed(1)} images/s ; écarts > 60 ms : ${gaps.length}${gaps.length ? `, plus grand ${Math.max(...gaps.map(([, gap]) => gap))} ms` : ''}`);
  const buckets = new Map<number, number[]>();
  for (const [at, gap] of gaps) buckets.set(Math.floor(at / 10_000) * 10, [...(buckets.get(Math.floor(at / 10_000) * 10) ?? []), gap]);
  for (const [from, list] of [...buckets].sort((a, b) => a[0] - b[0])) console.log(`      ${from}-${from + 10} s : ${list.length} écart(s), max ${Math.max(...list)} ms`);
}

const cues = readSrt(`${prefix}.srt`);
for (const [name, speaker] of [['voix-avatar', info.avatarName || 'AI avatar'], ['voix-recruteur', info.recruiter]] as const) {
  const { blocks } = readWebm(`${prefix}-${name}.webm`);
  const sizes = blocks.map((block) => block.size).sort((a, b) => a - b);
  // Fond quasi silencieux : paquets les plus petits ; parole : nettement plus gros.
  const quiet = sizes[Math.floor(sizes.length * 0.1)] ?? 0;
  const loud = (block: Block) => block.size > quiet * 3 + 20;
  const onsets: number[] = [];
  let lastLoud = -Infinity;
  for (const block of blocks) {
    if (!loud(block)) continue;
    if (block.time - lastLoud > SPEECH_GAP_MS) onsets.push(block.time);
    lastLoud = block.time;
  }
  const maxGap = Math.max(0, ...blocks.slice(1).map((block, i) => block.time - blocks[i]!.time));
  // Premier sous-titre de chaque prise de parole (plus de SPEECH_GAP_MS après le précédent du même interlocuteur).
  const starts = cues.filter((cue, i) => cue.speaker.startsWith(speaker) && !cues.slice(0, i).some((other) => other.speaker.startsWith(speaker) && cue.start - other.end < SPEECH_GAP_MS)).map((cue) => cue.start);
  // Début de parole apparié au début de sous-titre le plus proche, et réciproquement : une phrase d'attente suivie de
  // sa réponse moins d'1 s plus tard peut ne former qu'un seul début dans le son (sous-titre alors non apparié).
  const nearest = (value: number, list: number[]) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), Infinity);
  const offsets = starts.filter((start) => nearest(nearest(start, onsets), starts) === start).map((start) => nearest(start, onsets) - start);
  const absolute = offsets.map(Math.abs).sort((a, b) => a - b);
  console.log(
    `  voix ${name} : ${((blocks.at(-1)?.time ?? 0) / 1000).toFixed(1)} s (vidéo ${(videoEnd / 1000).toFixed(1)} s), plus grand écart entre paquets ${maxGap} ms ; ` +
      `${starts.length} prises de parole dans le SRT (${offsets.length} retrouvées dans le son), décalage avec le son : médiane ${absolute[Math.floor(absolute.length / 2)] ?? '-'} ms, max ${absolute.at(-1) ?? '-'} ms`,
  );
}

// Nom du candidat dans les sous-titres (prise sans le nom : objectif zéro). Les noms ne sont pas affichés.
if (existsSync('config.local.json')) {
  const config = JSON.parse(readFileSync('config.local.json', 'utf8')) as { candidateName?: string; cv?: string };
  const first = config.candidateName?.trim() ?? '';
  const notes = config.cv && existsSync(config.cv) ? readFileSync(config.cv, 'utf8') : '';
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const last = first ? (notes.match(new RegExp(`${escape(first)}(?:\\s+\\p{Lu}\\.)*\\s+(\\p{Lu}[\\p{L}'-]+)`, 'u'))?.[1] ?? '') : '';
  const srt = readFileSync(`${prefix}.srt`, 'utf8');
  const count = (word: string) => (word ? (srt.match(new RegExp(`(?<!\\p{L})${escape(word)}(?!\\p{L})`, 'giu')) ?? []).length : null);
  const firstCount = count(first);
  const lastCount = count(last);
  console.log(
    `  nom du candidat dans le SRT : prénom ${firstCount ?? '- (candidateName vide)'}, nom de famille ${lastCount ?? '- (introuvable dans les notes)'}` +
      ((firstCount ?? 0) + (lastCount ?? 0) > 0 ? ' : À CORRIGER pour une prise sans le nom' : ''),
  );
}
