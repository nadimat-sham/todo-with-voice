// One shared hover tooltip (dark box, white text) for the whole app — styled
// by us rather than the browser's native `title` tooltip, which looks
// different on every OS and only appears after a long delay.
//
// What it shows, for whatever is under the pointer (or keyboard focus):
//   1. the nearest element's data-tip attribute, if it has one;
//   2. otherwise, inside a table cell, that column's header name — plus a
//      "click to open" hint on rows that open a detail page.

const SHOW_DELAY_MS = 250;
const GAP = 8;

const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
tooltip.setAttribute('role', 'tooltip');
// As a popover it's shown in the browser's top layer — above an open
// <dialog> too — and positioned against the window, whatever its ancestors'
// styles. (Inside a dialog, the dialog's backdrop-filter and overflow would
// otherwise clip and squeeze it.)
const usePopover = typeof tooltip.showPopover === 'function';
if (usePopover) tooltip.popover = 'manual';
document.body.append(tooltip);

let currentTarget = null;
let showTimer;

function columnHeader(cell) {
  const table = cell.closest('table');
  const headerRow = table?.querySelector('thead tr');
  if (!headerRow) return '';
  const index = Array.from(cell.parentElement.children).indexOf(cell);
  return headerRow.children[index]?.dataset.label || '';
}

// Returns [element the tip belongs to, text] or null
function findTip(el) {
  if (!(el instanceof Element)) return null;
  const explicit = el.closest('[data-tip]');
  const cell = el.closest('td');
  // A data-tip inside the cell (a badge, a button) is more specific than the
  // column name; one outside it (none today) would be less specific.
  if (explicit && (!cell || cell.contains(explicit))) return [explicit, explicit.dataset.tip];
  if (cell && !cell.closest('.empty-state')) {
    const header = columnHeader(cell);
    if (!header) return null;
    const opens = cell.closest('tr.clickable') ? ' · click the row to open it' : '';
    return [cell, header + opens];
  }
  return null;
}

function position(target) {
  // Measure at the top-left corner, so the width never depends on where it
  // was shown last time
  tooltip.style.top = '0px';
  tooltip.style.left = '0px';
  const rect = target.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  let top = rect.top - tipRect.height - GAP;
  if (top < GAP) top = rect.bottom + GAP; // no room above → show below
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(GAP, Math.min(left, window.innerWidth - tipRect.width - GAP));
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function show(target, text) {
  tooltip.textContent = text;
  if (usePopover) {
    // Re-shown every time, so it lands above a dialog opened since
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.showPopover();
  } else {
    // Older browsers: an open <dialog> sits above everything in <body>, so
    // the tooltip has to live inside it to be visible over a form.
    const container = target.closest('dialog') || document.body;
    if (tooltip.parentElement !== container) container.append(tooltip);
  }
  tooltip.classList.add('show');
  position(target);
}

function hide() {
  clearTimeout(showTimer);
  currentTarget = null;
  tooltip.classList.remove('show');
  if (usePopover && tooltip.matches(':popover-open')) tooltip.hidePopover();
}

function handleEnter(event) {
  const found = findTip(event.target);
  if (!found) return hide();
  const [target, text] = found;
  if (target === currentTarget) return;
  hide();
  currentTarget = target;
  showTimer = setTimeout(() => show(target, text), SHOW_DELAY_MS);
}

// On touch screens a tap fires mouseover and then mousedown straight away;
// mousedown hides (below) before the show delay runs out, so taps never
// flash a tooltip.
document.addEventListener('mouseover', handleEnter);
document.addEventListener('mouseout', (event) => {
  if (currentTarget && !currentTarget.contains(event.relatedTarget)) hide();
});
// Focus only shows a tooltip when it came from the keyboard (Tab), not from
// a click or a page that puts the cursor in a field on load.
let keyboardFocus = false;
document.addEventListener('keydown', (event) => { if (event.key === 'Tab') keyboardFocus = true; }, true);
document.addEventListener('mousedown', () => { keyboardFocus = false; }, true);
document.addEventListener('focusin', (event) => { if (keyboardFocus) handleEnter(event); });
document.addEventListener('focusout', hide);
['scroll', 'mousedown', 'keydown'].forEach((type) => {
  window.addEventListener(type, hide, { capture: true, passive: true });
});
