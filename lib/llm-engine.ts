// Moteur conversationnel actuel (contrat : lib/engine.ts) : OpenAI Chat Completions en streaming (lib/llm.ts), prompt
// système de lib/prompt.ts construit une fois avec le profil, historique des 12 derniers messages, et compteur de la
// remarque d'humour (au plus une par entretien : signe HUMOR_MARK posé par le modèle, retiré ici avant de rendre le
// texte, puis note système « déjà utilisée »). Ne connaît ni l'audio, ni la page, ni la révélation.

import type { Persona } from './disclosure';
import type { ConversationEngine, EngineEvent, EngineFactory, HeardTurn } from './engine';
import { streamReply, type ChatMessage } from './llm';
import { createLogger } from './log';
import type { ProfileSource } from './profile';
import { humorNote, stripHumorMark, systemPrompt } from './prompt';

const log = createLogger('llm');
const MAX_HISTORY_MESSAGES = 12;

export interface LlmEngineOptions {
  apiKey: string;
  model: string;
}

/** Fabrique du moteur LLM : charge le profil par sa source, puis construit le prompt système une fois pour toutes. */
export function llmEngine(options: LlmEngineOptions): EngineFactory {
  return async (source: ProfileSource, persona: Persona) => {
    const profile = await source.load();
    log(
      `profil chargé : ${profile.origin}, ${profile.text.length} caractères ; langue ${persona.language} ; ` +
        `avatar ${persona.avatarName ? `« ${persona.avatarName} »` : 'sans nom'}`,
    );
    return new LlmEngine(options, systemPrompt(persona, profile.text));
  };
}

class LlmEngine implements ConversationEngine {
  private readonly history: ChatMessage[] = [];
  /** Remarque d'humour sur sa condition d'IA déjà faite dans cet entretien (au plus une, voir lib/prompt.ts). */
  private humorUsed = false;

  constructor(
    private readonly options: LlmEngineOptions,
    private readonly system: string,
  ) {}

  get description() {
    return `LLM ${this.options.model} (OpenAI, streaming)`;
  }

  notify(event: EngineEvent) {
    // Pause et reprise : rien à faire ici, la réponse en cours est abandonnée par son signal.
    if (event.type !== 'reset') return;
    this.history.length = 0;
    this.humorUsed = false;
  }

  async *reply(turn: HeardTurn, signal: AbortSignal): AsyncIterable<string> {
    const question = turn.text;
    const messages: ChatMessage[] = [
      { role: 'system', content: this.system },
      ...this.history.slice(-MAX_HISTORY_MESSAGES),
      { role: 'system', content: humorNote(this.humorUsed) },
      { role: 'user', content: question },
    ];
    log(`question envoyée au LLM (${this.options.model}) : « ${question} »`);
    // streamReply rend son texte par rappel : file d'attente lue au fil de l'eau par l'itérateur.
    const fragments: string[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failure: unknown = null;
    const done = streamReply(
      { apiKey: this.options.apiKey, model: this.options.model },
      messages,
      (delta) => {
        // Signe de la remarque d'humour : retiré avant la voix et la transcription, compté une fois pour toutes.
        const { text, marked } = stripHumorMark(delta);
        if (marked && !this.humorUsed) {
          this.humorUsed = true;
          log('remarque d’humour faite : plus aucune dans cet entretien');
        }
        fragments.push(text);
        wake?.();
      },
      signal,
    )
      .then((reply) => {
        // Réponse complète seulement : une réponse interrompue n'entre pas dans l'historique.
        this.history.push({ role: 'user', content: question }, { role: 'assistant', content: stripHumorMark(reply).text });
      })
      .catch((error: unknown) => {
        // Interruption : fin silencieuse. Autre erreur : rendue au tour de parole, qui ne dit pas la fin en attente.
        if (!signal.aborted) failure = error;
      })
      .finally(() => {
        finished = true;
        wake?.();
      });
    for (;;) {
      const fragment = fragments.shift();
      if (fragment !== undefined) {
        yield fragment;
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
    }
    await done;
    if (failure !== null) throw failure;
  }
}
