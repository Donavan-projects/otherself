// Tour de parole, côté extension, dans le document offscreen (contrat : lib/engine.ts, docs/moteur.md) :
// son du recruteur → VAD → transcription → moteur conversationnel (texte en flux) → découpe en phrases → voix
// phrase par phrase → page (micro injecté). Ne parle jamais pendant que le recruteur parle.
// Garde ce qu'aucun moteur ne doit pouvoir contourner : l'ouverture (révélation puis messageText, texte fixe de
// lib/disclosure.ts) part à la fin de la première prise de parole du recruteur, avant toute réponse ; le rappel court
// après une pause ; les états de l'avatar et les hochements, calculés ici à partir de l'audio et de la lecture.

import type { AvatarState } from './avatar-states';
import type { DemoConfig } from './config';
import { takeChunks } from './chunks';
import { disclosureText, openingText, shortDisclosureText } from './disclosure';
import type { ConversationEngine, RenderLink } from './engine';
import { isGreetingOnly } from './greeting';
import { clock, createLogger } from './log';
import { int16ToFloat, resample } from './pcm';
import { analyzePieces, describeResponse, measureSilence, SilenceSummary, type PieceKind, type VoicePiece } from './silences';
import { createTranscriber, STT_SAMPLE_RATE, type Transcriber } from './stt';
import { paceSpeech, pauseAfter } from './speech-pacing';
import { SpeechQueue } from './speech-queue';
import type { SpeechAudio } from './tts';
import type { VoicePool } from './voice-pool';
import { Vad, VAD_SAMPLE_RATE } from './vad';

const log = createLogger('llm');
const logStt = createLogger('stt');
const logTts = createLogger('tts');
const logVad = createLogger('vad');
const logState = createLogger('etat');

/** Audio gardé avant le début de parole confirmé, pour ne pas couper le premier mot. */
const PREROLL_MS = 600;
/** L'ouverture complète est jouée au plus deux fois (rejouée une fois si elle a été coupée). */
const MAX_OPENING_PLAYS = 2;
/** Phrases de l'avatar gardées pour reconnaître leur écho dans la transcription. */
const SPOKEN_MEMORY = 12;
/** Part des mots d'une transcription déjà prononcés par l'avatar au-delà de laquelle c'est un écho. */
const ECHO_WORD_RATIO = 0.7;
const BARGE_IN_CHECK_MS = 50;
/**
 * Pendant l'ouverture, seuil d'interruption relevé : un « got it » du recruteur ne doit pas
 * couper la révélation (et donc la faire rejouer).
 */
const OPENING_BARGE_IN_MS = 2000;
/** Marge (latence réseau) avant de considérer la révélation comme entendue. */
const HEARD_MARGIN_MS = 300;
/**
 * Délai maximal entre le premier envoi de la voix à la page et le début réel de sa lecture. D'habitude
 * 20 à 100 ms (pont, puis 20 ms d'avance à la lecture) ; au-delà, la voix est tenue pour perdue (erreur
 * dans la page, micro retiré) et l'avatar quitte « en réflexion ».
 */
const PLAYBACK_START_TIMEOUT_MS = 4000;
/** Écart minimal entre deux hochements de l'avatar à l'écoute. */
const NOD_MIN_GAP_MS = 1500;

/** Vers la page : voix (micro injecté), états et hochements (lib/engine.ts). */
export type PageLink = RenderLink;

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
  /** Morceaux de la réponse envoyés à la page, pour la ligne « Avatar : … ». */
  spoken: string[];
  transcriptLogged: boolean;
  /** Envoi du premier morceau de la réponse elle-même (Date.now). */
  answerStartedAt?: number;
  /** Début de la lecture dans la page (premier playback-started de ce tour). */
  playbackStartedAt?: number;
  timings: { transcript?: number; firstToken?: number; firstAudio?: number };
  /** Voix envoyée à la page, pas forcément encore jouée (Date.now du premier envoi). */
  sentAt?: number;
  /** La voix envoyée n'a jamais commencé à jouer dans le délai prévu : la réponse ne compte plus pour l'état. */
  playbackTimedOut?: boolean;
  /** Morceaux de voix envoyés, dans l'ordre, avec leurs heures (mesure des silences, lib/silences.ts). */
  pieces: VoicePiece[];
  /** Morceaux dont la page a déjà renvoyé l'heure de lecture. */
  scheduled: number;
  silencesLogged: boolean;
}

/** Ce que l'on sait d'un morceau avant de l'envoyer : son texte et ses heures de préparation. */
interface PieceInfo {
  kind: PieceKind;
  text: string;
  textReadyAt: number;
  synthStartAt: number;
  synthEndAt: number;
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
  /** Début de la dernière prise de parole du recruteur (Date.now), pour la transcription. */
  private speechStartedAt = Date.now();
  /** Prise de parole commencée par-dessus l'avatar, pas encore assez longue pour l'interrompre. */
  private bargeIn: { timer: ReturnType<typeof setInterval>; confirmed: boolean; threshold: number } | null = null;
  private openingPlays = 0;
  private shortDisclosureAudio: Promise<SpeechAudio>;
  /** Dernières phrases prononcées par l'avatar (détection d'écho). */
  private readonly spoken: string[] = [];
  /** Règle 2 : vrai seulement quand la révélation a été entièrement prononcée. */
  private revealed = false;
  /** Reprise après une pause : rappel court de la révélation avant la prochaine réponse, jusqu'à ce qu'il soit entendu. */
  private reminderPending = false;
  /** Pause : son du recruteur ignoré, aucune réponse. */
  private paused = false;
  /** Durée du rappel court, en ms d'audio. */
  private shortDisclosureMs = Infinity;
  /** Question restée sans réponse audible (recruteur qui reprend la parole). */
  private carried = '';
  private readonly opening: string;
  private openingAudio: Promise<SpeechAudio[]>;
  /** Texte de chaque morceau de l'ouverture, dans l'ordre de openingAudio. */
  private readonly openingTexts: string[];
  /** Fin prévue (Date.now) de la voix déjà envoyée à la page ; corrigée par les heures de lecture qu'elle renvoie. */
  private playhead = 0;
  /** Silences de la voix dans cet entretien (résumé logué après chaque réponse). */
  private readonly silences = new SilenceSummary();
  /** Durée de la révélation seule (début de l'ouverture), en ms d'audio. */
  private disclosureMs = Infinity;
  private vad!: Vad;
  /** État de l'avatar : déduit de la conversation à chaque événement (updateState), jamais posé à la main. */
  private avatarState: AvatarState = 'inactif';
  private lastNodAt = 0;

  private constructor(
    private readonly config: DemoConfig,
    private readonly voice: VoicePool,
    private readonly engine: ConversationEngine,
    private readonly link: PageLink,
  ) {
    // Le texte de l'ouverture n'est jamais donné au moteur : le LLM le recopiait mot pour mot.
    const opening = openingText(config, config.messageText);
    this.opening = opening;
    this.openingTexts = [...splitSentences(disclosureText(config)), ...splitSentences(config.messageText.trim())];
    // Ouverture synthétisée d'avance, phrase après phrase ; elle n'est jouée qu'une fois le
    // recruteur présent (fin de sa première prise de parole).
    // Révélation et message synthétisés à part : on sait ainsi quand la révélation a été entendue.
    this.openingAudio = (async () => {
      const audio: SpeechAudio[] = [];
      for (const sentence of splitSentences(disclosureText(config))) {
        audio.push(await voice.synthesize(sentence));
      }
      this.disclosureMs = audio.reduce((sum, chunk) => sum + (chunk.samples.length / chunk.sampleRate) * 1000, 0);
      for (const sentence of splitSentences(config.messageText.trim())) audio.push(await voice.synthesize(sentence));
      logTts(`ouverture prête (${audio.length} phrase(s)), pas encore jouée : en attente de la première prise de parole du recruteur`);
      return audio;
    })();
    this.shortDisclosureAudio = this.openingAudio
      .then(() => voice.synthesize(shortDisclosureText(config)))
      .then((audio) => {
        this.shortDisclosureMs = (audio.samples.length / audio.sampleRate) * 1000;
        return audio;
      });
  }

  static async create(config: DemoConfig, voice: VoicePool, engine: ConversationEngine, link: PageLink): Promise<Conversation> {
    const conversation = new Conversation(config, voice, engine, link);
    conversation.vad = await Vad.create(config.silenceMs, {
      onSpeechStart: (startedAt) => conversation.onSpeechStart(startedAt),
      onSpeechEnd: (lastVoiceAt, durationMs) => void conversation.onSpeechEnd(lastVoiceAt, durationMs),
      onShortPause: () => conversation.onShortPause(),
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
    this.engine.notify({ type: 'reset', reason });
    this.silences.reset();
    this.carried = '';
    this.preroll = [];
    this.prerollSamples = 0;
    this.capturing = false;
    this.transcriber?.clear();
    if (this.revealed || this.nextId > 0) log(`nouvel entretien (${reason}) : historique effacé, l’ouverture sera rejouée`);
    this.revealed = false;
    this.reminderPending = false;
    this.openingPlays = 0;
    this.spoken.length = 0;
    if (this.bargeIn) clearInterval(this.bargeIn.timer);
    this.bargeIn = null;
    this.updateState(reason);
  }

  /**
   * Pause demandée par l'utilisateur (popup ou bouton de la page) : réponse en cours abandonnée,
   * voix coupée, prise de parole en cours oubliée. clickAt : Date.now du clic.
   */
  pause(clickAt: number) {
    if (this.paused) return;
    this.interrupt('pause demandée par l’utilisateur');
    // Même sans réponse en cours : coupe le retour audio et ce que la page jouerait encore.
    this.link.stop();
    this.playhead = 0;
    this.paused = true;
    if (this.bargeIn) clearInterval(this.bargeIn.timer);
    this.bargeIn = null;
    this.capturing = false;
    this.preroll = [];
    this.prerollSamples = 0;
    this.carried = '';
    this.transcriber?.clear();
    this.vad.reset();
    this.engine.notify({ type: 'pause', at: clickAt });
    this.updateState('pause demandée');
    log(`pause : pipeline d’écoute arrêté ${Date.now() - clickAt} ms après le clic (son du recruteur ignoré, aucune réponse)`);
  }

  /** Reprise : la prochaine réponse commence par le rappel court de la révélation (règle 2). */
  resume(clickAt: number) {
    if (!this.paused) return;
    this.paused = false;
    // Révélation jamais entendue : l'ouverture complète est encore à venir, pas besoin de rappel.
    if (this.revealed) this.reminderPending = true;
    this.engine.notify({ type: 'resume', at: clickAt });
    this.updateState('reprise');
    log(
      `reprise ${Date.now() - clickAt} ms après le clic : ` +
        (this.revealed ? 'rappel court de la révélation avant la prochaine réponse' : 'ouverture complète toujours à venir'),
    );
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
  private audioLogged = false;

  onAudio(samples: Int16Array, receivedAt: number) {
    if (this.paused) return;
    if (!this.audioLogged) {
      this.audioLogged = true;
      logVad(
        `premier bloc du recruteur donné au VAD et à la transcription : entrée ${samples.length} échantillons à ${STT_SAMPLE_RATE} Hz, ` +
          `VAD ${Math.floor(samples.length * (VAD_SAMPLE_RATE / STT_SAMPLE_RATE))} à ${VAD_SAMPLE_RATE} Hz, transcription ${STT_SAMPLE_RATE} Hz`,
      );
    }
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

  /** Révélation (complète ou rappel après une pause) encore à faire entendre. */
  private get openingPending(): boolean {
    return !this.revealed || this.reminderPending;
  }

  /** Ouverture envoyée à la page et pas encore entendue en entier (lecture commencée ou imminente). */
  private get inOpening(): boolean {
    const response = this.current;
    return Boolean(response?.includesOpening && response.openingSent && this.openingPending && !response.answerSent);
  }

  private onSpeechStart(startedAt: number) {
    this.speechStartedAt = startedAt;
    this.updateState('le recruteur parle');
    const opening = this.inOpening;
    if (this.avatarSpeakingSince !== null || opening) {
      // Garde-fou : la voix de l'avatar ne doit jamais revenir dans le son capturé.
      logVad(
        `ALERTE : parole détectée pendant que l'avatar parle (${
          this.avatarSpeakingSince === null ? 'ouverture envoyée, lecture pas encore signalée' : `${Date.now() - this.avatarSpeakingSince} ms après le début de sa voix`
        }). ` +
          'Soit le recruteur lui coupe la parole, soit la voix de l’avatar revient dans le son capturé ' +
          '(micro de B sans casque, ou haut-parleurs de A et B dans la même pièce). Si cela arrive à chaque réponse, c’est un écho.',
      );
      // Seuil d'interruption : l'avatar ne s'arrête que si la parole dure vraiment (temps de
      // parole mesuré par le VAD, hors silence d'attente) ; un écho bref ou un bruit ne le coupe pas.
      const threshold = opening ? Math.max(this.config.bargeInMs, OPENING_BARGE_IN_MS) : this.config.bargeInMs;
      const bargeIn = {
        confirmed: false,
        threshold,
        timer: setInterval(() => {
          if (this.vad.speechMs < threshold) return;
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
    if (this.paused) return;
    this.capturing = false;
    const bargeIn = this.bargeIn;
    this.bargeIn = null;
    if (bargeIn && !bargeIn.confirmed) {
      clearInterval(bargeIn.timer);
      this.transcriber?.clear();
      this.updateState('parole brève par-dessus l’avatar ignorée');
      logVad(
        `parole de ${Math.round(durationMs)} ms par-dessus l’avatar, sous le seuil d’interruption (${bargeIn.threshold} ms` +
          `${bargeIn.threshold > this.config.bargeInMs ? ', relevé pendant l’ouverture' : ''}) : ignorée (écho, bruit ou bref acquiescement)`,
      );
      return;
    }
    const endDetectedAt = Date.now();
    const transcript = this.transcribe(endDetectedAt).then((text) => {
      if (this.paused) return '';
      if (!this.isEcho(text)) return text;
      logStt(`transcription reprenant les mots de l’avatar : écho ignoré (« ${text} »)`);
      return '';
    });

    if (!this.micReady) {
      if (!this.waitingForMicLogged) {
        this.waitingForMicLogged = true;
        log('le recruteur a parlé, mais la plateforme n’a pas encore demandé le micro : ouverture et réponse en attente');
      }
      this.updateState('fin de la question, micro de la plateforme pas encore prêt');
      this.carried = join(this.carried, await transcript);
      return;
    }

    if (this.paused) return;
    const response = this.startResponse(lastVoiceAt);
    this.updateState('fin de la question : transcription et réponse');
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
      this.updateState('aucune question à traiter');
      return;
    }
    // Simple salutation au premier tour : l'ouverture sert de réponse, rien n'est demandé au LLM.
    if (response.includesOpening && isGreetingOnly(question)) {
      transcriptLine('Recruteur', question, this.speechStartedAt);
      log(`salutation seule (« ${question} ») : l’ouverture sert de réponse, tour non envoyé au LLM`);
      await opening;
      response.finished = true;
      this.updateState('salutation : ouverture seule');
      return;
    }
    await this.answer(response, question, opening);
  }

  private interrupt(reason: string) {
    const response = this.current;
    if (!response) return;
    // Révélation (ou rappel après une pause) déjà entendue en entier avant la coupure : elle ne sera pas rejouée.
    if (response.includesOpening && this.openingPending && response.playbackStartedAt !== undefined) {
      const reminder = this.revealed;
      const neededMs = reminder ? this.shortDisclosureMs : this.disclosureMs;
      const what = reminder ? 'rappel de la révélation' : 'révélation';
      const heardMs = Date.now() - response.playbackStartedAt;
      if (heardMs >= neededMs + HEARD_MARGIN_MS) {
        this.markRevealed();
        logTts(
          `${what} entendu(e) en entier avant l’interruption (${Math.round(heardMs)} ms de lecture, ${what} ${Math.round(neededMs)} ms) : ` +
            'pas rejoué(e)',
        );
      } else {
        logTts(`${what} coupé(e) après ${Math.round(heardMs)} ms sur ${Math.round(neededMs)} ms : rejoué(e) au tour suivant`);
      }
    }
    response.controller.abort();
    this.link.stop();
    this.playhead = 0;
    this.avatarSpeakingSince = null;
    this.current = null;
    this.updateState(`réponse interrompue : ${reason}`);
    // Pas encore de réponse entendue : la question sera reprise avec la suite du recruteur.
    if (!response.answerSent) this.carried = join(response.question, this.carried);
    log(`réponse ${response.id} interrompue : ${reason}`);
    this.logAnswer(response, true);
    this.logSilences(response, true);
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
      includesOpening: this.openingPending,
      openingSent: false,
      played: false,
      answerSent: false,
      finished: false,
      spoken: [],
      transcriptLogged: false,
      timings: {},
      pieces: [],
      scheduled: 0,
      silencesLogged: false,
    };
    this.current = response;
    return response;
  }

  /**
   * Révélation puis messageText, déjà synthétisés. Coupée avant la fin de la révélation, elle
   * est rejouée une fois ; ensuite seulement (écho probable), un rappel court de la révélation
   * précède les réponses. Jamais de rappel dans la première réponse.
   */
  private async sendOpening(response: Response) {
    let audio: SpeechAudio[];
    let text: string;
    let texts: string[];
    if (this.revealed) {
      // Reprise après une pause : la révélation complète a déjà été entendue, le rappel court suffit.
      audio = [await this.shortDisclosureAudio];
      text = shortDisclosureText(this.config);
      texts = [text];
      this.remember(text);
      log(`reprise après une pause : rappel court de la révélation (réponse ${response.id})`);
    } else if (this.openingPlays < MAX_OPENING_PLAYS) {
      audio = await this.openingAudio;
      text = this.opening;
      texts = this.openingTexts;
      this.openingPlays += 1;
      this.remember(this.opening);
      log(
        `ouverture jouée (réponse ${response.id}, ${this.openingPlays === 1 ? 'première fois' : 'rejouée une fois, dernière'}) : ` +
          `révélation${this.config.messageText ? ' puis message' : ''}`,
      );
    } else {
      audio = [await this.shortDisclosureAudio];
      text = shortDisclosureText(this.config);
      texts = [text];
      this.remember(text);
      log(`ouverture déjà coupée ${MAX_OPENING_PLAYS} fois : rappel court de la révélation (réponse ${response.id})`);
    }
    // Ouverture préparée d'avance : texte et audio prêts dès maintenant.
    const readyAt = Date.now();
    for (const [index, chunk] of audio.entries()) {
      if (response.controller.signal.aborted) return;
      const pieceText = texts[index] ?? text;
      // Mêmes pauses régulières que les réponses (lib/speech-pacing.ts).
      this.send(response, paceSpeech(chunk, pauseAfter(pieceText)), { kind: 'ouverture', text: pieceText, textReadyAt: readyAt, synthStartAt: readyAt, synthEndAt: readyAt });
    }
    response.openingSent = true;
    transcriptLine('Avatar', text);
  }

  private async answer(response: Response, question: string, opening: Promise<void>) {
    const { signal } = response.controller;
    const { questionEndAt } = response;
    transcriptLine('Recruteur', question, this.speechStartedAt);
    // Morceaux de la réponse : synthèse dès que le texte est écrit, envoi dans l'ordre après l'ouverture, attente avant
    // de jouer si les suivants risquent d'arriver en retard (lib/speech-queue.ts).
    const queue = new SpeechQueue({
      pool: this.voice,
      signal,
      playhead: () => this.playhead,
      log: (line) => logTts(line),
      send: (audio, piece) => {
        if (!this.send(response, audio, { kind: 'réponse', ...piece })) return false;
        response.answerSent = true;
        response.answerStartedAt ??= Date.now();
        response.spoken.push(piece.text);
        this.remember(piece.text);
        return true;
      },
    });
    const speaker = queue.play(opening);

    let buffer = '';
    let words = 0;
    const take = (final: boolean) => {
      const [ready, rest] = takeChunks(buffer, words, final);
      buffer = rest;
      words += ready.reduce((sum, chunk) => sum + chunk.split(/\s+/).length, 0);
      return ready;
    };
    try {
      // Texte du moteur en flux, à n'importe quel grain : découpé ici en phrases pour la voix (lib/chunks.ts).
      for await (const fragment of this.engine.reply({ text: question, startedAt: this.speechStartedAt, endedAt: questionEndAt }, signal)) {
        if (signal.aborted) break;
        if (response.timings.firstToken === undefined) {
          response.timings.firstToken = Date.now() - questionEndAt;
          log(`premier mot reçu ${response.timings.firstToken} ms après la fin de la question`);
        }
        buffer += fragment;
        for (const text of take(false)) queue.push(text);
      }
      if (!signal.aborted) for (const text of take(true)) queue.push(text);
    } catch (error) {
      if (!signal.aborted) log(`erreur : ${error instanceof Error ? error.message : String(error)} (moteur ${this.engine.description})`);
    } finally {
      queue.end();
    }
    await speaker;
    response.finished = true;
    this.updateState(signal.aborted ? 'réponse abandonnée' : 'réponse entièrement envoyée');
    this.logAnswer(response, signal.aborted);
  }

  /** Ligne « Avatar : … » de la transcription (sous-titres), une fois par réponse. */
  private logAnswer(response: Response, interrupted: boolean) {
    if (response.transcriptLogged || response.spoken.length === 0) return;
    response.transcriptLogged = true;
    transcriptLine('Avatar', response.spoken.join(' ') + (interrupted ? ' […] (interrompu)' : ''), response.answerStartedAt);
  }

  private send(response: Response, audio: SpeechAudio, info: PieceInfo): boolean {
    // Pendant le seuil d'interruption, l'avatar continue : la parole entendue peut être un écho.
    if (this.vad.isSpeaking && !this.bargeIn) {
      this.interrupt('le recruteur parle');
      return false;
    }
    if (response.timings.firstAudio === undefined) response.timings.firstAudio = Date.now() - response.questionEndAt;
    if (response.sentAt === undefined) {
      response.sentAt = Date.now();
      setTimeout(() => {
        if (response.played || response.controller.signal.aborted || this.current !== response) return;
        response.playbackTimedOut = true;
        this.updateState(`voix envoyée à la page mais jamais jouée après ${PLAYBACK_START_TIMEOUT_MS} ms (réponse ${response.id})`);
      }, PLAYBACK_START_TIMEOUT_MS);
    }
    this.link.speak(response.id, audio, info.text);
    const duration = (audio.samples.length / audio.sampleRate) * 1000;
    // Comme la page : à la suite de la voix en cours, sinon dès l'arrivée (pont et avance de lecture : ≈ 100 ms).
    this.playhead = Math.max(Date.now() + 100, this.playhead) + duration;
    response.pieces.push({
      ...info,
      sentAt: Date.now(),
      durationMs: (audio.samples.length / audio.sampleRate) * 1000,
      ...measureSilence(audio.samples, audio.sampleRate),
    });
    return true;
  }

  /** La page a programmé un morceau de voix : heures réelles de sa lecture, dans l'ordre d'envoi. */
  onPlaybackChunk(responseId: number, startAt: number, endAt: number) {
    const response = this.current?.id === responseId ? this.current : null;
    const piece = response?.pieces[response.scheduled];
    if (!response || !piece) return;
    response.scheduled += 1;
    piece.playStartAt = startAt;
    piece.playEndAt = endAt;
    this.playhead = Math.max(this.playhead, endAt);
  }

  /** Silences de la réponse (plus long, cause) et résumé de l'entretien, une fois par réponse. */
  private logSilences(response: Response, interrupted: boolean) {
    if (response.silencesLogged || response.scheduled === 0) return;
    response.silencesLogged = true;
    const junctions = analyzePieces(response.pieces);
    this.silences.add(junctions);
    logTts(describeResponse(`la réponse ${response.id}`, response.pieces, junctions, interrupted));
    logTts(this.silences.describe());
  }

  /** État courant de l'avatar (renvoyé à la page à chaque connexion du pont). */
  get state(): AvatarState {
    return this.avatarState;
  }

  /**
   * Déduit l'état de l'avatar de la conversation et le transmet s'il a changé. Priorités : pause,
   * voix de l'avatar en cours (même si le recruteur parle par-dessus, tant que l'interruption n'est
   * pas confirmée), recruteur qui parle, réponse en préparation (ou entre deux phrases déjà jouées), inactif.
   * Une réponse entièrement envoyée mais pas encore jouée reste « en réflexion » jusqu'au début réel de la
   * lecture, au plus PLAYBACK_START_TIMEOUT_MS après le premier envoi.
   */
  private updateState(reason: string) {
    const response = this.current;
    let next: AvatarState;
    if (this.paused) next = 'pause';
    else if (this.avatarSpeakingSince !== null) next = 'parole';
    else if (this.vad?.isSpeaking) next = 'ecoute';
    else if (response && !response.finished) next = response.played ? 'parole' : 'reflexion';
    else if (response && response.sentAt !== undefined && !response.played && !response.playbackTimedOut) next = 'reflexion';
    else next = 'inactif';
    if (next === this.avatarState) return;
    const previous = this.avatarState;
    this.avatarState = next;
    logState(`${previous} → ${next} (${reason})`);
    this.link.state(next, previous, reason);
  }

  /** Courte pause du recruteur (VAD) : hochement si l'avatar écoute. */
  private onShortPause() {
    if (this.avatarState !== 'ecoute' || Date.now() - this.lastNodAt < NOD_MIN_GAP_MS) return;
    this.lastNodAt = Date.now();
    this.link.nod();
  }

  private markRevealed() {
    this.revealed = true;
    this.reminderPending = false;
  }

  /** La page a commencé à jouer la réponse : c'est la latence perçue par le recruteur. */
  onPlaybackStarted(responseId: number, at: number) {
    const response = this.current;
    if (response?.id !== responseId) return;
    this.avatarSpeakingSince = at;
    response.playbackStartedAt ??= at;
    this.updateState('début de la lecture de la voix');
    if (response.played) return;
    response.played = true;
    const { transcript, firstToken, firstAudio } = response.timings;
    logTts(
      `LATENCE fin de question → début de réponse : ${at - response.questionEndAt} ms ` +
        `(seuil de silence ${this.config.silenceMs} ms inclus ; transcription ${transcript ?? '-'} ms, ` +
        `premier mot ${firstToken ?? '-'} ms, première phrase prête ${firstAudio} ms)` +
        (response.includesOpening ? ' — ouverture avec révélation' : ''),
    );
  }

  /** La page n'a plus rien à jouer. */
  onPlaybackIdle(responseId: number) {
    const response = this.current;
    if (response?.id !== responseId) return;
    this.avatarSpeakingSince = null;
    if (response.includesOpening && response.openingSent && this.openingPending) {
      logTts(
        this.revealed
          ? 'rappel de la révélation entièrement prononcé (après la pause)'
          : 'révélation entièrement prononcée (elle ne sera plus jouée dans cet entretien, sauf rappel après une pause)',
      );
      this.markRevealed();
    }
    if (response.finished) {
      this.current = null;
      this.logSilences(response, false);
    }
    this.updateState('fin de la lecture de la voix');
  }
}

const join = (...parts: string[]) => parts.filter(Boolean).join(' ').trim();

function splitSentences(text: string): string[] {
  return takeChunks(text, Infinity, true)[0];
}

/**
 * Transcription lisible de l'entretien (sous-titres), dans la console du document
 * offscreen seulement : « HH:MM:SS.mmm Recruteur : … » / « … Avatar : … ».
 */
function transcriptLine(speaker: 'Recruteur' | 'Avatar', text: string, at = Date.now()) {
  if (text.trim()) console.log(`${clock(at)} ${speaker} : ${text.trim()}`);
}
