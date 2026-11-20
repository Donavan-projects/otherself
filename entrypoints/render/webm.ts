// Écriture WebM minimale, sans dépendance, pour le rendu après coup d'une prise : une piste vidéo VP8 et, au besoin,
// une piste audio Opus, encodées par WebCodecs. Segment de taille connue, Info (durée), Tracks, Cues (un point par
// image clé, positions sur 8 octets : leur taille ne dépend pas des valeurs), puis un Cluster par image clé, blocs
// (SimpleBlock) rangés par heure. Temps en millisecondes (TimecodeScale 1 ms).

export interface WebmChunk {
  /** Heure en microsecondes. */
  timestamp: number;
  key: boolean;
  data: Uint8Array;
}

export interface WebmVideoTrack {
  width: number;
  height: number;
  chunks: WebmChunk[];
}

export interface WebmAudioTrack {
  sampleRate: number;
  channels: number;
  /** En-tête Opus (OpusHead), CodecPrivate. */
  opusHead: Uint8Array;
  chunks: WebmChunk[];
}

type Part = Uint8Array<ArrayBuffer>;

function idBytes(id: number): Part {
  const bytes: number[] = [];
  for (let value = id; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff);
  return new Uint8Array(bytes);
}

function sizeBytes(size: number): Part {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length += 1;
  const bytes = new Uint8Array(length);
  let value = size;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  bytes[0]! |= 1 << (8 - length);
  return bytes;
}

function uintBytes(value: number, fixed = 0): Part {
  const bytes: number[] = [];
  for (let rest = value; rest > 0 || bytes.length === 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  while (bytes.length < fixed) bytes.unshift(0);
  return new Uint8Array(bytes);
}

const partsLength = (parts: Part[]) => parts.reduce((sum, part) => sum + part.length, 0);

/** Élément EBML : en-tête (identifiant, taille) puis contenu. */
function element(id: number, content: Part[]): Part[] {
  return [idBytes(id), sizeBytes(partsLength(content)), ...content];
}
const uint = (id: number, value: number, fixed = 0) => element(id, [uintBytes(value, fixed)]);
const text = (id: number, value: string) => element(id, [new TextEncoder().encode(value)]);
function float(id: number, value: number): Part[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return element(id, [bytes]);
}

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTrackPositions: 0xb7,
  Cluster: 0x1f43b675,
} as const;

/** Fichier WebM : vidéo en piste 1, audio éventuel en piste 2. */
export function writeWebm(video: WebmVideoTrack, audio?: WebmAudioTrack, app = 'OtherSelf (rendu de la prise)'): Blob {
  const header = element(ID.EBML, [
    ...uint(0x4286, 1),
    ...uint(0x42f7, 1),
    ...uint(0x42f2, 4),
    ...uint(0x42f3, 8),
    ...text(0x4282, 'webm'),
    ...uint(0x4287, 4),
    ...uint(0x4285, 2),
  ]);
  const ms = (timestamp: number) => Math.round(timestamp / 1000);
  const lastVideo = video.chunks.at(-1);
  const durationMs = lastVideo ? ms(lastVideo.timestamp) + 1000 / 30 : 0;
  const info = element(ID.Info, [...uint(0x2ad7b1, 1_000_000), ...text(0x4d80, app), ...text(0x5741, app), ...float(0x4489, durationMs)]);
  const tracks = element(ID.Tracks, [
    ...element(ID.TrackEntry, [
      ...uint(0xd7, 1),
      ...uint(0x73c5, 1),
      ...uint(0x83, 1),
      ...uint(0x9c, 0),
      ...text(0x86, 'V_VP8'),
      ...uint(0x23e383, Math.round(1e9 / 30)),
      ...element(0xe0, [...uint(0xb0, video.width), ...uint(0xba, video.height)]),
    ]),
    ...(audio
      ? element(ID.TrackEntry, [
          ...uint(0xd7, 2),
          ...uint(0x73c5, 2),
          ...uint(0x83, 2),
          ...uint(0x9c, 0),
          ...text(0x86, 'A_OPUS'),
          ...element(0x63a2, [audio.opusHead as Part]),
          ...uint(0x56aa, Math.round((new DataView(audio.opusHead.buffer, audio.opusHead.byteOffset).getUint16(10, true) * 1e9) / 48000)),
          ...uint(0x56bb, 80_000_000),
          ...element(0xe1, [...float(0xb5, audio.sampleRate), ...uint(0x9f, audio.channels)]),
        ])
      : []),
  ]);

  // Blocs rangés par heure ; un Cluster commence à chaque image clé.
  const blocks = [
    ...video.chunks.map((chunk) => ({ track: 1, ...chunk })),
    ...(audio?.chunks ?? []).map((chunk) => ({ track: 2, ...chunk, key: true })),
  ].sort((a, b) => a.timestamp - b.timestamp || a.track - b.track);
  const clusters: { time: number; parts: Part[] }[] = [];
  let current: { time: number; content: Part[] } | null = null;
  const flush = () => {
    if (current) clusters.push({ time: current.time, parts: element(ID.Cluster, [...uint(0xe7, current.time), ...current.content]) });
  };
  for (const block of blocks) {
    const time = ms(block.timestamp);
    if (!current || (block.track === 1 && block.key) || time - current.time > 30_000) {
      flush();
      current = { time, content: [] };
    }
    const head = new Uint8Array(4);
    head[0] = 0x80 | block.track;
    new DataView(head.buffer).setInt16(1, time - current.time);
    head[3] = block.key ? 0x80 : 0;
    current.content.push(...element(0xa3, [head, block.data as Part]));
  }
  flush();

  // Cues avant les Clusters : tailles fixes (8 octets), donc positions connues d'avance.
  const cuePoint = (time: number, position: number) =>
    element(ID.CuePoint, [...uint(0xb3, time, 8), ...element(ID.CueTrackPositions, [...uint(0xf7, 1), ...uint(0xf1, position, 8)])]);
  const cuesLength = partsLength(element(ID.Cues, clusters.flatMap(() => cuePoint(0, 0))));
  let position = partsLength(info) + partsLength(tracks) + cuesLength;
  const points: Part[] = [];
  for (const cluster of clusters) {
    points.push(...cuePoint(cluster.time, position));
    position += partsLength(cluster.parts);
  }
  const cues = element(ID.Cues, points);
  const body = [...info, ...tracks, ...cues, ...clusters.flatMap((cluster) => cluster.parts)];
  return new Blob([...header, idBytes(ID.Segment), sizeBytes(partsLength(body)), ...body], { type: audio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8' });
}

/** OpusHead (RFC 7845) : version 1, canaux, pré-saut, fréquence d'origine, gain 0, table de canaux 0. */
export function opusHead(channels: number, sampleRate: number, preSkip = 312): Uint8Array {
  const bytes = new Uint8Array(19);
  bytes.set(new TextEncoder().encode('OpusHead'));
  const view = new DataView(bytes.buffer);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  return bytes;
}
