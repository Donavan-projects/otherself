// Photo et options d'affichage sérialisées (jamais la clé API) pour passer de l'extension au monde MAIN de l'onglet,
// via les arguments de scripting.executeScript (pas de web_accessible_resources).

export interface SerializedFile {
  base64: string;
  type: string;
}

export interface SerializedSources {
  photo: SerializedFile | null;
  bannerText: string;
  debugSafeZone: boolean;
}

export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Décodage sans fetch(data:…) : la CSP de la page pourrait le bloquer. */
export function fileToBlob(file: SerializedFile): Blob {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: file.type });
}
