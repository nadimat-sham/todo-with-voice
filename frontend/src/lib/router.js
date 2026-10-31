// Hash routes look like #section or #section/id, e.g. #devices/4, with an
// optional third part naming a section of the page to jump to, e.g.
// #devices/4/problems scrolls to the element with id="problems".
// Each section has a list page and (optionally) a detail page; each page is
// { load(id) → Promise<data>, render(main, data, id) }.
let sections = {};
let defaultSection = '';
// Bumped on every navigation, so a slow load that finishes after the user
// has already moved on is thrown away instead of overwriting the new page.
let currentRequest = 0;

function parseHash() {
  const [section, id, anchor] = location.hash.slice(1).split('/');
  return sections[section] ? { section, id, anchor } : { section: defaultSection };
}

// Scrolls to a section of the freshly rendered page and flashes it briefly
// so the eye lands on it.
function jumpTo(anchor) {
  const target = document.getElementById(anchor);
  if (!target) return window.scrollTo(0, 0);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.remove('flash');
  void target.offsetWidth; // restart the animation if it's already applied
  target.classList.add('flash');
}

export async function route({ keepScroll = false } = {}) {
  const request = ++currentRequest;
  const { section, id, anchor } = parseHash();
  const page = id ? sections[section].detail : sections[section].list;
  const main = document.getElementById('view');

  document.querySelectorAll('.nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === section);
  });

  // On desktop the page content scrolls inside .content-area (the title card
  // stays pinned — see styles/page-layout.css), and re-rendering replaces
  // that element; remember its position so refreshes don't jump to the top.
  const scrolledTo = main.querySelector('.content-area')?.scrollTop || 0;

  try {
    const data = await page.load(id);
    if (request !== currentRequest) return;
    page.render(main, data, id);
  } catch (err) {
    if (request !== currentRequest) return;
    main.innerHTML = `<div class="content-area"><div class="card"><p class="empty-message"></p></div></div>`;
    main.querySelector('.empty-message').textContent = `Couldn't load this page: ${err.message}`;
  }
  if (keepScroll) {
    const scroller = main.querySelector('.content-area');
    if (scroller) scroller.scrollTop = scrolledTo;
    return;
  }
  if (anchor) jumpTo(anchor);
  else window.scrollTo(0, 0);
}

// Re-renders the current page in place — called after every successful change.
export function refresh() {
  return route({ keepScroll: true });
}

export function startRouter(routeTable, fallback) {
  sections = routeTable;
  defaultSection = fallback;
  window.addEventListener('hashchange', () => route());
  // Re-fetch whenever the window regains focus, so changes made elsewhere
  // (another tab, another person) show up without a manual reload — but
  // never underneath an open form, or over a page form with unsaved typing
  // (pages mark one with data-unsaved), which would wipe what was typed.
  window.addEventListener('focus', () => {
    if (!document.querySelector('dialog[open], #view [data-unsaved]')) refresh();
  });
  route();
}
