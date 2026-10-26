// Première prise de parole réduite à une salutation (« Hello. », « Bonjour à tous ») :
// l'ouverture y répond, le tour n'est pas envoyé au LLM.

const GREETING_WORDS = new Set([
  // en
  'hello', 'hi', 'hey', 'hiya', 'howdy', 'greetings', 'welcome', 'good', 'morning', 'afternoon', 'evening', 'day',
  'there', 'everyone', 'everybody', 'all', 'and', 'nice', 'to', 'meet', 'you', 'thanks', 'thank', 'for', 'joining',
  'okay', 'ok', 'so',
  // « how are you (doing) today? », « how's it going? »
  'how', 'are', "how's", 'it', 'going', 'doing', 'today',
  // fr
  'bonjour', 'bonsoir', 'salut', 'coucou', 'allô', 'allo', 'bienvenue', 'à', 'a', 'tous', 'toutes', 'et', 'merci',
  "d'être", 'être', 'là', 'enchanté', 'enchantée', 'madame', 'monsieur',
  // « comment allez-vous ? », « ça va ? »
  'comment', 'allez', 'vous', 'ça', 'ca', 'va',
]);
/** Au moins un de ces mots : sans lui, ce n'est pas une salutation (« thank you », « okay »…). */
const GREETING_CORE = new Set(['hello', 'hi', 'hey', 'hiya', 'howdy', 'greetings', 'welcome', 'morning', 'afternoon', 'evening',
  'bonjour', 'bonsoir', 'salut', 'coucou', 'allô', 'allo', 'bienvenue']);
const MAX_GREETING_WORDS = 8;

export function isGreetingOnly(text: string): boolean {
  const words = text.toLowerCase().replace(/’/g, "'").match(/[\p{L}']+/gu) ?? [];
  return (
    words.length > 0 &&
    words.length <= MAX_GREETING_WORDS &&
    words.every((word) => GREETING_WORDS.has(word)) &&
    words.some((word) => GREETING_CORE.has(word))
  );
}
