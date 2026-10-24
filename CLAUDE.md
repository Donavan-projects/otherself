# OtherSelf

## État actuel (24/10/2026)

- **Étape 3 terminée : voie A (injection) retenue.** Testée sur Google Meet (compte A dans Chrome avec l'extension, compte B dans Brave) : image, bandeau et son arrivent chez B.
- **Prochaine étape : étape 4, pipeline voix**, testé d'abord face à `rehearsal` (ouverte avec `?inject`). La voix générée remplacera le son de test (`lib/test-audio.ts`) comme piste du micro injecté (`createAudioTrack` de `installFakeGetUserMedia`).
- **Prérequis actuel sur la plateforme** : autoriser caméra et micro pour le site dans les réglages du navigateur (cadenas de la barre d'adresse), puis activer l'extension sur l'onglet (popup → « Activer sur cet onglet »), puis couper et rallumer caméra et micro dans la plateforme pour qu'elle redemande les flux. Recharger l'onglet annule l'injection.
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
6. **Permissions minimales** : `activeTab` + `scripting`, injection à la demande sur l'onglet actif. Jamais de `host_permissions`, et en particulier jamais sur `<all_urls>`.

## Architecture

Pipeline cible de l'extension complète (voie A, injection, retenue pour la démo à l'étape 3) :

```
son du recruteur (piste audio distante de la page)
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
- Pas de backend : les clés API de l'utilisateur sont stockées dans `chrome.storage.local`, les appels partent directement du navigateur.
- Machine de référence modeste (16 Go RAM, GPU 4 Go ancien) : rien de lourd ne tourne en local dans le navigateur sauf VAD, TTS Piper et le canvas de l'avatar.

## Structure prévue

```
entrypoints/
  background.ts        # orchestration, appels API
  content.ts           # injection getUserMedia, capture audio du recruteur
  popup/               # bouton Activer / Pause / Reprendre la main
  options/             # assistant de setup : clé API, CV, photo, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  avatar/              # page de l'avatar (aperçu)
lib/
  vad.ts  stt.ts  llm.ts  tts.ts  avatar.ts  prompt.ts
  inject.ts            # remplacement getUserMedia / enumerateDevices (monde MAIN)
  injection-sources.ts # photo et son sérialisés pour le monde MAIN
  test-audio.ts        # son de test provisoire du micro injecté (remplacé à l'étape 4)
  log.ts               # logs préfixés et horodatés
scripts/
  check-locales.ts     # vérification des fichiers _locales au build
docs/
  spec.md  config.md  visuel-otherself.md
```

## Démo (priorité actuelle)

L'objectif immédiat est une démo vidéo filmable, pas un produit. Le projet complet ne sera construit que si la démo suscite de l'intérêt.

Tout le code de la démo est écrit en TypeScript dans l'extension (rendu de l'avatar + modules `lib/`), pas en script séparé, pour être réutilisé tel quel dans le projet complet.

**Voie A, injection (retenue à l'étape 3)** : l'extension remplace caméra et micro dans l'onglet de l'entretien (`content.ts`, remplacement de getUserMedia et enumerateDevices, faux périphérique « Avatar IA – Contre-Recruteur ») et récupère le son du recruteur depuis la page. Pas de routage audio système, bandeau intouchable. La voie B (caméra virtuelle OBS + routage PipeWire) a été écartée.

### Étapes (dans cet ordre, une à la fois)

1. **Faux recruteur** : fait. Page `rehearsal` qui demande caméra et micro, affiche le flux reçu et lit des questions à voix haute.
2. **Rendu avatar statique** : fait. `lib/avatar.ts` dessine l'image 1280×720 et le bandeau incrusté ; page `avatar` pour l'aperçu.
3. **Test d'injection** : fait, voie A retenue (testée sur Google Meet).
4. **Pipeline voix, avec le mode « message »** : son du recruteur → VAD → STT → LLM → Piper, la voix générée remplaçant le son de test comme piste du micro injecté. Critères : révélation dès la première prise de parole, puis `messageText` s'il est configuré, puis réponses fidèles au CV ; latence acceptable. Tester d'abord face à `rehearsal?inject`.
5. **Visuel OtherSelf** : selon `docs/visuel-otherself.md` (avatar cartoon original en SVG local à la place de la photo, variantes et fond choisis dans `config.local.json`, `bannerText` configurable, bouche animée par la voix). Le bandeau garde l'emplacement et les contraintes de la règle 1.
6. **Tournage** : enregistrement de la session (simple enregistrement d'écran) pour la vidéo et le post LinkedIn.

Ne pas commencer une étape avant que la précédente fonctionne.

## Projet (reporté, seulement si la démo suscite de l'intérêt)

- Assistant de setup (options) remplaçant `config.local.json`, utilisable par des non-techniciens.
- Guide pas à pas pour obtenir la clé API, avec estimation du coût par entretien.
- Permission micro sans réglage manuel du site (solution B) : remplacer aussi `navigator.permissions.query` dans le script injecté pour répondre « granted » à `camera` et `microphone` (Meet ne demande pas le micro tant que la permission réelle n'est pas accordée). Aucune permission d'extension en plus ; Meet peut avoir gardé l'ancienne réponse en mémoire.
- Vérifier `enumerateDevices` : Meet affichait « Speaker not found » avec la liste injectée (fausse caméra, faux micro, sorties audio réelles).
- Popup avec Activer / Pause / Reprendre la main.
- Publication sur le Chrome Web Store, version Firefox, i18n complète, export intégré (enregistrement avec sous-titres).
- Lien vers une explication des droits des candidats face aux décisions automatisées (RGPD, AI Act), à faire vérifier juridiquement.
- Avertissement clair dans le README et l'assistant : utiliser OtherSelf dans une vraie candidature, c'est probablement renoncer au poste.

Le dépôt est publié avec le post, même au stade de démo. Le README le présente comme tel : prototype, projet complet à venir si le sujet intéresse.

Les règles non négociables s'appliquent dès maintenant, y compris pour la démo.

## Conventions

- Logs préfixés par module (`[vad]`, `[stt]`, `[llm]`, `[tts]`, `[avatar]`, `[inject]`), avec horodatage pour mesurer la latence.
- L'injection et le routage audio ne peuvent être vérifiés que dans un vrai navigateur : après une modification de ces parties, indiquer précisément ce que l'utilisateur doit tester et quels logs observer.
- Commits petits et fréquents, un par étape ou sous-étape fonctionnelle.
- Interface et textes utilisateur en français et anglais (i18n de WXT), après la démo.
- README : mission, statut de prototype, règles ci-dessus présentées comme des choix de conception, avertissement sur la candidature, pas de support garanti.
