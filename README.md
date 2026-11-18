# OtherSelf

Une extension de navigateur qui explore la symétrie des entretiens de recrutement automatisés : face à un recruteur IA, votre propre avatar IA peut répondre en votre nom, en s'identifiant clairement comme une IA.

![Avatar OtherSelf : androïde 3D en style dessin animé, cheveux argentés, peau blanche, un œil bleu et un œil jaune, veste blanche à col montant ; sur la poitrine, les lettres « AI » imprimées en gris, et sur la languette du col un voyant bleu allumé. Fond flou : atrium futuriste de nuit, plantes et architecture lumineuse.](docs/images/otherself-apercu.png)

*Image vidéo envoyée par l'extension (1280 × 720) : avatar 3D créé avec VRoid Studio, rendu dans le navigateur. Le marquage « AI » (« IA » en français) et le voyant d'état du col (bleu : en attente ou à l'écoute ; ambre : réflexion ; vert : parole) sont dessinés par le code dans chaque image : la plateforme ne peut pas les masquer. Voir [Licence et crédits](#licence-et-crédits).*

> **Statut : prototype de démonstration.** Ce dépôt accompagne une vidéo de démonstration. Un projet complet, utilisable par tous sans compétences techniques, ne sera développé que si le sujet suscite de l'intérêt. Aucun support n'est garanti.

> **Avertissement.** Utiliser OtherSelf dans une vraie candidature, c'est probablement renoncer au poste. Les plateformes d'entretien peuvent aussi interdire les outils automatisés dans leurs conditions d'utilisation.

## Principe

Quand un entretien est mené par un système automatisé, OtherSelf remplace votre caméra et votre micro, dans l'onglet de l'entretien uniquement, par un avatar :

1. il écoute la question posée par la plateforme ;
2. il annonce d'abord qu'il est une IA ;
3. il peut ensuite lire une déclaration que vous avez écrite (par exemple, demander poliment un entretien avec un humain) ;
4. puis il répond aux questions à partir de votre CV et de vos notes, sans rien inventer.

```mermaid
flowchart LR
  P["Plateforme d'entretien"] -->|"son de l'onglet"| D["Détection de parole<br/>locale"]
  D --> T["Transcription<br/>OpenAI"]
  T --> R["Réponse à partir du CV<br/>OpenAI"]
  R --> V["Voix de synthèse<br/>Piper, locale"]
  H["Hugging Face<br/>modèle de voix Piper<br/>téléchargé une fois"] -.->|"modèle de voix seulement"| V
  V --> A["Avatar animé + marqueur IA<br/>local"]
  A -->|"caméra et micro injectés"| P
```

La voix est synthétisée en local, dans le navigateur, par Piper : seul le modèle de voix est téléchargé, une fois, depuis Hugging Face, et aucune donnée de l'entretien ni du candidat ne lui est envoyée. Seules la transcription et la rédaction des réponses passent par l'API OpenAI.

Détail des composants, de ce qui reste local et de l'animation de l'avatar : [docs/architecture.md](docs/architecture.md).

## Choix de conception

Ces règles font partie du projet et ne sont pas désactivables :

- **Marqueur IA toujours visible** : dans chaque image où l'avatar apparaît, le marquage « IA » (« AI » en anglais) est imprimé sur sa veste, près du visage, comme un numéro de série, et la languette de son col s'allume comme un voyant : bleu quand il attend ou écoute, ambre quand il réfléchit, vert quand il parle. Ils restent visibles même quand la plateforme recadre l'image, et le voyant ne s'éteint jamais tant que l'avatar est visible. Pendant une pause, l'image affichée à la place de l'avatar l'indique en toutes lettres (« Avatar IA en pause »). L'apparence volontairement non humaine de l'avatar et l'annonce vocale complètent ce marqueur.
- **Révélation immédiate** : la première prise de parole de l'avatar annonce qu'il est une IA.
- **Aucun mode discret** : OtherSelf ne sert pas à tromper un interlocuteur humain, ni à souffler des réponses.
- **Avatar cartoon uniquement** : pas d'import de photo, pas de clonage de visage ni de voix ; voix synthétique générique.
- **Pas d'invention** : l'avatar ne répond qu'à partir de votre CV et de vos notes, sans inventer d'expérience, de diplôme ou de chiffre.
- **Permissions minimales** : l'extension n'agit que sur l'onglet où vous l'activez (`activeTab` + `scripting`, et `offscreen` pour le pipeline voix), jamais sur tous les sites. Pour entendre le recruteur, elle vous demande de partager cet onglet, son compris, par la fenêtre standard de Chrome : aucune permission en plus.

## Essayer le prototype (développeurs)

Prérequis : Node.js 22, Chrome, une clé API OpenAI (transcription et réponses) et, pour l'avatar 3D, WebGL avec accélération graphique (`chrome://gpu` : « WebGL: Hardware accelerated »). Sans accélération, l'extension passe automatiquement à l'avatar de secours : images du même personnage rendues à l'avance, plus légères (bouche, yeux et marqueur animés, sans mouvement de tête).

```
npm install
cp config.example.json config.local.json   # clé API, CV, voix… : voir docs/config.md
npm run build                              # build de production, dans .output/chrome-mv3
```

Chargez `.output/chrome-mv3` dans `chrome://extensions` (mode développeur, « Charger l'extension non empaquetée »). Sur la plateforme d'entretien : autorisez caméra et micro pour le site, cliquez sur « Activer sur cet onglet » dans le popup, puis sur le bouton OtherSelf qui apparaît dans la page pour partager l'onglet avec son son (c'est ainsi que l'avatar entend le recruteur, sans aucune permission d'extension). Choisissez ensuite le micro « Avatar IA – OtherSelf » dans la plateforme si elle ne l'a pas pris d'elle-même. Les appels à OpenAI sont facturés sur votre compte.

## État d'avancement

- Fait : page de répétition, injection caméra et micro, pipeline voix (écoute, transcription, réponse, synthèse vocale, révélation et déclaration configurable), marqueur IA incrusté (marquage sur la veste et voyant d'état sur la languette du col), testé sur Google Meet.
- Fait : avatar 3D (modèle VRoid rendu avec three.js) : synchronisation labiale sur la voix, clignements, regard, mouvements de tête, respiration, physique des cheveux, plan serré (tête et épaules) ; avatar de secours automatique, rendu à l'avance depuis le même modèle. Testé sur Google Meet.
- En cours : tournage de la démo.
- Plus tard, si le sujet intéresse : bouche pilotée par les phonèmes plutôt que par le volume de la voix, assistant de configuration pour les non-techniciens.

## Licence et crédits

OtherSelf est un logiciel libre sous licence [GPL-3.0-or-later](LICENSE) : l'extension embarque le phonémiseur eSpeak NG, lui-même sous GPL-3.0. Copyright (C) 2026 Donavan-projects.

Merci aux projets sur lesquels OtherSelf repose : [three.js](https://github.com/mrdoob/three.js) et [three-vrm](https://github.com/pixiv/three-vrm) (pixiv) pour le rendu de l'avatar 3D, [Piper](https://github.com/rhasspy/piper) et [piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) pour la voix de synthèse, [eSpeak NG](https://github.com/espeak-ng/espeak-ng) pour la phonémisation, [Silero VAD](https://github.com/snakers4/silero-vad) pour la détection de parole, [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) et [WXT](https://github.com/wxt-dev/wxt). Voix par défaut : `en_US-norman-medium`, entraînée sur des enregistrements [LibriVox](https://librivox.org) (domaine public), jouée 1,5 demi-ton plus haut sans changer le débit. Police du marquage « IA » : [DejaVu Sans Mono](https://dejavu-fonts.github.io/) Bold (licence [Bitstream Vera](public/fonts/DejaVu-LICENSE.txt)). Détail des licences : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Avatar 3D.** Le personnage (`avatar/otherself.vrm`) a été créé avec [VRoid Studio](https://vroid.com/en/studio) (pixiv), à partir des éléments prédéfinis de l'application, puis allégé pour l'extension. Il est distribué sous [VRM Public License 1.0](https://vrm.dev/licenses/1.0/) (usage commercial, redistribution et modification autorisés), distincte de la licence du code. Les éléments prédéfinis de VRoid relèvent aussi des [conditions de VRoid Studio](https://vroid.pixiv.help/hc/en-us/articles/4405813333657) : utiliser un modèle créé avec l'application est autorisé, mais une application qui génère des avatars à partir de ces éléments demande une licence séparée de pixiv.

**Avatar de secours.** Quand l'avatar 3D ne peut pas être affiché (pas d'accélération graphique, échec du chargement), l'extension utilise des images du même personnage rendues à l'avance à partir du modèle (`avatar/secours/`, `npm run vrm -- fallback`) ; elles relèvent des mêmes conditions que le modèle.

**Fonds.** Les fonds « atrium » (par défaut, flouté) et « bureau » ont été générés avec ChatGPT (OpenAI) : images matricielles recadrées et retouchées (flou pour « atrium », désaturation et éclaircissement pour « bureau-clair »), intégrées en WebP dans un SVG. Le marqueur IA est dessiné par le code. Ces images sont mises à disposition sans revendication de droits ; leur statut est distinct de la licence du code, la GPL ne s'applique pas à elles (détail : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#images)).
