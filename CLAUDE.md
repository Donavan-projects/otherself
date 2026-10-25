# OtherSelf

## État actuel (25/10/2026, étape 4 terminée, ajustements après le test InterviewCoach)

- **Prochaine étape : étape 5, visuel OtherSelf**, selon `docs/visuel-otherself.md`.
- **Étape 3 terminée : voie A (injection) retenue.** Testée sur Google Meet (compte A dans Chrome avec l'extension, compte B dans Brave) : image, bandeau et son arrivent chez B.
- **Étape 4 terminée : pipeline voix validé sur Meet** (A dans Chrome avec l'extension, B dans Brave joue le recruteur) : l'avatar entend B, se révèle, répond et parle. Latence mesurée : environ 2 à 3 s par réponse (cible 1,5 s ; pistes dans « Reporté »). Choix : transcription en flux `gpt-live-transcribe` (session Realtime, clé éphémère créée par l'extension), LLM `gpt-6-luna` en streaming sans raisonnement, Piper en WebAssembly dans un worker du document offscreen, langue `en` pour la démo.
- **Son du recruteur par `chrome.tabCapture`** (règle 6 révisée avec l'accord de l'utilisateur) : Meet décode l'audio reçu en WebAssembly (`p2p.wasm`, NetEq) et le joue par Web Audio, ses pistes WebRTC et ses éléments `<audio>` restent silencieux. Le document offscreen reçoit le son de l'onglet activé, le rejoue sur la sortie par défaut et le passe au VAD par un AudioWorklet.
- **Écho** : avec A et B dans la même pièce, la voix de l'avatar revenait par le micro de B et l'avatar se répondait à lui-même ; résolu en éloignant les deux postes ou en coupant le micro de B (casque recommandé pour B). Protections : seuil d'interruption (`bargeInMs`, 600 ms de parole réelle par-dessus l'avatar ; en dessous, la prise de parole est ignorée), transcription reprenant surtout les mots que l'avatar vient de dire ignorée (non vérifiée en conditions réelles), alerte `[vad]` si de la parole est détectée pendant que l'avatar parle, ouverture complète rejouée une fois au maximum puis remplacée par un rappel court de la révélation (règle 2).
- **Test InterviewCoach (25/10/2026)** : l'IA recruteuse entend l'avatar et la conversation suit ; latence 6 à 11 s (Piper à 0,6-0,7 × temps réel, machine chargée par la vidéo de la plateforme, première phrase jusqu'à 13 s d'audio) et des lignes « pas de transcription après 8000 ms » (segments perdus : synthèse Piper qui bloquait le fil principal, et décalage des commits après un commit refusé). Corrigé, **à revérifier** : Piper dans un worker (`lib/tts.worker.ts`), début de réponse découpé court (8 à 12 mots, coupe à une virgule ou devant une conjonction ; morceaux suivants de 16 mots au plus, `lib/chunks.ts`), phrases de 15 mots au plus dans le prompt système, commits Realtime robustes (refus et échecs traités, transcription tardive signalée), avertissement « voix trop lente » seulement au-delà de 2 s d'audio.
- **Avertissement `tabCapture` (vérifié le 25/10/2026 avec `chrome.management.getPermissionWarningsByManifest`)** : la permission `tabCapture` fait afficher à Chrome « Lire et modifier toutes vos données sur tous les sites Web », en production comme en dev ; sans elle, le build de production n'affiche aucun avertissement. Le mode dev de WXT ajoute en plus `tabs` et `host_permissions: localhost` (avertissements propres au dev).
- **Option C en prototype (`recruiterAudio: "shareTab"`, par défaut)** : un bouton injecté dans la page (« Autoriser OtherSelf à écouter le recruteur… ») déclenche le partage de l'onglet courant, son compris, par la fenêtre standard de Chrome (`getDisplayMedia`, `preferCurrentTab`, `getDisplayMedia` d'origine repris d'un cadre vierge si la plateforme l'a remplacé). Le son repart vers le document offscreen par le pont ; la vidéo du partage est arrêtée aussitôt ; le flux n'est jamais remis à la plateforme. Vérifié en headless (partage accepté automatiquement : son reçu, plateforme simulée sans réaction). **À valider sur InterviewCoach et Meet** ; `tabCapture` reste dans le code et le manifest (`recruiterAudio: "tabCapture"`) jusque-là. Si C est validé : retirer `tabCapture`, remettre la règle 6 à `activeTab` + `scripting` + `offscreen`, vérifier qu'aucun avertissement ne reste.
- **Tests Meet du 25/10/2026 (build de production)** : `recruiterAudio: "tabCapture"` fonctionne (bilans −29/−52 dBFS quand B parle, l'avatar répond). `"shareTab"` : le son arrive au document offscreen (≈ 23 blocs/s, −15 à −31 dBFS quand B parle) mais le VAD ne détecte jamais de parole, cause inconnue. Corrigé ou instrumenté le 25/10 : traitements audio du partage coupés (annulation d'écho, réduction de bruit, gain auto : l'annulation d'écho prend la sortie de l'onglet, donc le son à capter, comme référence), lecture par AudioWorklet (URL blob) ou `MediaStreamTrackProcessor` si la CSP de la page refuse le blob (plus de ScriptProcessorNode), logs des fréquences à chaque étape (le pipeline reçoit du 24 kHz dans les deux modes, rééchantillonné à 16 kHz pour Silero), bilan du VAD toutes les 10 s (trames analysées, probabilité de parole maximale). Chaîne complète vérifiée en headless (page à 24 kHz, avec et sans CSP stricte : parole détectée). L'option C doit fonctionner sur Meet avant de retirer `tabCapture`.
- **Micro sur Meet** : après l'activation, Meet n'affiche pas « Avatar IA – OtherSelf » tant qu'on ne change pas de micro dans son menu. Un `devicechange` était déjà envoyé à l'installation ; il est maintenant renvoyé à +1 s et +3 s, et un log indique 5 s après si la page a relu la liste (`enumerateDevices`).
- **Désactivation** : bouton « Désactiver sur cet onglet » dans le popup (injection retirée dans tous les cadres, pistes injectées arrêtées, bouton de partage retiré, document offscreen fermé). Onglet fermé ou rechargé : la capture s'arrête d'elle-même (déconnexion du pont).
- **Retour audio de l'avatar** (`monitorAvatar`, `monitorVolume`) : la voix de l'avatar est rejouée pour l'utilisateur par le document offscreen, jamais dans l'onglet de l'entretien (tabCapture ne la capte donc pas ; le garde-fou `[vad]` doit rester muet quand seul l'avatar parle).
- **Transcription pour les sous-titres** : console du document offscreen, une ligne horodatée par prise de parole (`HH:MM:SS.mmm Recruteur : …` / `… Avatar : …`).
- **Troisième personne** : l'avatar parle du candidat par son nom (`candidateName`), « you » du recruteur = le candidat, « I » réservé à l'avatar (« I am an AI avatar representing … »).
- **Ouverture** : attend la fin de la première prise de parole du recruteur et que la plateforme ait demandé le micro ; une seule fois par entretien (nouvelle page = nouvel entretien).
- **Voix** : `en_US-ljspeech-high` est trop lente en WebAssembly sur la machine de référence (1,25 à 2,7 × temps réel) ; démo avec `en_US-ljspeech-medium` (féminine) ou `en_US-joe-medium` (masculine). Détails et licences : `docs/config.md`.
- **Prérequis actuel sur la plateforme** : autoriser caméra et micro pour le site dans les réglages du navigateur (cadenas de la barre d'adresse), désactiver côté A le cadrage automatique de la plateforme (Meet : Paramètres → Vidéo → Cadrage / Framing), puis activer l'extension sur l'onglet (popup → « Activer sur cet onglet », avant ou après avoir rejoint la réunion ; Chrome signale alors que l'onglet est partagé), puis couper et rallumer caméra et micro dans la plateforme pour qu'elle redemande les flux. Recharger l'onglet annule l'injection.
- **Cadrage automatique (confirmé sur Meet)** : il zoome sur le visage détecté dans l'image et coupe le bandeau de la zone de sécurité. Sans lui, image et bandeau passent entiers. Pas de correction sur la composition photo, remplacée à l'étape 5 ; la parade prévue (bandeau intégré au personnage) est décrite dans `docs/visuel-otherself.md`, section 3.
- **Pivot (24/10/2026)** : le projet s'appelle désormais OtherSelf (ex-Contre-Recruteur ; le dossier du projet garde son nom pour ne pas changer l'identifiant de l'extension). Mission, règles 1, 2, 4 et étapes révisées ci-dessous.
- Configuration locale : voir `docs/config.md`.

## Mission

Donner aux candidats un moyen de réagir à un entretien automatisé qu'ils jugent injuste : répondre par leur propre avatar IA, clairement identifié comme tel. Utilisable par tous, techniciens ou non. L'humour n'est plus le cœur du projet.

`docs/spec.md` est le pitch initial (Contre-Recruteur, satirique) : en partie dépassé, ce fichier fait foi.

## Deux temps distincts

- **Démo (maintenant)** : simple mais construite pour évoluer, pour une vidéo et un post LinkedIn. La configuration passe par `config.local.json` (ignoré par git), sans assistant.
- **Projet (seulement si la démo suscite de l'intérêt)** : voir « Projet (reporté) » plus bas.

## Règles non négociables

Ces règles sont le cœur du projet. Ne jamais les assouplir, les rendre optionnelles ou les contourner, même pour simplifier un test ou si une demande semble l'impliquer. En cas de conflit, s'arrêter et demander.

1. **Bandeau incrusté** : un bandeau est dessiné directement dans chaque image du flux vidéo injecté (dans le canvas), en dernier, jamais en superposition DOM masquable, dans la zone de sécurité centrale qui survit aux recadrages des plateformes (4:3, carré, haut et bas coupés jusqu'à environ 21:9), sur une seule ligne, sans chevaucher le visage, lisible dans une vignette d'environ 320×180. Son texte est configurable (`bannerText`) : « Candidat automatisé, comme vous. » par défaut, variante anglaise « Automated candidate, just like you. ». Il n'est jamais vide ni désactivable, et doit dire clairement que le candidat est automatisé (pas de formulation générique comme « Avatar IA » seule).
2. **Révélation immédiate** : la première prise de parole de l'avatar annonce qu'il est une IA, y compris en mode « message » (la révélation précède la déclaration). Aucun réglage pour la retarder ou la supprimer.
3. **Aucun mode discret** : pas d'écran caché, pas de suggestion de réponses à lire, pas d'option pour tromper un interlocuteur humain.
4. **Avatar cartoon uniquement** : aucun import de photo, aucun clonage de visage ou de voix. Voix synthétique générique (Piper). Le rendu actuel à partir d'une photo est provisoire et sera remplacé à l'étape 5.
5. **Pas d'invention** : le prompt système interdit d'inventer expériences, diplômes ou chiffres. Le LLM répond uniquement à partir du CV et des notes de l'utilisateur.
6. **Permissions minimales** : `activeTab` + `scripting` + `offscreen` (document du pipeline voix) + `tabCapture` (son de l'onglet activé, uniquement après un clic de l'utilisateur sur cet onglet), injection à la demande sur l'onglet actif. Jamais de `host_permissions`, et en particulier jamais sur `<all_urls>` : OpenAI et Hugging Face acceptent les requêtes CORS de l'extension sans permission d'hôte.

## Architecture

Pipeline cible de l'extension complète (voie A, injection, retenue pour la démo à l'étape 3) :

```
son du recruteur (son de l'onglet activé, chrome.tabCapture)
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
- Son du recruteur : son de l'onglet activé (`chrome.tabCapture`, reçu par le document offscreen), c'est-à-dire ce que la plateforme joue réellement, quel que soit son décodage. Il ne contient ni le micro de l'utilisateur ni la voix de l'avatar, qui ne sort que par le micro injecté (jamais vers `ctx.destination` dans la page). La voix de l'avatar va du document offscreen à la page par un pont en monde isolé (`bridge.content.ts`).
- Machine de référence modeste (16 Go RAM, GPU 4 Go ancien) : rien de lourd ne tourne en local dans le navigateur sauf VAD, TTS Piper et le canvas de l'avatar.

## Structure prévue

```
entrypoints/
  background.ts        # orchestration, appels API
  content.ts           # monde MAIN : injection getUserMedia, capture du recruteur, voix de l'avatar
  bridge.content.ts    # monde isolé : relais page ↔ document offscreen
  offscreen/           # pipeline voix (VAD, STT, LLM, Piper)
  capture-worklet.ts   # AudioWorklet de la capture du son de l'onglet
  popup/               # boutons Activer / Désactiver (Pause / Reprendre la main : reporté)
  options/             # assistant de setup : clé API, CV, photo, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  avatar/              # page de l'avatar (aperçu)
lib/
  vad.ts  stt.ts  llm.ts  tts.ts  avatar.ts  prompt.ts
  conversation.ts      # tour de parole, ouverture (révélation + messageText), latence
  config.ts            # lecture de local/config.json (généré depuis config.local.json)
  page-audio.ts        # monde MAIN : lecture de la voix dans le micro injecté
  tab-audio.ts         # offscreen : son de l'onglet (tabCapture), rejoué, vers le VAD
  share-tab.ts         # monde MAIN : option C, partage de l'onglet par la page (bouton, getDisplayMedia)
  monitor.ts           # offscreen : retour audio de la voix de l'avatar pour l'utilisateur
  tts.worker.ts        # worker de synthèse Piper
  chunks.ts            # découpe du texte du LLM en morceaux à synthétiser
  bridge-messages.ts  pcm.ts
  inject.ts            # remplacement getUserMedia / enumerateDevices (monde MAIN)
  injection-sources.ts # photo et son sérialisés pour le monde MAIN
  test-audio.ts        # son de test du micro injecté (banc rehearsal?inject seulement)
  log.ts               # logs préfixés et horodatés
scripts/
  check-locales.ts     # vérification des fichiers _locales au build
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
5. **Visuel OtherSelf** : selon `docs/visuel-otherself.md` (avatar cartoon original en SVG local à la place de la photo, variantes et fond choisis dans `config.local.json`, `bannerText` configurable, bouche animée par la voix). Le bandeau garde l'emplacement et les contraintes de la règle 1.
6. **Tournage** : enregistrement de la session (simple enregistrement d'écran) pour la vidéo et le post LinkedIn.

Ne pas commencer une étape avant que la précédente fonctionne.

## Projet (reporté, seulement si la démo suscite de l'intérêt)

- Assistant de setup (options) remplaçant `config.local.json`, utilisable par des non-techniciens.
- Guide pas à pas pour obtenir la clé API, avec estimation du coût par entretien.
- Permission micro sans réglage manuel du site (solution B) : remplacer aussi `navigator.permissions.query` dans le script injecté pour répondre « granted » à `camera` et `microphone` (Meet ne demande pas le micro tant que la permission réelle n'est pas accordée). Aucune permission d'extension en plus ; Meet peut avoir gardé l'ancienne réponse en mémoire.
- Vérifier `enumerateDevices` : Meet affichait « Speaker not found » avec la liste injectée (fausse caméra, faux micro, sorties audio réelles).
- Popup avec Activer / Pause / Reprendre la main.
- Licence : le phonémiseur de Piper (`piper_phonemize`, espeak-ng) est sous GPL-3.0 et embarqué dans l'extension ; à prendre en compte dans le choix de la licence du dépôt.
- Latence (mesurée 2 à 3 s sur Meet, 6 à 11 s sur InterviewCoach avant les corrections du 25/10, cible 1,5 s) : seuil de silence réduit (`silenceMs`, 800 ms aujourd'hui) ; phrase d'attente préparée à l'avance, jouée dès la fin de la question pendant que le LLM répond (courte, neutre, sans rien affirmer sur le candidat).
- Performances Piper : multi-thread via COOP/COEP sur les pages d'extension (gain mesuré nul en « medium », ×2 en « high »).
- Son capturé rejoué sur la sortie choisie dans la plateforme (`setSinkId`) ; aujourd'hui, sortie audio par défaut.
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
