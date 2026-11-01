import { api } from '../lib/api.js';
import { mount, pageHeader, card, table, statCard, statIcon, button, bindActions, emptyRow, statusBadge, showToast } from '../lib/ui.js';
import { escapeHtml, formatDate, today } from '../lib/format.js';
import {
  addButtons, openTextTodo, openSpeechTodo, openRecordTodo, isVoiceTodo, recordingButtons, addedByBadge,
} from './todos.js';

const NEXT_UP = 5;

// Start page: counts, and the next few open todos (soonest due first — the
// API already returns them in that order).
export const dashboardPage = {
  load: () => api('/todos'),

  render(main, todos) {
    const open = todos.filter((t) => !t.is_done);
    const overdue = open.filter((t) => t.due_date && t.due_date < today());
    const dueToday = open.filter((t) => t.due_date === today());
    const byVoice = todos.filter(isVoiceTodo);

    const rows = open.slice(0, NEXT_UP).map((t) => `
      <tr data-href="todos">
        <td><strong>${escapeHtml(t.title)}</strong>${recordingButtons(t)}</td>
        <td class="nowrap">${t.due_date ? formatDate(t.due_date) : '<span class="muted">—</span>'}${t.due_date && t.due_date < today() ? ` ${statusBadge('overdue')}` : ''}</td>
        <td>${addedByBadge(t)}</td>
      </tr>`).join('');

    const page = mount(main, `
      ${pageHeader({
        title: 'Dashboard',
        subtitle: 'Voice Todo — a todo list you can fill in by voice',
        actions: addButtons()
          + button('Check Server', 'health', { tip: 'Ask the server whether the database is reachable' }),
      })}
      <div class="content-area">
        <div class="stats-grid">
          ${statCard(statIcon('todo'), 'Open', String(open.length), 'Todos still to do')}
          ${statCard(statIcon('warning'), 'Overdue', String(overdue.length), 'Open todos past their due date')}
          ${statCard(statIcon('mic'), 'Added by voice', String(byVoice.length), 'Todos spoken (voice to text) or recorded, or holding such entries')}
          ${statCard(statIcon('active'), 'Due today', String(dueToday.length), 'Open todos due today')}
        </div>
        ${card('Next up', table([
          ['What to do', 'Click a row to open the full list'],
          ['Due', 'The day it should be done by'],
          ['Added by', 'Typed, spoken (voice to text) or recorded'],
        ], rows || emptyRow(3, todos.length ? 'Nothing left to do — nice work' : 'No todos yet — add one by typing or by voice')), {
          tools: `<a class="btn btn-secondary btn-small" href="#todos" data-tip="See, edit, tick off or delete every todo">All todos (${todos.length})</a>`,
        })}
      </div>`);

    bindActions(page, {
      'add-text': openTextTodo,
      'add-speech': openSpeechTodo,
      'add-record': openRecordTodo,
      health: async () => {
        const res = await fetch('/api/health');
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.dbConnected) showToast('Server and database are working');
        else showToast(body.message || 'The database is not reachable', 'error');
      },
    });
  },
};
