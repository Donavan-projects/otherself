const button = document.querySelector<HTMLButtonElement>('#open-rehearsal')!;
button.textContent = browser.i18n.getMessage('popupOpenRehearsal');
button.addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/rehearsal.html') });
});
