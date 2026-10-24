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
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} : ${await response.text()}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let full = '';
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
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  log(`réponse complète (${full.length} caractères)`);
  return full;
}
