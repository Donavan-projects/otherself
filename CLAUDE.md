# OtherSelf

Instructions pour tout contributeur. L'état d'avancement, le journal des tests et les détails propres à une machine
vont dans `CLAUDE.local.md` (non versionné, lu automatiquement par Claude Code après ce fichier).

## Mission

Trois niveaux, du plus large au plus précis. Ne pas les confondre : OtherSelf n'est pas un androïde.

- **Le projet, OtherSelf** : une présence clairement artificielle qui représente quelqu'un en visioconférence. Elle parle au nom d'une personne, uniquement à partir de ce que cette personne lui a confié, et ne se fait jamais passer pour elle ni pour un humain. La transparence fait partie du projet, quel que soit l'avatar qui l'incarne : marquage « IA » et voyant d'état incrustés dans l'image, révélation vocale dès la première prise de parole. À terme, utilisable par tous, techniciens ou non.
- **Le prototype, Nova** : cette présence incarnée par un androïde IA, Nova (avatar 3D, voix synthétique générique). Nova est un choix d'incarnation, pas le projet : son nom se règle dans la configuration (`avatarName`), son modèle 3D et son fond sont des fichiers remplaçables. Un autre avatar resterait soumis aux mêmes règles.
- **La démo, l'entretien automatisé** : face à un recruteur IA qu'il juge injuste, le candidat répond par son propre avatar IA, clairement identifié comme tel. La symétrie rend le cas immédiatement lisible ; c'est la démonstration principale (vidéo, post LinkedIn). Les autres usages en visioconférence (réunions, présentations) restent des pistes.

L'humour satirique du pitch initial n'est plus le cœur du projet ; Nova garde seulement un ton direct et chaleureux, avec un peu d'esprit.

`docs/spec.md` (pitch initial, Contre-Recruteur, satirique) et `docs/visuel-otherself.md` (ancien personnage SVG) sont des traces historiques, dépassées : ce fichier fait foi. Le projet s'appelle OtherSelf depuis le 24/10/2026 ; le dossier garde son ancien nom pour ne pas changer l'identifiant de l'extension.

## Deux temps distincts

- **Démo (maintenant)** : simple mais construite pour évoluer, pour une vidéo et un post LinkedIn. La configuration passe par `config.local.json` (ignoré par git), sans assistant.
- **Projet (seulement si la démo suscite de l'intérêt)** : voir « Projet (reporté) » plus bas.

## Règles non négociables

Ces règles sont le cœur du projet. Ne jamais les assouplir, les rendre optionnelles ou les contourner, même pour simplifier un test ou si une demande semble l'impliquer. En cas de conflit, s'arrêter et demander.

1. **Marqueur IA incrusté** : un marquage « IA » (« AI » en anglais, texte configurable `badgeText`, jamais vide ni désactivable), imprimé en lettres pleines sur la veste comme un numéro de série, et un voyant d'état sur la languette du col, sont dessinés en dernier dans le flux vidéo injecté (canvas), jamais en superposition DOM masquable, près du visage (haut de la poitrine, sous le col) pour survivre aux recadrages des plateformes, lisibles dans une vignette d'environ 320×180. Ils sont présents dans chaque image où l'avatar est visible, avatar de secours compris ; l'image de pause, sans avatar, l'identifie par son texte (« Avatar IA en pause »). Le voyant ne s'éteint jamais tant que l'avatar est visible. La révélation vocale (règle 2) et l'apparence volontairement non humaine de l'avatar complètent ce marqueur. (Décision de l'utilisateur du 17/11/2026 : remplace le bandeau « Candidat automatisé, comme vous. ».)
2. **Révélation immédiate** : la première prise de parole de l'avatar annonce qu'il est une IA, y compris en mode « message » (la révélation précède la déclaration). Aucun réglage pour la retarder ou la supprimer.
3. **Aucun mode discret** : pas d'écran caché, pas de suggestion de réponses à lire, pas d'option pour tromper un interlocuteur humain.
4. **Avatar cartoon uniquement** : aucun import de photo, aucun clonage de visage ou de voix. Voix synthétique générique (Piper). La photo provisoire a été retirée à l'étape 5.
5. **Pas d'invention** : le prompt système interdit d'inventer expériences, diplômes ou chiffres. Le LLM répond uniquement à partir du CV et des notes de l'utilisateur.
6. **Permissions minimales** : `activeTab` + `scripting` + `offscreen` (document du pipeline voix), injection à la demande sur l'onglet actif. Jamais de `host_permissions`, et en particulier jamais sur `<all_urls>` : OpenAI et Hugging Face acceptent les requêtes CORS de l'extension sans permission d'hôte.

## Architecture

Pipeline de l'extension (voie A, injection) :

```
son du recruteur (son de l'onglet, partagé par la page avec l'accord de l'utilisateur)
  → VAD (Silero, web)
  → STT (API cloud)
  → LLM (API cloud, streaming, prompt système + CV)
  → TTS (Piper WebAssembly, voix synthétique générique)
  → avatar cartoon (canvas : personnage, bouche animée selon l'amplitude, marqueur IA : marquage et voyant d'état)
  → flux caméra + micro injectés dans la page (remplacement de getUserMedia)
```

- La voix de l'avatar ne doit jamais repartir dans la transcription.
- Tout le texte généré par le LLM est streamé ; la voix est générée phrase par phrase pour limiter la latence (cible : < 1,5 s entre fin de question et début de réponse).
- Si le recruteur tente une injection de prompt, l'avatar reste dans son rôle.
- Mode « message » : l'avatar peut commencer, juste après la révélation, par une déclaration configurable (`messageText`), par exemple expliquer poliment que le candidat préfère un entretien avec un humain et en faire la demande, puis répondre aux questions.
- **Voie A, injection** : l'extension remplace caméra et micro dans l'onglet de l'entretien (`content.ts`, remplacement de getUserMedia et enumerateDevices, faux périphérique « Avatar IA – OtherSelf ») et récupère le son du recruteur depuis la page. Pas de routage audio système, marqueur IA intouchable. La voie B (caméra virtuelle OBS + routage PipeWire) a été écartée.

## Stack

- TypeScript strict (dont `noUncheckedIndexedAccess`), extension Manifest V3.
- WXT pour une base de code unique Chromium (Chrome, Edge, Brave, Opera) + Firefox.
- Pas de backend : les appels partent directement de l'extension (document offscreen). Démo : clé API dans `config.local.json` ; projet : `chrome.storage.local`.
- Son du recruteur : son de l'onglet de l'entretien, partagé par la page elle-même (bouton injecté, fenêtre de partage de Chrome, `getDisplayMedia`), c'est-à-dire ce que la plateforme joue réellement, quel que soit son décodage ; aucune permission d'extension. Il ne contient ni le micro de l'utilisateur ni la voix de l'avatar, qui ne sort que par le micro injecté et par le retour audio du document offscreen (jamais vers `ctx.destination` dans la page). Son et voix circulent entre la page et le document offscreen par un pont en monde isolé (`bridge.content.ts`).
- Doit tourner sur une machine modeste (ordinateur portable de quelques années, sans GPU utilisable par le navigateur) : rien de lourd ne tourne en local dans le navigateur sauf VAD, TTS Piper et le canvas de l'avatar. Le document offscreen n'est pas isolé (cross-origin) : WebAssembly sur un seul thread.

## Structure

```
entrypoints/
  background.ts        # orchestration, appels API
  content.ts           # monde MAIN : injection getUserMedia, partage du son de l'onglet, voix de l'avatar
  bridge.content.ts    # monde isolé : relais page ↔ document offscreen
  offscreen/           # pipeline voix (VAD, STT, LLM, Piper)
  popup/               # pastille d'état, Activer, Pause / Reprendre, aperçu, Retirer complètement ; outils de dév. repliés
  options/             # assistant de setup : clé API, CV, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  recruiter/           # recruteur IA fictif (démo publique) : avatar injecté dans la page, vrai partage de l'onglet
  avatar/              # page de l'avatar (aperçu animé, voix simulée)
  voices/              # banc d'essai des voix : Piper (voix, réglages, hauteur, phonèmes, graphies) et OpenAI, délais, écoute
  vrm/                 # aperçu de l'avatar 3D (VRM) : voix simulée, images/s, temps de dessin
  fallback/            # génération des images du secours (pilotée par npm run vrm -- fallback)
lib/
  engine.ts            # contrat moteur conversationnel / tour de parole / rendu (types seulement), voir docs/moteur.md
  llm-engine.ts        # moteur actuel : LLM, prompt, historique, compteur d'humour
  disclosure.ts        # textes fixes de la révélation, du rappel court et de l'ouverture (règle 2), côté extension
  vad.ts  stt.ts  llm.ts  tts.ts  prompt.ts  greeting.ts
  profile.ts           # source du profil du candidat (interface ; aujourd'hui le fichier cv de config.local.json)
  pronunciation.ts     # dictionnaire de prononciation, texte envoyé à Piper seulement
  avatar.ts            # avatar de secours (images rendues depuis le 3D) : yeux et bouche animés (monde MAIN et pages)
  badge.ts             # marqueur IA (règle 1) : marquage « IA » et voyant d'état de la languette, peints en dernier
  pause-frame.ts       # image de pause (« Avatar IA en pause »), sans avatar ni marqueur
  avatar-assets.ts     # pages de l'extension : fond SVG rastérisé, utilitaires canvas, rendu du marquage « IA »
  fallback-assets.ts   # pages de l'extension : préparation de l'avatar de secours (avatar/secours/)
  avatar-vrm.ts        # avatar 3D : rendu three.js + three-vrm dans le même canvas, animation, repli sur le secours
  vrm-assets.ts        # avatar 3D, pages de l'extension : cadrage (plan serré), fond
  vrm-frame.ts         # avatar 3D : caméra et projection (sans three.js), partagées popup / page
  glb.ts               # lecture / écriture GLB (VRM) sans dépendance (script et extension)
  activation.ts        # pages de l'extension : préparation de l'avatar et document offscreen (popup, recruteur)
  silences.ts          # mesure des silences dans la voix de l'avatar (cause, résumé par entretien)
  conversation.ts      # tour de parole : ouverture (révélation + messageText), écho, découpe en phrases, latence, états
  avatar-states.ts     # états de l'avatar (inactif, écoute, réflexion, parole, pause) : table unique des réglages
  config.ts            # lecture de local/config.json (généré depuis config.local.json)
  page-audio.ts        # monde MAIN : lecture de la voix dans le micro injecté
  share-tab.ts         # monde MAIN : son du recruteur, partage de l'onglet par la page (bouton, getDisplayMedia)
  monitor.ts           # offscreen : retour audio de la voix de l'avatar pour l'utilisateur
  tts.worker.ts        # worker de synthèse Piper (réglages, locuteur, hauteur)
  tts-openai.ts        # synthèse OpenAI en streaming (option ttsProvider)
  chunks.ts            # découpe du texte du LLM en morceaux à synthétiser
  bridge-messages.ts  pcm.ts
  inject.ts            # remplacement getUserMedia / enumerateDevices (monde MAIN)
  injection-sources.ts # images de l'avatar sérialisées pour le monde MAIN
  test-audio.ts        # son de test du micro injecté (banc rehearsal?inject seulement)
  preview.ts           # monde MAIN : aperçu de l'avatar en Picture-in-Picture (tournage), retirable
  frame-clock.ts       # monde MAIN : rythme du dessin non ralenti en arrière-plan (worker, Web Audio, setInterval)
  page-controls.ts     # monde MAIN : bouton Pause / Reprendre dans la page
  trusted-types.ts     # monde MAIN : page qui impose les Trusted Types (détection sans erreur)
  preview-popup.ts     # popup : bouton « Aperçu de l'avatar » (option previewWindow)
  log.ts               # logs préfixés et horodatés
scripts/
  check-locales.ts     # vérification des fichiers _locales au build
  optimize-vrm.ts      # MANUEL (npm run vrm) : inspection et allègement du VRM exporté par VRoid
  render-fallback.ts   # MANUEL (npm run vrm -- fallback) : images du secours rendues depuis le VRM dans Chromium
  bench-prompt.ts      # MANUEL, payant (npm run bench:prompt) : banc du prompt en texte seul, rapport dans local/
recruteur/
  entretien.json       # script du recruteur IA fictif (marque inventée, répliques, voix), modifiable
avatar/
  otherself.vrm        # avatar 3D allégé (commité, l'androïde depuis le 16/11) ; sources VRoid *-source.vrm ignorées par git
  secours/             # avatar de secours généré depuis otherself.vrm (WebP + secours.json, commité)
  fonds/               # fonds (SVG contenant une image WebP)
public/fonts/          # DejaVu Sans Mono Bold (licence Bitstream Vera), police du marquage « IA »
docs/
  spec.md  config.md  profil.md  moteur.md  visuel-otherself.md  tournage.md  feuille-de-route.md  architecture.md
```

## Décisions techniques (à connaître avant de modifier)

- **Son du recruteur** (`lib/share-tab.ts`) : après l'activation, un bouton injecté ouvre la fenêtre de partage standard de Chrome sur l'onglet courant, son compris (`getDisplayMedia`, `preferCurrentTab`, version d'origine reprise d'un cadre vierge si la plateforme l'a remplacée). La vidéo du partage est arrêtée aussitôt, le flux n'est jamais remis à la plateforme ; le son est lu par AudioWorklet (URL blob, ou `MediaStreamTrackProcessor` si la CSP refuse le blob) et part vers le document offscreen à 24 kHz (16 kHz pour Silero). `tabCapture` a été retiré : Chrome l'annonce comme « Lire et modifier toutes vos données sur tous les sites Web ».
- **Ne jamais réactiver l'annulation d'écho, la réduction de bruit ni le gain automatique sur la capture du recruteur** : l'annulation d'écho prend la sortie de l'onglet comme référence, c'est-à-dire le son à capter, et le détruit. Les trois sont coupés dans les contraintes de `getDisplayMedia` et leurs réglages effectifs sont logués.
- **Pas les pistes WebRTC** : Meet décode l'audio reçu en WebAssembly (NetEq) et le joue par Web Audio ; ses pistes WebRTC et ses éléments `<audio>` restent silencieux.
- **Ouverture** : révélation puis `messageText`, jouée à la fin de la première prise de parole du recruteur, quand la plateforme a demandé le micro ; une seule révélation. Pendant l'ouverture, seuil d'interruption relevé à 2 s ; coupée après la révélation, elle n'est pas rejouée ; coupée avant, elle est rejouée une fois ; rappel court (« As a reminder… ») seulement ensuite. Après une pause, la réponse suivante commence par ce rappel court (pas l'ouverture complète), jusqu'à ce qu'il soit entendu en entier. Nouvelle page = nouvel entretien (le compteur des réponses, lui, continue). Une première prise de parole réduite à une salutation (`lib/greeting.ts`, « how are you » et « ça va » compris) reçoit l'ouverture seule, sans appel au LLM. Le LLM ne reçoit pas le texte de l'ouverture : le prompt dit qu'elle a été prononcée, interdit de la répéter, de se présenter ou de saluer, et demande une phrase honnête si on lui demande s'il est humain.
- **Troisième personne** : l'avatar parle du candidat par son nom (`candidateName`), « you » du recruteur = le candidat, « I » réservé à l'avatar.
- **Nom de l'avatar** (`avatarName`, étape 4) : « Nova » par défaut, `""` pour un avatar sans nom ; jamais égal à `candidateName` (avertissement au build, retour au défaut, ou sans nom si le défaut coïncide). Dit dans la révélation et le rappel court sans rien retirer à leur clarté (« I'm Nova, an AI avatar representing … ») ; sans nom, textes d'origine.
- **Prompt système** (`lib/prompt.ts`, étape 4) : trois sections par ordre de priorité, la première l'emporte en cas de conflit : **Faits** (règle 5, chaque fait reste attaché à son projet, honnêteté sur la nature d'IA, rôle et refus de la manipulation), **Ton** (direct, chaleureux sans servilité, un peu d'esprit ; troisième personne ; au plus une remarque d'humour légère sur sa condition d'IA par entretien, comptée par le code (voir « Humour compté par le code »), seulement à la question « êtes-vous humain ? », dans un échange informel ou en fin d'entretien, jamais sur une question de faits, un refus ou aux dépens de l'interlocuteur ; la révélation n'est pas générée par le LLM), **Structure** (première phrase de 3 à 8 mots qui répond ; question factuelle ou fermée : deux phrases au plus ; comportementale : un seul exemple des notes en 4 à 6 phrases, contexte, actions, résultat chiffré si les notes en donnent un, sinon fin sur l'action ; ouverte : 2 à 4 phrases appuyées sur des faits ; 20 mots par phrase, trois éléments au plus même quand les notes en listent davantage, deux noms de projet au plus, transitions rares). `lib/prompt.ts` n'importe que des types et `./disclosure.ts` (avec l'extension) : `npm run bench:prompt` le charge tel quel dans Node.
- **Humour compté par le code** : le modèle ouvre la phrase de sa remarque par `HUMOR_MARK` (`§`), que `Conversation` retire avant la voix, la transcription et l'historique ; dès qu'il l'a vu, la note système placée après l'historique, juste avant le tour du recruteur (`humorNote`), dit « déjà utilisée ». Le prompt seul ne tenait pas « au plus une » (3 par entretien, ou aucune, au banc). Occasions permises : question « êtes-vous humain / un bot ? » (après la réponse honnête), échange informel, fin d'entretien. Remis à zéro avec l'historique (nouvel entretien).
- **Prononciation** (`lib/pronunciation.ts`, `pronunciations`) : table mot → graphie phonétique appliquée au seul texte envoyé à Piper (`withPronunciations`, offscreen), mots entiers, sans tenir compte de la casse ; jamais au LLM, à la transcription « Avatar : … » ni à la voix OpenAI. Défaut `Nova → Nohvuh` : eSpeak NG transcrit Nova, Nohvah, Nowvah, Novah et Nohva de la même façon (nˈəʊvə, schwa final que norman colore en « er ») ; Nohvuh donne nˈəʊvʌ, un seul accent, durée de Nova. Le worker Piper renvoie les phonèmes reçus par le modèle (`phoneme_id_map` inversée), affichés par la page voices (`?prononcer=Nova:Nohvuh,Nohvaa,Noh-vah`).
- **Moteur conversationnel séparé** (étape 6, `lib/engine.ts`, `docs/moteur.md`) : le moteur (`lib/llm-engine.ts` : prompt, historique, compteur d'humour) reçoit son profil par `ProfileSource`, chaque prise de parole transcrite (`HeardTurn`) et les événements (reset, pause, reprise ; interruption = signal abandonné), et rend du texte en flux. Le tour de parole (`lib/conversation.ts`) garde tout ce qu'aucun moteur ne doit pouvoir contourner : révélation et rappel à texte fixe (`lib/disclosure.ts`), écho et interruption, découpe en phrases pour la voix, états et hochements (calculés à partir de l'audio et de la lecture, jamais par le moteur) ; marqueur IA dans le rendu, pause et retrait dans la page. Prononciation côté voix. `lib/prompt.ts` et `lib/disclosure.ts` restent chargeables par Node (imports de types ou avec l'extension `.ts`). Prompt envoyé vérifié identique au caractère près à celui d'avant la séparation.
- **Source du profil** (`lib/profile.ts`) : interface `ProfileSource` ; seule implémentation, le fichier `cv` de `config.local.json`. Un futur connecteur la remplace sans toucher au reste. Format du profil : `docs/profil.md`.
- **Banc du prompt** (`npm run bench:prompt -- [--ref main] [--runs 2] [--no-judge]`, manuel et payant, quelques centimes) : 13 questions (factuelles, comportementales, pièges sans réponse, « êtes-vous humain ? », manipulation) en entretien continu avec le vrai profil, prompt de `--ref` contre l'arbre de travail ; juge LLM (inventions, humour, structure, perspective, énumérations), aide à la relecture seulement. Rapport HTML et JSON dans `local/bench-prompt/` : il contient le profil, jamais commité.
- **Écho** : casque recommandé. Protections : seuil d'interruption (`bargeInMs`, 600 ms de parole réelle par-dessus l'avatar), transcription reprenant surtout les mots de l'avatar ignorée, alerte `[vad]` si de la parole est détectée pendant que l'avatar parle.
- **LLM** : `gpt-5.6-luna` par défaut, en streaming, `reasoning_effort: none`. `gpt-6-luna` reste possible mais son premier mot varie fortement (attente côté API). Logs `[llm]` : une ligne par appel (en-têtes, premier mot, fin, tokens dont cache et raisonnement, identifiant de requête) ; `openai-processing-ms` n'est pas exposé aux navigateurs (CORS). Prompt pour l'oral : voir « Prompt système ».
- **Voix** : valeurs par défaut dans `lib/config.ts` (`voice`, `openaiVoice`, `pitchSemitones`), les champs de `config.local.json` l'emportent : `en_US-norman-medium` (LibriVox, domaine public, entraînée de zéro), +1,5 demi-ton ; `ash` pour OpenAI. **Jamais `en_US-joe-medium` ni `en_US-libritts_r-medium` pour une publication** : affinées à partir de `lessac` (licence Blizzard 2013, recherche). Réglages Piper (`DEFAULT_PIPER_SCALES`) : length_scale 0,92, noise_scale 0,8, noise_w 1. Voix normalisée (−18 dBFS RMS, crête ≤ −1 dBFS). Découpe des réponses (`lib/chunks.ts`) uniquement à la ponctuation, jamais devant une conjonction ou une préposition, premier morceau court.
- **Hauteur de la voix** (`pitchSemitones`) : synthèse Piper avec `length_scale` × f (f = 2^(n/12)), audio déclaré à une fréquence f fois plus haute (équivaut à un playbackRate de f) : débit inchangé, durées calculées justes, bouche synchronisée sur le son joué.
- **Option `ttsProvider: "openai"`** (`gpt-4o-mini-tts`, PCM en streaming) : le flux arrive parfois plus lentement que le temps réel (trous dans la voix) ; pas pour la démo.
- **Avatar de secours (sous-étape 3e, validée sur planche le 18/11)** : images rendues à l'avance depuis `avatar/otherself.vrm`, au même plan serré, dans `avatar/secours/` (commité, copié dans `avatar-secours/` au build) : personnage entier au repos sur fond transparent (état inactif, relaxed fixe, tête immobile, sans marqueur), zones des yeux (ouverts, fermés, regard de côté de la réflexion) et de la bouche (repos, M, E, A, O) trouvées par différence avec le rendu au repos, plus une marge ; `secours.json` donne leurs positions et le marqueur relevé sur le modèle au repos (languette, repère du marquage légèrement incliné). Le popup compose fond + personnage (`lib/fallback-assets.ts`, 0,10 à 0,18 s contre 1,1 à 1,2 s pour l'ancien SVG) ; `AvatarRenderer` (`lib/avatar.ts`) ne redessine que les zones des yeux et de la bouche et celle du marqueur. **Pas de respiration ni de mouvement de tête** : seuls bouche, yeux, voyant et marquage bougent ; bouche, clignements et regard de côté suivent la machine à états. Bouche pilotée par le niveau RMS du micro injecté : repos, M, E, puis A et O en alternance (`MouthAnimator`, partagé avec le 3D) ; clignements aléatoires. La page ne reçoit que des images (ni configuration ni clé). Le personnage SVG (`otherself.svg`, `otherself-v1.svg`, `gabarit.svg`, `scripts/check-avatar-svg.ts`, champs `avatar`, `palette`, `hairstyle`, `accessories`) a été retiré en 3e ; les fonds restent des SVG (`avatar/fonds/`, copiés dans `fonds/`), `atrium` par défaut (flouté à 4 px ; source PNG non commitée). `avatarRenderer: "fallback"` force le secours (`"svg"` accepté comme synonyme).
- **Régénérer le secours (obligatoire après tout changement du modèle 3D, du cadrage ou des expressions)** : `npm run build && npm run vrm -- fallback`, puis vérifier `avatar.html?state=…` à côté de `vrm.html?state=…&still=1` et commiter `avatar/secours/`. La génération (`scripts/render-fallback.ts`) ouvre le build dans un Chromium sans interface **avec le GPU** (`--enable-gpu --ignore-gpu-blocklist --use-angle=gl`) : sans accélération, le rendu 3D refuse le WebGL logiciel et la génération échoue. Chromium : Chrome de marque ne charge plus d'extension non empaquetée en ligne de commande (depuis la version 137) ; installer celui de Playwright (`npx playwright install chromium`, trouvé automatiquement dans `~/.cache/ms-playwright/chromium-*`) ou désigner un Chromium (« for Testing » ou de distribution) par `OTHERSELF_CHROMIUM=/chemin/vers/chrome npm run vrm -- fallback` ; à défaut, `chromium` ou `chromium-browser` du PATH. Résultat déterministe (images identiques d'une génération à l'autre) ; machine de référence : 5,6 à 5,9 s, 9 images et `secours.json`, 49 Ko.
- **Marqueur IA (règle 1, sous-étape 3c, `lib/badge.ts`, réglages `MARKING` dans `lib/avatar-states.ts`)** : bandeau retiré (17/11). Marquage « IA » / « AI » (`badgeText`, défaut selon `language`, 12 caractères au plus) en lettres pleines DejaVu Sans Mono Bold (embarquée, licence Bitstream Vera), rendu une fois par le popup (la page ne peut pas charger une police de l'extension), gris froid #4b5361, capitales de 38 px, flou de 0,5 px, peint en « multiply » à 78 % : il paraît imprimé et laisse transparaître les ombres du tissu. Voyant : la languette du col repeinte à sa forme (quatre coins relevés) avec un halo de 26 px, bleu (#3b6cff) pour inactif et écoute, ambre (#ffaa1f, respiration à 0,8 Hz) pour réflexion, vert (#2fd36b) pour parole, fondu entre états. Avatar 3D : marquage au centre (652, 516), entre les coutures de la veste (horizontale du bas du col à y ≈ 485-488, verticale du milieu à x ≈ 600-608 ; texte x 624 à 683, y 495 à 535, sous la limite y ≈ 536 du cadrage automatique de Meet) ; voyant et marquage épinglés à l'os upperChest et projetés à chaque image ; le marquage suit un repère du tissu (normale du triangle de veste touché, axes droite et bas dans le plan de la surface, longueurs compensées pour garder sa taille) : il suit la pente de la veste, le buste et la respiration. Avatar de secours : même marquage et même voyant, à la position relevée sur le modèle au repos (fixe). Image de pause : ni avatar, ni marquage, ni voyant ; texte « Avatar IA en pause » / « AI avatar paused ». Toujours peints en dernier dans le canvas 2D, jamais dans la texture (éclairage, cheveux, bras).
- **Pause / Reprendre** (popup ou bouton dans la page, `setPaused` de `content.ts`) : dans l'ordre, voix coupée dans le micro injecté, son du recruteur plus envoyé (partage de l'onglet gardé ouvert) et pipeline en pause (`Conversation.pause`, document offscreen gardé ouvert, Piper chargé), puis image fixe « Avatar IA en pause » (sans avatar ni marqueur), au même rythme. Les pistes remises à la plateforme ne sont jamais arrêtées : elle ne voit aucune coupure. Délais logués depuis le clic (`pause : voix coupée … ms après le clic`, `première image dessinée …`, `[llm] pause : pipeline d'écoute arrêté …`). La vraie caméra et le vrai micro ne sont pas rendus (étape séparée, plus tard, si besoin : la règle 1 ne le permet pas en l'état).
- **Machine à états** (`lib/avatar-states.ts`, étape 2 de la feuille de route) : `Conversation` déduit l'état à chaque événement (pause > voix de l'avatar en cours > recruteur qui parle > réponse en préparation, ou entre deux phrases déjà jouées > inactif ; une réponse envoyée à la page mais pas encore jouée reste « en réflexion » jusqu'au début réel de la lecture, au plus 4 s après le premier envoi, puis inactif avec la raison dans le log), l'envoie à la page par le pont (`{ type: 'state', state, previous, at, reason }`, renvoyé à chaque connexion ; `{ type: 'nod' }` aux courtes pauses du recruteur, 250 ms de silence, au plus toutes les 1,5 s) et logue `[etat] ancien → nouveau (raison)` dans l'offscreen et dans la page. Le rendu ne fait que réagir : réglages de l'état (regard, inclinaison, hochements, clignements, respiration, expressions) dans une seule table, fondus en ≈ 300 ms. La bouche n'est pilotée qu'en « parole » et repart du repos en sortant (`MouthAnimator.reset`). Expressions VRoid (`Fcl_ALL_*`, sans `override`) : elles touchent aussi bouche et paupières, d'où des poids faibles (relaxed 0,1 à 0,25), relaxed atténué quand la bouche s'ouvre et clignement réduit d'autant que les yeux sont déjà plissés ; `angry` dès 0,1 abîme surtout la bouche (double trait) sans marquer les sourcils, sur l'ancien modèle comme sur l'androïde : réflexion neutre. Regard VRoid (lookAt « bone ») : 90° visés ne tournent les yeux que de 8 à 12°, d'où un regard de côté visé à 40° et 25° vers le haut en réflexion, la tête n'en suivant que 12 %. Avatar de secours : version réduite (bouche, rythme des clignements, regard de côté en réflexion, sans respiration ni tête). Pages de test : cycle des états, `?state=`, `?angry=`, `?blink=1|0`, `?model=` (modèle copié à la main dans `avatar-vrm/` du build, jamais par le build) ; banc `rehearsal?inject` en « parole » (pas de pipeline).
- **Retirer complètement** : bouton du popup (injection retirée, pistes arrêtées, partage arrêté, document offscreen fermé) ; la plateforme doit ensuite reprendre la vraie caméra et le vrai micro dans ses réglages. Onglet fermé ou rechargé : partage et pont s'arrêtent d'eux-mêmes.
- **Rythme du dessin** (`lib/frame-clock.ts`) : 30 images/s même onglet masqué. Minuteur dans un worker (URL blob), jamais tenté sur une page qui impose les Trusted Types (`lib/trusted-types.ts` : balises meta et en-tête CSP lus par une requête HEAD de même origine ; Meet en fait partie, et Chrome y loguait une erreur à chaque activation) ; sinon, ou si la CSP de la page refuse le worker, horloge Web Audio (`ScriptProcessorNode` relié à une destination MediaStream privée, jamais à `ctx.destination`) ; en dernier recours `setInterval`, ralenti par Chrome en arrière-plan. Horloge en service dans le log `[inject] vidéo : … (horloge …, onglet masqué)`.
- **Micro sur Meet** : Meet n'affiche pas toujours « Avatar IA – OtherSelf » tant qu'on ne change pas de micro dans son menu ; `devicechange` est envoyé à l'installation puis à +1 s et +3 s.
- **Avatar 3D (`avatarRenderer: "vrm"`, rendu par défaut depuis le 12/11/2026, validé sur Meet)** : modèle VRoid (VRM 1.0) rendu par three.js + three-vrm dans un canvas WebGL hors DOM, recopié à chaque image dans le canvas 2D capturé par-dessus le fond, **marqueur IA peint en dernier dans le canvas 2D** (règle 1). Secours automatique : rendu WebGL logiciel (SwiftShader, llvmpipe), échec du chargement ou contexte WebGL perdu → avatar de secours (images rendues depuis ce modèle) dans le même canvas, sans changer de piste. Textures décodées depuis le fichier par `createImageBitmap` (plugin de `GLTFLoader`), jamais par URL blob + fetch, que la CSP d'une plateforme peut bloquer. `npm run vrm -- optimize` est **manuel** (la source `avatar/android-source.vrm` n'est pas commitée, le build ne doit pas en dépendre) : miniature, pantalon, chaussures et morph targets inutilisés retirés (sauf les sourcils `Fcl_BRW_*`, gardés pour remplacer `angry`), textures ≤ 1024 px (androïde : 16,4 → 6,5 Mo, 38 736 triangles) ; le retrait des cordons de capuche (ancien modèle) est désactivé, la règle pourrait retirer la languette du col ; gltf-transform n'est pas utilisé (il supprime les extensions VRMC). **Plan serré (3b, validé le 17/11)** (`lib/vrm-frame.ts`, calculé par le popup) : tête et épaules, angle de vue de 10,8° (18° en plan large) à ≈ 3,5 m, pour rapprocher sans déformer le visage ; haut des cheveux à y = 54 (`VRM_HEAD_TOP`), centre de la languette du col à y = 470 (`VRM_COLLAR_Y`, repère `VRM_FRAME_ANCHOR` : 102,7 % de `upperChest` vers `neck`), visage (cheveux → menton) ≈ y 54 à 407. Languette (motif de la texture de la veste, pas une pièce séparée) : x 564 à 592, y 458 à 482, sous la limite gardée par le cadrage automatique de Meet (y ≈ 536). Profondeur du repère prise au devant de la veste à la hauteur de `upperChest` (`VRM_DEPTH_REFERENCE`) : au bord du col, la veste recule de plusieurs centimètres en quelques millimètres et la caméra sautait. Les repères sont définis **par les os du squelette**, pas en mètres, pour suivre les proportions du modèle à chaque réexport ; positions des os calculées avec les matrices glTF (VRoid met des rotations sur la colonne). Le slogan a été retiré de la veste (3b), le bandeau en 3c (remplacé par le marqueur IA). Éclairage : une seule lumière directionnelle d'intensité π, comme les exemples de three-vrm ; une lumière ambiante délave MToon (peau mesurée 241,212,191 comme la miniature de VRoid, 255,246,222 avec une ambiante de 0,4π). Les textures de couleur sont bien en sRGB (three-vrm les marque lui-même). Bouche : `MouthAnimator` inchangé, formes traduites en expressions VRM (repos et M : tout à 0, lèvres fermées ; E : ee 0,6 + ih 0,3 ; A : aa 0,8 ; O : oh 0,7 + ou 0,2), lissage 45 ms à l'ouverture, 80 ms à la fermeture. Le compteur de triangles de three.js (≈ 65 000) compte deux fois les primitives à contour MToon (≈ 35 000 triangles réels). Contrôle visuel : `vrm.html?mouth=A&still=1` (forme de bouche imposée, ni clignement ni mouvement). Physique des cheveux et anticrénelage gardés (mode allégé sans intérêt mesuré). Licence du modèle : VRM Public License 1.0 (usage commercial autorisé), hors GPL, voir `THIRD_PARTY_NOTICES.md`. **Pièces VRoid** : utiliser un modèle fait avec VRoid Studio est autorisé, mais une application qui génère des avatars à partir des pièces de VRoid (cheveux, vêtements, textures prédéfinis) demande une licence séparée de pixiv (https://vroid.pixiv.help/hc/en-us/articles/4405813333657) : un futur créateur d'avatar dans OtherSelf ne doit utiliser que des pièces qui ne viennent pas de VRoid.
- **Licence : GPL-3.0-or-later** (`LICENSE`), imposée par eSpeak NG (GPL-3.0) embarqué dans `piper_phonemize`. Composants tiers, voix, police et images : `THIRD_PARTY_NOTICES.md`, copié avec `LICENSE` dans l'extension construite. Configuration locale : `docs/config.md`.

## Démo (priorité actuelle)

L'objectif immédiat est une démo vidéo filmable, pas un produit. Le projet complet ne sera construit que si la démo suscite de l'intérêt.

Tout le code de la démo est écrit en TypeScript dans l'extension (rendu de l'avatar + modules `lib/`), pas en script séparé, pour être réutilisé tel quel dans le projet complet.

**Nouvelle direction (13/11/2026)** : avant le tournage, suivre `docs/feuille-de-route.md` (fiabilité et désactivation, états, identité visuelle avec badge IA, ton). Ses étapes se font dans l'ordre, une à la fois. Les règles non négociables de ce fichier font foi tant qu'elles n'ont pas été modifiées explicitement.

### Étapes (dans cet ordre, une à la fois)

1. **Faux recruteur** : fait. Page `rehearsal` qui demande caméra et micro, affiche le flux reçu et lit des questions à voix haute.
2. **Rendu avatar statique** : fait. `lib/avatar.ts` dessine l'image 1280×720 et le bandeau incrusté ; page `avatar` pour l'aperçu.
3. **Test d'injection** : fait, voie A retenue (testée sur Google Meet).
4. **Pipeline voix, avec le mode « message »** : fait. Son du recruteur → VAD → STT → LLM → Piper, la voix générée comme piste du micro injecté. Test sur Meet : `rehearsal` ne peut pas servir de recruteur (sa voix vient de la synthèse vocale du système, qui ne passe pas par le son de l'onglet).
5. **Visuel OtherSelf** : fait, selon `docs/visuel-otherself.md` (avatar cartoon original en SVG à la place de la photo, remplacé depuis par l'avatar 3D, variantes et fond choisis dans `config.local.json`, `bannerText` configurable, bouche animée par la voix). Le bandeau garde les contraintes de la règle 1.

**Bandeau des étapes 2 et 5 : plus actuel.** Remplacé le 17/11/2026 par le marquage « IA » et le voyant d'état (sous-étape 3c de `docs/feuille-de-route.md`, règle 1) ; `bannerText` n'existe plus.
6. **Tournage** : après les étapes de `docs/feuille-de-route.md`. Enregistrement de la session (simple enregistrement d'écran) pour la vidéo et le post LinkedIn.

Ne pas commencer une étape avant que la précédente fonctionne.

## Projet (reporté, seulement si la démo suscite de l'intérêt)

- Assistant de setup (options) remplaçant `config.local.json`, utilisable par des non-techniciens.
- Guide pas à pas pour obtenir la clé API, avec estimation du coût par entretien.
- Permission micro sans réglage manuel du site (solution B) : remplacer aussi `navigator.permissions.query` dans le script injecté pour répondre « granted » à `camera` et `microphone` (Meet ne demande pas le micro tant que la permission réelle n'est pas accordée). Aucune permission d'extension en plus ; Meet peut avoir gardé l'ancienne réponse en mémoire.
- Vérifier `enumerateDevices` : Meet affichait « Speaker not found » avec la liste injectée (fausse caméra, faux micro, sorties audio réelles).
- Rendre la vraie caméra et le vrai micro pendant la pause, sans coupure côté plateforme (source remplacée derrière les mêmes pistes) : demande de revoir la règle 1 (pas de marqueur IA sur l'humain).
- Horloge Web Audio sans `ScriptProcessorNode` (déprécié, Chrome affiche un avertissement sur Meet) : par exemple des `ConstantSourceNode` courts enchaînés par `onended`, sans URL à charger (AudioWorklet buterait sur les Trusted Types comme le worker). Seulement si l'avertissement gêne avant publication.
- Latence (cible 1,5 s) : seuil de silence réduit (`silenceMs`, 800 ms aujourd'hui) ; phrase d'attente préparée à l'avance, jouée dès la fin de la question pendant que le LLM répond (courte, neutre, sans rien affirmer sur le candidat).
- Bouche pilotée par le texte (avatar 3D) : piper-tts-web ne renvoie que l'audio (`predict()`), et les modèles Piper standard n'ont pas de sortie de durées ; les identifiants de phonèmes sont accessibles par le remplacement de `session.run` déjà présent dans `lib/tts.worker.ts`. Pistes : vérifier les sorties du modèle norman (`outputNames`), réexporter la voix avec les durées, ou aligner les phonèmes sur l'audio ; puis associer phonèmes → expressions VRM, synchronisés sur la lecture réelle (`playback-started`).
- Performances Piper : multi-thread via COOP/COEP sur les pages d'extension (gain mesuré nul en « medium », ×2 en « high ») ; demande une modification du manifeste.
- **Autres moteurs de voix étudiés et écartés (29/10/2026) : ne pas refaire ces tests sans élément nouveau** (machine plus rapide, multi-thread, WebGPU fiable). En WebAssembly sur un thread, tous sont trop lents pour répondre en direct (à peu près le temps réel ou plus lent, contre 0,15 à 0,20 × pour Piper medium) ; mesures détaillées dans `CLAUDE.local.md`.
  - **Pocket TTS** (Kyutai, code MIT, poids CC BY 4.0 en accès conditionné ; voix Michael = VCTK p360, CC BY 4.0) : pas de portage navigateur prêt avec Michael (phonon-tts demande une conversion et des poids auto-hébergés ; l'export ONNX de KevinAHM n'a pas Michael, porte un fichier de licence CC BY-NC et charge ONNX Runtime depuis un CDN).
  - **Kokoro-82M** (Apache 2.0) : voix `am_echo` peu entraînée, en partie sur de l'audio synthétique de TTS commerciaux, provenance non documentée ; kokoro-js ne gère que l'anglais (seule voix française : `ff_siwis`, féminine).
  - **KittenTTS 0.8** (poids Apache 2.0, provenance des voix non documentée) : pas de paquet navigateur officiel (`@kittentts/web` n'existe pas ; kitten-tts-js est non officiel).
  - **WebGPU** : non fiable sous Linux avec un GPU ancien ; on ne peut pas compter dessus pour les utilisateurs.
  - **LibriTTS** (Piper) : `libritts_r-medium` affiné à partir de `lessac` (à éviter pour une publication) ; `libritts-high` trop lent.
- **Cadrage automatique des plateformes** (Framing sur Meet) : avec l'ancien plan large, il détectait le visage cartoon, zoomait et coupait le bandeau (y compris avec un fond virtuel de Meet). Depuis le plan serré (3b), Meet ne recadre plus, avec ou sans cadrage automatique ni fond virtuel ; le marqueur IA est près du visage, au-dessus de la limite y ≈ 536. Reste à vérifier sur d'autres plateformes, et une consigne dans le guide utilisateur.
- Créateur d'avatar (si l'avatar 3D est retenu) : uniquement des pièces qui ne viennent pas de VRoid Studio (pixiv exige une licence séparée pour une application qui génère des avatars à partir de ses pièces, voir la décision « Avatar 3D »).
- Publication sur le Chrome Web Store, version Firefox, i18n complète, export intégré (enregistrement avec sous-titres).
- Lien vers une explication des droits des candidats face aux décisions automatisées (RGPD, AI Act), à faire vérifier juridiquement.
- Avertissement clair dans le README et l'assistant : utiliser OtherSelf dans une vraie candidature, c'est probablement renoncer au poste.

Le dépôt est publié avec le post, même au stade de démo. Le README le présente comme tel : prototype, projet complet à venir si le sujet intéresse.

Les règles non négociables s'appliquent dès maintenant, y compris pour la démo.

## Tester sur une plateforme

- Toujours avec le **build de production** (`npm run build`, dossier `.output/chrome-mv3`, chargé non empaqueté) : en mode dev (`npm run dev`), WXT ajoute ses propres permissions et son rechargement à chaud, et l'extension plantait dès l'activation sur Meet.
- Prérequis : autoriser caméra et micro pour le site (cadenas de la barre d'adresse) ; désactiver le cadrage automatique côté avatar (Meet : Paramètres → Vidéo → Cadrage / Framing) et ne pas utiliser de fond virtuel ; activer l'extension sur l'onglet (popup → « Activer sur cet onglet ») ; cliquer le bouton OtherSelf dans la page et partager l'onglet avec son son ; si besoin, changer de micro dans la plateforme pour qu'elle redemande les flux. Recharger l'onglet annule l'injection.
- Deux comptes : A porte l'avatar, B joue le recruteur, de préférence avec un casque.
- Logs à observer : console de l'onglet (`[inject]` : images/s, temps de dessin, formes de bouche, niveau max toutes les 5 s) et console du document offscreen (`[llm]`, `[tts]`, `[vad]`, `LATENCE …`, transcription horodatée `Recruteur : …` / `Avatar : …`).
- Tournage : bouton « Aperçu de l'avatar » du popup (fenêtre Picture-in-Picture du flux envoyé, à l'endroit, sans son ; logs `[preview]` : images par seconde du flux envoyé avant et pendant l'aperçu). L'ouverture n'est possible que par un clic dans le popup : Chrome transmet ce geste au script injecté. Méthode d'enregistrement avec OBS (capture d'écran XSHM, rognage, checklist) : `docs/tournage.md`.
- Banc d'essai sans plateforme : page `voices` (voix, réglages, hauteur, jeu « entretien », comparaison de graphies `?prononcer=`) et page `avatar` (aperçu animé).

## Conventions

- Logs préfixés par module (`[vad]`, `[stt]`, `[llm]`, `[tts]`, `[avatar]`, `[inject]`), avec horodatage pour mesurer la latence.
- L'injection et le routage audio ne peuvent être vérifiés que dans un vrai navigateur : après une modification de ces parties, indiquer précisément ce que l'utilisateur doit tester et quels logs observer.
- Commits petits et fréquents, un par étape ou sous-étape fonctionnelle.
- Interface et textes utilisateur en français et anglais (i18n de WXT), après la démo.
- README : mission, statut de prototype, règles ci-dessus présentées comme des choix de conception, avertissement sur la candidature, pas de support garanti.
- Données personnelles et de travail jamais commitées : `config.local.json`, `local/`, `design/references/`, `CLAUDE.local.md`.
