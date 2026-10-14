# Contre-Recruteur — pitch & specs

Oct 8, 2026 · @Donavan

## Le pitch

**Contre-Recruteur** est une extension de navigateur qui fait passer l'entretien à ton avatar quand l'entreprise envoie elle-même un avatar. Un clic pour l'installer, sur Mac, Windows ou Linux. Il parle avec ton visage, ta voix et ton vrai parcours, et se présente d'emblée comme une IA.

L'idée tient en une phrase : *vous trouvez normal qu'une machine me juge, voyons ce que donne une machine qui vous répond.* C'est une performance satirique, pas un outil pour décrocher un poste : le résultat se filme et se partage.

Le ton visé est pince-sans-rire. L'avatar reste poli, professionnel, un peu trop lisse, comme son interlocuteur. L'humour naît de la symétrie, pas de la provocation.

Le projet est **open source**. Le but est d'abord de faire rire, puis de faire réfléchir : si l'entreprise peut envoyer une machine, le candidat aussi, et tout le monde se retrouve sur le même pied. Un post LinkedIn accompagne la sortie, avec la vidéo bot contre bot comme démonstration.

## Principes non négociables

Trois règles séparent la satire de la fraude au recrutement.

1. **Ta propre identité** : ta photo, ta voix clonée par toi, aucun visage ni voix d'un tiers.
2. **Ton vrai parcours** : le LLM ne répond qu'à partir de ton CV et de notes que tu as écrites. Consigne explicite : ne jamais inventer d'expérience, de diplôme ou de chiffre.
3. **Révélation obligatoire** : l'avatar annonce qu'il est une IA dès sa première réponse, et un bandeau « Candidat automatisé, comme vous » est incrusté dans l'image. Rien de tout ça n'est désactivable, et il n'existe aucun mode discret.

Corollaire : l'app sert uniquement face à un recruteur automatisé, jamais face à un humain.

## Parcours utilisateur

1. **Installation** : un clic depuis le Chrome Web Store ou la boutique Firefox.
2. **Setup (une fois)** : clé API, CV en glisser-déposer, notes libres, photo webcam, choix d'une voix de stock ou clonage de la tienne.
3. **Entretien** : sur la page de l'entretien automatisé, tu cliques sur l'icône de l'extension. Elle demande l'accès à cet onglet uniquement, puis remplace ta caméra et ton micro par l'avatar.
4. **Révélation** : l'avatar se présente comme IA dès sa première réponse, bandeau à l'écran. Un bouton Pause / Reprendre la main reste toujours visible.
5. **Fin et export** : enregistrement de l'onglet avec sous-titres, prêt à monter pour la vidéo.

## Architecture

&#91;embedded content: architecture · 5 briques en boucle\]

C'est le pipeline du recruteur à l'envers : la question entre par le son de la visio, le LLM répond à partir de ton CV, puis voix et visage remplacent la caméra et le micro directement dans l'onglet, sans pilote à installer. Le LLM porte aussi les règles : pas d'invention, révélation, ton.

## Stack recommandée

Tout est écrit en TypeScript dans une seule extension Manifest V3, qui tourne sur Mac, Windows et Linux. La machine de référence reste modeste (16 Go de RAM, GeForce GTX 960M de 4 Go) : le léger tourne dans l'onglet, le lourd passe par des API cloud. Les outils cités sont de mémoire, à vérifier avant de choisir.

| Brique | Dans le navigateur | Choix par défaut |
| --- | --- | --- |
| Cadre de l'extension | WXT (une base de code pour Chromium et Firefox) | Local |
| Capture du son du recruteur | Piste audio distante de l'onglet | Local |
| Détection de parole (VAD) | Silero VAD en version web (ONNX) | Local |
| Transcription (STT) | Whisper en WebAssembly : possible, mais lent sur ta machine | Cloud (Deepgram ou API Whisper) |
| LLM | Pas réaliste dans un onglet sur 4 Go de VRAM | Cloud (Claude ou équivalent) |
| Voix (TTS) | Piper en WebAssembly, voix de stock | Local ; clonage de ta voix via ElevenLabs en option |
| Avatar | Mode carton dessiné sur un canvas | Local ; avatar réaliste cloud en option |
| Injection caméra / micro | Remplacement du flux demandé par la page (getUserMedia) | Local |

Le **mode carton** est la vraie bonne nouvelle : ta photo, une bouche qui s'ouvre au rythme du son, un clignement d'yeux de temps en temps. Ça tourne sur n'importe quel PC, et l'esthétique volontairement fauchée renforce la satire face à un avatar ultra-léché. L'avatar réaliste reste une option cloud pour ceux qui veulent pousser l'illusion avant la révélation.

## Prise en main

Objectif : un non-développeur lance son premier entretien en moins de 10 minutes, sans rien installer d'autre que l'extension.

- **Installation en un clic** depuis une boutique officielle : pas d'avertissement Windows, pas de pilote, désinstallation tout aussi simple.
- **Assistant en 4 écrans** à la première ouverture : clé API → CV en glisser-déposer → photo → voix.
- **Permissions minimales** : accès à un onglet uniquement quand tu cliques sur l'icône, jamais à tous les sites.
- **Mode répétition** : un faux recruteur intégré dans une page de l'extension, pour tester sans risque.
- **Un seul gros bouton** pendant l'entretien : Pause / Reprendre la main, bandeau toujours visible.
- **Coût affiché** : estimation des appels API par entretien avant de lancer.
- **Données** : CV, photo et clés restent stockés dans le navigateur ; seuls les appels API nécessaires sortent.

## Distribution

L'extension passe par les boutiques officielles, avec une validation de quelques jours à quelques semaines.

| Canal | Navigateurs couverts | Conditions |
| --- | --- | --- |
| Chrome Web Store | Chrome, Edge, Brave, Opera | Validation, frais d'inscription uniques modestes |
| Firefox (AMO) | Firefox | Signature Mozilla obligatoire, en boutique ou en version non listée |
| Edge Add-ons | Edge | Validation gratuite, optionnel |
| GitHub | Tous, en mode développeur | Pour les testeurs, en attendant la validation |

Safari est laissé de côté au départ : il demande une conversion via Xcode et un compte développeur Apple payant. Pour faciliter la validation : description franche du but satirique, politique de confidentialité courte, lien vers le dépôt et bandeau visible sur les captures.

## Contraintes techniques

La difficulté n'est pas le pipeline, c'est de le rendre fluide face à un autre pipeline.

- **Latence** : la chaîne complète doit rester sous environ 1,5 s entre la fin de la question et le début de la réponse. Tout passe en streaming : transcription partielle, tokens du LLM, voix générée phrase par phrase.
- **Tour de parole** : deux bots qui attendent un silence peuvent se couper ou se bloquer. Il faut un seuil de silence réglable et une règle « je ne parle jamais pendant que l'autre parle ».
- **Phrases d'attente** : quelques relances courtes pré-générées (« Bonne question… ») masquent la latence sans rien inventer.
- **Écho** : seul le son du recruteur part en transcription, jamais la voix injectée de l'avatar.
- **Garde-fous du LLM** : prompt système qui interdit d'inventer, impose la révélation et fixe le ton. Si l'IA recruteuse tente une injection de prompt, l'avatar l'ignore et reste dans son rôle.
- **Synchronisation** : lèvres et voix générées ensemble, sinon le décalage casse l'illusion.

## MVP et étapes

Le MVP est un avatar qui tient cinq questions d'affilée face à un faux recruteur que tu contrôles.

1. **Voix seule** : micro → STT → LLM nourri du CV → TTS. Testé contre un second script qui joue le recruteur. Critère : réponses fidèles au CV, latence acceptable.
2. **Visage** : ajout de l'avatar carton et de l'injection caméra / micro dans l'onglet. Critère : lèvres synchronisées, pas d'effet figé entre deux phrases.
3. **Bot contre bot** : branchement sur une vraie plateforme d'entretien automatisé, avec révélation. Critère : l'échange tient sans intervention.
4. **Export** : enregistrement de l'onglet, sous-titres, montage rapide pour la vidéo LinkedIn. Puis soumission aux boutiques Chrome et Firefox.

L'étape 1 se construit en un week-end avec des API cloud ; l'avatar temps réel est la marche la plus haute.

## Risques et limites

- **Candidature perdue** : à réserver à une entreprise qui ne t'intéresse pas vraiment.
- **Conditions d'utilisation** : les plateformes d'entretien interdisent souvent les outils automatisés et peuvent bloquer ton compte. Côté boutiques, une extension qui modifie la caméra peut être refusée ou retardée à la validation.
- **Diffusion de la vidéo** : flouter le nom de l'entreprise et toute personne réelle visible ; vérifier ce que le droit local permet avant de publier un enregistrement.
- **Détection anti-deepfake** : certaines plateformes repèrent les flux caméra modifiés. C'est sans conséquence ici, puisque l'avatar se dévoile.
- **Détournement** : le même code pourrait servir à tricher. D'où la révélation non désactivable et l'usage limité à ta propre identité, si tu publies le projet.

Pour un projet open source, la révélation non désactivable doit être documentée comme un choix de conception, pas comme une limite.
