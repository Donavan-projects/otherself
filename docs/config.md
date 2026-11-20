# Configuration locale (démo)

Pour la démo, les données personnelles sont lues depuis `config.local.json`, à la racine du projet. Ce fichier et le dossier `local/` sont ignorés par git : ils ne sont jamais commités.

```
cp config.example.json config.local.json
mkdir -p local
```

Les chemins sont relatifs à la racine du projet. Les fichiers sont copiés dans le build sous `local/`, avec un `local/config.json` qui les référence : après toute modification de `config.local.json` ou des fichiers qu'il désigne, relancer `npm run dev` ou `npm run build`.

> **Clé API** : `openaiApiKey` est recopiée dans `.output/…/local/config.json` (ignoré par git, jamais accessible aux pages web ni transmise à la page de la plateforme). Ne partagez pas le dossier `.output` ni un zip du build.

> **Logs du pipeline voix** : ils s'affichent dans la console du document offscreen (`chrome://extensions` → OtherSelf, mode développeur → « Inspecter les vues : offscreen.html »), avec la transcription `Recruteur : …` / `Avatar : …`. Ce document n'existe qu'après l'activation sur un onglet : le lien `offscreen.html` n'apparaît qu'en rechargeant la page `chrome://extensions` après avoir cliqué sur « Activer sur cet onglet ».

| Champ | Valeurs | Rôle | Si absent |
| --- | --- | --- | --- |
| `background` | nom de fichier | Fond : `avatar/fonds/<background>.svg` | `atrium` (autres fonds : `bureau-clair`, `bureau`, `interieur-clair`) |
| `avatarRenderer` | `vrm` / `fallback` | Rendu de l'avatar. `vrm` : modèle 3D `avatar/otherself.vrm` (VRoid), animé en WebGL, plan serré, marqueur IA (marquage et voyant de la languette du col) ; sans accélération graphique (rendu WebGL logiciel) ou en cas d'échec, l'avatar de secours prend le relais automatiquement. `fallback` : avatar de secours seul (images rendues à l'avance depuis le modèle 3D : bouche, yeux, voyant et marquage animés, sans respiration ni mouvement de tête), utile pour le vérifier ; `svg`, ancien nom, est accepté. Les anciens champs `avatar`, `palette`, `hairstyle` et `accessories` (personnage SVG, retiré) sont ignorés, avec un avertissement au build | `vrm` |
| `badgeText` | texte court | Marquage imprimé sur la veste de l'avatar à côté du voyant d'état (règle 1), en lettres pleines ; 12 caractères au plus | « IA » si `language` vaut `fr`, sinon « AI » (un texte vide est aussi remplacé) |
| `language` | `en`, `fr` | Langue de l'entretien : transcription, réponses du LLM, phrase de révélation | `en` |
| `candidateName` | texte | Prénom ou nom du candidat : l'avatar parle de lui à la troisième personne (« Alex a travaillé… »), et se présente comme « l'avatar IA qui représente Alex » | « the candidate » / « le candidat » |
| `avatarName` | texte | Nom de l'avatar, dit dans la révélation et le rappel court (« I'm Nova, an AI avatar representing Alex… ») et quand on lui demande s'il est humain ; lettres, espaces, apostrophes et tirets, 30 caractères au plus. `""` : avatar sans nom (« I am an AI avatar representing Alex… »). Jamais le nom du candidat : l'avatar ne se fait pas passer pour lui ; dans ce cas, avertissement au build et nom par défaut | `Nova` |
| `pronunciations` | objet | Prononciation pour la voix Piper seulement : mot → graphie phonétique, remplacé dans le texte envoyé à la synthèse (mots entiers, sans tenir compte de la casse), jamais dans le texte du LLM ni dans la transcription. Complète les défauts ; une graphie vide retire un défaut. Lettres, chiffres, espaces, apostrophes, points et tirets, 40 caractères au plus. Exemple : `{ "Donavan": "Donnavan", "Loupe": "Loop" }`. Comparer des graphies à l'oreille : page `voices.html?prononcer=Nova:Nohvuh,Nohvaa,Noh-vah` (colonne Phonèmes : transcription d'eSpeak NG reçue par la voix ; deux graphies qui donnent les mêmes phonèmes sonnent pareil). La voix OpenAI lit l'orthographe elle-même : le dictionnaire ne lui est pas appliqué | `{ "Nova": "Nohvuh" }` |
| `messageText` | texte | Mode « message » : déclaration prononcée juste après la révélation, avant de répondre aux questions | Révélation seule |
| `cv` | md, txt | CV et notes du candidat, seule source des réponses (règle 5) ; modèle conseillé : [profil.md](profil.md) (une histoire par expérience clé : contexte, rôle, actions, résultat chiffré) | Avertissement au build ; l'avatar dit ne pas pouvoir répondre |
| `openaiApiKey` | `sk-…` | Clé OpenAI (transcription et LLM) | Pipeline voix inactif, avertissement au build |
| `voice` | identifiant Piper | Voix Piper de l'avatar : modèle téléchargé une seule fois depuis Hugging Face (aucune donnée de l'entretien ni du candidat envoyée), puis synthèse en local dans le navigateur (voir ci-dessous) | `en_US-norman-medium` |
| `ttsProvider` | `piper`, `openai` | Synthèse vocale : Piper (local, gratuit) ou OpenAI (même clé, payante, en streaming) | `piper` |
| `openaiVoice` | voix OpenAI | Voix de la synthèse OpenAI (`ash`, `onyx`…) | `ash` |
| `openaiTtsModel` | modèle OpenAI | Modèle de synthèse OpenAI | `gpt-4o-mini-tts` |
| `piperScales` | objet | Réglages Piper : `lengthScale` (débit, plus petit = plus rapide), `noiseScale` (variation de l'intonation), `noiseW` (variation du rythme). Comparer au banc d'essai des voix (popup) | `{ "lengthScale": 0.92, "noiseScale": 0.8, "noiseW": 1 }` |
| `pitchSemitones` | −6 à +6 | Hauteur de la voix Piper, en demi-tons, sans changer le débit : synthèse avec un `length_scale` × 2^(n/12), rejouée 2^(n/12) fois plus vite (micro injecté et retour audio ; la bouche suit le son joué). À comparer à l'écoute au banc d'essai (`voix~1.5`) | `1.5` |
| `monitorAvatar` | `true` / `false` | Retour audio : vous entendez la voix de l'avatar, jouée par l'extension hors de l'onglet de l'entretien (elle n'est donc jamais prise pour le recruteur) | Activé |
| `monitorVolume` | 0 à 1 | Volume du retour audio | `0.8` |
| `previewWindow` | `true` / `false` | Bouton « Aperçu de l'avatar » du popup, pour le tournage : fenêtre Picture-in-Picture montrant le flux vidéo envoyé à la plateforme, à l'endroit et sans son. `false` masque le bouton | Activé |
| `silenceMs` | millisecondes | Silence après lequel le recruteur est considéré comme ayant fini sa question | `800` |
| `bargeInMs` | millisecondes | Parole continue du recruteur par-dessus la voix de l'avatar nécessaire pour l'interrompre. En dessous, la prise de parole est ignorée (écho ou bruit probable) | `600` |
| `sttModel` | modèle OpenAI | Transcription en flux (session Realtime) | `gpt-live-transcribe` |
| `llmModel` | modèle OpenAI | Réponses en streaming, sans raisonnement. Par défaut depuis le 20/11 : premier mot en 0,6 à 2,0 s en entretien (médiane 0,9 s), qualité égale à `gpt-5.6-luna` au banc du prompt, prix plus bas (le 28/10, son premier mot variait de 1 à 14 s) | `gpt-6-luna` |
| `testAudio` | mp3, ogg, wav, webm, m4a | Banc d'essai `rehearsal?inject` uniquement : son joué en boucle par le micro injecté | Bip de 440 Hz chaque seconde |

## Voix

Licences vérifiées pour une vidéo publiée. Vitesse mesurée en WebAssembly sur la machine de référence (ordinateur portable de 2015, processeur 4 cœurs, 16 Go, sans carte graphique utilisable), en temps de synthèse rapporté à la durée de l'audio (moins de 1 = plus rapide que le temps réel) :

| Voix | Genre | Licence du jeu de données | Vitesse |
| --- | --- | --- | --- |
| `en_US-ljspeech-medium` | féminine | domaine public (LJ Speech) | ≈ 0,35 |
| `en_US-joe-medium` | masculine | CC0 pour le jeu `joe`, mais voix **affinée à partir de `lessac`** (jeu Lessac, licence Blizzard 2013, recherche) : **à éviter pour toute publication** | ≈ 0,2 |
| `en_US-norman-medium` | masculine | domaine public (LibriVox), entraînée de zéro : **voix masculine la plus sûre pour une vidéo publiée** | non mesurée (même taille que joe) |
| `en_US-john-medium` | masculine | domaine public (LibriVox), affinée à partir de `kristin` (LibriVox) | non mesurée (même taille que joe) |
| `en_US-ljspeech-high` | féminine | domaine public | 1,25 à 2,7 : **trop lente** pour répondre en direct |

À éviter pour une vidéo publiée : `en_US-ryan-*` et `en_US-hfc_*` (CC BY-NC-SA, usage non commercial), `en_US-lessac-*` (licence Blizzard 2013, recherche).

Depuis l'étape 4, `testAudio` ne sert plus sur la plateforme : le micro injecté porte la voix générée.
