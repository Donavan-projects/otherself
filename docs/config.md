# Configuration locale (démo)

Pour la démo, les données personnelles sont lues depuis `config.local.json`, à la racine du projet. Ce fichier et le dossier `local/` sont ignorés par git : ils ne sont jamais commités.

```
cp config.example.json config.local.json
mkdir -p local
```

Les chemins sont relatifs à la racine du projet. Les fichiers sont copiés dans le build sous `local/` : après toute modification de `config.local.json` ou des fichiers qu'il désigne, relancer `npm run dev` ou `npm run build`.

| Champ | Formats | Rôle | Si absent |
| --- | --- | --- | --- |
| `photo` | jpg, png, webp | Photo de l'avatar (au moins 720 px conseillés) | Silhouette neutre, avertissement au build |
| `testAudio` | mp3, ogg, wav, webm, m4a | Son préenregistré joué en boucle par le micro injecté, en attendant la voix générée de l'étape 4 | **Bip de 440 Hz chaque seconde**, sans avertissement au build |

> **Attention** : `testAudio` figure dans `config.example.json`, mais un `config.local.json` créé avant l'étape 3 ne l'a pas. Sans ce champ, l'injection envoie un bip à la place de ton enregistrement. Le log `[inject] aucun son préenregistré (testAudio)` dans la console de la page le signale.
