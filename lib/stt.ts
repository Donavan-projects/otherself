// Transcription (OpenAI). Fournisseur isolé ici : le reste du pipeline ne voit que
// l'interface Transcriber.
//
// Mode principal : session Realtime de transcription (gpt-live-transcribe). L'audio du
// recruteur est envoyé pendant qu'il parle ; à la fin de la question, un « commit »
// suffit et le texte arrive presque aussitôt. Repli : envoi de l'extrait complet à
// /v1/audio/transcriptions (gpt-transcribe) si la session Realtime échoue.
//
// Audio attendu : PCM 16 bits mono à 24 kHz (seul format des sessions Realtime).

import { createLogger } from './log';
import { bufferToBase64, encodeWav } from './pcm';

const log = createLogger('stt');

export const STT_SAMPLE_RATE = 24000;
const API = 'https://api.openai.com/v1';
const COMMIT_TIMEOUT_MS = 8000;

export interface Transcriber {
  /** Ajoute l'audio de la prise de parole en cours. */
  append(samples: Int16Array): void;
  /** Termine la prise de parole et renvoie son texte. */
  commit(): Promise<string>;
  /** Abandonne la prise de parole en cours (bruit, parole trop courte). */
  clear(): void;
  /** Faux si la connexion est perdue : il faut alors en créer un nouveau. */
  isAlive(): boolean;
  close(): void;
}

export interface SttOptions {
  apiKey: string;
  model: string;
  language: string;
}

export async function createTranscriber(options: SttOptions): Promise<Transcriber> {
  try {
    return await RealtimeTranscriber.connect(options);
  } catch (error) {
    log(`session Realtime indisponible (${error instanceof Error ? error.message : String(error)}) : repli sur la transcription par fichier (gpt-transcribe)`);
    return new FileTranscriber({ ...options, model: 'gpt-transcribe' });
  }
}

interface PendingCommit {
  sentAt: number;
  resolve(itemId: string | null): void;
}

class RealtimeTranscriber implements Transcriber {
  /** Commits envoyés, dans l'ordre, en attente de leur confirmation (input_audio_buffer.committed). */
  private pendingCommits: PendingCommit[] = [];
  private readonly waiting = new Map<string, (text: string) => void>();
  private readonly finished = new Map<string, string>();
  private hasAudio = false;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
    socket.addEventListener('close', (event) => log(`session Realtime fermée (code ${event.code})`));
  }

  static async connect(options: SttOptions): Promise<RealtimeTranscriber> {
    // Clé éphémère créée avec la clé de l'utilisateur : seule elle transite dans le WebSocket.
    const response = await fetch(`${API}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: STT_SAMPLE_RATE },
              noise_reduction: null,
              transcription: { model: options.model, languages: [options.language] },
              // Fin de parole décidée localement par le VAD (seuil de silence réglable).
              turn_detection: null,
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`client_secrets ${response.status} : ${await response.text()}`);
    const { value } = (await response.json()) as { value: string };

    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?intent=transcription`, [
      'realtime',
      `openai-insecure-api-key.${value}`,
    ]);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('connexion WebSocket refusée')), { once: true });
      socket.addEventListener('close', (event) => reject(new Error(`WebSocket fermé (code ${event.code})`)), { once: true });
    });
    log(`session Realtime de transcription ouverte (${options.model}, ${options.language})`);
    return new RealtimeTranscriber(socket);
  }

  private send(event: Record<string, unknown>) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private onMessage(data: string) {
    const event = JSON.parse(data) as {
      type: string;
      item_id?: string;
      transcript?: string;
      error?: { message?: string; code?: string; type?: string };
    };
    switch (event.type) {
      case 'input_audio_buffer.committed':
        this.pendingCommits.shift()?.resolve(event.item_id ?? '');
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const itemId = event.item_id ?? '';
        const text = event.transcript ?? '';
        const resolve = this.waiting.get(itemId);
        if (resolve) {
          this.waiting.delete(itemId);
          resolve(text);
        } else {
          this.finished.set(itemId, text);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        // Sans réponse, la question attendrait jusqu'au délai et serait perdue en silence.
        log(`échec de transcription d'un segment : ${event.error?.message ?? data}`);
        const itemId = event.item_id ?? '';
        const resolve = this.waiting.get(itemId);
        this.waiting.delete(itemId);
        if (resolve) resolve('');
        else this.finished.set(itemId, '');
        break;
      }
      case 'error': {
        log(`erreur Realtime : ${event.error?.message ?? data}${event.error?.code ? ` (${event.error.code})` : ''}`);
        // Commit refusé (tampon vide ou trop court) : aucun « committed » ne viendra. Sans
        // cela, les commits suivants seraient décalés d'un cran et leurs questions perdues.
        if (event.error?.code?.includes('commit') || /commit/i.test(event.error?.message ?? '')) {
          this.pendingCommits.shift()?.resolve(null);
        }
        break;
      }
      default:
        break;
    }
  }

  append(samples: Int16Array) {
    this.hasAudio = true;
    this.send({ type: 'input_audio_buffer.append', audio: bufferToBase64(samples.buffer) });
  }

  async commit(): Promise<string> {
    if (!this.hasAudio) return '';
    this.hasAudio = false;
    const sentAt = Date.now();
    let committedId: string | null | undefined;
    const itemId = new Promise<string | null>((resolve) =>
      this.pendingCommits.push({
        sentAt,
        resolve: (id) => {
          committedId = id;
          resolve(id);
        },
      }),
    );
    this.send({ type: 'input_audio_buffer.commit' });
    let timedOut = false;
    const transcript = itemId.then(
      (id) =>
        new Promise<string>((resolve) => {
          if (id === null) return resolve('');
          const done = this.finished.get(id);
          if (done !== undefined) {
            this.finished.delete(id);
            resolve(done);
            return;
          }
          this.waiting.set(id, (text) => {
            // Arrivée après le délai : le segment a été traité comme vide, on le signale.
            if (timedOut) log(`transcription arrivée en retard (${Date.now() - sentAt} ms), segment perdu : « ${text} »`);
            resolve(text);
          });
        }),
    );
    const timeout = new Promise<string>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        const stage =
          committedId === undefined
            ? 'commit jamais confirmé par OpenAI'
            : committedId === null
              ? 'commit refusé'
              : 'commit confirmé, texte jamais reçu';
        log(`pas de transcription après ${COMMIT_TIMEOUT_MS} ms (${stage}) : segment perdu`);
        resolve('');
      }, COMMIT_TIMEOUT_MS),
    );
    return Promise.race([transcript, timeout]);
  }

  clear() {
    if (!this.hasAudio) return;
    this.hasAudio = false;
    this.send({ type: 'input_audio_buffer.clear' });
  }

  isAlive() {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close() {
    this.socket.close();
  }
}

class FileTranscriber implements Transcriber {
  private chunks: Int16Array[] = [];

  constructor(private readonly options: SttOptions) {}

  append(samples: Int16Array) {
    this.chunks.push(samples);
  }

  async commit(): Promise<string> {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (length === 0) return '';
    const samples = new Int16Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const form = new FormData();
    form.append('file', encodeWav(samples, STT_SAMPLE_RATE), 'question.wav');
    form.append('model', this.options.model);
    form.append('language', this.options.language);
    const response = await fetch(`${API}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      log(`erreur ${response.status} : ${await response.text()}`);
      return '';
    }
    return ((await response.json()) as { text?: string }).text ?? '';
  }

  clear() {
    this.chunks = [];
  }

  isAlive() {
    return true;
  }

  close() {}
}
