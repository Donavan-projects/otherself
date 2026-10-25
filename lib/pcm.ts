// Utilitaires audio partagés entre la page (monde MAIN) et le document offscreen.

/** Rééchantillonnage linéaire, suffisant pour la voix (VAD, transcription, lecture). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const fraction = position - index;
    output[i] = input[index]! * (1 - fraction) + input[next]! * fraction;
  }
  return output;
}

export function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]!));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function int16ToFloat(input: Int16Array): Float32Array<ArrayBuffer> {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) output[i] = input[i]! / 0x8000;
  return output;
}

export function bufferToBase64(buffer: ArrayBufferLike): string {
  const view = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** WAV PCM 16 bits mono, pour l'envoi d'un extrait à l'API de transcription. */
export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) header.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  header.setUint32(4, 36 + samples.byteLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeText(36, 'data');
  header.setUint32(40, samples.byteLength, true);
  return new Blob([header.buffer, samples.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/** Décode un WAV PCM 16 bits mono (sortie de Piper). */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array<ArrayBuffer>; sampleRate: number } {
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  // Cherche le bloc « data » (l'en-tête n'a pas toujours 44 octets).
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const samples = new Int16Array(buffer.slice(offset + 8, offset + 8 + size));
      return { samples: int16ToFloat(samples), sampleRate };
    }
    offset += 8 + size;
  }
  throw new Error('WAV sans bloc data');
}
