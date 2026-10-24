# OtherSelf

Une extension de navigateur pour réagir à un entretien d'embauche automatisé que vous jugez injuste : au lieu d'un humain face à une machine, c'est votre propre avatar IA qui répond, clairement identifié comme tel.

> **Statut : prototype de démonstration.** Ce dépôt accompagne une vidéo de démonstration. Un projet complet, utilisable par tous sans compétences techniques, ne sera développé que si le sujet suscite de l'intérêt. Aucun support n'est garanti.

> **Avertissement.** Utiliser OtherSelf dans une vraie candidature, c'est probablement renoncer au poste. Les plateformes d'entretien peuvent aussi interdire les outils automatisés dans leurs conditions d'utilisation.

## Principe

Quand un entretien est mené par un système automatisé, OtherSelf remplace votre caméra et votre micro, dans l'onglet de l'entretien uniquement, par un avatar :

1. il écoute la question posée par la plateforme ;
2. il annonce d'abord qu'il est une IA ;
3. il peut ensuite lire une déclaration que vous avez écrite (par exemple, demander poliment un entretien avec un humain) ;
4. puis il répond aux questions à partir de votre CV et de vos notes, sans rien inventer.

## Choix de conception

Ces règles font partie du projet et ne sont pas désactivables :

- **Bandeau toujours visible** : un bandeau (« Candidat automatisé, comme vous. » par défaut) est dessiné dans chaque image de la vidéo, à un emplacement qui reste visible même quand la plateforme recadre l'image.
- **Révélation immédiate** : la première prise de parole de l'avatar annonce qu'il est une IA.
- **Aucun mode discret** : OtherSelf ne sert pas à tromper un interlocuteur humain, ni à souffler des réponses.
- **Avatar cartoon uniquement** : pas d'import de photo, pas de clonage de visage ni de voix ; voix synthétique générique.
- **Pas d'invention** : l'avatar ne répond qu'à partir de votre CV et de vos notes, sans inventer d'expérience, de diplôme ou de chiffre.
- **Permissions minimales** : l'extension n'agit que sur l'onglet où vous l'activez (`activeTab` + `scripting`, `offscreen` pour le pipeline voix, `tabCapture` pour entendre le recruteur dans cet onglet), jamais sur tous les sites.

## Essayer le prototype (développeurs)

Prérequis : Node.js 22 et Chrome.

```
npm install
cp config.example.json config.local.json   # voir docs/config.md
npm run dev
```

`npm run dev` ouvre un Chrome de développement avec l'extension chargée. Le popup donne accès à une page de répétition (« faux recruteur ») et à l'activation sur l'onglet courant. Sur une plateforme réelle, autorisez d'abord caméra et micro pour le site, activez l'extension, puis coupez et rallumez caméra et micro.

## État d'avancement

- Fait : page de répétition, rendu de l'avatar avec bandeau, injection caméra et micro (testée sur Google Meet).
- En cours : pipeline voix (écoute, transcription, réponse, synthèse vocale) et déclaration configurable.
- Ensuite : avatar cartoon OtherSelf, puis tournage de la démo.
