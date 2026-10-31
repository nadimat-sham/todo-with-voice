import { escapeHtml } from './format.js';

// ==================== Badges ====================
const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  retired: 'Retired',
  open: 'Open',
  done: 'Done',
  overdue: 'Overdue',
  text: 'Typed',
  voice: 'Voice to text',
  recording: 'Recorded',
};

// Shown when hovering a badge, so every status explains itself.
const STATUS_TIPS = {
  active: 'In use',
  inactive: 'No longer in use — history is kept, but it can\'t be picked for anything new',
  retired: 'Kept only for its history',
  open: 'Still to do',
  done: 'Ticked off',
  overdue: 'Past its due date and not done yet',
  text: 'Added by typing',
  voice: 'Spoken — the browser typed it in',
  recording: 'Added as a voice recording',
};

export function statusBadge(status) {
  const tip = STATUS_TIPS[status] ? ` data-tip="${escapeHtml(STATUS_TIPS[status])}"` : '';
  return `<span class="status-badge ${escapeHtml(status)}"${tip}>${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

// A status badge you can click to act on it; the tooltip keeps the status
// meaning and adds what the click does.
export function statusBadgeButton(status, action, hint, data = {}) {
  const attrs = Object.entries(data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
  const tip = [STATUS_TIPS[status], hint].filter(Boolean).join(' · ');
  return `<button type="button" class="status-badge status-button ${escapeHtml(status)}" data-action="${action}"${attrs} data-tip="${escapeHtml(tip)}">${escapeHtml(STATUS_LABELS[status] || status)} <span class="status-caret" aria-hidden="true">▾</span></button>`;
}

const tipAttr = (tip) => (tip ? ` data-tip="${escapeHtml(tip)}"` : '');

// ==================== Page pieces ====================
// Renders a page into a fresh wrapper element and returns it. Listeners are
// bound to the wrapper (not to `main`, which lives forever), so they're
// discarded along with the old markup on every re-render instead of piling up.
export function mount(main, html) {
  main.innerHTML = `<div class="page">${html}</div>`;
  return main.firstElementChild;
}

export function detailItem(label, valueHtml, tip) {
  return `<div class="detail-item"${tipAttr(tip)}><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${valueHtml}</span></div>`;
}

// `count: true` adds a live result counter next to the title (see showCount).
// `id` lets a link jump straight to this card (#section/id/<card id>).
export function card(title, bodyHtml, { tools = '', count = false, id } = {}) {
  const counter = count ? '<span class="result-count" aria-live="polite"></span>' : '';
  return `
    <div class="card"${id ? ` id="${id}"` : ''}>
      <div class="card-header"><div class="card-title"><h3>${escapeHtml(title)}</h3>${counter}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>
      <div class="card-body">${bodyHtml}</div>
    </div>`;
}

// "120 devices" when nothing is filtered, "Showing 6 of 120 devices" while
// searching/filtering.
export function showCount(root, shown, total, noun) {
  const counter = root.querySelector('.result-count');
  const label = `${total} ${noun}${total === 1 ? '' : 's'}`;
  counter.textContent = shown === total ? label : `Showing ${shown} of ${label}`;
  counter.classList.toggle('filtered', shown !== total);
}

// ==================== Shared list-page controls ====================
// Every list page builds its search, count and stat-card
// filters from these, so they all look and behave the same.

export function searchBox(value, placeholder, tip) {
  return `<input type="search" class="search-input" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"${tipAttr(tip)} />`;
}

// True when every word typed appears somewhere in the given values
// (case-insensitive), so "ip cam" finds "IP Camera".
export function matchesSearch(query, values) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = values.filter((v) => v !== null && v !== undefined).join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

// Draws a list page's table body and "Showing X of Y" count, and redraws
// live as the search box is typed in. `state.search` keeps the typed text
// across re-renders. Returns draw() for other controls (dropdowns, stat
// cards) to call after changing their own filters.
export function liveList(page, { items, matches, rows, noun, state }) {
  const tbody = page.querySelector('tbody');
  const draw = () => {
    tbody.innerHTML = rows(items);
    showCount(page, items.filter(matches).length, items.length, noun);
  };
  page.querySelector('.search-input')?.addEventListener('input', (event) => {
    state.search = event.target.value;
    draw();
  });
  draw();
  return draw;
}

// Makes the page's filter stat cards (statCard with `filter`) clickable:
// clicking one calls setValue(its filter); the card matching getValue() is
// highlighted. Returns sync() — call it after the filter changes elsewhere
// (e.g. a dropdown) so the highlight follows.
export function bindStatFilters(page, getValue, setValue) {
  const sync = () => {
    page.querySelectorAll('.filter-card').forEach((cardEl) => {
      const active = cardEl.dataset.filter === String(getValue());
      cardEl.classList.toggle('active', active);
      cardEl.setAttribute('aria-pressed', String(active));
    });
  };
  page.addEventListener('click', (event) => {
    const cardEl = event.target.closest('.filter-card');
    if (!cardEl || !page.contains(cardEl)) return;
    setValue(cardEl.dataset.filter);
    sync();
  });
  sync();
  return sync;
}

// headers: strings, or [label, tip] pairs whose tip explains the column.
// Each <th> carries its label in data-label so the tooltip can name the
// column when hovering any cell under it.
export function table(headers, rowsHtml) {
  const headerHtml = headers.map((h) => {
    const [label, tip] = Array.isArray(h) ? h : [h];
    return `<th data-label="${escapeHtml(label)}"${tipAttr(tip)}>${escapeHtml(label)}</th>`;
  }).join('');
  return `<table class="table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

// Lucide icons (PanelLeft / Sun / Moon)
const LUCIDE = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SIDEBAR_ICON = `<svg ${LUCIDE}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`;
// Both icons are always present; CSS shows the one for the mode a click
// switches TO (moon while in day mode, sun while in night mode).
const THEME_ICONS = `<svg class="theme-icon-sun" ${LUCIDE}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
  + `<svg class="theme-icon-moon" ${LUCIDE}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

// Labels for the two title-card toggles — also used by lib/sidebar.js and
// lib/theme.js to keep the buttons in step after a click.
export const sidebarToggleLabel = () => (document.documentElement.dataset.sidebar === 'collapsed' ? 'Show sidebar' : 'Hide sidebar');
export const themeToggleLabel = () => (document.documentElement.dataset.theme === 'day' ? 'Switch to night mode' : 'Switch to day mode');

// Every page's title card: hide/show-sidebar button at the left, the page's
// own buttons plus the day/night switch at the right. The two toggles work
// through document-level listeners (lib/sidebar.js, lib/theme.js), so they
// keep working however often the page re-renders.
export function pageHeader({ title, subtitle = '', back, actions = '' }) {
  const collapsed = document.documentElement.dataset.sidebar === 'collapsed';
  const day = document.documentElement.dataset.theme === 'day';
  return `
    <header class="header">
      <div class="header-main">
        <button type="button" class="header-icon-btn sidebar-toggle" data-sidebar-toggle aria-controls="app-sidebar" aria-expanded="${!collapsed}" aria-label="${sidebarToggleLabel()}" data-tip="${sidebarToggleLabel()}">${SIDEBAR_ICON}</button>
        <div class="header-title">
          ${back ? `<a class="btn-back" href="${back.href}" data-tip="Back to the ${escapeHtml(back.label)} list">← ${escapeHtml(back.label)}</a>` : ''}
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
      </div>
      <div class="header-actions">
        ${actions}
        <button type="button" class="header-icon-btn theme-switch" data-theme-toggle aria-pressed="${day}" aria-label="${themeToggleLabel()}" data-tip="${themeToggleLabel()}">${THEME_ICONS}</button>
      </div>
    </header>`;
}

export function button(label, action, { style = 'secondary', small = false, data = {}, tip } = {}) {
  const attrs = Object.entries(data)
    .map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`)
    .join('');
  return `<button type="button" class="btn btn-${style}${small ? ' btn-small' : ''}" data-action="${action}"${attrs}${tipAttr(tip)}>${escapeHtml(label)}</button>`;
}

export function emptyRow(columns, message) {
  return `<tr class="empty-state"><td colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

// With `filter`, the card is a button that filters the page's list to that
// value (wired by bindStatFilters); `active` marks the filter in use.
export function statCard(icon, label, value, tip, { filter, active = false } = {}) {
  const inner = `
      <div class="stat-icon">${icon}</div>
      <div><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`;
  if (filter === undefined) return `<div class="stat-card"${tipAttr(tip)}>${inner}</div>`;
  return `
    <button type="button" class="stat-card filter-card${active ? ' active' : ''}" data-filter="${escapeHtml(filter)}" aria-pressed="${active}"${tipAttr(tip)}>${inner}</button>`;
}

const STAT_ICONS = {
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  active: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  inactive: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/>',
  todo: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};

export function statIcon(name) {
  return `<svg class="stat-svg" viewBox="0 0 24 24" aria-hidden="true">${STAT_ICONS[name] || STAT_ICONS.mail}</svg>`;
}

// Wires every [data-action] button inside `root` to handlers[action](dataset),
// and makes rows with data-href navigate when clicked anywhere but a button/link.
export function bindActions(root, handlers) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button && root.contains(button)) {
      const handler = handlers[button.dataset.action];
      if (handler) handler(button.dataset);
      return;
    }
    // Links, and inactive buttons (no data-action), never open the row
    if (event.target.closest('a, button')) return;
    const row = event.target.closest('[data-href]');
    if (row) location.hash = row.dataset.href;
  });
}

// ==================== Toast ====================
// A queue, not one box that's overwritten: a batch (e.g. one toast per mail
// sent) would otherwise replace each message before it can be read. Every
// toast gets its own 2 seconds, in the order requested, with a short gap
// between so back-to-back ones read as separate messages.
// type: 'success' | 'error' | 'warning'
const toastQueue = [];
let toastShowing = false;

export function showToast(message, type = 'success') {
  toastQueue.push({ message, type });
  nextToast();
}

function nextToast() {
  if (toastShowing || toastQueue.length === 0) return;
  const { message, type } = toastQueue.shift();
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  toastShowing = true;
  setTimeout(() => {
    toast.classList.remove('show');
    toastShowing = false;
    setTimeout(nextToast, 250);
  }, 2000);
}

// ==================== Form modal ====================
// options: [{ value, label }], or category groups [{ label, options: [...] }]
// rendered as <optgroup>s. The placeholder gets value "" so a `required`
// select refuses to submit until a real option is picked.
export function optionsHtml(options, selected, placeholder) {
  const placeholderHtml = placeholder !== undefined
    ? `<option value="">${escapeHtml(placeholder)}</option>`
    : '';
  const optionHtml = (o) => {
    if (o.options) {
      return `<optgroup label="${escapeHtml(o.label)}">${o.options.map(optionHtml).join('')}</optgroup>`;
    }
    const isSelected = selected !== undefined && selected !== null && String(o.value) === String(selected);
    return `<option value="${escapeHtml(o.value)}"${isSelected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`;
  };
  return placeholderHtml + options.map(optionHtml).join('');
}

export function setOptions(select, options, placeholder) {
  select.innerHTML = optionsHtml(options, undefined, placeholder);
}

function fieldHtml(f) {
  const id = `field-${f.name}`;
  const required = f.required ? ' required' : '';
  const placeholder = f.placeholder && f.type !== 'select' ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
  const maxlength = f.maxlength ? ` maxlength="${f.maxlength}"` : '';
  let control;
  if (f.type === 'select') {
    control = `<select id="${id}" name="${f.name}"${required}>${optionsHtml(f.options || [], f.value, f.placeholder)}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 2}"${placeholder}${maxlength}${required}>${escapeHtml(f.value ?? '')}</textarea>`;
  } else {
    const numberAttrs = f.type === 'number' ? ` min="${f.min ?? 0}" step="1"` : '';
    const readonly = f.readonly ? ' readonly tabindex="-1"' : '';
    control = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${escapeHtml(f.value ?? '')}"${numberAttrs}${placeholder}${maxlength}${required}${readonly} autocomplete="off" />`;
  }
  const hint = f.hint ? `<small class="form-hint">${escapeHtml(f.hint)}</small>` : '';
  const tip = f.tip ?? (f.required ? 'Required' : '');
  return `<div class="form-group"${tipAttr(tip)}><label for="${id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>${control}${hint}</div>`;
}

// Consecutive fields marked `half` share a row two-up.
function fieldsHtml(fields) {
  let html = '';
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].half && fields[i + 1]?.half) {
      html += `<div class="form-row">${fieldHtml(fields[i])}${fieldHtml(fields[i + 1])}</div>`;
      i++;
    } else {
      html += fieldHtml(fields[i]);
    }
  }
  return html;
}

// Opens the shared modal with a generated form. `onSubmit(values, form)`
// runs on submit; if it resolves, the modal closes and its return value (if
// any) is shown as a toast; if it throws, the modal stays open with the
// error shown inside it so nothing typed is lost.
export function openFormModal({ title, intro, fields = [], submitLabel = 'Save', danger = false, onSubmit }) {
  const dialog = document.getElementById('modal');
  dialog.innerHTML = `
    <form novalidate>
      <div class="modal-header"><h2>${escapeHtml(title)}</h2></div>
      <div class="modal-body">
        ${intro ? `<p class="modal-text">${escapeHtml(intro)}</p>` : ''}
        ${fieldsHtml(fields)}
        <p class="form-error" role="alert"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-close data-tip="Close without saving (Esc)">Cancel</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(submitLabel)}</button>
      </div>
    </form>`;
  const form = dialog.querySelector('form');
  const errorBox = form.querySelector('.form-error');

  fields.filter((f) => f.onChange).forEach((f) => {
    form.elements[f.name].addEventListener('change', async () => {
      try {
        await f.onChange(form);
      } catch (err) {
        errorBox.textContent = err.message;
      }
    });
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    errorBox.textContent = '';
    try {
      const message = await onSubmit(Object.fromEntries(new FormData(form)), form);
      dialog.close();
      if (message) showToast(message);
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  dialog.showModal();
  form.querySelector('input, select, textarea')?.focus();
  return form;
}

export function confirmModal({ title, message, confirmLabel, danger = true, onConfirm }) {
  return openFormModal({ title, intro: message, submitLabel: confirmLabel, danger, onSubmit: onConfirm });
}

// Runs an async loader for a modal's options; shows a toast instead of
// opening anything if it fails.
export async function withOptions(loader, open) {
  try {
    open(await loader());
  } catch (err) {
    showToast(err.message, 'error');
  }
}
