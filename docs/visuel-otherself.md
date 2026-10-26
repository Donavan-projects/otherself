# OtherSelf — Ajustements visuels pour le prototype de démonstration

## Objectif

Faire évoluer l'avatar vers une identité visuelle **cartoon personnalisable, inspirée des jeux vidéo**, cohérente, reconnaissable et facile à présenter dans une courte démonstration vidéo.

OtherSelf est un prototype qui permet à un candidat de répondre à un entretien automatisé par son propre avatar IA, clairement identifié comme artificiel. L'avatar doit conserver une identité visuelle distinctive.

Pour cette version, privilégier une démonstration convaincante plutôt qu'une personnalisation complète ou une refonte générale de l'extension.

Avant toute modification, inspecter l'architecture et les composants existants (`lib/avatar.ts`, page `avatar`, injection). Réutiliser autant que possible le code actuel et limiter les changements au strict nécessaire pour la démo.

Ce document remplace l'étape 5 (avatar carton) du `CLAUDE.md`. Il ne remplace pas l'étape 4 (pipeline voix).

## 1. Identité visuelle et avatar

Adopter un style **cartoon vectoriel moderne**, expressif et légèrement inspiré des jeux vidéo indépendants, avec un style original qui n'imite aucun studio, jeu ou personnage existant.

Caractéristiques :
- Illustration 2D avec contours nets et couleurs harmonieuses.
- Personnage sympathique, expressif et facilement reconnaissable.
- Animation simple de la bouche pendant la prise de parole, pilotée par l'amplitude de la voix générée.
- Clignement des yeux facultatif.
- Rendu léger, fluide sur la machine de référence (16 Go RAM, GPU ancien de 4 Go).

Éviter le photoréalisme, les clones de personnes réelles et les avatars 3D complexes.

### Personnalisation limitée

Prévoir uniquement quelques variantes prédéfinies :
- Coiffure et couleur des cheveux.
- Teinte de peau.
- Lunettes ou accessoire simple.
- Vêtements ou couleurs.

Utiliser des éléments graphiques locaux en SVG, dessinés dans le canvas de l'avatar. Pour la démo, le choix des variantes se fait dans `config.local.json` ; pas d'éditeur d'avatar.

Ne pas ajouter d'import de photos, de clonage visuel ou de dépendance externe pour générer les personnages. Le rendu actuel à partir de la photo est remplacé par l'avatar cartoon.

## 2. Arrière-plan

Ajouter un fond simple derrière l'avatar, avec au maximum trois variantes :
- Fond uni ou dégradé graphique.
- Bureau stylisé.
- Décor minimaliste inspiré d'un jeu vidéo.

Les fonds doivent rester secondaires, préserver le contraste du visage, être locaux et légers, et être choisis indépendamment de l'avatar dans `config.local.json`.

Ne pas créer de bibliothèque de décors.

## 3. Bandeau de transparence : signature visuelle

Le bandeau est un élément central de l'identité d'OtherSelf. Son texte est configurable (`bannerText` dans `config.local.json`) :
- Par défaut : **« Candidat automatisé, comme vous. »**
- Variante anglaise : **« Automated candidate, just like you. »**

Ne pas le remplacer par « Avatar IA » ou une formulation générique.

### Emplacement (inchangé)

- Dessiné **dans le canvas du flux vidéo injecté**, à chaque image et en dernier (règle 1), jamais en superposition DOM.
- Placé dans la zone de sécurité qui survit aux recadrages des plateformes : 4:3 et carré sur les côtés ; en haut et en bas, la coupe 2:1 mesurée sur Meet sans cadrage automatique (36 px) plus une marge (décision du 26/10/2026 : la coupe 21:9 n'est plus couverte). Bandeau en bas du cadre (y = 608 à 670), centré, 580 × 62 px. Avec le cadrage automatique, il peut être coupé : le slogan du t-shirt et la révélation vocale prennent le relais.
- Sur une seule ligne, sans chevauchement avec le visage.

### Résistance au zoom sur le visage

Le cadrage automatique des plateformes (Framing sur Meet) zoome sur le visage détecté et coupe le bandeau de la zone de sécurité (constaté sur Meet avec la photo). Le bandeau doit survivre à un zoom centré sur le visage :

- Prévoir une **version intégrée au personnage** : badge ou brassard au niveau du col, juste sous le menton, sans masquer le visage, portant le même texte (`bannerText`). Elle s'ajoute au bandeau de la zone de sécurité, sans le remplacer.
- Comme le bandeau principal, elle est dessinée dans le canvas à chaque image, jamais en superposition DOM, et n'est pas désactivable.
- Vérifier sa lisibilité dans une vignette zoomée sur le visage.
- À l'étape 5, **tester si Meet détecte le visage cartoon et zoome dessus** (cadrage automatique activé côté A), et noter le résultat dans `CLAUDE.md`.

### Apparence

- Fond jaune, texte noir suffisamment gras, contraste élevé.
- Présentation compacte et immédiatement reconnaissable.
- Icône facultative, uniquement si elle ne détourne pas l'attention du slogan.

### Lisibilité

- Le slogan complet reste lisible, sans troncature ni points de suspension, dans les deux langues.
- Adapter la taille du texte à la largeur de la zone de sécurité, avec une taille minimale lisible dans une petite vignette (environ 320×180).
- Vérifier le rendu dans la page `avatar` et dans une vignette Meet recadrée.

## 4. Identification explicite de l'IA

Le bandeau reste l'élément visuel principal. Une petite mention secondaire « Avatar IA » peut être ajoutée sans le remplacer.

L'avatar annonce explicitement qu'il est une IA dans sa première réponse vocale (géré par le prompt système de l'étape 4).

## 5. Voix et prise de parole

La voix est celle du pipeline de l'étape 4 (Piper, voix synthétique générique). Ce document n'ajoute ni fournisseur ni clonage vocal.

Ajouter une indication visuelle simple quand l'avatar parle (animation de la bouche, éventuellement léger halo ou mouvement), si elle s'intègre facilement.

## 6. Priorités de réalisation

1. Remplacer le rendu photo par l'avatar cartoon et harmoniser son environnement.
2. Adapter le bandeau (texte configurable, mêmes contraintes d'emplacement).
3. Vérifier la visibilité permanente du slogan, y compris après recadrage.
4. Soigner l'avatar pendant la prise de parole.
5. Corriger les défauts d'affichage visibles dans la capture vidéo.

Les fonctionnalités non nécessaires à la démonstration restent hors périmètre.

## 7. Critères de validation

- L'avatar est stylisé, original, et n'imite aucune personne réelle.
- Le slogan exact est intégralement visible, jamais tronqué, en français comme en anglais.
- Le bandeau reste visible dans la vignette Meet recadrée.
- L'avatar parle avec la voix synthétique de l'étape 4 et sa bouche s'anime.
- Les arrière-plans ne nuisent pas à la lisibilité.
- L'injection sur Meet fonctionne toujours (image, bandeau, son).
- Aucune photo ni ressource distante n'est chargée pour construire l'avatar.

## 8. Méthode de travail

1. Inspecter l'architecture et identifier les composants visuels concernés.
2. Présenter un plan court des modifications.
3. Réutiliser les composants et ressources existants.
4. Implémenter uniquement les changements nécessaires à la démonstration.
5. Vérifier le rendu dans la page `avatar` et sur Meet, puis corriger les défauts visibles.

Ne pas réécrire l'extension, ne pas ajouter de dépendances importantes, ne pas développer de fonctionnalités supplémentaires sans nécessité directe pour la démo.
