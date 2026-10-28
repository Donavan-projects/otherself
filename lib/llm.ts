// LLM (OpenAI Chat Completions en streaming). Fournisseur isolé ici : le reste du
// pipeline ne voit que streamReply().

import { createLogger } from './log';

const log = createLogger('llm');

const API = 'https://api.openai.com/v1/chat/completions';
const MAX_COMPLETION_TOKENS = 300;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Comptes de tokens renvoyés par l'API en fin de flux (stream_options.include_usage). */
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface LlmOptions {
  apiKey: string;
  model: string;
}

/** Envoie la conversation et transmet le texte de la réponse au fil de l'eau. */
export async function streamReply(
  options: LlmOptions,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const started = performance.now();
  const response = await fetch(API, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: true,
      // Pas de raisonnement : la latence avant le premier mot compte plus que tout.
      reasoning_effort: 'none',
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      // Dernier événement du flux : tokens du prompt (dont en cache) et de la réponse (dont raisonnement).
      stream_options: { include_usage: true },
    }),
  });
  const headersMs = performance.now() - started;
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} : ${await response.text()}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let full = '';
  let firstWordMs: number | null = null;
  let usage: Usage | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Usage | null };
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        firstWordMs ??= performance.now() - started;
        full += delta;
        onDelta(delta);
      }
    }
  }
  // Une ligne par appel : distingue l'attente côté API (en-têtes, traitement) de la génération (premier mot → fin).
  const ms = (value: number | null) => (value === null ? '-' : `${Math.round(value)} ms`);
  const processing = response.headers.get('openai-processing-ms');
  log(
    `appel ${options.model} : en-têtes ${ms(headersMs)}, premier mot ${ms(firstWordMs)}, fin ${ms(performance.now() - started)} ; ` +
      `prompt ${usage?.prompt_tokens ?? '-'} tokens (en cache ${usage?.prompt_tokens_details?.cached_tokens ?? '-'}), ` +
      `réponse ${usage?.completion_tokens ?? '-'} tokens (raisonnement ${usage?.completion_tokens_details?.reasoning_tokens ?? '-'}) ; ` +
      // openai-processing-ms n'est pas exposé aux navigateurs (CORS) : le délai des en-têtes mesure l'attente côté API, réseau compris.
      `traitement API ${processing === null ? 'non exposé au navigateur' : `${processing} ms`} ; requête ${response.headers.get('x-request-id') ?? '-'} ; ` +
      `${full.length} caractères`,
  );
  return full;
}
