// Images de l'avatar et options d'affichage sérialisées (jamais la clé API) pour passer de l'extension
// au monde MAIN de l'onglet, via les arguments de scripting.executeScript (pas de web_accessible_resources).

import type { AvatarAssets } from './avatar';
import type { VrmAssets } from './vrm-assets';

export interface SerializedFile {
  base64: string;
  type: string;
}

export interface SerializedSources {
  avatar: AvatarAssets<SerializedFile>;
  /** Avatar 3D (avatarRenderer: vrm) ; l'avatar de secours ci-dessus prend le relais. */
  vrm?: VrmAssets<SerializedFile> | undefined;
  /** Marquage « IA » (règle 1) déjà rendu par le popup (lib/avatar-assets.ts, renderMarkingText). */
  marking: SerializedFile;
  /** Langue de l'entretien : texte de l'image de pause, vue par l'interlocuteur. */
  language: 'fr' | 'en';
  /** Textes des boutons injectés dans la page, vus par l'utilisateur seul : langue du navigateur (public/_locales). */
  labels: PageLabels;
}

/** Boutons injectés dans la page : traduits par le popup (la page ne peut pas lire les fichiers de l'extension). */
export interface PageLabels {
  share: string;
  pause: string;
  resume: string;
}

/** Texte de l'image affichée pendant la pause : sans avatar ni marqueur, elle l'identifie en toutes lettres (règle 1). */
export function pauseText(language: 'fr' | 'en'): string {
  return language === 'fr' ? 'Avatar IA en pause' : 'AI avatar paused';
}

export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function blobToFile(blob: Blob): Promise<SerializedFile> {
  return { base64: bytesToBase64(await blob.arrayBuffer()), type: blob.type };
}

/** Décodage sans fetch(data:…) : la CSP de la page pourrait le bloquer. */
export function fileToBlob(file: SerializedFile): Blob {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: file.type });
}
