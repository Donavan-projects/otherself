# Tournage de la démo avec OBS

Enregistrement d'écran d'un entretien : l'onglet de la plateforme et la fenêtre d'aperçu de l'avatar, son compris.
Méthode testée sous Linux (X11) avec Chrome et OBS Studio.

## Avant la prise

Dans `config.local.json`, puis `npm run build` et rechargement de l'extension dans `chrome://extensions` :

- `debugSafeZone` à `false` (sinon le contour magenta de la zone de sécurité est filmé) ;
- voix du personnage (`en_US-norman-medium`) ou une autre voix publiable : jamais `en_US-joe-medium` ni
  `en_US-libritts_r-medium` (voir `THIRD_PARTY_NOTICES.md`) ;
- `previewWindow` absent ou à `true` (bouton « Aperçu de l'avatar »).

Sur la plateforme : pas de fond virtuel, cadrage automatique désactivé (Meet : Paramètres → Vidéo → Cadrage).

## Checklist de l'écran

Tout l'écran est capturé, même si seules deux zones sont gardées au montage : rien de personnel ne doit être visible.

- [ ] Barre de favoris masquée dans Chrome (Ctrl+Maj+B), aucun onglet personnel ouvert dans la fenêtre filmée.
- [ ] Autres fenêtres fermées (messagerie, courriel, gestionnaire de fichiers, terminal).
- [ ] Notifications coupées (mode « Ne pas déranger » du bureau) ; notifications de Chrome et de la plateforme aussi.
- [ ] Casque branché : la voix de l'avatar ne doit pas revenir par le micro du recruteur.
- [ ] Rien de confidentiel dans le CV et les notes que l'avatar pourrait citer.

## Lancer l'entretien et l'aperçu

1. Ouvrir la plateforme, autoriser caméra et micro pour le site.
2. Popup → « Activer sur cet onglet », puis bouton OtherSelf dans la page : partager l'onglet avec son son.
3. Rejoindre l'entretien (la plateforme demande alors la caméra et le micro).
4. Rouvrir le popup → « Aperçu de l'avatar » : une fenêtre Picture-in-Picture montre le flux vidéo envoyé à la
   plateforme, à l'endroit (la vignette de la plateforme est souvent en miroir), sans son.
5. Agrandir la fenêtre d'aperçu par un coin et la placer à côté de l'onglet, sans chevauchement. Éloigner la souris :
   les commandes de la fenêtre disparaissent. Chrome affiche l'adresse du site en haut à gauche : la rogner (voir plus bas).

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

- Ne pas déplacer les fenêtres, ne pas changer d'onglet : un onglet en arrière-plan est ralenti par Chrome.
- Logs utiles (console de l'onglet) : `[inject]` et `[preview]` donnent les images par seconde du flux envoyé,
  avant et pendant l'aperçu (vers 30 images/s attendues).
- Fin : arrêter l'enregistrement, puis popup → « Désactiver sur cet onglet » (l'aperçu se ferme avec).
