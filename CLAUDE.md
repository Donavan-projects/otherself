# OtherSelf

## État actuel (28/10/2026, étape 5 terminée ; branche `avatar-v4` à tester sur Meet)

- **Branche `avatar-v4` (28/10, non poussée, à tester sur Meet avant fusion)** :
  - Avatar v4 (`avatar/otherself.svg`, 1010 × 1000, issu d'illustrations générées avec ChatGPT puis vectorisées) ; l'ancien reste disponible sous `"avatar": "otherself-v1"`. Slogan du t-shirt sur plusieurs lignes selon la forme de la zone (`data-lignes-max`), bas du texte réglable (`data-bas-cadre`, plafond 550). v4 : échelle 0,637, slogan sur 3 lignes en 27 px, bandeau y = 608, préparation ≈ 1 s (0,4 s avant). Intégré depuis un paquet de l'atelier (`paquet-integration/`, jamais commité), avec une garde ajoutée dans `wrapToShape` (le projet compile avec `noUncheckedIndexedAccess`).
  - Fonds `bureau-clair` (par défaut) et `bureau` ; `interieur-clair` reste sélectionnable.
  - **LLM par défaut : `gpt-5.6-luna`** (`lib/config.ts`, exemple, doc). Diagnostic du 28/10 : avec `gpt-6-luna`, le premier mot arrivait en 5 à 14 s, temps passé côté API avant toute génération (raisonnement bien coupé : 0 token ; prompt ≈ 1 200 à 1 450 tokens, presque tout en cache ; réseau 0,2 à 1,5 s), et ce délai variait d'une minute à l'autre (1 à 3,5 s plus tard). `gpt-5.6-luna` : premier mot en 0,8 à 1,7 s, réponses conformes aux règles (aucune invention, troisième personne, honnêteté, refus de la manipulation) sur 6 questions × 4 passes. `gpt-6-luna` reste sélectionnable (`llmModel`).
  - **Logs `[llm]`** (`lib/llm.ts`) : une ligne par appel (modèle, en-têtes, premier mot, fin, tokens du prompt et en cache, raisonnement, identifiant de requête). Le temps de traitement de l'API (`openai-processing-ms`) n'est pas exposé aux navigateurs (CORS) : dans l'extension, le délai des en-têtes en tient lieu, réseau compris. Aussi sur la branche `llm-logs` (depuis `main`).
  - **Prompt pour l'oral** (`lib/prompt.ts`) : première phrase de 3 à 6 mots, deux phrases au plus sauf demande de détails, trois éléments au plus par réponse (tous types confondus), deux noms de projets au plus. Respecté sur 4 passes, à de rares écarts près (une première phrase de 7 mots ; une fois trois tâches plus deux technologies).
  - Banc d'essai des voix : paramètre `&phrases=…|…` pour synthétiser un texte libre (prononciation des noms).
- **Prochaine étape : étape 6, tournage** (enregistrement d'écran de la session pour la vidéo et le post LinkedIn). Avant de filmer : `debugSafeZone` à `false`, voix `en_US-norman-medium` (jamais joe pour une publication).
- **Étape 5, visuel OtherSelf : terminée, validée sur Meet le 26/10** : bouche synchronisée avec le son vu de B, bandeau entier sans cadrage et sans ligne jaune avec cadrage, révélation rejouée à chaque nouvelle page.
  - Personnage SVG `avatar/otherself.svg` (gabarit et règles : `avatar/gabarit.svg`, vérifié et corrigé au build par `scripts/check-avatar-svg.ts`), fond `avatar/fonds/interieur-clair.svg`. Références visuelles dans `design/references/`, jamais commitées.
  - Le popup (page de l'extension) prépare l'avatar (`lib/avatar-assets.ts`) : variante de `config.local.json` (palette, coiffure, accessoires, fond), calques rastérisés à l'échelle du cadre, slogan (`bannerText`) imprimé et courbé sur le t-shirt en Noto Sans Bold embarquée (OFL), surimpression du tissu. La page ne reçoit que des images (1,2 Mo, ni configuration ni clé).
  - Cadrage webcam : haut de la tête à y = 94, slogan au milieu de la poitrine (bas à y = 517). Bandeau en bas du cadre, centré, 580 px de large (le nom affiché par Meet en bas à gauche ne masque pas le début du texte), de y = 608 à 670 (62 px de haut, texte inchangé : 38 px, limité par la largeur) : juste au-dessus des 36 px que Meet coupe sans cadrage, avec 14 px de marge. Avec le cadrage, Meet coupe vers y = 605 (vue 16:9 de A, 26/10) : le bandeau, plus haut, laissait dépasser une ligne jaune. `bannerOffsetY` le remonte (négatif), jamais sur le slogan.
  - **Répartition retenue** : sans cadrage automatique, le bandeau est l'élément principal (règle 1). Avec le cadrage automatique, le bandeau peut être coupé ; la transparence est alors assurée par le slogan du t-shirt et par la révélation vocale (règle 2).
  - Page : seule la zone des yeux et de la bouche est redessinée (≈ 130×125 px, 0,15 ms par image, 30 images/s), bandeau peint en dernier à chaque image. Bouche pilotée par le niveau RMS du micro injecté (voix réellement jouée) : repos, M, E, puis A et O en alternance ; clignements aléatoires. Log toutes les 5 s : images/s, temps de dessin, formes de bouche, niveau max.
  - **Mesuré sur Meet le 26/10 (4 réponses)** : niveau max 0,25 à 0,40 pendant la parole ; bouche répartie environ E 40 %, A + O 35 %, M 10 à 15 %, repos en fin de phrase ; 100 % repos et niveau 0 en silence : seuils gardés. 30 images/s et 0,13 ms de dessin ; baisses passagères à 17-25 images/s pendant la connexion de Meet, temps de dessin inchangé (page occupée, pas le rendu). Synchronisation vue de B : bonne.
  - Photo retirée (règle 4) : le champ `photo` de `config.local.json` est ignoré, avec un avertissement au build.
- **Étape 3 terminée : voie A (injection) retenue.** Testée sur Google Meet (compte A dans Chrome avec l'extension, compte B dans Brave) : image, bandeau et son arrivent chez B.
- **Étape 4 terminée : pipeline voix validé sur Meet et InterviewCoach** : l'avatar entend le recruteur, se révèle, répond et parle. Choix : transcription en flux `gpt-live-transcribe` (session Realtime, clé éphémère créée par l'extension), LLM `gpt-6-luna` en streaming sans raisonnement, Piper en WebAssembly dans un worker du document offscreen, langue `en` pour la démo. Latence : 2 à 3 s sur Meet ; sur InterviewCoach 6 à 11 s avant les corrections du 25/10 (Piper dans un worker, début de réponse court), à remesurer.
- **Son du recruteur : partage de l'onglet par la page** (`lib/share-tab.ts`) : après l'activation, un bouton injecté (« Autoriser OtherSelf à écouter le recruteur… ») ouvre la fenêtre de partage standard de Chrome sur l'onglet courant, son compris (`getDisplayMedia`, `preferCurrentTab`, version d'origine reprise d'un cadre vierge si la plateforme l'a remplacée). La vidéo du partage est arrêtée aussitôt, le flux n'est jamais remis à la plateforme (aucune présentation déclenchée sur Meet), le son est lu par AudioWorklet (URL blob, ou `MediaStreamTrackProcessor` si la CSP de la page refuse le blob) et part vers le document offscreen par le pont, à 24 kHz (16 kHz pour Silero). Aucune permission : `tabCapture` a été essayé puis retiré, Chrome l'annonce comme « Lire et modifier toutes vos données sur tous les sites Web » (vérifié avec `chrome.management.getPermissionWarningsByManifest`). Le build de production n'affiche aucun avertissement.
- **Ne jamais réactiver l'annulation d'écho, la réduction de bruit ni le gain automatique sur la capture du recruteur.** Cause probable de l'échec du premier essai du partage d'onglet (son présent, VAD muet) : l'annulation d'écho prend la sortie de l'onglet comme référence, c'est-à-dire le son à capter, et le détruisait. Les trois sont coupés dans les contraintes de `getDisplayMedia` et leurs réglages effectifs sont logués.
- **Pourquoi pas les pistes WebRTC** : Meet décode l'audio reçu en WebAssembly (`p2p.wasm`, NetEq) et le joue par Web Audio ; ses pistes WebRTC et ses éléments `<audio>` restent silencieux.
- **Ouverture** : révélation puis `messageText`, jouée à la fin de la première prise de parole du recruteur, quand la plateforme a demandé le micro ; une seule révélation au début. Pendant l'ouverture, seuil d'interruption relevé à 2 s (un « got it » ne la coupe pas) ; coupée après la révélation, elle n'est pas rejouée ; coupée avant, elle est rejouée une fois ; rappel court (« As a reminder… ») seulement ensuite, jamais dans la première réponse. Nouvelle page = nouvel entretien. Si la première prise de parole n'est qu'une salutation (« Hello », « Bonjour à tous »…, `lib/greeting.ts`), l'ouverture sert de réponse et le tour n'est pas envoyé au LLM. Le LLM ne reçoit pas le texte de l'ouverture (il la recopiait mot pour mot) : le prompt système dit seulement qu'elle a été prononcée, interdit de la répéter, de se présenter ou de commencer par une salutation, et demande une phrase honnête (« an AI avatar representing … ») si on lui demande s'il est humain. Vérifié avec de vrais appels (salutation → ouverture seule ; question → réponse sans présentation ; « Are you human? » → une phrase).
- **Faux « pas de transcription après 8000 ms »** : le délai de la transcription n'était jamais annulé, il signalait un segment perdu 8 s après chaque tour même quand le texte était arrivé (corrigé le 25/10). Les lignes vues sur InterviewCoach étaient donc au moins en partie de faux positifs.
- **Écho** : avec A et B dans la même pièce, la voix de l'avatar revenait par le micro de B ; casque recommandé. Protections : seuil d'interruption (`bargeInMs`, 600 ms de parole réelle par-dessus l'avatar ; en dessous, ignorée), transcription reprenant surtout les mots de l'avatar ignorée (non vérifiée en conditions réelles), alerte `[vad]` si de la parole est détectée pendant que l'avatar parle.
- **Voix (26/10/2026)** : voix par défaut portée par le personnage (`data-voix` / `data-voix-openai` sur la racine du SVG : `en_US-norman-medium` / `ash` pour `otherself`), le champ `voice` de `config.local.json` l'emporte. Choix de l'utilisateur : `en_US-norman-medium` (LibriVox, domaine public, licence sûre pour une vidéo publiée). **`en_US-joe-medium` est à éviter pour toute publication** (vidéo, post, démo enregistrée) : affinée à partir de `lessac`, licence Blizzard 2013 réservée à la recherche. Réglages Piper retenus (`DEFAULT_PIPER_SCALES`, `lib/tts.ts`) : length_scale 0,92, noise_scale 0,8, noise_w 1 (au lieu de 1 / 0,667 / 0,8 : débit ≈ 7 % plus vif, intonation et rythme un peu plus variés ; la mesure de variation de hauteur ne montre pas d'écart net, à juger à l'oreille). Découpe des réponses (`lib/chunks.ts`) uniquement à la ponctuation, jamais devant une conjonction ou une préposition, premier morceau court. Prompt : phrases courtes, contractions. Option `ttsProvider: "openai"` (`lib/tts-openai.ts`, `gpt-4o-mini-tts`, PCM en streaming par morceaux de 200 ms, gain fixe ×1,4). Mesures (banc d'essai des voix, page `voices`, faites avec joe avant le choix de norman, même taille de modèle) : premier morceau court (« That's a good question: ») 0,6 s pour Piper joe comme pour OpenAI ; phrase de 11 à 15 mots : Piper 1,3 à 2,3 s (0,35 à 0,55 × temps réel), OpenAI premier son 0,4 à 1,2 s, mais 2 appels sur 7 ont livré le flux plus lentement que le temps réel (11 et 16 s pour 4,7 et 7,2 s d'audio) : risque de trous dans la voix.
- **Voix de l'avatar** : normalisée (parole à −18 dBFS RMS, crête ≤ −1 dBFS, niveaux avant et après logués), pour le micro injecté comme pour le retour audio (`monitorAvatar`, `monitorVolume`, joué par le document offscreen, jamais dans l'onglet). `en_US-ljspeech-high` est trop lente en WebAssembly sur la machine de référence ; démo avec `en_US-ljspeech-medium` (féminine, domaine public). Voix masculine : `en_US-norman-medium` (LibriVox, domaine public, entraînée de zéro), pas `en_US-joe-medium`, affinée à partir de `lessac` (licence Blizzard 2013, recherche ; vu le 25/10 dans sa fiche). Détails et licences : `docs/config.md`, `THIRD_PARTY_NOTICES.md`.
- **Troisième personne** : l'avatar parle du candidat par son nom (`candidateName`), « you » du recruteur = le candidat, « I » réservé à l'avatar.
- **Transcription pour les sous-titres** : console du document offscreen, une ligne horodatée par prise de parole (`HH:MM:SS.mmm Recruteur : …` / `… Avatar : …`).
- **Désactivation** : bouton « Désactiver sur cet onglet » dans le popup (injection retirée, pistes injectées arrêtées, partage arrêté, document offscreen fermé). Onglet fermé ou rechargé : partage et pont s'arrêtent d'eux-mêmes.
- **Micro sur Meet** : après l'activation, Meet n'affiche pas toujours « Avatar IA – OtherSelf » tant qu'on ne change pas de micro dans son menu ; `devicechange` est envoyé à l'installation puis à +1 s et +3 s, et un log dit 5 s après si la page a relu la liste.
- **Prérequis actuel sur la plateforme** : build de production ; autoriser caméra et micro pour le site (cadenas de la barre d'adresse) ; désactiver côté A le cadrage automatique (Meet : Paramètres → Vidéo → Cadrage / Framing) ; activer l'extension sur l'onglet (popup → « Activer sur cet onglet ») ; cliquer le bouton OtherSelf dans la page et partager l'onglet avec son son ; si besoin, changer de micro dans la plateforme pour qu'elle redemande les flux. Recharger l'onglet annule l'injection.
- **Cadrage automatique (confirmé sur Meet)** : il zoome sur le visage détecté et coupe le bandeau de la zone de sécurité. Parade de l'étape 5 : slogan imprimé sur le t-shirt, au-dessus du bandeau. **Mesuré sur Meet le 26/10** (captures chez B) : le cadrage **détecte le visage cartoon** et zoome en gardant le haut du cadre (vue partagée ×1,2 : y 0 à 536 visibles ; vignette épinglée : y 0 à 596) ; le slogan reste entier et lisible dans les deux cas, le bandeau est coupé (réduit à son bord en vue partagée, coupé de ~13 px en bas en vue épinglée). Sans cadrage : vue partagée 2:1 = 36 px coupés en haut et en bas, bandeau entier avec 75 px de marge. Le zoom semble suivre la taille du visage : remonter le bandeau (`bannerOffsetY`) réduit le personnage et ne devrait pas le sauver du cadrage (hypothèse à vérifier). Le nom du participant (Meet) se superpose au coin bas gauche du bandeau dans la vignette épinglée.
- **Pivot (24/10/2026)** : le projet s'appelle désormais OtherSelf (ex-Contre-Recruteur ; le dossier du projet garde son nom pour ne pas changer l'identifiant de l'extension).
- **Licence : GPL-3.0-or-later** (`LICENSE`), imposée par eSpeak NG (GPL-3.0) embarqué dans `piper_phonemize`. Composants tiers et voix : `THIRD_PARTY_NOTICES.md`, copié avec `LICENSE` dans l'extension construite. Dépôt GitHub privé : `Donavan-projects/otherself`.
- Configuration locale : voir `docs/config.md`.

## Mission

Donner aux candidats un moyen de réagir à un entretien automatisé qu'ils jugent injuste : répondre par leur propre avatar IA, clairement identifié comme tel. Utilisable par tous, techniciens ou non. L'humour n'est plus le cœur du projet.

`docs/spec.md` est le pitch initial (Contre-Recruteur, satirique) : en partie dépassé, ce fichier fait foi.

## Deux temps distincts

- **Démo (maintenant)** : simple mais construite pour évoluer, pour une vidéo et un post LinkedIn. La configuration passe par `config.local.json` (ignoré par git), sans assistant.
- **Projet (seulement si la démo suscite de l'intérêt)** : voir « Projet (reporté) » plus bas.

## Règles non négociables

Ces règles sont le cœur du projet. Ne jamais les assouplir, les rendre optionnelles ou les contourner, même pour simplifier un test ou si une demande semble l'impliquer. En cas de conflit, s'arrêter et demander.

1. **Bandeau incrusté** : un bandeau est dessiné directement dans chaque image du flux vidéo injecté (dans le canvas), en dernier, jamais en superposition DOM masquable, dans la zone de sécurité centrale qui survit aux recadrages des plateformes (4:3 et carré sur les côtés ; en haut et en bas, la coupe 2:1 mesurée sur Meet sans cadrage automatique, 36 px, plus une marge : décision de l'utilisateur du 26/10/2026, la coupe 21:9 n'est plus couverte), sur une seule ligne, sans chevaucher le visage, lisible dans une vignette d'environ 320×180. Son texte est configurable (`bannerText`) : « Candidat automatisé, comme vous. » par défaut, variante anglaise « Automated candidate, just like you. ». Il n'est jamais vide ni désactivable, et doit dire clairement que le candidat est automatisé (pas de formulation générique comme « Avatar IA » seule).
2. **Révélation immédiate** : la première prise de parole de l'avatar annonce qu'il est une IA, y compris en mode « message » (la révélation précède la déclaration). Aucun réglage pour la retarder ou la supprimer.
3. **Aucun mode discret** : pas d'écran caché, pas de suggestion de réponses à lire, pas d'option pour tromper un interlocuteur humain.
4. **Avatar cartoon uniquement** : aucun import de photo, aucun clonage de visage ou de voix. Voix synthétique générique (Piper). La photo provisoire a été retirée à l'étape 5.
5. **Pas d'invention** : le prompt système interdit d'inventer expériences, diplômes ou chiffres. Le LLM répond uniquement à partir du CV et des notes de l'utilisateur.
6. **Permissions minimales** : `activeTab` + `scripting` + `offscreen` (document du pipeline voix), injection à la demande sur l'onglet actif. Jamais de `host_permissions`, et en particulier jamais sur `<all_urls>` : OpenAI et Hugging Face acceptent les requêtes CORS de l'extension sans permission d'hôte.

## Architecture

Pipeline cible de l'extension complète (voie A, injection, retenue pour la démo à l'étape 3) :

```
son du recruteur (son de l'onglet, partagé par la page avec l'accord de l'utilisateur)
  → VAD (Silero, web)
  → STT (API cloud)
  → LLM (API cloud, streaming, prompt système + CV)
  → TTS (Piper WebAssembly, voix synthétique générique)
  → avatar cartoon (canvas : personnage, bouche animée selon l'amplitude, bandeau)
  → flux caméra + micro injectés dans la page (remplacement de getUserMedia)
```

- La voix de l'avatar ne doit jamais repartir dans la transcription.
- Tout le texte généré par le LLM est streamé ; la voix est générée phrase par phrase pour limiter la latence (cible : < 1,5 s entre fin de question et début de réponse).
- Si le recruteur tente une injection de prompt, l'avatar reste dans son rôle.
- Mode « message » : l'avatar peut commencer, juste après la révélation, par une déclaration configurable (`messageText`), par exemple expliquer poliment que le candidat préfère un entretien avec un humain et en faire la demande, puis répondre aux questions.

## Stack

- TypeScript strict, extension Manifest V3.
- WXT pour une base de code unique Chromium (Chrome, Edge, Brave, Opera) + Firefox.
- Pas de backend : les appels partent directement de l'extension (document offscreen). Démo : clé API dans `config.local.json` ; projet : `chrome.storage.local`.
- Son du recruteur : son de l'onglet de l'entretien, partagé par la page elle-même (bouton injecté, fenêtre de partage de Chrome, `getDisplayMedia`), c'est-à-dire ce que la plateforme joue réellement, quel que soit son décodage ; aucune permission d'extension. Il ne contient ni le micro de l'utilisateur ni la voix de l'avatar, qui ne sort que par le micro injecté et par le retour audio du document offscreen (jamais vers `ctx.destination` dans la page). Son et voix circulent entre la page et le document offscreen par un pont en monde isolé (`bridge.content.ts`).
- Machine de référence modeste (16 Go RAM, GPU 4 Go ancien) : rien de lourd ne tourne en local dans le navigateur sauf VAD, TTS Piper et le canvas de l'avatar.

## Structure prévue

```
entrypoints/
  background.ts        # orchestration, appels API
  content.ts           # monde MAIN : injection getUserMedia, partage du son de l'onglet, voix de l'avatar
  bridge.content.ts    # monde isolé : relais page ↔ document offscreen
  offscreen/           # pipeline voix (VAD, STT, LLM, Piper)
  popup/               # boutons Activer / Désactiver (Pause / Reprendre la main : reporté)
  options/             # assistant de setup : clé API, CV, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  avatar/              # page de l'avatar (aperçu animé, voix simulée)
  voices/              # banc d'essai des voix : Piper (voix, réglages) et OpenAI, délais, écoute
lib/
  vad.ts  stt.ts  llm.ts  tts.ts  prompt.ts
  avatar.ts            # rendu du cadre : composition, yeux et bouche animés, bandeau (monde MAIN et pages)
  avatar-assets.ts     # pages de l'extension : SVG → images de l'avatar, variante, slogan courbé
  conversation.ts      # tour de parole, ouverture (révélation + messageText), latence
  config.ts            # lecture de local/config.json (généré depuis config.local.json)
  page-audio.ts        # monde MAIN : lecture de la voix dans le micro injecté
  share-tab.ts         # monde MAIN : son du recruteur, partage de l'onglet par la page (bouton, getDisplayMedia)
  monitor.ts           # offscreen : retour audio de la voix de l'avatar pour l'utilisateur
  tts.worker.ts        # worker de synthèse Piper
  tts-openai.ts        # synthèse OpenAI en streaming (option ttsProvider)
  chunks.ts            # découpe du texte du LLM en morceaux à synthétiser
  bridge-messages.ts  pcm.ts
  inject.ts            # remplacement getUserMedia / enumerateDevices (monde MAIN)
  injection-sources.ts # images de l'avatar sérialisées pour le monde MAIN
  test-audio.ts        # son de test du micro injecté (banc rehearsal?inject seulement)
  log.ts               # logs préfixés et horodatés
scripts/
  check-locales.ts     # vérification des fichiers _locales au build
  check-avatar-svg.ts  # vérification et correction des SVG de personnage au build
avatar/
  gabarit.svg  otherself.svg  fonds/   # personnage et fonds (SVG Inkscape)
public/fonts/          # Noto Sans Bold (OFL), police du slogan
docs/
  spec.md  config.md  visuel-otherself.md
```

## Démo (priorité actuelle)

L'objectif immédiat est une démo vidéo filmable, pas un produit. Le projet complet ne sera construit que si la démo suscite de l'intérêt.

Tout le code de la démo est écrit en TypeScript dans l'extension (rendu de l'avatar + modules `lib/`), pas en script séparé, pour être réutilisé tel quel dans le projet complet.

**Voie A, injection (retenue à l'étape 3)** : l'extension remplace caméra et micro dans l'onglet de l'entretien (`content.ts`, remplacement de getUserMedia et enumerateDevices, faux périphérique « Avatar IA – OtherSelf ») et récupère le son du recruteur depuis la page. Pas de routage audio système, bandeau intouchable. La voie B (caméra virtuelle OBS + routage PipeWire) a été écartée.

### Étapes (dans cet ordre, une à la fois)

1. **Faux recruteur** : fait. Page `rehearsal` qui demande caméra et micro, affiche le flux reçu et lit des questions à voix haute.
2. **Rendu avatar statique** : fait. `lib/avatar.ts` dessine l'image 1280×720 et le bandeau incrusté ; page `avatar` pour l'aperçu.
3. **Test d'injection** : fait, voie A retenue (testée sur Google Meet).
4. **Pipeline voix, avec le mode « message »** : son du recruteur → VAD → STT → LLM → Piper, la voix générée remplaçant le son de test comme piste du micro injecté. Critères : révélation dès la première prise de parole, puis `messageText` s'il est configuré, puis réponses fidèles au CV ; latence acceptable. Test sur Meet : `rehearsal` ne peut pas servir de recruteur (sa voix vient de la synthèse vocale du système, qui ne passe pas par le son de l'onglet).
5. **Visuel OtherSelf** : fait, selon `docs/visuel-otherself.md` (avatar cartoon original en SVG local à la place de la photo, variantes et fond choisis dans `config.local.json`, `bannerText` configurable, bouche animée par la voix). Le bandeau garde l'emplacement et les contraintes de la règle 1.
6. **Tournage** : enregistrement de la session (simple enregistrement d'écran) pour la vidéo et le post LinkedIn.

Ne pas commencer une étape avant que la précédente fonctionne.

## Projet (reporté, seulement si la démo suscite de l'intérêt)

- Assistant de setup (options) remplaçant `config.local.json`, utilisable par des non-techniciens.
- Guide pas à pas pour obtenir la clé API, avec estimation du coût par entretien.
- Permission micro sans réglage manuel du site (solution B) : remplacer aussi `navigator.permissions.query` dans le script injecté pour répondre « granted » à `camera` et `microphone` (Meet ne demande pas le micro tant que la permission réelle n'est pas accordée). Aucune permission d'extension en plus ; Meet peut avoir gardé l'ancienne réponse en mémoire.
- Vérifier `enumerateDevices` : Meet affichait « Speaker not found » avec la liste injectée (fausse caméra, faux micro, sorties audio réelles).
- Popup avec Activer / Pause / Reprendre la main.
- Latence (mesurée 2 à 3 s sur Meet, 6 à 11 s sur InterviewCoach avant les corrections du 25/10, cible 1,5 s) : seuil de silence réduit (`silenceMs`, 800 ms aujourd'hui) ; phrase d'attente préparée à l'avance, jouée dès la fin de la question pendant que le LLM répond (courte, neutre, sans rien affirmer sur le candidat).
- Performances Piper : multi-thread via COOP/COEP sur les pages d'extension (gain mesuré nul en « medium », ×2 en « high »).
- **Autres moteurs de voix étudiés le 29/10/2026, écartés : ne pas refaire ces tests sans élément nouveau** (machine plus rapide, multi-thread, WebGPU fiable). Sur la machine de référence, en WebAssembly sur un thread (comme le document offscreen), jeu « entretien » du banc d'essai, Piper norman : 0,15 à 0,20 × temps réel.
  - **Pocket TTS** (Kyutai, code MIT, poids CC BY 4.0 en accès conditionné ; voix Michael = VCTK p360, CC BY 4.0) : pas de portage navigateur prêt avec Michael (phonon-tts demande conversion et poids auto-hébergés ; export ONNX de KevinAHM sans Michael, fichier de licence CC BY-NC, ONNX Runtime chargé depuis un CDN) ; vitesse non mesurée (poids en accès conditionné), estimée vers 0,7 à 1,1 × temps réel.
  - **Kokoro-82M** (Apache 2.0 ; voix `am_echo` notée D, entraînée en partie sur de l'audio synthétique de TTS commerciaux, provenance non documentée) : 3 à 3,5 × temps réel (q8 et fp32) ; kokoro-js ne gère que l'anglais, seule voix française féminine (`ff_siwis`).
  - **KittenTTS 0.8** (poids Apache 2.0, provenance des voix non documentée ; portage non officiel kitten-tts-js, `@kittentts/web` n'existe pas) : nano-int8 et micro 0,8 à 1,06 × temps réel, mini 1,8 à 2 × ; seul Bruno vers 115 Hz.
  - **WebGPU** : aucun adaptateur proposé par Chrome sur la machine de référence (GTX 960M, Linux) ; on ne peut pas compter dessus pour les utilisateurs.
  - **LibriTTS** (Piper) : `libritts_r-medium` affiné à partir de `lessac` (à éviter pour une publication) ; `libritts-high` 1,3 à 1,5 × temps réel.
- Cadrage automatique des plateformes (Framing sur Meet) : il zoome sur le visage et coupe le bandeau ; pour la démo, il est désactivé côté A. Pour le projet, garantir la visibilité du bandeau même avec ce zoom (au minimum la version intégrée au personnage de l'étape 5, et une consigne dans l'assistant).
- Publication sur le Chrome Web Store, version Firefox, i18n complète, export intégré (enregistrement avec sous-titres).
- Lien vers une explication des droits des candidats face aux décisions automatisées (RGPD, AI Act), à faire vérifier juridiquement.
- Avertissement clair dans le README et l'assistant : utiliser OtherSelf dans une vraie candidature, c'est probablement renoncer au poste.

Le dépôt est publié avec le post, même au stade de démo. Le README le présente comme tel : prototype, projet complet à venir si le sujet intéresse.

Les règles non négociables s'appliquent dès maintenant, y compris pour la démo.

## Conventions

- Logs préfixés par module (`[vad]`, `[stt]`, `[llm]`, `[tts]`, `[avatar]`, `[inject]`), avec horodatage pour mesurer la latence.
- L'injection et le routage audio ne peuvent être vérifiés que dans un vrai navigateur : après une modification de ces parties, indiquer précisément ce que l'utilisateur doit tester et quels logs observer.
- Tester sur les plateformes avec le **build de production** (`npm run build`, dossier `.output/chrome-mv3`) : en mode dev (`npm run dev`), WXT ajoute ses propres permissions et son rechargement à chaud, et l'extension plantait dès l'activation sur Meet.
- Commits petits et fréquents, un par étape ou sous-étape fonctionnelle.
- Interface et textes utilisateur en français et anglais (i18n de WXT), après la démo.
- README : mission, statut de prototype, règles ci-dessus présentées comme des choix de conception, avertissement sur la candidature, pas de support garanti.
