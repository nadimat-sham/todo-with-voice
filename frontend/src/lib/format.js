// Every value rendered into HTML goes through here, so a name containing
// "<" can never be interpreted as markup.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Date-only columns arrive as 'YYYY-MM-DD'; new Date() would read that as
// UTC midnight and show the previous day anywhere west of UTC.
function toDate(value) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return dateOnly ? new Date(dateOnly[1], dateOnly[2] - 1, dateOnly[3]) : new Date(value);
}

// The whole app is in English, so dates are too ("Oct 26, 2026, 9:15 AM")
// regardless of the viewer's browser/OS language.
const LOCALE = 'en-US';

export function formatDate(value) {
  return value ? toDate(value).toLocaleDateString(LOCALE, { dateStyle: 'medium' }) : '—';
}

export function formatDateTime(value) {
  return value
    ? toDate(value).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}

// "3 days", "2 months", "1 year" — how long between two moments (to = now if omitted)
export function formatDuration(from, to) {
  const days = Math.floor((toDate(to ?? Date.now()) - toDate(from)) / 86_400_000);
  if (days < 1) return 'less than a day';
  if (days < 31) return plural(days, 'day');
  if (days < 365) return plural(Math.floor(days / 30), 'month');
  return plural(Math.floor(days / 365), 'year');
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Today as 'YYYY-MM-DD' in local time, for <input type="date"> defaults
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
