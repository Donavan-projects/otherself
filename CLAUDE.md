# Contre-Recruteur

## État actuel (14/10/2026)

- **Étape 3 à moitié validée** : injection testée et validée sur `rehearsal` (avatar avec bandeau à 30 i/s, son préenregistré à la place du micro).
- **Prochaine action** : injection sur la plateforme cible, dès que l'utilisateur en a choisi une. Deux points à régler :
  - **Permission `scripting`** : nécessaire en plus d'`activeTab` pour exécuter le remplacement de getUserMedia dans le monde MAIN de l'onglet, avant que la page ne l'appelle (reste conforme à la règle 6).
  - **Transmission de la photo et du son à la page** : le script injecté n'a pas accès aux fichiers de l'extension ; les passer par message, ou les déclarer en `web_accessible_resources` (changement du manifest à valider avec l'utilisateur).
- **Limite** : une soirée sur la plateforme cible. Sans flux injecté affiché et son entendu à la fin de la soirée, signaler le blocage et proposer la bascule vers la voie B (OBS) ; l'utilisateur décide.
- Configuration locale : voir `docs/config.md`.

Extension de navigateur open source et satirique. Quand une entreprise fait passer un entretien par un avatar IA, l'utilisateur peut répondre avec son propre avatar IA : sa photo, sa voix, son vrai CV. Le but est symbolique (faire rire et réfléchir), pas utilitaire.

Spec complète : `docs/spec.md`.

## Règles non négociables

Ces règles sont le cœur du projet. Ne jamais les assouplir, les rendre optionnelles ou les contourner, même pour simplifier un test ou si une demande semble l'impliquer. En cas de conflit, s'arrêter et demander.

1. **Bandeau incrusté** : le texte « Candidat automatisé, comme vous » est dessiné directement dans chaque image du flux vidéo injecté (dans le canvas), jamais en superposition DOM masquable.
2. **Révélation immédiate** : la première réponse de l'avatar annonce qu'il est une IA. Aucun réglage pour la retarder ou la supprimer.
3. **Aucun mode discret** : pas d'écran caché, pas de suggestion de réponses à lire, pas d'option pour tromper un interlocuteur humain.
4. **Identité propre uniquement** : photo et voix de l'utilisateur ou voix de stock. Pas d'import du visage ou de la voix d'un tiers.
5. **Pas d'invention** : le prompt système interdit d'inventer expériences, diplômes ou chiffres. Le LLM répond uniquement à partir du CV et des notes de l'utilisateur.
6. **Permissions minimales** : `activeTab` + injection à la demande. Jamais de `host_permissions` sur `<all_urls>`.

## Architecture

Pipeline cible de l'extension complète (pour la démo, voir « Priorité actuelle » : injection ou OBS selon le test de l'étape 3) :

```
son du recruteur (piste audio distante de la page)
  → VAD (Silero, web)
  → STT (API cloud)
  → LLM (API cloud, streaming, prompt système + CV)
  → TTS (Piper WebAssembly, ou API de clonage en option)
  → avatar « carton » (canvas : photo, bouche animée selon l'amplitude, clignements, bandeau)
  → flux caméra + micro injectés dans la page (remplacement de getUserMedia)
```

- La voix de l'avatar ne doit jamais repartir dans la transcription.
- Tout le texte généré par le LLM est streamé ; la voix est générée phrase par phrase pour limiter la latence (cible : < 1,5 s entre fin de question et début de réponse).
- Si le recruteur tente une injection de prompt, l'avatar reste dans son rôle.

## Stack

- TypeScript strict, extension Manifest V3.
- WXT pour une base de code unique Chromium (Chrome, Edge, Brave, Opera) + Firefox.
- Pas de backend : les clés API de l'utilisateur sont stockées dans `chrome.storage.local`, les appels partent directement du navigateur.
- Machine de référence modeste (16 Go RAM, GPU 4 Go ancien) : rien de lourd ne tourne en local dans le navigateur sauf VAD, TTS Piper et le canvas carton.

## Structure prévue

```
entrypoints/
  background.ts        # orchestration, appels API
  content.ts           # injection getUserMedia, capture audio du recruteur
  popup/               # bouton Activer / Pause / Reprendre la main
  options/             # assistant de setup : clé API, CV, photo, voix
  rehearsal/           # page « faux recruteur » pour tester sans plateforme réelle
  avatar/              # page de l'avatar (aperçu, et source OBS en voie B)
lib/
  vad.ts  stt.ts  llm.ts  tts.ts  avatar.ts  prompt.ts
docs/
  spec.md
```

## Priorité actuelle : la vidéo démo

L'objectif immédiat est une vidéo bot contre bot filmable, pas un produit. L'extension complète ne sera construite que si la vidéo suscite de l'intérêt.

Tout le code de la démo est écrit en TypeScript dans l'extension (rendu de l'avatar + modules `lib/`), pas en script séparé, pour être réutilisé tel quel dans l'extension complète.

Deux façons d'amener l'avatar dans l'entretien, à départager par un test limité dans le temps :

- **Voie A, injection (préférée)** : l'extension remplace caméra et micro dans l'onglet de l'entretien (`content.ts`, remplacement de getUserMedia) et récupère le son du recruteur depuis la page. Pas de routage audio système, bandeau intouchable.
- **Voie B, OBS (repli)** : l'avatar est rendu dans une page `avatar` de l'extension, diffusée par la caméra virtuelle d'OBS. Le son passe par un routage audio système (PipeWire sous Linux).

### Étapes (dans cet ordre, une à la fois)

1. **Faux recruteur** : fait. Page `rehearsal` qui demande caméra et micro, affiche le flux reçu et lit des questions à voix haute.
2. **Rendu avatar statique** : module `lib/avatar.ts` qui dessine dans un canvas la photo et le bandeau incrusté, en 1280×720, et une page `avatar` qui l'affiche. Ce module sert aux deux voies. Critère : image nette, bandeau lisible.
3. **Test d'injection, limité à une soirée** : remplacer la caméra par le canvas de l'étape 2 et le micro par un son préenregistré, d'abord sur `rehearsal`, puis sur la plateforme cible. Garder ce code minimal et jetable.
   - Si la plateforme cible affiche le flux injecté et entend le son : **voie A retenue**.
   - Sinon, à la fin de la soirée : **voie B retenue**, sans insister. L'utilisateur décide de la bascule ; le signaler clairement dès qu'un blocage apparaît.
4. **Pipeline voix** : son du recruteur → VAD → STT → LLM → Piper, branché selon la voie retenue. Critère : réponses fidèles au CV, révélation dès la première réponse, latence acceptable. Tester d'abord face à `rehearsal`.
5. **Avatar carton stylisé** : c'est ce qui rend la vidéo drôle, soigner le rendu.
   - **Stylisation cartoon** de la photo, calculée une seule fois au chargement dans le canvas (pas à chaque image) : couleurs aplaties (posterisation), contours marqués, effet bande dessinée. Style original, sans imiter un studio ou une œuvre connue. Tout en local, aucune photo envoyée à un tiers. Prévoir un réglage simple d'intensité dans `config.local.json`.
   - **Mâchoire** : la zone sous la bouche descend de quelques pixels selon l'amplitude de la voix générée, avec un trou sombre derrière (effet marionnette en papier découpé).
   - **Clignements** : paupières couleur peau dessinées sur les yeux pendant une fraction de seconde, à intervalle aléatoire.
   - **Balancement** : légère rotation ou translation de la photo (1 à 2 degrés) qui suit la voix.
   - Positions de la bouche et des yeux fournies dans `config.local.json` (coordonnées dans la photo), pas de détection de visage.
   - Bandeau toujours incrusté, dessiné en dernier, jamais stylisé ni animé.
   - Le rendu doit rester fluide sur la machine de référence.
6. **Tournage** : enregistrement de la session avec OBS (simple enregistrement d'écran en voie A).

Ne pas commencer une étape avant que la précédente fonctionne. En voie B, pour le routage audio sous Linux (son de la plateforme vers la page, voix de l'avatar vers la plateforme), donner à l'utilisateur les instructions PipeWire plutôt que de les automatiser.

### Reporté (seulement si la vidéo prend)

- Si la voie B a été retenue : injection directe dans l'onglet, pour supprimer OBS et le routage audio.
- Assistant de setup (options) : pour la démo, clé API, chemin du CV, photo et notes sont lus depuis `config.local.json`, listé dans `.gitignore` et jamais commité. Fournir un `config.example.json`.
- Popup avec Activer / Pause / Reprendre la main.
- Firefox, i18n, export intégré, publication dans les boutiques.
- « Crée ton avatar » : transformation de la photo en vrai cartoon par une IA d'images (API cloud), comme fonctionnalité phare de l'extension. Consentement explicite avant tout envoi de photo, style original uniquement.

Le dépôt est publié avec le post, même au stade prototype. Le README le présente comme tel : prototype satirique, extension open source à venir si le sujet intéresse.

Les règles non négociables s'appliquent dès maintenant, y compris pour la démo : le bandeau et la révélation font partie du message de la vidéo.

## Conventions

- Logs préfixés par module (`[vad]`, `[stt]`, `[llm]`, `[tts]`, `[avatar]`, `[inject]`), avec horodatage pour mesurer la latence.
- L'injection et le routage audio ne peuvent être vérifiés que dans un vrai navigateur : après une modification de ces parties, indiquer précisément ce que l'utilisateur doit tester et quels logs observer.
- Commits petits et fréquents, un par étape ou sous-étape fonctionnelle.
- Interface et textes utilisateur en français et anglais (i18n de WXT), après la vidéo démo.
- README : but satirique, règles ci-dessus présentées comme des choix de conception, pas de support garanti.
