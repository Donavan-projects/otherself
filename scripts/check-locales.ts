// Vérifie public/_locales au build : Chrome refuse de charger l'extension si une
// entrée de messages.json n'a pas la forme { "message": "..." }.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_PATTERN = /^[A-Za-z0-9_@]+$/;
const ALLOWED_FIELDS = new Set(['message', 'description', 'placeholders']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkMessages(file: string): { keys: Set<string>; errors: string[] } {
  const errors: string[] = [];
  const keys = new Set<string>();
  let messages: unknown;
  try {
    messages = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { keys, errors: [`${file} : JSON invalide (${error instanceof Error ? error.message : String(error)})`] };
  }
  if (!isObject(messages)) return { keys, errors: [`${file} : un objet est attendu à la racine`] };

  for (const [key, entry] of Object.entries(messages)) {
    keys.add(key);
    const where = `${file} : "${key}"`;
    if (!KEY_PATTERN.test(key)) errors.push(`${where} : nom de clé invalide (lettres, chiffres, _ et @ uniquement)`);
    if (!isObject(entry)) {
      errors.push(`${where} : { "message": "..." } attendu, reçu ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.message !== 'string') errors.push(`${where} : champ "message" (texte) manquant`);
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      errors.push(`${where} : "description" doit être un texte`);
    }
    if (entry.placeholders !== undefined && !isObject(entry.placeholders)) {
      errors.push(`${where} : "placeholders" doit être un objet`);
    }
    for (const field of Object.keys(entry)) {
      if (!ALLOWED_FIELDS.has(field)) errors.push(`${where} : champ inconnu "${field}"`);
    }
  }
  return { keys, errors };
}

/** Lève une erreur listant tous les problèmes trouvés dans les fichiers de traduction. */
export function checkLocales(publicDir: string, defaultLocale: string) {
  const localesDir = join(publicDir, '_locales');
  const locales = existsSync(localesDir) ? readdirSync(localesDir) : [];
  const errors: string[] = [];
  if (!locales.includes(defaultLocale)) errors.push(`${localesDir} : langue par défaut "${defaultLocale}" absente`);

  const keysByLocale = new Map<string, Set<string>>();
  for (const locale of locales) {
    const file = join(localesDir, locale, 'messages.json');
    if (!existsSync(file)) {
      errors.push(`${file} : fichier manquant`);
      continue;
    }
    const result = checkMessages(file);
    errors.push(...result.errors);
    keysByLocale.set(locale, result.keys);
  }

  // Une clé absente d'une langue s'afficherait vide dans l'interface.
  const allKeys = new Set([...keysByLocale.values()].flatMap((keys) => [...keys]));
  for (const [locale, keys] of keysByLocale) {
    for (const key of allKeys) {
      if (!keys.has(key)) errors.push(`${join(localesDir, locale, 'messages.json')} : clé "${key}" manquante`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Fichiers de traduction invalides :\n  - ${errors.join('\n  - ')}`);
  }
}
