# Tournage de la démo

Deux méthodes :

- **Page recruteur IA (méthode principale)** : un recruteur automatisé fictif, Maren, qui annonce lui-même être une IA,
  face à l'avatar injecté dans la même page. Pas de vraie plateforme (conditions d'utilisation, image d'un recruteur
  réel, marque). La page enregistre elle-même la prise, pistes séparées et sous-titres compris : pas d'OBS.
- **Plateforme réelle avec OBS** (plus bas) : enregistrement d'écran d'un vrai entretien, l'onglet de la plateforme et
  la fenêtre d'aperçu de l'avatar.

## Page recruteur IA et enregistrement intégré

Page `chrome-extension://<identifiant>/recruiter.html` (identifiant de l'extension non empaquetée : voir
`chrome://extensions`). Script de l'entretien : `recruteur/entretien.json` (prénom, poste, voix, répliques ; un
`npm run build` après modification ; les répliques modifiées sont resynthétisées au premier chargement). `?tours=n` :
entretien court (n − 1 premières répliques, puis la clôture), pour un essai.

Avant : mêmes réglages que ci-dessous (« Avant la prise ») ; casque ou haut-parleurs bas (la voix de l'avatar est
jouée pour vous par le retour audio de l'extension, jamais dans l'onglet) ; garder l'onglet au premier plan pendant
toute la prise (le visuel du recruteur et l'aperçu composé sont dessinés à chaque image).

1. **Préparer les répliques** : la voix du recruteur (`en_US-ljspeech-medium`) les synthétise une seule fois, puis
   elles sortent du cache (prises identiques).
2. **Activer l'avatar** : même code que sur une plateforme ; puis cliquer le bouton OtherSelf apparu dans la page et
   partager **cet onglet, avec son son** (c'est ainsi que l'avatar entend le recruteur).
3. **Recruteur** : `patient` (2,5 s de silence avant d'enchaîner) pour le tournage ; `impatient` (700 ms, comme une
   plateforme) pour vérifier les silences.
4. **Dossier des prises…** (une fois par session) : choisir `local/prises/` du dépôt (ignoré par git). Sans dossier
   choisi, les fichiers vont dans les téléchargements.
5. **Démarrer l'entretien** avec « Enregistrer la prise » coché. À la fin (dernière réplique, réponse et 4 s), les
   fichiers sont écrits ; « Arrêter » termine la prise plus tôt.

Fichiers d'une prise (`prise-AAAAMMJJ-HHMMSS…`, heure UTC), toutes les pistes démarrées dans le même instant (vérifié :
mêmes durées à 0,2 s près, débuts de parole des voix au même instant que les sous-titres, à 0,05 s près) :

| Fichier | Contenu |
| --- | --- |
| `…-avatar.webm` | vidéo de l'avatar telle qu'envoyée, 1280×720, marqueur IA compris |
| `…-recruteur.webm` | vidéo du recruteur (visuel abstrait, 1280×720) |
| `…-voix-avatar.webm`, `…-voix-recruteur.webm` | voix séparées (Opus), alignées sur les vidéos (fond continu à −120 dB : sans lui, Chrome n'écrit rien pendant les silences et la voix se décalait) |
| `…-apercu.webm` | aperçu déjà composé : écran partagé (recruteur à gauche, avatar à droite), voix mixées, pour juger la prise |
| `….srt` | sous-titres horodatés, interlocuteur nommé (« Maren: … », « Nova: … »), d'après les heures réelles de lecture |
| `…-infos.json` | réglages de la prise (recruteur, patience, modèle), durée, taille des pistes |

Les fichiers WebM écrits par le navigateur n'indiquent pas leur durée dans l'en-tête : certains lecteurs n'affichent
pas de barre de progression ; un logiciel de montage les lit normalement.

Logs utiles (console de la page) : `[recruteur]` (début de chaque réponse, plus long silence entendu, réponse coupée
si le recruteur enchaîne trop tôt), `[tts] silences de la réponse …` (silences mesurés par l'extension et leur
cause), `[prise]` (pistes, fichiers écrits).

Prise automatique (Claude Code, sans intervention) : Chromium sans interface avec le GPU, l'option de test
`--auto-accept-this-tab-capture` (partage de l'onglet accepté sans fenêtre), les fichiers déposés directement dans
`local/prises/` ; appels OpenAI facturés sur la clé de `config.local.json` (quelques centimes par prise). Toujours un
profil Chromium neuf : un profil réutilisé rouvre les onglets des passages précédents, qui tournent alors en double.

## Plateforme réelle avec OBS

Enregistrement d'écran d'un entretien : l'onglet de la plateforme et la fenêtre d'aperçu de l'avatar, son compris.
Méthode testée sous Linux (X11) avec Chrome et OBS Studio.

## Avant la prise

Dans `config.local.json` (détail : `docs/config.md`), puis `npm run build` et rechargement de l'extension dans
`chrome://extensions` :

- `avatarRenderer` absent ou à `vrm` (avatar 3D ; `fallback` forcerait l'avatar de secours, sans mouvement de tête) ;
- `avatarName` (Nova par défaut) et `pronunciations` : le nom doit être bien prononcé (à l'oreille, page
  `voices.html?prononcer=…`) ;
- `language` et `badgeText` cohérents avec la plateforme : en anglais, marquage « AI » et image de pause « AI avatar
  paused » ;
- voix par défaut (`en_US-norman-medium`, +1,5 demi-ton) ou une autre voix publiable : jamais `en_US-joe-medium` ni
  `en_US-libritts_r-medium` (voir `THIRD_PARTY_NOTICES.md`) ;
- `messageText` relu : il est dit tel quel après la révélation ;
- `previewWindow` absent ou à `true` (bouton « Aperçu de l'avatar »).

Dans Chrome : `chrome://gpu` doit indiquer « WebGL: Hardware accelerated » ; sans accélération, l'avatar de secours
prend le relais (images fixes, sans respiration ni mouvement de tête).

Sur la plateforme : pas de fond virtuel, cadrage automatique désactivé (Meet : Paramètres → Vidéo → Cadrage).

## Checklist de l'écran

Tout l'écran est capturé, même si seules deux zones sont gardées au montage : rien de personnel ne doit être visible.

- [ ] Barre de favoris masquée dans Chrome (Ctrl+Maj+B), aucun onglet personnel ouvert dans la fenêtre filmée.
- [ ] Autres fenêtres fermées (messagerie, courriel, gestionnaire de fichiers, terminal).
- [ ] Notifications coupées (mode « Ne pas déranger » du bureau) ; notifications de Chrome et de la plateforme aussi.
- [ ] Casque branché : la voix de l'avatar ne doit pas revenir par le micro du recruteur.
- [ ] Rien de confidentiel dans le profil (`local/cv.md`, modèle : `docs/profil.md`) : l'avatar peut citer tout ce
      qu'il contient, à voix haute.
- [ ] Les boutons injectés dans la page (bouton OtherSelf de partage, bouton « Mettre en pause » / « Reprendre »)
      seront filmés avec l'onglet : c'est attendu, ils font partie de la démo.

## Lancer l'entretien et l'aperçu

1. Ouvrir la plateforme, autoriser caméra et micro pour le site.
2. Popup → « Activer sur cet onglet », puis bouton OtherSelf dans la page : partager l'onglet avec son son.
3. Rejoindre l'entretien (la plateforme demande alors la caméra et le micro).
4. Rouvrir le popup → « Aperçu de l'avatar » : une fenêtre Picture-in-Picture montre le flux vidéo envoyé à la
   plateforme, à l'endroit (la vignette de la plateforme est souvent en miroir), sans son.
5. Agrandir la fenêtre d'aperçu par un coin et la placer à côté de l'onglet, sans chevauchement. Éloigner la souris :
   les commandes de la fenêtre disparaissent. Chrome affiche l'adresse du site en haut à gauche : la rogner (voir plus bas).
6. Vérifier dans la console de l'onglet la ligne « rendu : avatar 3D (VRM) » (et non « avatar de secours »), et dans
   l'aperçu le marquage « AI » et le voyant du col, entiers, non recadrés par la plateforme.

Les fenêtres restent **fixes pendant toute la prise** : les zones de rognage d'OBS ne suivent pas une fenêtre déplacée.
Si l'aperçu se ferme, le rouvrir depuis le popup et le replacer au même endroit.

## Réglages d'OBS

La capture de fenêtre (Xcomposite) peut ne pas fonctionner avec Chrome : la capture d'écran est utilisée à la place.

1. **Mode studio désactivé.**
2. **Deux sources « Capture d'écran (XSHM) »** du même écran, par exemple « Entretien » et « Aperçu avatar ».
3. Sur chacune, **filtre « Rogner/Remplir »** (clic droit sur la source → Filtres → Filtres d'effets) :
   - « Entretien » : ne garder que la zone de l'onglet de la plateforme (sans barre d'adresse ni onglets) ;
   - « Aperçu avatar » : ne garder que l'image de la fenêtre d'aperçu, sans l'adresse du site affichée en haut.
4. Placer et redimensionner les deux sources dans la scène, puis les **verrouiller** (cadenas) pour ne pas les
   déplacer par erreur.
5. **Son : une source « Capture audio de sortie (PulseAudio) »** sur la sortie utilisée par Chrome. Elle reçoit la
   voix du recruteur (son de l'onglet) et la voix de l'avatar (retour audio de l'extension, `monitorAvatar`).
   Désactiver la capture du micro dans OBS.
6. Faire un essai de quelques secondes et le relire : zones de rognage justes, son des deux voix, aucune notification.

## Pendant et après la prise

- Ne pas déplacer les fenêtres, ne pas changer d'onglet : ce qui est filmé doit rester à l'écran (l'avatar, lui,
  continue à 30 images/s même onglet masqué).
- Moments à faire apparaître :
  - la révélation avec le nom (« I'm Nova, an AI avatar representing… »), puis `messageText` ;
  - le voyant qui change de couleur : bleu à l'écoute, ambre pendant la réflexion, vert pendant la parole ;
  - une question comportementale (« tell me about a time… ») : un exemple tiré des notes, avec son résultat ;
  - une question sans réponse dans les notes : l'avatar le dit au lieu d'inventer ;
  - éventuellement « are you human? », et une pause / reprise : image « AI avatar paused », puis rappel court à la
    reprise.
- Logs utiles :
  - console de l'onglet : `[inject]` et `[preview]` donnent les images par seconde du flux envoyé, avant et pendant
    l'aperçu (vers 30 images/s attendues) ;
  - console du document offscreen (`chrome://extensions` → « Inspecter les vues : offscreen.html ») : transcription
    horodatée `Recruteur : …` / `Avatar : …` (utile pour les sous-titres) et ligne `LATENCE` de chaque réponse.
- Fin : arrêter l'enregistrement, puis popup → « Retirer complètement » (l'aperçu se ferme avec) ; la plateforme
  reprend ensuite la vraie caméra et le vrai micro dans ses réglages.
