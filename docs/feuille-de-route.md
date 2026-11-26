# Feuille de route : nouvelle direction d'OtherSelf

Document de travail du 13/11/2026. Il complète `CLAUDE.md` sans le remplacer : tant que les règles non négociables
n'ont pas été modifiées (voir étape 3), ce sont elles qui font foi.

## Direction

- **OtherSelf n'est pas toi.** C'est un autre qui te représente, clairement artificiel. Il peut avoir sa propre
  personnalité, mais ce qu'il affirme vient toujours de tes notes : **ton libre, faits verrouillés**.
- **Un look assumé non humain.** Le personnage s'éloigne volontairement du réalisme : ses défauts (raideur,
  bouche approximative) se lisent comme un style, et son apparence participe à la transparence.
- **Une transparence plus discrète mais plus robuste.** Un badge IA près du visage, imprimé sur le modèle,
  remplace le grand bandeau. Il survit aux recadrages des plateformes. La révélation vocale reste inchangée.
- **Positionnement.** L'entretien automatisé reste la démonstration et le cœur du message. Les réunions et
  présentations sont évoquées comme une perspective, pas comme un usage mis en avant : face à des humains,
  les règles 2, 3 et 5 s'appliquent sans exception.

## Étapes, dans l'ordre

### 1. Fiabilité et désactivation

Objectif : pouvoir couper l'avatar à tout moment, instantanément, sans manipulation dans la plateforme.

- Un seul geste (popup, et si possible bouton dans la page) arrête dans l'ordre : la voix en cours, le pipeline
  d'écoute, puis le rendu.
- Aujourd'hui, après désactivation, le popup demande de « réactiver la vraie caméra et le vrai micro dans les
  réglages de la plateforme ». À étudier : rendre la vraie caméra et le vrai micro directement dans les pistes
  injectées (même `MediaStreamTrack` côté plateforme, source remplacée), pour que la plateforme ne voie aucune
  coupure. À défaut, afficher une image fixe « Avatar en pause » et couper le son.
- Garder 30 images/s (rythme `setInterval` de `lib/inject.ts`) dans tous les états. Problème connu : onglet de la
  plateforme en arrière-plan, Chrome ralentit les minuteurs et le dessin tombe à 1 image/s (remonte à 30 avec
  l'aperçu Picture-in-Picture ouvert). À corriger ici, par exemple avec un rythme qui n'est pas ralenti (minuteur
  dans un worker, ou piste générée côté worker).
- Critère de fin : sur Meet, désactiver puis réactiver trois fois de suite sans recharger l'onglet, sans gel
  d'image ni son résiduel ; temps de coupure de la voix mesuré dans les logs.

### 2. Machine à états

Objectif : rendre l'avatar vivant avec une logique simple, sans IA supplémentaire.

| État | Déclencheur | Comportement de l'avatar |
|---|---|---|
| Inactif | activation, fin d'une réponse sans question en attente | respiration, clignements, regard qui flâne |
| À l'écoute | VAD : le recruteur parle | regard vers la caméra, tête légèrement inclinée, petits hochements |
| En réflexion | fin de la question → attente STT et LLM | regard détourné, bouche fermée, léger mouvement de tête |
| En conversation | début de la lecture de la voix (`playback-started`) | bouche synchronisée, gestes de tête plus marqués |
| En pause / désactivé | geste de l'étape 1 | image fixe « Avatar en pause » ou vraie caméra |

- Les transitions sont émises par `lib/conversation.ts` (une seule source de vérité), le rendu
  (`lib/avatar-vrm.ts`, et le SVG de secours) ne fait que réagir.
- Transitions lissées (quelques centaines de ms), pas de saut de pose.
- L'état apparaît dans les logs (`[etat] ecoute → reflexion`) pour vérifier les temps sur Meet.
- Cette interface d'événements prépare l'étape 6.

### 3. Identité visuelle : plan serré, badge, look non humain

Ces trois choix se tiennent : à décider et valider ensemble.

**Décisions (16/11/2026).** Étape découpée en sous-étapes, une branche chacune, testée sur Meet avant fusion :
- **3a** : l'androïde devient le modèle par défaut, avec un nouveau fond (Atrium) ;
- **3b** : plan serré, et slogan retiré de la veste ;
- **3c** : modification de la règle 1 de `CLAUDE.md`, puis badge « IA » (« AI » en anglais) au col avec voyant
  d'état (bleu : inactif et écoute ; ambre : réflexion ; vert : parole ; jamais éteint), puis retrait du bandeau ;
- **3e** : secours généré à partir du modèle 3D à la place de l'avatar SVG (fait et validé sur Meet le 18/11).

L'ancienne partie « contraste » (3d) est absorbée par le nouveau fond, sauf si le contraste pose encore problème.
Le slogan « Automated candidate, just like you. » est retiré de l'avatar : la transparence repose sur le badge, le
voyant et la révélation vocale (règle 2).

**Modèle (travail dans VRoid Studio).**
- Silhouette, coiffure et palette reconnaissables, volontairement non réalistes (couleur ou matière de peau non
  naturelle, traits simplifiés, yeux plus graphiques, élément signature).
- Garder le squelette humanoïde et les expressions VRM dont dépend l'animation : `aa`, `ee`, `ih`, `oh`, `ou`,
  clignements, regard. Vérifier chaque export avec `vrm.html?mouth=A&still=1` (puis E, O).
- Remplacer autant que possible les pièces prédéfinies de VRoid par des textures et pièces faites maison :
  identité plus propre, et pas de dépendance à la licence pixiv si un créateur d'avatar voit le jour.
- Meshy AI (ou autre) seulement comme planche d'inspiration, pas comme source du modèle : un modèle généré n'a
  pas les expressions VRM nécessaires.
- Repasser par `npm run vrm -- optimize` ; viser une taille proche de l'actuelle (5,4 Mo).
- Décider quelles formes séparées de l'androïde garder à l'allègement (57 formes, dont sourcils, yeux et bouche
  séparés ; l'allègement ne garde aujourd'hui que les 14 des expressions standard). Par exemple les sourcils seuls,
  pour remplacer `angry` en réflexion (étape 2), qui plisse aussi les yeux et abaisse la bouche.
- Quand l'androïde devient le modèle par défaut : remplacer l'avatar SVG de secours, qui ne lui ressemble plus, par
  des images générées à partir du modèle 3D. Un script rend à l'avance, avec le GPU de la machine, le visage au repos,
  les formes de bouche, les yeux fermés et le regard de côté ; le rendu de secours les superpose comme le SVG
  aujourd'hui (fond, visage, yeux, bouche, bandeau en dernier). À relancer à chaque changement de modèle.
- Les repères de cadrage sont définis par les os (`lib/vrm-frame.ts`) : ils devraient suivre un nouveau modèle,
  à revérifier quand même.

**Plan serré.**
- Cadrer tête et épaules : quand le visage remplit déjà l'image, le cadrage automatique des plateformes n'a plus
  de raison de zoomer.
- Conséquences : le slogan sort du cadre et est retiré de la veste (décision du 16/11), les défauts du visage se
  voient plus, d'où l'intérêt du look non humain.
- Valider sur Meet avec et sans cadrage automatique, avec et sans fond virtuel.
- Refaire la comparaison du flou du fond Atrium (4 px retenu en 3a, contre 8 px), la partie visible du fond changeant
  avec le plan serré. Fait en 3b : 4 px confirmé.
- Cadrage retenu en 3b : angle de vue 10,8°, haut des cheveux à y = 54, languette du col à y = 470 (x 564 à 592,
  y 458 à 482). Marge des cheveux : 18 px au-dessus de la coupe 2:1 de Meet ; si des mèches sont coupées, descendre le
  cadrage d'environ 15 px (languette vers y ≈ 485, toujours sous 536).

**Marqueur IA (3c).**
- Premier essai, une pastille « ● IA » (pilule sombre, voyant et texte) : rejeté sur planche le 17/11, trop hors
  personnage.
- Retenu : marquage « IA » (« AI » en anglais, `badgeText`, jamais vide) en lettres pleines gris anthracite, imprimé
  sur la veste comme un numéro de série de robot (police technique à chasse fixe, embarquée), sans fond ni contour, à
  côté de la languette du col ; la languette elle-même sert de voyant d'état et s'allume avec un léger halo : bleu
  pour inactif et écoute, ambre pour réflexion (respiration lente), vert pour parole. Un très léger fondu dans la
  veste l'empêche de flotter au-dessus du tissu, sans perte de netteté.
- Dessiné en dernier dans le canvas 2D, pas dans la texture du modèle : dans la texture, il serait assombri par
  l'éclairage, masqué par les cheveux ou un bras, et le voyant ne pourrait pas changer de couleur à chaque image.
  Attaché au torse (os upperChest), projeté à chaque image : il suit les mouvements comme s'il était imprimé.
- Présent dans chaque image où l'avatar est visible ; le voyant ne s'éteint jamais tant que l'avatar est visible.
  L'image de pause, sans avatar, n'a ni marquage ni voyant : son texte l'identifie (« Avatar IA en pause » / « AI
  avatar paused »).
- Lisible dans une vignette d'environ 320×180 ; toujours visible de face et dans les mouvements de tête.
- Avatar de secours : même marquage et même voyant, à la position relevée sur le modèle au repos (sous-étape 3e).
- La languette du col (28 × 24 px dans le cadre 1280×720, plan serré de 3b) est trop petite pour porter le texte :
  elle sert de voyant, le texte est imprimé juste à côté.
- Vérifier que le voyant bleu se distingue des bandes lumineuses turquoise du fond Atrium.
- Le bandeau est retiré une fois le marquage validé (3c), après la modification de la règle 1 (faite le 17/11 :
  voir `CLAUDE.md`).

### 4. Personnalité (ton uniquement)

- Une seule personnalité pour la démo, plus affirmée qu'aujourd'hui : par exemple directe et chaleureuse, avec un
  peu d'esprit.
- Définie dans le prompt (`lib/prompt.ts`) comme une section « ton » séparée de la section « faits », pour
  qu'aucune consigne de style ne puisse affaiblir la règle 5.
- Le personnage parle de lui comme d'un avatar qui représente le candidat, à la troisième personne quand il
  rapporte un fait (« d'après ses notes, il a… »). À tester : la formulation la plus naturelle à l'oral.
- La voix (Piper, hauteur) peut être ajustée pour coller au personnage, toujours générique (règle 4).

**Structure des réponses** (retour d'une plateforme d'évaluation du 13/11/2026, score 40/100 : réponses brèves, vagues,
sans structure STAR ni résultats chiffrés). Cause principale : les limites de longueur du paragraphe « Style » de
`lib/prompt.ts` (une phrase de plus au maximum, 15 mots par phrase, trois éléments au plus).
- Longueur adaptée au type de question : réponse courte pour une question factuelle ou fermée ; pour une question
  comportementale (« racontez une fois où… », « comment avez-vous géré… »), un seul exemple tiré des notes en
  quatre à six phrases courtes : contexte, rôle et actions du candidat, résultat chiffré si les notes en donnent un.
- Toujours une première phrase courte qui répond directement (bonne pour la latence : elle part en synthèse
  pendant que la suite s'écrit).
- Un exemple bien raconté plutôt que plusieurs cités.
- Faits concrets (chiffres, dates, résultats nommés) plutôt que qualités générales ; aucune affirmation vague sans
  le fait qui l'appuie. Sans résultat dans les notes, la réponse s'arrête sur l'action (règle 5).
- Phrases de 20 mots au plus ; garder au plus trois éléments et deux noms de projet par réponse.
- Mots de liaison : il n'y en a aucun aujourd'hui, ce qui accentue le côté robotique. À tester dans le cadre du ton :
  quelques transitions naturelles et rares (« en fait », « concrètement », « du coup » ou leurs équivalents
  anglais), jamais en ouverture systématique, puis vérifier qu'une plateforme d'évaluation ne les compte pas comme
  des hésitations. Le reproche « filler words » vient sans doute d'ailleurs (transcription, formulations floues) :
  relire les logs `Recruteur : …` / `Avatar : …` de la session.
- « Polite, calm and composed » est retiré du paragraphe « Style » : le ton relève de la section « ton » ci-dessus.
- Notes du candidat : proposer un modèle (pour chaque expérience clé : contexte, rôle, actions, résultat chiffré ;
  trois à cinq histoires couvrent la plupart des questions comportementales), la qualité des réponses étant
  plafonnée par celle des notes.
- Durée d'une réponse longue : 20 à 30 secondes est un plafond, pas un objectif. Mesuré au banc du prompt (18/11) :
  ≈ 16 secondes pour une réponse comportementale (4 phrases, ≈ 40 mots), gardé tel quel.

- Critère de fin : le jeu « entretien » de la page `voices` sur une dizaine de questions, dont des questions
  pièges sans réponse dans les notes et des questions comportementales ; aucune invention, ton reconnaissable,
  réponses comportementales structurées. Puis une session sur la même plateforme d'évaluation à comparer au 40/100 du 13/11/2026.

### 5. Communication

- README et post : entretien automatisé comme démonstration principale ; une phrase sur les autres usages possibles
  (réunions, présentations), présentés comme une piste.
- Mettre à jour l'image d'aperçu et la description de l'avatar dans le README après l'étape 3.
- Mettre à jour la section « Mission » de `CLAUDE.md` pour refléter le personnage distinct.

### 6. Interface entre moteur conversationnel et rendu (sans connecteur)

Fait le 18/11/2026 : contrat dans `lib/engine.ts`, moteur actuel dans `lib/llm-engine.ts`, textes fixes de la
révélation dans `lib/disclosure.ts`, documentation dans `docs/moteur.md`. Écarts au plan d'origine, validés : les
états et les hochements sont calculés par le tour de parole de l'extension (ils dépendent de l'audio et de la lecture
réelle, qu'un moteur ne voit pas), et le découpage en phrases est fait par l'extension à partir du flux du moteur.

- Formaliser ce qui existe déjà : le moteur reçoit le texte entendu et émet du texte à dire et des événements
  d'état (étape 2) ; le rendu ne connaît que ces événements et l'audio.
- Un seul fichier de types décrit ce contrat, pour qu'un autre moteur (agent externe, autre service) puisse un
  jour le remplacer.
- Pas de connecteur pour la démo. Tout moteur futur reste soumis aux règles 2, 3 et 5.
- Piste, pas encore faite : un filtre de sortie dans l'extension, appliqué au flux de tout moteur avant la voix, qui
  refuserait une phrase où l'avatar se dirait humain (« I am human », « je suis humain ») ou se ferait passer pour la
  personne représentée (« I am Alex »). Aujourd'hui, ces règles relèvent du moteur (prompt) ; le filtre les
  garantirait aussi hors du moteur. À concevoir sans faux positifs (une citation du recruteur, « he is human-centered »).
- Profil du candidat : la source est déjà isolée derrière une interface (`lib/profile.ts`, `ProfileSource`) et son
  format documenté (`docs/profil.md`). Pistes pour plus tard :
  - conversion de n'importe quelle source (CV en PDF, Notion, second brain, Dots, Muse…) vers ce format,
    automatique ou assistée par un LLM, avec relecture par l'utilisateur avant usage et sans invention : chaque
    fait du profil converti doit venir de la source (citation ou lien vers le passage) ;
  - sélection des passages utiles à chaque question quand la source est trop grosse pour le prompt (recherche
    sémantique ou par mots-clés), sans jamais affaiblir la règle 5 : ce qui n'est pas retrouvé n'est pas inventé.

## Hors périmètre pour l'instant

- Bouche pilotée par les phonèmes (reste dans « Projet (reporté) »).
- Plusieurs personnalités au choix.
- Connecteurs vers d'autres agents.
- Usage en réunion avec des humains comme fonctionnalité mise en avant.
