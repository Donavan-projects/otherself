// Source du profil du candidat (CV et notes) : seule base des réponses (règle 5). Aujourd'hui un fichier désigné par
// le champ cv de config.local.json, copié dans le build (local/) ; demain, peut-être un connecteur (export d'un outil
// de notes, document converti…), qui n'aura qu'à fournir le même texte. Format attendu : docs/profil.md.

import { loadLocalText, type DemoConfig } from './config';

/** Profil prêt pour le prompt : texte (Markdown, format de docs/profil.md) et provenance, pour les logs. */
export interface CandidateProfile {
  text: string;
  origin: string;
}

/** Fournisseur du profil. Toute source future implémente cette interface ; aucun autre module ne lit le CV. */
export interface ProfileSource {
  /** Provenance lisible (logs), sans contenu du profil. */
  readonly description: string;
  load(): Promise<CandidateProfile>;
}

/** Profil de la démo : fichier cv de config.local.json (Markdown ou texte). Absent : profil vide. */
export function localFileProfile(config: Pick<DemoConfig, 'cv'>): ProfileSource {
  const description = config.cv ? `fichier ${config.cv} (config.local.json)` : 'aucun fichier (champ cv absent)';
  return {
    description,
    load: async () => ({ text: await loadLocalText(config.cv), origin: description }),
  };
}
