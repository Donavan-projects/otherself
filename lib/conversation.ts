// Orchestration du tour de parole, dans le document offscreen :
// son du recruteur → VAD → transcription → LLM en streaming → Piper phrase par phrase
// → page (micro injecté). Ne parle jamais pendant que le recruteur parle.
// L'ouverture (révélation puis messageText) part à la fin de la première prise de parole
// du recruteur, sans attendre la transcription, puis vient la réponse à sa question.

import type { DemoConfig } from './config';
import { streamReply, type ChatMessage } from './llm';
import { createLogger } from './log';
import { int16ToFloat, resample } from './pcm';
import { openingText, shortDisclosureText, systemPrompt } from './prompt';
import { createTranscriber, STT_SAMPLE_RATE, type Transcriber } from './stt';
import type { PiperVoice, SpeechAudio } from './tts';
import { Vad, VAD_SAMPLE_RATE } from './vad';

const log = createLogger('llm');
const logStt = createLogger('stt');
const logTts = createLogger('tts');
const logVad = createLogger('vad');

/** Audio gardé avant le début de parole confirmé, pour ne pas couper le premier mot. */
const PREROLL_MS = 600;
const MAX_HISTORY_MESSAGES = 12;
/** Au-delà, une phrase trop longue est coupée à la dernière virgule pour parler plus tôt. */
const MAX_CHUNK_CHARS = 160;
/** Premier morceau d'une réponse plus court : sa synthèse retarde le début de la réponse. */
const FIRST_CHUNK_CHARS = 60;
/** L'ouverture complète est jouée au plus deux fois (rejouée une fois si elle a été coupée). */
const MAX_OPENING_PLAYS = 2;
/** Phrases de l'avatar gardées pour reconnaître leur écho dans la transcription. */
const SPOKEN_MEMORY = 12;
/** Part des mots d'une transcription déjà prononcés par l'avatar au-delà de laquelle c'est un écho. */
const ECHO_WORD_RATIO = 0.7;
const BARGE_IN_CHECK_MS = 50;

/** Vers la page : lecture de la voix dans le micro injecté. */
export interface PageLink {
  speak(responseId: number, audio: SpeechAudio): void;
  stop(): void;
}

interface Response {
  id: number;
  controller: AbortController;
  questionEndAt: number;
  question: string;
  includesOpening: boolean;
  openingSent: boolean;
  played: boolean;
  /** Au moins une phrase de la réponse elle-même (hors ouverture) est partie. */
  answerSent: boolean;
  /** Tout a été envoyé à la page (ou abandonné). */
  finished: boolean;
  timings: { transcript?: number; firstToken?: number; firstAudio?: number };
}

export class Conversation {
  private transcriber: Transcriber | null = null;
  private connecting: Promise<void> | null = null;
  private preroll: Int16Array[] = [];
  private prerollSamples = 0;
  private capturing = false;
  private current: Response | null = null;
  private nextId = 0;
  /** La plateforme a demandé le micro : sinon la page ignorerait la voix. */
  private micReady = false;
  private waitingForMicLogged = false;
  /** Début (Date.now) de la voix de l'avatar en cours dans le micro injecté, sinon null. */
  private avatarSpeakingSince: number | null = null;
  /** Prise de parole commencée par-dessus l'avatar, pas encore assez longue pour l'interrompre. */
  private bargeIn: { timer: ReturnType<typeof setInterval>; confirmed: boolean } | null = null;
  private openingPlays = 0;
  private shortDisclosureAudio: Promise<SpeechAudio>;
  /** Dernières phrases prononcées par l'avatar (détection d'écho). */
  private readonly spoken: string[] = [];
  /** Règle 2 : vrai seulement quand la révélation a été entièrement prononcée. */
  private revealed = false;
  /** Question restée sans réponse audible (recruteur qui reprend la parole). */
  private carried = '';
  private readonly history: ChatMessage[] = [];
  private readonly opening: string;
  private readonly system: string;
  private openingAudio: Promise<SpeechAudio[]>;
  private vad!: Vad;

  private constructor(
    private readonly config: DemoConfig,
    private readonly voice: PiperVoice,
    cv: string,
    private readonly link: PageLink,
  ) {
    const opening = openingText(config.language, config.messageText);
    this.opening = opening;
    this.system = systemPrompt(config.language, opening, cv);
    // Ouverture synthétisée d'avance, phrase après phrase ; elle n'est jouée qu'une fois le
    // recruteur présent (fin de sa première prise de parole).
    this.openingAudio = (async () => {
      const audio: SpeechAudio[] = [];
      for (const sentence of splitSentences(opening)) audio.push(await voice.synthesize(sentence));
      logTts(`ouverture prête (${audio.length} phrase(s)), pas encore jouée : en attente de la première prise de parole du recruteur`);
      return audio;
    })();
    this.shortDisclosureAudio = this.openingAudio.then(() => voice.synthesize(shortDisclosureText(config.language)));
  }

  static async create(config: DemoConfig, voice: PiperVoice, cv: string, link: PageLink): Promise<Conversation> {
    const conversation = new Conversation(config, voice, cv, link);
    conversation.vad = await Vad.create(config.silenceMs, {
      onSpeechStart: (startedAt) => conversation.onSpeechStart(startedAt),
      onSpeechEnd: (lastVoiceAt, durationMs) => void conversation.onSpeechEnd(lastVoiceAt, durationMs),
    });
    log(`ouverture : « ${conversation.opening} »`);
    void conversation.ensureTranscriber();
    return conversation;
  }

  setMicReady(ready: boolean) {
    if (ready === this.micReady) return;
    this.micReady = ready;
    log(ready ? 'micro injecté prêt sur la plateforme' : 'en attente du micro injecté (la plateforme ne l’a pas encore demandé)');
  }

  /** Nouvelle page de la plateforme (autre onglet ou onglet rechargé) : nouvel entretien. */
  reset(reason: string) {
    this.interrupt(reason);
    this.history.length = 0;
    this.carried = '';
    this.preroll = [];
    this.prerollSamples = 0;
    this.capturing = false;
    this.transcriber?.clear();
    if (this.revealed || this.nextId > 0) log(`nouvel entretien (${reason}) : historique effacé, l’ouverture sera rejouée`);
    this.revealed = false;
    this.openingPlays = 0;
    this.spoken.length = 0;
    if (this.bargeIn) clearInterval(this.bargeIn.timer);
    this.bargeIn = null;
  }

  private ensureTranscriber(): Promise<void> {
    if (this.transcriber?.isAlive()) return Promise.resolve();
    this.connecting ??= createTranscriber({
      apiKey: this.config.openaiApiKey,
      model: this.config.sttModel,
      language: this.config.language,
    })
      .then((transcriber) => {
        this.transcriber = transcriber;
      })
      .catch((error: unknown) => logStt(`erreur : ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /** Son du recruteur (son de l'onglet capturé), PCM 16 bits à 24 kHz. */
  onAudio(samples: Int16Array, receivedAt: number) {
    if (this.capturing) {
      this.transcriber?.append(samples);
    } else {
      this.preroll.push(samples);
      this.prerollSamples += samples.length;
      while (this.prerollSamples > (STT_SAMPLE_RATE * PREROLL_MS) / 1000 && this.preroll.length > 1) {
        this.prerollSamples -= this.preroll.shift()!.length;
      }
    }
    this.vad.push(resample(int16ToFloat(samples), STT_SAMPLE_RATE, VAD_SAMPLE_RATE), receivedAt);
  }

  private onSpeechStart(startedAt: number) {
    if (this.avatarSpeakingSince !== null) {
      // Garde-fou : la voix de l'avatar ne doit jamais revenir dans le son capturé.
      logVad(
        `ALERTE : parole détectée pendant que l'avatar parle (${Date.now() - this.avatarSpeakingSince} ms après le début de sa voix). ` +
          'Soit le recruteur lui coupe la parole, soit la voix de l’avatar revient dans le son capturé ' +
          '(micro de B sans casque, ou haut-parleurs de A et B dans la même pièce). Si cela arrive à chaque réponse, c’est un écho.',
      );
      // Seuil d'interruption : l'avatar ne s'arrête que si la parole dure vraiment (temps de
      // parole mesuré par le VAD, hors silence d'attente) ; un écho bref ou un bruit ne le coupe pas.
      const bargeIn = {
        confirmed: false,
        timer: setInterval(() => {
          if (this.vad.speechMs < this.config.bargeInMs) return;
          clearInterval(bargeIn.timer);
          bargeIn.confirmed = true;
          this.interrupt(`le recruteur parle par-dessus l’avatar depuis ${Math.round(this.vad.speechMs)} ms`);
        }, BARGE_IN_CHECK_MS),
      };
      this.bargeIn = bargeIn;
    } else if (this.current) {
      // Ne jamais parler pendant que le recruteur parle : la réponse en préparation s'arrête.
      this.interrupt(`le recruteur parle (${Date.now() - startedAt} ms après le début de sa phrase)`);
    }
    void this.ensureTranscriber().then(() => {
      for (const chunk of this.preroll) this.transcriber?.append(chunk);
      this.preroll = [];
      this.prerollSamples = 0;
      this.capturing = true;
    });
  }

  private async transcribe(endDetectedAt: number): Promise<string> {
    if (!this.transcriber) {
      logStt('aucune session de transcription ouverte : prise de parole perdue');
      return '';
    }
    let text = '';
    try {
      text = await this.transcriber.commit();
    } catch (error) {
      logStt(`erreur : ${error instanceof Error ? error.message : String(error)}`);
    }
    logStt(`transcription en ${Date.now() - endDetectedAt} ms après détection de fin : « ${text} »`);
    return text;
  }

  private async onSpeechEnd(lastVoiceAt: number, durationMs: number) {
    this.capturing = false;
    const bargeIn = this.bargeIn;
    this.bargeIn = null;
    if (bargeIn && !bargeIn.confirmed) {
      clearInterval(bargeIn.timer);
      this.transcriber?.clear();
      logVad(
        `parole de ${Math.round(durationMs)} ms par-dessus l’avatar, sous le seuil d’interruption (${this.config.bargeInMs} ms) : ignorée (écho ou bruit probable)`,
      );
      return;
    }
    const endDetectedAt = Date.now();
    const transcript = this.transcribe(endDetectedAt).then((text) => {
      if (!this.isEcho(text)) return text;
      logStt(`transcription reprenant les mots de l’avatar : écho ignoré (« ${text} »)`);
      return '';
    });

    if (!this.micReady) {
      if (!this.waitingForMicLogged) {
        this.waitingForMicLogged = true;
        log('le recruteur a parlé, mais la plateforme n’a pas encore demandé le micro : ouverture et réponse en attente');
      }
      this.carried = join(this.carried, await transcript);
      return;
    }

    const response = this.startResponse(lastVoiceAt);
    // Règle 2 : l'ouverture part tout de suite (déjà synthétisée), avant toute réponse.
    const opening = response.includesOpening ? this.sendOpening(response) : Promise.resolve();
    const text = await transcript;
    response.timings.transcript = Date.now() - lastVoiceAt;
    if (response.controller.signal.aborted) {
      // Le recruteur a repris la parole pendant la transcription : question gardée pour la suite.
      this.carried = join(this.carried, text);
      return;
    }
    const question = join(this.carried, text);
    this.carried = '';
    response.question = question;
    if (!question || this.vad.isSpeaking) {
      this.carried = question;
      await opening;
      response.finished = true;
      // Rien n'a été envoyé : aucune fin de lecture ne viendra libérer ce tour.
      if (!response.includesOpening && this.current === response) this.current = null;
      return;
    }
    await this.answer(response, question, opening);
  }

  private interrupt(reason: string) {
    const response = this.current;
    if (!response) return;
    response.controller.abort();
    this.link.stop();
    this.avatarSpeakingSince = null;
    this.current = null;
    // Pas encore de réponse entendue : la question sera reprise avec la suite du recruteur.
    if (!response.answerSent) this.carried = join(response.question, this.carried);
    log(`réponse ${response.id} interrompue : ${reason}`);
  }

  /** Vrai si la plupart des mots transcrits viennent d'être prononcés par l'avatar. */
  private isEcho(text: string): boolean {
    const words = (value: string) => value.toLowerCase().match(/\p{L}[\p{L}'’]*/gu) ?? [];
    const heard = words(text);
    if (heard.length < 3) return false;
    const said = new Set(this.spoken.flatMap(words));
    return heard.filter((word) => said.has(word)).length / heard.length >= ECHO_WORD_RATIO;
  }

  private remember(sentence: string) {
    this.spoken.push(sentence);
    if (this.spoken.length > SPOKEN_MEMORY) this.spoken.shift();
  }

  private startResponse(questionEndAt: number): Response {
    const response: Response = {
      id: (this.nextId += 1),
      controller: new AbortController(),
      questionEndAt,
      question: '',
      includesOpening: !this.revealed,
      openingSent: false,
      played: false,
      answerSent: false,
      finished: false,
      timings: {},
    };
    this.current = response;
    return response;
  }

  /**
   * Révélation puis messageText, déjà synthétisés. Coupée, elle est rejouée une fois ;
   * ensuite (écho probable), seul un rappel court de la révélation précède les réponses.
   */
  private async sendOpening(response: Response) {
    let audio: SpeechAudio[];
    if (this.openingPlays < MAX_OPENING_PLAYS) {
      audio = await this.openingAudio;
      this.openingPlays += 1;
      this.remember(this.opening);
      log(
        `ouverture jouée (réponse ${response.id}, ${this.openingPlays === 1 ? 'première fois' : 'rejouée une fois, dernière'}) : ` +
          `révélation${this.config.messageText ? ' puis message' : ''}`,
      );
    } else {
      audio = [await this.shortDisclosureAudio];
      this.remember(shortDisclosureText(this.config.language));
      log(`ouverture déjà coupée ${MAX_OPENING_PLAYS} fois : rappel court de la révélation (réponse ${response.id})`);
    }
    for (const chunk of audio) {
      if (response.controller.signal.aborted) return;
      this.send(response, chunk);
    }
    response.openingSent = true;
  }

  private async answer(response: Response, question: string, opening: Promise<void>) {
    const { signal } = response.controller;
    const { questionEndAt } = response;
    const messages: ChatMessage[] = [
      { role: 'system', content: this.system },
      ...this.history.slice(-MAX_HISTORY_MESSAGES),
      { role: 'user', content: question },
    ];
    log(`question envoyée au LLM (${this.config.llmModel}) : « ${question} »`);
    const sentences: string[] = [];
    const queue: { wake: (() => void) | null; done: boolean } = { wake: null, done: false };
    // La réponse ne part qu'après l'ouverture ; le LLM, lui, n'attend pas.
    const speaker = opening.then(() =>
      this.speakSentences(response, sentences, () => queue.done, (resolve) => (queue.wake = resolve)),
    );

    let buffer = '';
    let queued = 0;
    try {
      const reply = await streamReply(
        { apiKey: this.config.openaiApiKey, model: this.config.llmModel },
        messages,
        (delta) => {
          if (response.timings.firstToken === undefined) {
            response.timings.firstToken = Date.now() - questionEndAt;
            log(`premier mot reçu ${response.timings.firstToken} ms après la fin de la question`);
          }
          buffer += delta;
          const [ready, rest] = takeSentences(buffer, queued === 0 ? FIRST_CHUNK_CHARS : MAX_CHUNK_CHARS);
          buffer = rest;
          queued += ready.length;
          if (ready.length) {
            sentences.push(...ready);
            queue.wake?.();
          }
        },
        signal,
      );
      if (buffer.trim()) sentences.push(buffer.trim());
      this.history.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
    } catch (error) {
      if (!signal.aborted) log(`erreur : ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      queue.done = true;
      queue.wake?.();
    }
    await speaker;
    response.finished = true;
  }

  /** Synthétise et envoie les phrases dans l'ordre, au fur et à mesure qu'elles arrivent. */
  private async speakSentences(
    response: Response,
    sentences: string[],
    isDone: () => boolean,
    setWake: (resolve: () => void) => void,
  ) {
    const { signal } = response.controller;
    for (;;) {
      const sentence = sentences.shift();
      if (sentence === undefined) {
        if (isDone()) return;
        await new Promise<void>((resolve) => setWake(resolve));
        continue;
      }
      const audio = await this.voice.synthesize(sentence);
      if (signal.aborted) return;
      if (this.send(response, audio)) {
        response.answerSent = true;
        this.remember(sentence);
      }
    }
  }

  private send(response: Response, audio: SpeechAudio): boolean {
    // Pendant le seuil d'interruption, l'avatar continue : la parole entendue peut être un écho.
    if (this.vad.isSpeaking && !this.bargeIn) {
      this.interrupt('le recruteur parle');
      return false;
    }
    if (response.timings.firstAudio === undefined) response.timings.firstAudio = Date.now() - response.questionEndAt;
    this.link.speak(response.id, audio);
    return true;
  }

  /** La page a commencé à jouer la réponse : c'est la latence perçue par le recruteur. */
  onPlaybackStarted(responseId: number, at: number) {
    const response = this.current;
    if (response?.id !== responseId) return;
    this.avatarSpeakingSince = at;
    if (response.played) return;
    response.played = true;
    const { transcript, firstToken, firstAudio } = response.timings;
    logTts(
      `LATENCE fin de question → début de réponse : ${at - response.questionEndAt} ms ` +
        `(seuil de silence ${this.config.silenceMs} ms inclus ; transcription ${transcript} ms, ` +
        `premier mot ${firstToken ?? '-'} ms, première phrase prête ${firstAudio} ms)` +
        (response.includesOpening ? ' — ouverture avec révélation' : ''),
    );
  }

  /** La page n'a plus rien à jouer. */
  onPlaybackIdle(responseId: number) {
    const response = this.current;
    if (response?.id !== responseId) return;
    this.avatarSpeakingSince = null;
    if (response.includesOpening && response.openingSent && !this.revealed) {
      this.revealed = true;
      logTts('révélation entièrement prononcée (elle ne sera plus jouée dans cet entretien)');
    }
    if (response.finished) this.current = null;
  }
}

const join = (...parts: string[]) => parts.filter(Boolean).join(' ').trim();

function splitSentences(text: string): string[] {
  const [sentences, rest] = takeSentences(text, MAX_CHUNK_CHARS);
  return rest.trim() ? [...sentences, rest.trim()] : sentences;
}

/** Sépare les phrases terminées du texte encore en cours d'écriture. */
function takeSentences(text: string, maxChars: number): [string[], string] {
  const sentences: string[] = [];
  let rest = text;
  for (;;) {
    const match = /[.!?…](?=\s)/.exec(rest);
    if (match) {
      sentences.push(rest.slice(0, match.index + 1).trim());
      rest = rest.slice(match.index + 1).trimStart();
      continue;
    }
    if (rest.length > maxChars) {
      const comma = rest.lastIndexOf(', ', maxChars);
      if (comma > 20) {
        sentences.push(rest.slice(0, comma + 1).trim());
        rest = rest.slice(comma + 2);
        continue;
      }
    }
    return [sentences.filter(Boolean), rest];
  }
}

