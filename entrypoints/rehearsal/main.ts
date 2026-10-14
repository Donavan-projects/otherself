// Faux recruteur : banc d'essai du pipeline. Demande caméra + micro comme une
// plateforme d'entretien, affiche le flux reçu et lit les questions à voix haute.

const QUESTION_KEYS = ['question1', 'question2', 'question3', 'question4', 'question5'] as const;
const VOICES_TIMEOUT_MS = 1000;

type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

const t = (key: MessageKey, substitutions?: string[]) => browser.i18n.getMessage(key, substitutions);

const video = document.querySelector<HTMLVideoElement>('#candidate')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const nextButton = document.querySelector<HTMLButtonElement>('#next')!;
const progressEl = document.querySelector<HTMLParagraphElement>('#progress')!;
const questionEl = document.querySelector<HTMLParagraphElement>('#question')!;
const logsEl = document.querySelector<HTMLPreElement>('#logs')!;

const questions = QUESTION_KEYS.map((key) => t(key));
const speechLang = t('speechLang');

let questionIndex = -1;
// Référence conservée : Chrome peut libérer une utterance en cours de lecture
// et ne jamais émettre son événement `end`.
let currentUtterance: SpeechSynthesisUtterance | null = null;

function log(message: string) {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  const line = `[rehearsal] ${clock} (+${Math.round(performance.now())} ms) ${message}`;
  console.log(line);
  logsEl.textContent += `${line}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function describeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function watchTrack(track: MediaStreamTrack) {
  const settings = track.getSettings();
  const details =
    track.kind === 'video'
      ? `${settings.width}x${settings.height} @ ${settings.frameRate} fps`
      : `${settings.sampleRate} Hz, ${settings.channelCount} canal(aux)`;
  log(`piste ${track.kind} reçue : « ${track.label} » (${details})`);
  track.addEventListener('ended', () => log(`piste ${track.kind} terminée`));
  track.addEventListener('mute', () => log(`piste ${track.kind} muette`));
  track.addEventListener('unmute', () => log(`piste ${track.kind} réactivée`));
}

async function requestMedia() {
  log('getUserMedia({ video, audio }) demandé');
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  log('getUserMedia accordé');
  stream.getTracks().forEach(watchTrack);
  // L'élément <video> est muet : on affiche le flux sans rejouer le micro (larsen).
  video.srcObject = stream;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  // Chrome charge la liste des voix de façon asynchrone.
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, VOICES_TIMEOUT_MS);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

async function pickVoice() {
  const voices = await loadVoices();
  const prefix = speechLang.slice(0, 2);
  const voice =
    voices.find((candidate) => candidate.lang.replace('_', '-') === speechLang) ??
    voices.find((candidate) => candidate.lang.startsWith(prefix));
  if (voices.length === 0) {
    log('synthèse vocale : aucune voix installée, les questions resteront silencieuses');
  } else if (!voice) {
    log(`synthèse vocale : aucune voix ${speechLang} parmi ${voices.length}, voix par défaut utilisée`);
  }
  return voice;
}

async function speak(text: string, number: number) {
  // Interrompt la question précédente si elle est encore en cours de lecture.
  speechSynthesis.cancel();
  const voice = await pickVoice();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLang;
  if (voice) utterance.voice = voice;
  utterance.addEventListener('start', () => {
    log(`question ${number} : début de lecture (voix « ${utterance.voice?.name ?? 'par défaut'} »)`);
  });
  utterance.addEventListener('end', (event) => {
    log(`question ${number} : fin de lecture (${Math.round(event.elapsedTime)} ms)`);
    if (number === questions.length) log(t('rehearsalDone'));
  });
  utterance.addEventListener('error', (event) => {
    log(`question ${number} : lecture interrompue (${event.error})`);
  });
  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

function askNextQuestion() {
  const question = questions[questionIndex + 1];
  if (question === undefined) return;
  questionIndex += 1;
  const number = questionIndex + 1;
  progressEl.textContent = t('rehearsalProgress', [String(number), String(questions.length)]);
  questionEl.textContent = question;
  nextButton.disabled = number === questions.length;
  log(`question ${number}/${questions.length} : « ${question} »`);
  void speak(question, number);
}

function localize() {
  document.title = `${t('extName')} · ${t('rehearsalTitle')}`;
  document.documentElement.lang = speechLang.slice(0, 2);
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n as MessageKey);
  }
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  try {
    await requestMedia();
  } catch (error) {
    log(`getUserMedia refusé : ${describeError(error)}`);
    startButton.disabled = false;
    return;
  }
  askNextQuestion();
});

nextButton.addEventListener('click', askNextQuestion);

video.addEventListener('loadedmetadata', () => {
  log(`vidéo affichée : ${video.videoWidth}x${video.videoHeight}`);
});

localize();
log(`page prête (langue des questions : ${speechLang})`);
