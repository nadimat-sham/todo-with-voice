import { themeToggleLabel } from './ui.js';

// Day/night switch. The button lives in every page's title card
// (pageHeader in ui.js) and is re-created on each render, so clicks are
// caught at the document level and every copy on screen is kept in step.

function syncThemeButtons() {
  const isDay = document.documentElement.dataset.theme === 'day';
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(isDay));
    button.setAttribute('aria-label', themeToggleLabel());
    button.setAttribute('data-tip', themeToggleLabel());
  });
}

function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme === 'day' ? 'day' : 'night';
  syncThemeButtons();
  if (persist) {
    try { localStorage.setItem('vtodo-theme', theme === 'day' ? 'day' : 'night'); } catch { /* Storage is optional. */ }
  }
}

applyTheme(document.documentElement.dataset.theme === 'day' ? 'day' : 'night', false);

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-theme-toggle]')) return;
  applyTheme(document.documentElement.dataset.theme === 'day' ? 'night' : 'day');
});

const menuToggle = document.getElementById('mobile-menu-toggle');
const mobileNavigation = document.getElementById('mobile-navigation');

function setMenu(open) {
  menuToggle?.setAttribute('aria-expanded', String(open));
  menuToggle?.setAttribute('aria-label', `${open ? 'Close' : 'Open'} navigation menu`);
  mobileNavigation?.classList.toggle('is-open', open);
}

menuToggle?.addEventListener('click', () => {
  setMenu(menuToggle.getAttribute('aria-expanded') !== 'true');
});

mobileNavigation?.addEventListener('click', (event) => {
  if (event.target.closest('.nav-item') && matchMedia('(max-width: 768px)').matches) setMenu(false);
});

matchMedia('(min-width: 769px)').addEventListener('change', (event) => {
  if (event.matches) setMenu(false);
});
