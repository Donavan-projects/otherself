// Bouton « Pause / Reprendre » dans la page de la plateforme, pour couper l'avatar sans ouvrir
// le popup. Visible seulement par l'utilisateur (élément DOM, jamais dans le flux vidéo).
// Monde MAIN, cadre principal.

const LABELS = {
  fr: { pause: 'OtherSelf : mettre l’avatar en pause', resume: 'OtherSelf : reprendre (l’avatar se présentera de nouveau)' },
  en: { pause: 'OtherSelf: pause the avatar', resume: 'OtherSelf: resume (the avatar will introduce itself again)' },
} as const;

export interface PageControls {
  update(paused: boolean): void;
  remove(): void;
}

export function createPageControls(language: 'fr' | 'en', onToggle: (clickAt: number) => void): PageControls {
  const labels = LABELS[language];
  // Shadow DOM : le style de la page ne touche pas le bouton.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const button = document.createElement('button');
  button.type = 'button';
  const style = (paused: boolean) =>
    'padding:8px 14px;border:0;border-radius:10px;color:#fff;font:600 13px/1.3 system-ui,sans-serif;cursor:pointer;' +
    `box-shadow:0 4px 16px rgba(0,0,0,.3);background:${paused ? '#15803d' : '#b91c1c'};`;
  shadow.append(button);
  // L'heure du clic part tout de suite : elle sert à mesurer le délai de coupure.
  button.addEventListener('click', () => onToggle(Date.now()));
  document.documentElement.append(host);

  const update = (paused: boolean) => {
    button.textContent = paused ? labels.resume : labels.pause;
    button.style.cssText = style(paused);
  };
  update(false);
  return { update, remove: () => host.remove() };
}
