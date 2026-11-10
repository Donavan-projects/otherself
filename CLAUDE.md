# OtherSelf

Instructions pour tout contributeur. L'état d'avancement, le journal des tests et les détails propres à une machine
vont dans `CLAUDE.local.md` (non versionné, lu automatiquement par Claude Code après ce fichier).

## Mission

Donner aux candidats un moyen de réagir à un entretien automatisé qu'ils jugent injuste : répondre par leur propre avatar IA, clairement identifié comme tel. Utilisable par tous, techniciens ou non. L'humour n'est plus le cœur du projet.

`docs/spec.md` est le pitch initial (Contre-Recruteur, satirique) : en partie dépassé, ce fichier fait foi. Le projet s'appelle OtherSelf depuis le 24/10/2026 ; le dossier garde son ancien nom pour ne pas changer l'identifiant de l'extension.

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

Pipeline de l'extension (voie A, injection) :

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
- **Voie A, injection** : l'extension remplace caméra et micro dans l'onglet de l'entretien (`content.ts`, remplacement de getUserMedia et enumerateDevices, faux périphérique « Avatar IA – OtherSelf ») et récupère le son du recruteur depuis la page. Pas de routage audio système, bandeau intouchable. La voie B (caméra virtuelle OBS + routage PipeWire) a été écartée.

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
  popup/               # boutons Activer / Désactiver (Pause / Reprendre la main : reporté)
  options/             # assistant de setup : clé API, CV, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  avatar/              # page de l'avatar (aperçu animé, voix simulée)
  voices/              # banc d'essai des voix : Piper (voix, réglages, hauteur) et OpenAI, délais, écoute
  vrm/                 # aperçu de l'avatar 3D (prototype VRM) : voix simulée, images/s, temps de dessin
lib/
  vad.ts  stt.ts  llm.ts  tts.ts  prompt.ts  greeting.ts
  avatar.ts            # rendu du cadre : composition, yeux et bouche animés, bandeau (monde MAIN et pages)
  avatar-assets.ts     # pages de l'extension : SVG → images de l'avatar, variante, slogan courbé
  avatar-vrm.ts        # prototype VRM : rendu three.js + three-vrm dans le même canvas, animation, repli SVG
  vrm-assets.ts        # prototype VRM, pages de l'extension : cadrage, slogan à plat (repris du SVG), fond
  vrm-frame.ts         # prototype VRM : caméra et projection (sans three.js), partagées popup / page
  glb.ts               # lecture / écriture GLB (VRM) sans dépendance (script et extension)
  conversation.ts      # tour de parole, ouverture (révélation + messageText), latence
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
  preview-popup.ts     # popup : bouton « Aperçu de l'avatar » (option previewWindow)
  log.ts               # logs préfixés et horodatés
scripts/
  check-locales.ts     # vérification des fichiers _locales au build
  check-avatar-svg.ts  # vérification et correction des SVG de personnage au build
  optimize-vrm.ts      # MANUEL (npm run vrm) : inspection et allègement du VRM exporté par VRoid
avatar/
  gabarit.svg  otherself.svg  otherself-v1.svg  fonds/   # personnages et fonds (SVG Inkscape)
  otherself.vrm        # avatar 3D allégé (commité) ; la source VRoid Otherself.vrm est ignorée par git
public/fonts/          # Noto Sans Bold (OFL), police du slogan
docs/
  spec.md  config.md  visuel-otherself.md  tournage.md
```

## Décisions techniques (à connaître avant de modifier)

- **Son du recruteur** (`lib/share-tab.ts`) : après l'activation, un bouton injecté ouvre la fenêtre de partage standard de Chrome sur l'onglet courant, son compris (`getDisplayMedia`, `preferCurrentTab`, version d'origine reprise d'un cadre vierge si la plateforme l'a remplacée). La vidéo du partage est arrêtée aussitôt, le flux n'est jamais remis à la plateforme ; le son est lu par AudioWorklet (URL blob, ou `MediaStreamTrackProcessor` si la CSP refuse le blob) et part vers le document offscreen à 24 kHz (16 kHz pour Silero). `tabCapture` a été retiré : Chrome l'annonce comme « Lire et modifier toutes vos données sur tous les sites Web ».
- **Ne jamais réactiver l'annulation d'écho, la réduction de bruit ni le gain automatique sur la capture du recruteur** : l'annulation d'écho prend la sortie de l'onglet comme référence, c'est-à-dire le son à capter, et le détruit. Les trois sont coupés dans les contraintes de `getDisplayMedia` et leurs réglages effectifs sont logués.
- **Pas les pistes WebRTC** : Meet décode l'audio reçu en WebAssembly (NetEq) et le joue par Web Audio ; ses pistes WebRTC et ses éléments `<audio>` restent silencieux.
- **Ouverture** : révélation puis `messageText`, jouée à la fin de la première prise de parole du recruteur, quand la plateforme a demandé le micro ; une seule révélation. Pendant l'ouverture, seuil d'interruption relevé à 2 s ; coupée après la révélation, elle n'est pas rejouée ; coupée avant, elle est rejouée une fois ; rappel court (« As a reminder… ») seulement ensuite. Nouvelle page = nouvel entretien (le compteur des réponses, lui, continue). Une première prise de parole réduite à une salutation (`lib/greeting.ts`, « how are you » et « ça va » compris) reçoit l'ouverture seule, sans appel au LLM. Le LLM ne reçoit pas le texte de l'ouverture : le prompt dit qu'elle a été prononcée, interdit de la répéter, de se présenter ou de saluer, et demande une phrase honnête si on lui demande s'il est humain.
- **Troisième personne** : l'avatar parle du candidat par son nom (`candidateName`), « you » du recruteur = le candidat, « I » réservé à l'avatar.
- **Écho** : casque recommandé. Protections : seuil d'interruption (`bargeInMs`, 600 ms de parole réelle par-dessus l'avatar), transcription reprenant surtout les mots de l'avatar ignorée, alerte `[vad]` si de la parole est détectée pendant que l'avatar parle.
- **LLM** : `gpt-5.6-luna` par défaut, en streaming, `reasoning_effort: none`. `gpt-6-luna` reste possible mais son premier mot varie fortement (attente côté API). Logs `[llm]` : une ligne par appel (en-têtes, premier mot, fin, tokens dont cache et raisonnement, identifiant de requête) ; `openai-processing-ms` n'est pas exposé aux navigateurs (CORS). Prompt pour l'oral : première phrase de 3 à 6 mots, deux phrases au plus sauf demande de détails, trois éléments au plus, deux noms de projets au plus, contractions.
- **Voix** : portée par le personnage (`data-voix`, `data-voix-openai`, `data-voix-hauteur` sur la racine du SVG), les champs de `config.local.json` l'emportent. `otherself` : `en_US-norman-medium` (LibriVox, domaine public, entraînée de zéro), +1,5 demi-ton. **Jamais `en_US-joe-medium` ni `en_US-libritts_r-medium` pour une publication** : affinées à partir de `lessac` (licence Blizzard 2013, recherche). Réglages Piper (`DEFAULT_PIPER_SCALES`) : length_scale 0,92, noise_scale 0,8, noise_w 1. Voix normalisée (−18 dBFS RMS, crête ≤ −1 dBFS). Découpe des réponses (`lib/chunks.ts`) uniquement à la ponctuation, jamais devant une conjonction ou une préposition, premier morceau court.
- **Hauteur de la voix** (`pitchSemitones`) : synthèse Piper avec `length_scale` × f (f = 2^(n/12)), audio déclaré à une fréquence f fois plus haute (équivaut à un playbackRate de f) : débit inchangé, durées calculées justes, bouche synchronisée sur le son joué.
- **Option `ttsProvider: "openai"`** (`gpt-4o-mini-tts`, PCM en streaming) : le flux arrive parfois plus lentement que le temps réel (trous dans la voix) ; pas pour la démo.
- **Avatar** : personnage SVG (`avatar/otherself.svg`, gabarit et règles dans `avatar/gabarit.svg`, vérifié et corrigé au build par `scripts/check-avatar-svg.ts`), fond `avatar/fonds/bureau-clair.svg` par défaut. Le popup prépare l'avatar (`lib/avatar-assets.ts`) : variante de `config.local.json`, calques rastérisés à l'échelle du cadre, slogan (`bannerText`) imprimé et courbé sur le t-shirt en Noto Sans Bold embarquée, sur plusieurs lignes selon la forme de la zone (`data-lignes-max`), surimpression du tissu. La page ne reçoit que des images (ni configuration ni clé). Seule la zone des yeux et de la bouche est redessinée à chaque image ; bandeau peint en dernier. Bouche pilotée par le niveau RMS du micro injecté : repos, M, E, puis A et O en alternance ; clignements aléatoires.
- **Cadrage du cadre 1280×720** : haut de la tête à y = 94, bas du slogan à y = 517 (`data-bas-cadre`, au plus 550). Bandeau centré, 580 × 62 px, de y = 608 à 670, juste au-dessus de la coupe de Meet sans cadrage ; `bannerOffsetY` le remonte, jamais sur le slogan.
- **Répartition bandeau / slogan** : sans cadrage automatique, le bandeau est l'élément principal (règle 1). Avec le cadrage automatique, le bandeau peut être coupé ; la transparence est alors assurée par le slogan du t-shirt et par la révélation vocale (règle 2).
- **Désactivation** : bouton du popup (injection retirée, pistes arrêtées, partage arrêté, document offscreen fermé). Onglet fermé ou rechargé : partage et pont s'arrêtent d'eux-mêmes.
- **Micro sur Meet** : Meet n'affiche pas toujours « Avatar IA – OtherSelf » tant qu'on ne change pas de micro dans son menu ; `devicechange` est envoyé à l'installation puis à +1 s et +3 s.
- **Avatar 3D (prototype, branche `prototype-vrm`, `avatarRenderer: "vrm"`)** : modèle VRoid (VRM 1.0) rendu par three.js + three-vrm dans un canvas WebGL hors DOM, recopié à chaque image dans le canvas 2D capturé par-dessus le fond, **bandeau peint en dernier dans le canvas 2D** (règle 1 inchangée). Le SVG reste le défaut et le secours : rendu WebGL logiciel (SwiftShader, llvmpipe), échec du chargement ou contexte WebGL perdu → avatar SVG dans le même canvas, sans changer de piste. Textures décodées depuis le fichier par `createImageBitmap` (plugin de `GLTFLoader`), jamais par URL blob + fetch, que la CSP d'une plateforme peut bloquer. `npm run vrm -- optimize` est **manuel** (la source n'est pas commitée, le build ne doit pas en dépendre) : miniature, pantalon, chaussures, cordons de capuche et morph targets inutilisés retirés, textures ≤ 1024 px (15,5 → 5,4 Mo) ; gltf-transform n'est pas utilisé (il supprime les extensions VRMC). Cadrage (`lib/vrm-frame.ts`, calculé par le popup) : haut des cheveux à y = 94, devant du sweat à y = 517 au repère `VRM_FRAME_ANCHOR` (51,4 % de `chest` vers `upperChest`), validé sur Meet. Les repères (cadrage, haut du slogan) sont définis **par les os du squelette**, pas en mètres, pour suivre les proportions du modèle à chaque réexport ; positions des os calculées avec les matrices glTF (VRoid met des rotations sur la colonne). Slogan : **même rendu que le SVG**, paramètres repris de `buildAvatarAssets` (taille de `badge_zone_texte` dans le cadre, `data-lignes-max`, encre `badge-fond`, Noto Sans Bold, police ≈ 27 px, 3 lignes), sans courbure (le torse 3D la donne), en haut du torse (`VRM_SLOGAN_TOP` : 66,3 % de `upperChest` vers `neck`, y ≈ 380). Le popup le dessine à plat (image) ; la page l'imprime dans la texture du sweat (agrandie à 2048 px) **sur le personnage posé** : chaque triangle visible du sweat est projeté par la caméra et reçoit sa transformation affine cadre → texture. Projeter le modèle en T-pose déformait les lettres près des épaules (skinning des bras baissés). Éclairage : une seule lumière directionnelle d'intensité π, comme les exemples de three-vrm ; une lumière ambiante délave MToon (peau mesurée 241,212,191 comme la miniature de VRoid, 255,246,222 avec une ambiante de 0,4π). Les textures de couleur sont bien en sRGB (three-vrm les marque lui-même). Bouche : `MouthAnimator` inchangé, formes traduites en expressions VRM (repos et M : tout à 0, lèvres fermées ; E : ee 0,6 + ih 0,3 ; A : aa 0,8 ; O : oh 0,7 + ou 0,2), lissage 45 ms à l'ouverture, 80 ms à la fermeture. Le compteur de triangles de three.js (≈ 65 000) compte deux fois les primitives à contour MToon (≈ 35 000 triangles réels). Contrôle visuel : `vrm.html?mouth=A&still=1` (forme de bouche imposée, ni clignement ni mouvement). Physique des cheveux et anticrénelage gardés (mode allégé sans intérêt mesuré). Licence du modèle : VRM Public License 1.0 (usage commercial autorisé), hors GPL, voir `THIRD_PARTY_NOTICES.md`. **Pièces VRoid** : utiliser un modèle fait avec VRoid Studio est autorisé, mais une application qui génère des avatars à partir des pièces de VRoid (cheveux, vêtements, textures prédéfinis) demande une licence séparée de pixiv (https://vroid.pixiv.help/hc/en-us/articles/4405813333657) : un futur créateur d'avatar dans OtherSelf ne doit utiliser que des pièces qui ne viennent pas de VRoid.
- **Licence : GPL-3.0-or-later** (`LICENSE`), imposée par eSpeak NG (GPL-3.0) embarqué dans `piper_phonemize`. Composants tiers, voix, police et images : `THIRD_PARTY_NOTICES.md`, copié avec `LICENSE` dans l'extension construite. Configuration locale : `docs/config.md`.

## Démo (priorité actuelle)

L'objectif immédiat est une démo vidéo filmable, pas un produit. Le projet complet ne sera construit que si la démo suscite de l'intérêt.

Tout le code de la démo est écrit en TypeScript dans l'extension (rendu de l'avatar + modules `lib/`), pas en script séparé, pour être réutilisé tel quel dans le projet complet.

### Étapes (dans cet ordre, une à la fois)

1. **Faux recruteur** : fait. Page `rehearsal` qui demande caméra et micro, affiche le flux reçu et lit des questions à voix haute.
2. **Rendu avatar statique** : fait. `lib/avatar.ts` dessine l'image 1280×720 et le bandeau incrusté ; page `avatar` pour l'aperçu.
3. **Test d'injection** : fait, voie A retenue (testée sur Google Meet).
4. **Pipeline voix, avec le mode « message »** : fait. Son du recruteur → VAD → STT → LLM → Piper, la voix générée comme piste du micro injecté. Test sur Meet : `rehearsal` ne peut pas servir de recruteur (sa voix vient de la synthèse vocale du système, qui ne passe pas par le son de l'onglet).
5. **Visuel OtherSelf** : fait, selon `docs/visuel-otherself.md` (avatar cartoon original en SVG à la place de la photo, variantes et fond choisis dans `config.local.json`, `bannerText` configurable, bouche animée par la voix). Le bandeau garde les contraintes de la règle 1.
6. **Tournage** : enregistrement de la session (simple enregistrement d'écran) pour la vidéo et le post LinkedIn.

Ne pas commencer une étape avant que la précédente fonctionne.

## Projet (reporté, seulement si la démo suscite de l'intérêt)

- Assistant de setup (options) remplaçant `config.local.json`, utilisable par des non-techniciens.
- Guide pas à pas pour obtenir la clé API, avec estimation du coût par entretien.
- Permission micro sans réglage manuel du site (solution B) : remplacer aussi `navigator.permissions.query` dans le script injecté pour répondre « granted » à `camera` et `microphone` (Meet ne demande pas le micro tant que la permission réelle n'est pas accordée). Aucune permission d'extension en plus ; Meet peut avoir gardé l'ancienne réponse en mémoire.
- Vérifier `enumerateDevices` : Meet affichait « Speaker not found » avec la liste injectée (fausse caméra, faux micro, sorties audio réelles).
- Popup avec Activer / Pause / Reprendre la main.
- Latence (cible 1,5 s) : seuil de silence réduit (`silenceMs`, 800 ms aujourd'hui) ; phrase d'attente préparée à l'avance, jouée dès la fin de la question pendant que le LLM répond (courte, neutre, sans rien affirmer sur le candidat).
- Bouche pilotée par le texte (après le prototype VRM) : piper-tts-web ne renvoie que l'audio (`predict()`), et les modèles Piper standard n'ont pas de sortie de durées ; les identifiants de phonèmes sont accessibles par le remplacement de `session.run` déjà présent dans `lib/tts.worker.ts`. Pistes : vérifier les sorties du modèle norman (`outputNames`), réexporter la voix avec les durées, ou aligner les phonèmes sur l'audio ; puis associer phonèmes → expressions VRM, synchronisés sur la lecture réelle (`playback-started`).
- Performances Piper : multi-thread via COOP/COEP sur les pages d'extension (gain mesuré nul en « medium », ×2 en « high ») ; demande une modification du manifeste.
- **Autres moteurs de voix étudiés et écartés (29/10/2026) : ne pas refaire ces tests sans élément nouveau** (machine plus rapide, multi-thread, WebGPU fiable). En WebAssembly sur un thread, tous sont trop lents pour répondre en direct (à peu près le temps réel ou plus lent, contre 0,15 à 0,20 × pour Piper medium) ; mesures détaillées dans `CLAUDE.local.md`.
  - **Pocket TTS** (Kyutai, code MIT, poids CC BY 4.0 en accès conditionné ; voix Michael = VCTK p360, CC BY 4.0) : pas de portage navigateur prêt avec Michael (phonon-tts demande une conversion et des poids auto-hébergés ; l'export ONNX de KevinAHM n'a pas Michael, porte un fichier de licence CC BY-NC et charge ONNX Runtime depuis un CDN).
  - **Kokoro-82M** (Apache 2.0) : voix `am_echo` peu entraînée, en partie sur de l'audio synthétique de TTS commerciaux, provenance non documentée ; kokoro-js ne gère que l'anglais (seule voix française : `ff_siwis`, féminine).
  - **KittenTTS 0.8** (poids Apache 2.0, provenance des voix non documentée) : pas de paquet navigateur officiel (`@kittentts/web` n'existe pas ; kitten-tts-js est non officiel).
  - **WebGPU** : non fiable sous Linux avec un GPU ancien ; on ne peut pas compter dessus pour les utilisateurs.
  - **LibriTTS** (Piper) : `libritts_r-medium` affiné à partir de `lessac` (à éviter pour une publication) ; `libritts-high` trop lent.
- **Cadrage automatique des plateformes** (Framing sur Meet) : il détecte le visage cartoon, zoome et coupe le bandeau ; pour la démo, il est désactivé côté avatar. **Avec un fond virtuel de Meet**, la segmentation détecte la silhouette de l'avatar et réactive le cadrage automatique, qui coupe le bandeau puis une partie du slogan (jusqu'à « Automated » seul). Pour la démo : garder le fond de l'avatar ou désactiver le cadrage. Pistes pour plus tard : un marqueur IA proche du visage (badge au col ou sur l'épaule) qui survive au zoom, et une consigne dans le guide utilisateur.
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
- Banc d'essai sans plateforme : page `voices` (voix, réglages, hauteur, jeu « entretien ») et page `avatar` (aperçu animé).

## Conventions

- Logs préfixés par module (`[vad]`, `[stt]`, `[llm]`, `[tts]`, `[avatar]`, `[inject]`), avec horodatage pour mesurer la latence.
- L'injection et le routage audio ne peuvent être vérifiés que dans un vrai navigateur : après une modification de ces parties, indiquer précisément ce que l'utilisateur doit tester et quels logs observer.
- Commits petits et fréquents, un par étape ou sous-étape fonctionnelle.
- Interface et textes utilisateur en français et anglais (i18n de WXT), après la démo.
- README : mission, statut de prototype, règles ci-dessus présentées comme des choix de conception, avertissement sur la candidature, pas de support garanti.
- Données personnelles et de travail jamais commitées : `config.local.json`, `local/`, `design/references/`, `CLAUDE.local.md`.
