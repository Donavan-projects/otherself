# Composants tiers

OtherSelf est distribué sous licence GPL-3.0-or-later (voir `LICENSE`). Il s'appuie sur les
composants suivants. Ceux marqués « embarqué » font partie de l'extension construite
(`npm run build`) ; les voix sont téléchargées par l'extension au premier usage.

| Composant | Rôle | Licence | Distribution |
| --- | --- | --- | --- |
| [eSpeak NG](https://github.com/espeak-ng/espeak-ng) | phonémiseur de Piper (dans `vendor/piper/piper_phonemize.wasm` et `.data`) | GPL-3.0-or-later | embarqué |
| [piper-phonemize](https://github.com/rhasspy/piper-phonemize) (Michael Hansen) | phonémisation pour Piper | MIT | embarqué (compilé en WebAssembly) |
| [@diffusionstudio/piper-wasm](https://github.com/diffusion-studio/piper-wasm) (Konstantin Paulus, Diffusion Studio) | compilation WebAssembly de piper-phonemize et eSpeak NG | MIT (déclarée dans `package.json`, sans fichier de licence publié) | embarqué |
| [@mintplex-labs/piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) (Mintplex Labs) | synthèse Piper dans le navigateur | MIT (déclarée dans `package.json`, sans fichier de licence publié) | embarqué |
| [Piper](https://github.com/rhasspy/piper) (Michael Hansen) | moteur de synthèse et format des voix | MIT | format utilisé |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (Microsoft) | exécution des modèles (VAD, voix) | MIT | embarqué |
| [Silero VAD](https://github.com/snakers4/silero-vad) v5 (Silero Team) | détection de parole (`vendor/silero_vad_v5.onnx`) | MIT | embarqué |
| [@ricky0123/vad-web](https://github.com/ricky0123/vad) | source du fichier `silero_vad_v5.onnx` utilisé | ISC | fichier modèle repris |
| [Noto Sans](https://github.com/notofonts/latin-greek-cyrillic) Bold (Google LLC) | police du slogan imprimé sur l'avatar (`public/fonts/NotoSans-Bold.ttf`, texte de licence dans `public/fonts/OFL.txt`) | OFL-1.1 | embarqué |
| [WXT](https://github.com/wxt-dev/wxt) | cadre de l'extension (petites parties à l'exécution) | MIT | embarqué en partie |

## Voix

Téléchargées depuis Hugging Face ([rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices), miroir
`diffusionstudio/piper-voices`) ; une seule voix, celle choisie dans `config.local.json`.

| Voix | Jeu de données | Licence du jeu de données (fiche du modèle) | Remarque |
| --- | --- | --- | --- |
| `en_US-ljspeech-medium` (voix par défaut) | [LJ Speech](https://keithito.com/LJ-Speech-Dataset/) | domaine public | entraînée de zéro sur LJ Speech (Bryce Beattie) |
| `en_US-norman-medium` | [LibriVox](https://librivox.org) | domaine public | entraînée de zéro ; voix masculine conseillée |
| `en_US-joe-medium` | [OHF-Voice voice-datasets](https://github.com/OHF-Voice/voice-datasets) | CC0 | **affinée à partir de la voix `lessac`**, elle-même entraînée sur le jeu Lessac (licence Blizzard 2013, recherche) : statut incertain pour une publication |

## Sources des parties GPL

Le code source d'eSpeak NG est disponible sur https://github.com/espeak-ng/espeak-ng, et celui de sa
compilation WebAssembly utilisée ici sur https://github.com/diffusion-studio/piper-wasm. Le code source
complet d'OtherSelf est ce dépôt.

## Textes des licences

### MIT : Piper, piper-phonemize

```
MIT License

Copyright (c) 2022 Michael Hansen (Piper)
Copyright (c) 2023 Michael Hansen (piper-phonemize)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT : ONNX Runtime Web

```
MIT License

Copyright (c) Microsoft Corporation
```
(suivi du même texte de permission MIT que ci-dessus)

### MIT : Silero VAD

```
MIT License

Copyright (c) 2020-present Silero Team
```
(suivi du même texte de permission MIT que ci-dessus)

### MIT : WXT

```
MIT License

Copyright (c) 2023 Aaron
```
(suivi du même texte de permission MIT que ci-dessus)

### MIT : @diffusionstudio/piper-wasm, @mintplex-labs/piper-tts-web

Licence MIT déclarée dans leur `package.json` (auteurs : Konstantin Paulus / Diffusion Studio ; Mintplex
Labs), même texte de permission MIT que ci-dessus.

### ISC : @ricky0123/vad-web

```
ISC License

Copyright (c) 2022-present ricky0123

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### GPL-3.0-or-later : eSpeak NG

Texte complet dans `LICENSE` (même licence que OtherSelf).
