# Profil du candidat : modèle de notes

Le profil (CV et notes, fichier désigné par le champ `cv` de `config.local.json`) est la **seule source des réponses**
de l'avatar (règle 5) : il ne dit rien qui n'y soit pas. La qualité des réponses est donc plafonnée par celle des
notes. Un CV seul suffit pour les questions factuelles (poste, outils, diplômes) ; les questions comportementales
(« racontez une fois où… ») demandent des histoires.

Ce modèle est aussi le **format interne du profil** : une source future (connecteur, conversion d'un CV en PDF ou d'un
outil de notes, voir l'étape 6 de `docs/feuille-de-route.md`) devra produire ce même texte, que `lib/profile.ts`
transmet tel quel au prompt.

## Règles

- **Markdown simple**, en anglais ou en français (l'avatar répond dans la langue de l'entretien, `language`).
- **Trois à cinq histoires** couvrent la plupart des questions comportementales : choisir des expériences variées
  (une automatisation, un problème technique difficile, un projet mené de bout en bout, une situation humaine : équipe,
  désaccord, client, un échec et ce qui en a été tiré).
- Pour chaque histoire : **contexte, rôle, actions, résultat**. Le résultat est **chiffré** quand c'est possible
  (temps gagné, volume traité, taille d'équipe, délai). Sans chiffre, un résultat concret et vérifiable ; sans résultat
  du tout, l'avatar s'arrête sur l'action, il n'en invente pas.
- **Des faits, pas des qualités** : « a formé 6 nouveaux agents en 2 semaines » plutôt que « bon pédagogue ». Une
  qualité sans fait ne sera pas reprise.
- Ce qui n'est pas dans le profil, l'avatar dit qu'il ne le sait pas : salaire, disponibilité, préférences… à ajouter
  dans « Informations pratiques » si on veut qu'il puisse y répondre.
- Rien qu'on ne veuille pas entendre dit à voix haute à un recruteur.

## Modèle

```markdown
# Prénom Nom

**Titre visé** (ex. Product Builder, IA et automatisation)

## Informations pratiques
- Lieu, mobilité, télétravail :
- Type de contrat recherché :
- Disponibilité :
- Langues :

## Résumé
Deux ou trois phrases factuelles : années d'expérience, domaine, ce qui distingue.

## Compétences
- Domaine : outils, technologies (les plus utilisés en premier)

## Expériences
### Poste — Employeur (secteur), lieu · dates
Une phrase sur le rôle. Résultats clés chiffrés.

## Histoires (3 à 5)
### Titre court de l'histoire (employeur ou projet, année)
- **Contexte** : la situation et le problème, en une ou deux phrases.
- **Rôle** : ce dont le candidat était responsable, seul ou en équipe.
- **Actions** : ce qu'il a fait, concrètement, dans l'ordre (trois étapes au plus).
- **Résultat** : chiffré si possible ; sinon concret ; sinon rien.
- **Questions auxquelles elle répond** : automatisation, API difficile, projet de bout en bout…

## Formation
- Diplôme ou formation — établissement · année
```

## Exemple (fictif)

```markdown
### Import automatique des catalogues fournisseurs (Atelier Martin, 2024)
- **Contexte** : chaque mois, 3 fournisseurs envoyaient leurs tarifs dans des tableurs aux formats différents ;
  la saisie prenait deux jours à une personne.
- **Rôle** : seul développeur, en lien avec la responsable des achats.
- **Actions** : normalisation des trois formats dans un scénario Make ; contrôle des écarts de prix supérieurs à
  10 % avant import ; alerte par courriel en cas d'erreur.
- **Résultat** : saisie ramenée de deux jours à vingt minutes de vérification ; aucune erreur de prix en six mois.
- **Questions auxquelles elle répond** : automatisation d'un processus manuel, fiabilité des données, travail avec
  un service non technique.
```
