import { sidebarToggleLabel } from './ui.js';

// Desktop "hide sidebar" toggle: collapses the sidebar to an icon-only strip
// (html[data-sidebar="collapsed"], styled in styles/sidebar-collapse.css) and
// remembers the choice. index.html applies the saved state before the first
// paint, so the page never flashes wide-then-narrow on load.
//
// The button lives in every page's title card (pageHeader in ui.js) and is
// re-created on each render, so clicks are caught at the document level.

const STORAGE_KEY = 'vtodo-sidebar';

function applyCollapsed(collapsed, persist = true) {
  if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
  document.querySelectorAll('[data-sidebar-toggle]').forEach((button) => {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', sidebarToggleLabel());
    button.setAttribute('data-tip', sidebarToggleLabel());
  });
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* Storage is optional. */ }
  }
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-sidebar-toggle]')) return;
  applyCollapsed(document.documentElement.dataset.sidebar !== 'collapsed');
});
