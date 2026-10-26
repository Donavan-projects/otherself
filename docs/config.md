# Configuration locale (démo)

Pour la démo, les données personnelles sont lues depuis `config.local.json`, à la racine du projet. Ce fichier et le dossier `local/` sont ignorés par git : ils ne sont jamais commités.

```
cp config.example.json config.local.json
mkdir -p local
```

Les chemins sont relatifs à la racine du projet. Les fichiers sont copiés dans le build sous `local/`, avec un `local/config.json` qui les référence : après toute modification de `config.local.json` ou des fichiers qu'il désigne, relancer `npm run dev` ou `npm run build`.

> **Clé API** : `openaiApiKey` est recopiée dans `.output/…/local/config.json` (ignoré par git, jamais accessible aux pages web ni transmise à la page de la plateforme). Ne partagez pas le dossier `.output` ni un zip du build.

> **Logs du pipeline voix** : ils s'affichent dans la console du document offscreen (`chrome://extensions` → OtherSelf, mode développeur → « Inspecter les vues : offscreen.html »), avec la transcription `Recruteur : …` / `Avatar : …`. Ce document n'existe qu'après l'activation sur un onglet : le lien `offscreen.html` n'apparaît qu'en rechargeant la page `chrome://extensions` après avoir cliqué sur « Activer sur cet onglet ».

| Champ | Valeurs | Rôle | Si absent |
| --- | --- | --- | --- |
| `avatar` | nom de fichier | Personnage : `avatar/<avatar>.svg` (voir `avatar/gabarit.svg`) | `otherself` |
| `background` | nom de fichier | Fond : `avatar/fonds/<background>.svg` | `interieur-clair` |
| `palette` | objet | Variante de couleurs sans redessiner : classe de la palette du SVG → couleur CSS. Exemple : `{ "peau": "#a86f4c", "cheveux": "#151010", "vetement": "#5b6470", "barbe": "none" }`. Classes : `peau`, `peau-trait`, `cheveux`, `cheveux-trait`, `sourcils`, `barbe`, `vetement` (surchemise), `vetement-2` (t-shirt), `vetement-trait`, `iris`, `levres`, `badge-fond` (encre du slogan)… | Couleurs du SVG |
| `hairstyle` | nom | Coiffure : sous-groupe `coiffure_<nom>` du SVG | `principale` |
| `accessories` | liste de noms | Accessoires affichés : sous-groupes `accessoire_<nom>` | aucun |
| `bannerOffsetY` | pixels | Décalage vertical du bandeau du bas, négatif vers le haut. Il reste dans la zone de sécurité et ne remonte jamais sur le slogan du t-shirt (de y = 529 à 590) | `0` (bandeau en bas du cadre, y = 590 à 670) |
| `bannerText` | texte | Texte du bandeau incrusté (règle 1), aussi imprimé sur le t-shirt de l'avatar. Démo : « Automated candidate, just like you. » | « Candidat automatisé, comme vous. » (un texte vide est aussi remplacé par celui-ci) |
| `language` | `en`, `fr` | Langue de l'entretien : transcription, réponses du LLM, phrase de révélation | `en` |
| `candidateName` | texte | Prénom ou nom du candidat : l'avatar parle de lui à la troisième personne (« Alex a travaillé… »), et se présente comme « l'avatar IA qui représente Alex » | « the candidate » / « le candidat » |
| `messageText` | texte | Mode « message » : déclaration prononcée juste après la révélation, avant de répondre aux questions | Révélation seule |
| `cv` | md, txt | CV et notes du candidat, seule source des réponses (règle 5) | Avertissement au build ; l'avatar dit ne pas pouvoir répondre |
| `openaiApiKey` | `sk-…` | Clé OpenAI (transcription et LLM) | Pipeline voix inactif, avertissement au build |
| `voice` | identifiant Piper | Voix Piper de l'avatar, téléchargée une seule fois depuis Hugging Face (voir ci-dessous) | Voix du personnage : attribut `data-voix` du SVG (`en_US-norman-medium` pour `otherself`) |
| `ttsProvider` | `piper`, `openai` | Synthèse vocale : Piper (local, gratuit) ou OpenAI (même clé, payante, en streaming) | `piper` |
| `openaiVoice` | voix OpenAI | Voix de la synthèse OpenAI (`ash`, `onyx`…) | Voix du personnage : attribut `data-voix-openai` du SVG (`ash`) |
| `openaiTtsModel` | modèle OpenAI | Modèle de synthèse OpenAI | `gpt-4o-mini-tts` |
| `piperScales` | objet | Réglages Piper : `lengthScale` (débit, plus petit = plus rapide), `noiseScale` (variation de l'intonation), `noiseW` (variation du rythme). Comparer au banc d'essai des voix (popup) | `{ "lengthScale": 0.92, "noiseScale": 0.8, "noiseW": 1 }` |
| `monitorAvatar` | `true` / `false` | Retour audio : vous entendez la voix de l'avatar, jouée par l'extension hors de l'onglet de l'entretien (elle n'est donc jamais prise pour le recruteur) | Activé |
| `monitorVolume` | 0 à 1 | Volume du retour audio | `0.8` |
| `silenceMs` | millisecondes | Silence après lequel le recruteur est considéré comme ayant fini sa question | `800` |
| `bargeInMs` | millisecondes | Parole continue du recruteur par-dessus la voix de l'avatar nécessaire pour l'interrompre. En dessous, la prise de parole est ignorée (écho ou bruit probable) | `600` |
| `sttModel` | modèle OpenAI | Transcription en flux (session Realtime) | `gpt-live-transcribe` |
| `llmModel` | modèle OpenAI | Réponses en streaming, sans raisonnement | `gpt-6-luna` |
| `debugSafeZone` | `true` / `false` | Débogage : dessine dans l'image le contour pointillé magenta de la zone de sécurité (visible aussi par l'interlocuteur sur la plateforme) | Désactivé |
| `testAudio` | mp3, ogg, wav, webm, m4a | Banc d'essai `rehearsal?inject` uniquement : son joué en boucle par le micro injecté | Bip de 440 Hz chaque seconde |

## Voix

Licences vérifiées pour une vidéo publiée. Vitesse mesurée en WebAssembly sur la machine de référence (i7-4720HQ), en temps de synthèse rapporté à la durée de l'audio (moins de 1 = plus rapide que le temps réel) :

| Voix | Genre | Licence du jeu de données | Vitesse |
| --- | --- | --- | --- |
| `en_US-ljspeech-medium` | féminine | domaine public (LJ Speech) | ≈ 0,35 |
| `en_US-joe-medium` | masculine | CC0 pour le jeu `joe`, mais voix **affinée à partir de `lessac`** (jeu Lessac, licence Blizzard 2013, recherche) : **à éviter pour toute publication** | ≈ 0,2 |
| `en_US-norman-medium` | masculine | domaine public (LibriVox), entraînée de zéro : **voix masculine la plus sûre pour une vidéo publiée** | non mesurée (même taille que joe) |
| `en_US-john-medium` | masculine | domaine public (LibriVox), affinée à partir de `kristin` (LibriVox) | non mesurée (même taille que joe) |
| `en_US-ljspeech-high` | féminine | domaine public | 1,25 à 2,7 : **trop lente** pour répondre en direct |

À éviter pour une vidéo publiée : `en_US-ryan-*` et `en_US-hfc_*` (CC BY-NC-SA, usage non commercial), `en_US-lessac-*` (licence Blizzard 2013, recherche).

Depuis l'étape 4, `testAudio` ne sert plus sur la plateforme : le micro injecté porte la voix générée.
