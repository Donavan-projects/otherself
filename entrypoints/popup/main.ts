const pages = [
  { id: '#open-rehearsal', label: 'popupOpenRehearsal', url: '/rehearsal.html' },
  { id: '#open-avatar', label: 'popupOpenAvatar', url: '/avatar.html' },
] as const;

for (const page of pages) {
  const button = document.querySelector<HTMLButtonElement>(page.id)!;
  button.textContent = browser.i18n.getMessage(page.label);
  button.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL(page.url) });
  });
}
