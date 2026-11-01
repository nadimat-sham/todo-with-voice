import { api } from '../lib/api.js';
import { refresh } from '../lib/router.js';
import {
  mount, pageHeader, card, table, statCard, statIcon, button, bindActions, searchBox, matchesSearch,
  liveList, bindStatFilters, emptyRow, statusBadge, statusBadgeButton, openFormModal, confirmModal, showToast,
} from '../lib/ui.js';
import { escapeHtml, formatDate, formatDateTime, today } from '../lib/format.js';
import {
  voiceSupported, recordingSupported, startDictation, startRecording, formatClock, MAX_RECORDING_MS,
} from '../lib/voice.js';

// Kept across re-renders (refresh after every change re-draws the page)
const state = { search: '', filter: 'all', expanded: new Set() };

const isOverdue = (t) => !t.is_done && t.due_date && t.due_date < today();
// Added by voice, or holding anything spoken or recorded
export const isVoiceTodo = (t) => t.source !== 'text' || t.entries.some((e) => e.kind !== 'text');
const entriesWord = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

const FILTERS = {
  all: () => true,
  open: (t) => !t.is_done,
  overdue: isOverdue,
  voice: (t) => isVoiceTodo(t),
  done: (t) => t.is_done,
};

// The todo itself; add forms also offer Notes, saved as its first typed entry
const todoFields = (t = {}, { notes = true } = {}) => [
  { name: 'title', label: 'What to do', type: 'textarea', rows: 2, required: true, maxlength: 500, value: t.title, placeholder: 'e.g. Call the dentist', tip: 'Required — what needs doing' },
  { name: 'due_date', label: 'Due date', type: 'date', value: t.due_date, tip: 'Optional — the day it should be done by' },
  ...(notes ? [{ name: 'notes', label: 'Notes', type: 'textarea', rows: 3, maxlength: 5000, placeholder: 'Any extra detail', tip: 'Optional — saved as the todo\'s first typed entry; more can be added later' }] : []),
];

const saveNew = (values, source) => api('/todos', {
  method: 'POST',
  body: { title: values.title, due_date: values.due_date, notes: values.notes, source },
});

const uploadRecording = (todoId, clip) => api(`/todos/${todoId}/entries/recording?duration_ms=${clip.durationMs}`, { method: 'POST', body: clip.blob });

// ---------- Add (also used from the Dashboard) ----------
// The three add buttons, for the Todos page and the Dashboard
export const addButtons = () => button('Add Text Todo', 'add-text', { style: 'primary', tip: 'Type a new todo' })
  + button('Voice to Text Todo', 'add-speech', { style: 'primary', tip: voiceSupported ? 'Say a new todo — what you say is typed in (nothing is recorded)' : 'Voice to text needs Chrome, Edge or Safari' })
  + button('Record Todo', 'add-record', { style: 'primary', tip: recordingSupported ? 'Record a new todo with your voice — the recording is saved, nothing is typed for you' : 'This browser can\'t record audio' });

// ---------- New todo from an existing one (the Edit form) ----------
// Any of the three add forms can start from an existing todo: `replace` is
// that todo, `prefill` what its Edit form held. A box on top (ticked to
// begin with) says whether the old todo is deleted; the new todo is saved
// first, and only then is the old one deleted.
function addReplaceChoice(form, old) {
  form.querySelector('.modal-body').insertAdjacentHTML('afterbegin', `
    <div class="form-group replace-choice">
      <label class="check-row" data-tip="Ticked: this replaces it (deleted for good). Unticked: both are kept.">
        <input type="checkbox" name="delete_old" checked /> Delete "${escapeHtml(old.title)}"${old.entries.length ? ` and its ${entriesWord(old.entries.length)}` : ''} when I save
      </label>
    </div>`);
  const box = form.elements.delete_old;
  const submit = form.querySelector('[type="submit"]');
  const sync = () => { submit.textContent = box.checked ? 'Save and Replace' : 'Add Todo'; };
  box.addEventListener('change', sync);
  sync();
}

async function deleteReplaced(old) {
  stopPlayingTodo(old);
  try {
    await api(`/todos/${old.todo_id}`, { method: 'DELETE' });
  } catch (err) {
    showToast(`New todo added, but "${old.title}" couldn't be deleted: ${err.message}`, 'warning');
  }
}

export function openTextTodo({ replace, prefill } = {}) {
  const form = openFormModal({
    title: 'Add Text Todo',
    fields: todoFields(prefill),
    submitLabel: 'Add Todo',
    onSubmit: async (values) => {
      const replacing = replace && values.delete_old;
      await saveNew(values, 'text');
      if (replacing) await deleteReplaced(replace);
      refresh();
      return replacing ? 'Todo replaced' : 'Todo added';
    },
  });
  if (replace) addReplaceChoice(form, replace);
}

// The two microphone forms. Each does one thing: "Voice to Text" types what
// you say into "What to do" (nothing is recorded); "Record" saves your voice
// with the todo (nothing is typed for you, and naming it is optional).
const MIC_MODES = {
  speech: {
    title: 'Add Voice to Text Todo',
    source: 'voice',
    supported: () => voiceSupported,
    unsupported: 'Voice to text needs Chrome, Edge or Safari — use Record Todo or Add Text Todo here',
    hint: (field) => `Speak in English — what you say is typed into ${field}. Fix any words before saving.`,
    tips: { idle: (field) => `Start speaking — what you say is typed into ${field}`, active: () => 'Stop listening — click again to say more' },
    entryTitle: 'Add Voice to Text Entry',
    entryDone: 'Entry added',
    status: { on: 'Listening…', paused: 'Stopped — click the mic to say more', idle: 'Click the mic to speak' },
    done: 'Voice to text todo added',
  },
  record: {
    title: 'Add Recorded Todo',
    source: 'recording',
    supported: () => recordingSupported,
    unsupported: 'This browser can\'t record audio — use Add Text Todo here',
    hint: () => 'Your voice is recorded and saved with the todo. Naming it is optional.',
    entryHint: 'Your voice is recorded and added to the todo.',
    tips: { idle: () => 'Start recording', active: () => 'Pause — click again to record more' },
    entryTitle: 'Add Recording',
    entryDone: 'Recording added',
    status: { on: 'Recording…', paused: 'Paused — click the mic to record more', idle: 'Click the mic to record' },
    done: 'Recorded todo added',
  },
};

export const openSpeechTodo = (options) => openMicTodo(MIC_MODES.speech, options);
export const openRecordTodo = (options) => openMicTodo(MIC_MODES.record, options);

// The text todo form with a mic on top — or, with `entryFor` (a todo), a
// form adding one voice-to-text or recorded entry to it. Nothing starts until
// the mic is clicked (that's also when the browser asks for the microphone);
// clicking it again pauses, and again carries on (in the same recording, when
// recording).
function openMicTodo(mode, { replace, prefill, entryFor } = {}) {
  // Over plain http (except localhost) browsers hide the microphone entirely
  if (!window.isSecureContext) {
    showToast('The microphone only works when the app is opened over https:// (or on localhost)', 'error');
    return;
  }
  if (!mode.supported()) {
    showToast(mode.unsupported, 'error');
    return;
  }
  const recordMode = mode === MIC_MODES.record;
  let dictation = null; // speech-to-text, only while the mic is on
  let recording = null; // the one clip, kept across pauses until saved
  let active = false;
  let closed = false;
  let previewUrl = null;
  let clockTimer = null;

  // Voice to text starts with an empty "What to do", ready to be spoken into
  let fields = todoFields(prefill && { ...prefill, title: recordMode ? prefill.title : '' });
  const field = entryFor ? 'the entry' : '"What to do"';
  if (entryFor) {
    fields = recordMode ? [] : [{ name: 'body', label: 'Entry', type: 'textarea', rows: 4, required: true, maxlength: 5000, placeholder: 'What you say is typed in here', tip: 'Required — fix any words before saving' }];
  } else if (recordMode) {
    Object.assign(fields[0], {
      required: false,
      placeholder: 'Optional — e.g. Call the dentist',
      tip: 'Optional — left empty, it\'s named "Voice note" with the date and time',
    });
  }
  const form = openFormModal({
    title: entryFor ? mode.entryTitle : mode.title,
    intro: entryFor ? `To "${entryFor.title}"` : undefined,
    fields,
    submitLabel: entryFor ? 'Add Entry' : 'Add Todo',
    onSubmit: async (values) => {
      const replacing = replace && values.delete_old;
      await pause();
      if (entryFor) {
        if (!recordMode) {
          await api(`/todos/${entryFor.todo_id}/entries`, { method: 'POST', body: { kind: 'voice', body: values.body } });
        } else {
          if (!recording) throw new Error('Record something first — click the mic');
          if (!previewUrl) throw new Error('The recording is empty — click the mic and record again');
          await uploadRecording(entryFor.todo_id, await recording.finish());
          recording = null;
        }
        state.expanded.add(String(entryFor.todo_id));
        refresh();
        return mode.entryDone;
      }
      if (!recordMode) {
        await saveNew(values, mode.source);
        if (replacing) await deleteReplaced(replace);
        refresh();
        return replacing ? 'Todo replaced' : mode.done;
      }
      if (!recording) throw new Error('Record something first — click the mic');
      // Nothing was captured (e.g. saved the instant recording began)
      if (!previewUrl) throw new Error('The recording is empty — click the mic and record again');
      // Save the todo first: if that's refused, the recording is still
      // here, paused, for the next try.
      const title = values.title.trim() || `Voice note — ${formatDateTime(new Date())}`;
      const todo = await saveNew({ ...values, title }, mode.source);
      const clip = await recording.finish();
      recording = null;
      try {
        await uploadRecording(todo.todo_id, clip);
      } catch (err) {
        // The old todo is kept, so nothing is lost
        showToast(`Todo added, but its recording couldn't be saved: ${err.message}${replacing ? ` — "${replace.title}" was kept` : ''}`, 'warning');
        refresh();
        return null;
      }
      if (replacing) await deleteReplaced(replace);
      refresh();
      return replacing ? 'Todo replaced' : mode.done;
    },
  });

  const dialog = form.closest('dialog');
  const titleBox = form.elements[entryFor ? 'body' : 'title'];
  // The mic goes under the "delete the old todo" box or the "To …" line
  if (replace) addReplaceChoice(form, replace);
  const choice = form.querySelector('.replace-choice, .modal-text');
  (choice || form.querySelector('.modal-body')).insertAdjacentHTML(choice ? 'afterend' : 'afterbegin', `
    <div class="voice-recorder">
      <button type="button" class="mic-btn" aria-pressed="false">${statIcon('mic')}</button>
      <div class="voice-text">
        <strong class="voice-status" aria-live="polite">Starting…</strong>
        <small>${escapeHtml((entryFor && mode.entryHint) || mode.hint(field))}</small>
      </div>
      ${recordMode ? `<span class="voice-clock" hidden data-tip="Length of the recording (at most ${formatClock(MAX_RECORDING_MS)})">0:00</span>` : ''}
    </div>
    ${recordMode ? `
    <div class="voice-preview" hidden>
      <span class="voice-preview-label">Your recording</span>
      <span class="voice-preview-play"></span>
      <button type="button" class="btn btn-secondary btn-small" data-remove-recording data-tip="Throw this recording away and start again">Remove recording</button>
    </div>` : ''}`);
  const mic = form.querySelector('.mic-btn');
  const status = form.querySelector('.voice-status');
  const clock = form.querySelector('.voice-clock');
  const preview = form.querySelector('.voice-preview');
  const errorBox = form.querySelector('.form-error');

  const showClock = () => {
    if (!clock) return;
    clock.hidden = !recording;
    if (recording) clock.textContent = formatClock(recording.elapsed());
  };
  const setActive = (on) => {
    active = on;
    mic.classList.toggle('listening', on);
    mic.setAttribute('aria-pressed', String(on));
    const tip = on ? mode.tips.active(field) : mode.tips.idle(field);
    mic.setAttribute('aria-label', tip);
    mic.dataset.tip = tip;
    const started = recordMode ? recording : titleBox.value.trim();
    status.textContent = on ? mode.status.on : (started ? mode.status.paused : mode.status.idle);
    clearInterval(clockTimer);
    if (on && recordMode) {
      stopPlaying('preview');
      preview.hidden = true;
      clockTimer = setInterval(showClock, 250);
    }
    showClock();
  };
  const showPreview = (blob) => {
    stopPlaying('preview');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = blob.size ? URL.createObjectURL(blob) : null;
    preview.querySelector('.voice-preview-play').innerHTML = previewUrl ? playButton('preview', previewUrl, recording.elapsed()) : '';
    preview.hidden = !previewUrl;
  };
  const limitMessage = `Recordings stop at ${formatClock(MAX_RECORDING_MS)} — save this one, or remove it to start again`;

  async function start() {
    errorBox.textContent = '';
    if (!recordMode) {
      dictation = startDictation({
        base: titleBox.value,
        onText: (text) => { titleBox.value = text; },
        // Speech recognition ends on its own after a long silence
        onState: (listening) => { if (!listening) { dictation = null; if (active) setActive(false); } },
        onError: (message) => { errorBox.textContent = message; },
      });
      setActive(true);
      return;
    }
    if (recording && recording.elapsed() >= MAX_RECORDING_MS) {
      errorBox.textContent = limitMessage;
      return;
    }
    mic.disabled = true;
    try {
      if (recording) recording.resume();
      else {
        recording = await startRecording({ onLimit: () => { pause(); errorBox.textContent = limitMessage; } });
        // Closed while the browser was asking for the microphone
        if (closed) { recording.cancel(); recording = null; return; }
      }
    } catch (err) {
      errorBox.textContent = err.message;
      setActive(false);
      return;
    } finally {
      mic.disabled = false;
    }
    setActive(true);
  }

  async function pause() {
    if (!active) return;
    setActive(false);
    dictation?.stop();
    dictation = null;
    if (recording) showPreview(await recording.pause());
    showClock();
  }

  mic.addEventListener('click', () => (active ? pause() : start()));
  preview?.querySelector('[data-remove-recording]').addEventListener('click', () => {
    recording?.cancel();
    recording = null;
    showPreview(new Blob());
    setActive(false);
  });

  // The close event arrives a moment after close(), so it can land after
  // another form has already replaced this one in the shared dialog. Ours is
  // over once this form is gone or the dialog is shut; a late close event
  // from an earlier form, while this one is still showing, is ignored.
  const onClose = () => {
    if (dialog.open && form.isConnected) return;
    closed = true;
    clearInterval(clockTimer);
    stopPlaying('preview');
    dictation?.abort();
    recording?.cancel();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    dialog.removeEventListener('close', onClose);
  };
  dialog.addEventListener('close', onClose);
  setActive(false);
}

// ---------- Playing recordings ----------
// One player for every ▶ button (list rows, the voice form's preview, the
// edit form), so starting one recording stops another. The buttons show the
// length measured while recording: browser recordings don't carry their
// own, so a plain <audio> player would show 0:00.
const player = new Audio();
let playingKey = null;

const isPlaying = (key) => key === playingKey && !player.paused;

function syncPlayButtons() {
  document.querySelectorAll('.play-btn').forEach((btn) => {
    const on = isPlaying(btn.dataset.key);
    btn.classList.toggle('playing', on);
    const tip = on ? 'Pause the voice recording' : 'Play the voice recording';
    btn.setAttribute('aria-label', tip);
    btn.dataset.tip = tip;
    const total = formatClock(Number(btn.dataset.ms));
    const started = btn.dataset.key === playingKey && player.currentTime > 0 && !player.ended;
    btn.querySelector('span').textContent = started ? `${formatClock(player.currentTime * 1000)} / ${total}` : total;
  });
}
['play', 'pause', 'ended', 'timeupdate'].forEach((type) => player.addEventListener(type, syncPlayButtons));
player.addEventListener('error', () => {
  if (!playingKey) return;
  playingKey = null;
  syncPlayButtons();
  showToast('Couldn\'t play that recording', 'error');
});

function togglePlay(key, src) {
  if (isPlaying(key)) return player.pause();
  if (key !== playingKey || player.getAttribute('src') !== src) {
    playingKey = key;
    player.src = src;
  }
  player.play().catch(() => {}); // failures arrive as the 'error' event
}

// Stops `key` if it's the one playing and forgets it
function stopPlaying(key) {
  if (playingKey !== key) return;
  player.pause();
  playingKey = null;
  player.removeAttribute('src');
  player.load();
  syncPlayButtons();
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('.play-btn');
  if (btn) togglePlay(btn.dataset.key, btn.dataset.src);
});

const PLAY_ICONS = '<svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>'
  + '<svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>';

// `label`, if given, sits before the time (e.g. "Recorded 0:02")
function playButton(key, src, ms, label = '') {
  const on = isPlaying(key);
  const tip = on ? 'Pause the voice recording' : 'Play the voice recording';
  const text = label ? `<b>${escapeHtml(label)}</b>` : '';
  return `<button type="button" class="play-btn${on ? ' playing' : ''}${label ? ' labelled' : ''}" data-key="${escapeHtml(key)}" data-src="${escapeHtml(src)}" data-ms="${Math.round(ms)}" aria-label="${tip}" data-tip="${tip}">${PLAY_ICONS}${text}<span>${formatClock(ms)}</span></button>`;
}

export const entryAudio = (e, label) => playButton(`entry-${e.entry_id}`, `/api/todos/${e.todo_id}/entries/${e.entry_id}/audio`, e.duration_ms, label);

// The "Added by" badge. A recorded todo's badge plays the recording it was
// added with (its first one); if none was ever saved, it says so.
export function addedByBadge(t) {
  if (t.source !== 'recording') return statusBadge(t.source);
  const first = t.entries.find((e) => e.kind === 'recording');
  if (first) return entryAudio(first, 'Recorded');
  return '<span class="status-badge recording" data-tip="Added as a voice recording, but no recording was saved — open its entries and use + Record to add one">Recorded · no audio</span>';
}
const stopPlayingTodo = (t) => t.entries.forEach((e) => stopPlaying(`entry-${e.entry_id}`));

// ---------- Adding / changing entries ----------
export function openTextEntry(todo) {
  openFormModal({
    title: 'Add Text Entry',
    intro: `To "${todo.title}"`,
    fields: [{ name: 'body', label: 'Entry', type: 'textarea', rows: 4, required: true, maxlength: 5000, placeholder: 'Type anything about this todo', tip: 'Required' }],
    submitLabel: 'Add Entry',
    onSubmit: async (values) => {
      await api(`/todos/${todo.todo_id}/entries`, { method: 'POST', body: { kind: 'text', body: values.body } });
      state.expanded.add(String(todo.todo_id));
      refresh();
      return 'Entry added';
    },
  });
}

const ENTRY_OPENERS = {
  text: openTextEntry,
  voice: (todo) => openMicTodo(MIC_MODES.speech, { entryFor: todo }),
  recording: (todo) => openMicTodo(MIC_MODES.record, { entryFor: todo }),
};

// ---------- Rows ----------
// Every recording of a todo as a ▶ button, so it can be played straight
// from the list without opening the entries
export function recordingButtons(t) {
  const recordings = t.entries.filter((e) => e.kind === 'recording');
  return recordings.length ? `<div class="row-recordings">${recordings.map((e) => entryAudio(e)).join('')}</div>` : '';
}

const KIND_WORDS = { text: 'typed', voice: 'voice to text', recording: 'recorded' };

// "3 entries · 2 typed · 1 recorded" — the button that opens the entries
function entriesToggle(t, open) {
  const counts = ['text', 'voice', 'recording']
    .map((kind) => [kind, t.entries.filter((e) => e.kind === kind).length])
    .filter(([, n]) => n)
    .map(([kind, n]) => `${n} ${KIND_WORDS[kind]}`);
  const label = t.entries.length ? [entriesWord(t.entries.length), ...counts].join(' · ') : 'No entries yet';
  const tip = open ? 'Hide the entries' : 'Show the entries — and add typed, voice to text or recorded ones';
  return `<button type="button" class="entries-toggle${open ? ' open' : ''}" data-action="expand" data-id="${t.todo_id}" aria-expanded="${open}" data-tip="${tip}"><span class="caret" aria-hidden="true">▸</span> ${escapeHtml(label)}</button>`;
}

function entryHtml(e) {
  const content = e.kind === 'recording'
    ? entryAudio(e)
    : `<span class="entry-text">${escapeHtml(e.body)}</span>`;
  const edited = e.kind !== 'recording' && e.updated_at !== e.created_at ? ` · edited ${formatDateTime(e.updated_at)}` : '';
  return `
    <li class="entry">
      ${statusBadge(e.kind)}
      <div class="entry-content">${content}</div>
      <span class="entry-time" data-tip="Added ${escapeHtml(formatDateTime(e.created_at) + edited)}">${formatDateTime(e.created_at)}</span>
      <span class="entry-actions">
        ${e.kind === 'recording' ? '' : button('Edit', 'edit-entry', { small: true, data: { id: e.todo_id, entry: e.entry_id }, tip: 'Change the words of this entry' })}
        ${button('Delete', 'delete-entry', { small: true, style: 'danger', data: { id: e.todo_id, entry: e.entry_id }, tip: 'Delete this entry for good' })}
      </span>
    </li>`;
}

// The row under a todo when its entries are open
function entriesRow(t) {
  const list = t.entries.length
    ? `<ol class="entry-list">${t.entries.map(entryHtml).join('')}</ol>`
    : '<p class="muted entries-empty">No entries yet — add one below.</p>';
  return `
    <tr class="entries-row">
      <td colspan="6">
        <div class="entries">
          ${list}
          <div class="entry-add">
            <span class="muted">Add an entry:</span>
            ${button('+ Text', 'add-entry', { small: true, data: { id: t.todo_id, kind: 'text' }, tip: 'Type an entry' })}
            ${button('+ Voice to Text', 'add-entry', { small: true, data: { id: t.todo_id, kind: 'voice' }, tip: voiceSupported ? 'Say an entry — what you say is typed in' : 'Voice to text needs Chrome, Edge or Safari' })}
            ${button('+ Record', 'add-entry', { small: true, data: { id: t.todo_id, kind: 'recording' }, tip: recordingSupported ? 'Record an entry with your voice' : 'This browser can\'t record audio' })}
          </div>
        </div>
      </td>
    </tr>`;
}

function rowHtml(t) {
  const status = t.is_done ? 'done' : 'open';
  const open = state.expanded.has(String(t.todo_id));
  const due = t.due_date
    ? `${formatDate(t.due_date)}${isOverdue(t) ? ` ${statusBadge('overdue')}` : ''}`
    : '<span class="muted">—</span>';
  return `
    <tr class="${t.is_done ? 'todo-done' : ''}${open ? ' expanded' : ''}">
      <td>${statusBadgeButton(status, 'toggle', t.is_done ? 'Click to reopen' : 'Click to mark done', { id: t.todo_id, done: t.is_done })}</td>
      <td class="todo-cell"><strong class="todo-title">${escapeHtml(t.title)}</strong>${recordingButtons(t)}${entriesToggle(t, open)}</td>
      <td class="nowrap">${due}</td>
      <td>${addedByBadge(t)}</td>
      <td class="nowrap" data-tip="${escapeHtml(t.is_done ? `Done ${formatDateTime(t.done_at)}` : `Last changed ${formatDateTime(t.updated_at)}`)}">${formatDateTime(t.created_at)}</td>
      <td class="actions-cell">
        ${button('Edit', 'edit', { small: true, data: { id: t.todo_id }, tip: 'Change what to do or the due date' })}
        ${button('Delete', 'delete', { small: true, style: 'danger', data: { id: t.todo_id }, tip: 'Delete this todo and its entries for good' })}
      </td>
    </tr>${open ? entriesRow(t) : ''}`;
}

export const todosPage = {
  load: () => api('/todos'),

  render(main, todos) {
    const count = (filter) => todos.filter(FILTERS[filter]).length;
    const page = mount(main, `
      ${pageHeader({
        title: 'Todos',
        subtitle: 'Type a todo or just say it — then tick it off, edit or delete it',
        actions: addButtons(),
      })}
      <div class="content-area">
        <div class="stats-grid">
          ${statCard(statIcon('todo'), 'Open', String(count('open')), 'Still to do — click to show only these (click again for all)', { filter: 'open' })}
          ${statCard(statIcon('warning'), 'Overdue', String(count('overdue')), 'Past their due date — click to show only these', { filter: 'overdue' })}
          ${statCard(statIcon('mic'), 'Added by voice', String(count('voice')), 'Spoken (voice to text) or recorded — click to show only these', { filter: 'voice' })}
          ${statCard(statIcon('active'), 'Done', String(count('done')), 'Ticked off — click to show only these', { filter: 'done' })}
        </div>
        ${card('Todo list', table([
          ['Status', 'Click a status to tick off or reopen'],
          ['What to do', 'The todo — click its entries to open them'],
          ['Due', 'The day it should be done by'],
          ['Added by', 'Typed, spoken (voice to text) or recorded'],
          ['Added', 'When it was added'],
          '',
        ], ''), { count: true, tools: searchBox(state.search, 'Search todos…', 'Search what to do and the words of every entry') })}
      </div>`);

    const matches = (t) => FILTERS[state.filter](t) && matchesSearch(state.search, [t.title, ...t.entries.map((e) => e.body)]);
    const draw = liveList(page, {
      items: todos,
      matches,
      noun: 'todo',
      state,
      rows: (items) => {
        const shown = items.filter(matches);
        if (shown.length) return shown.map(rowHtml).join('');
        return emptyRow(6, todos.length ? 'No todos match this search or filter' : 'No todos yet — add one by typing or by voice');
      },
    });
    bindStatFilters(page, () => state.filter, (value) => {
      state.filter = state.filter === value ? 'all' : value;
      draw();
    });

    const byId = (id) => todos.find((t) => String(t.todo_id) === String(id));
    const entryOf = (id, entryId) => byId(id)?.entries.find((e) => String(e.entry_id) === String(entryId));
    bindActions(page, {
      expand: ({ id }) => {
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        draw();
      },
      'add-entry': ({ id, kind }) => {
        const todo = byId(id);
        if (todo) ENTRY_OPENERS[kind](todo);
      },
      'edit-entry': ({ id, entry }) => {
        const e = entryOf(id, entry);
        if (!e) return;
        openFormModal({
          title: 'Edit Entry',
          intro: `In "${byId(id).title}"`,
          fields: [{ name: 'body', label: 'Entry', type: 'textarea', rows: 4, required: true, maxlength: 5000, value: e.body, tip: 'Required' }],
          submitLabel: 'Save',
          onSubmit: async (values) => {
            await api(`/todos/${id}/entries/${entry}`, { method: 'PUT', body: { body: values.body } });
            refresh();
            return 'Entry saved';
          },
        });
      },
      'delete-entry': ({ id, entry }) => {
        const e = entryOf(id, entry);
        if (!e) return;
        const what = e.kind === 'recording' ? `this ${formatClock(e.duration_ms)} recording` : `"${e.body.length > 60 ? `${e.body.slice(0, 60)}…` : e.body}"`;
        confirmModal({
          title: 'Delete Entry',
          message: `Delete ${what} from "${byId(id).title}"? This can't be undone.`,
          confirmLabel: 'Delete',
          onConfirm: async () => {
            stopPlaying(`entry-${entry}`);
            await api(`/todos/${id}/entries/${entry}`, { method: 'DELETE' });
            refresh();
            return 'Entry deleted';
          },
        });
      },
      'add-text': openTextTodo,
      'add-speech': openSpeechTodo,
      'add-record': openRecordTodo,
      toggle: async ({ id, done }) => {
        const nowDone = done !== 'true';
        try {
          await api(`/todos/${id}/done`, { method: 'PATCH', body: { done: nowDone } });
          showToast(nowDone ? 'Marked done' : 'Reopened');
          refresh();
        } catch (err) {
          showToast(err.message, 'error');
        }
      },
      edit: ({ id }) => {
        const todo = byId(id);
        if (!todo) return;
        const form = openFormModal({
          title: 'Edit Todo',
          fields: todoFields(todo, { notes: false }),
          submitLabel: 'Save',
          onSubmit: async (values) => {
            await api(`/todos/${id}`, { method: 'PUT', body: { title: values.title, due_date: values.due_date } });
            refresh();
            return 'Todo saved';
          },
        });
        // Replace it with a new todo of any kind: closes this form and opens
        // that one, carrying over what's typed here
        const micReady = window.isSecureContext;
        const replaceButton = (kind, label, ok, tip, why) => `<button type="button" class="btn btn-secondary btn-small" data-replace="${kind}"${ok ? '' : ' aria-disabled="true"'} data-tip="${escapeHtml(ok ? tip : why)}">${label}</button>`;
        form.querySelector('.form-error').insertAdjacentHTML('beforebegin', `
          <div class="form-group replace-group">
            <label>New todo from this one</label>
            <div class="replace-actions">
              ${replaceButton('text', 'Text Todo', true, 'Type a new todo based on this one')}
              ${replaceButton('speech', 'Voice to Text Todo', micReady && voiceSupported, 'Say a new todo based on this one — what you say is typed in', micReady ? 'Voice to text needs Chrome, Edge or Safari' : 'The microphone needs https:// or localhost')}
              ${replaceButton('record', 'Record Todo', micReady && recordingSupported, 'Record a new todo based on this one', micReady ? 'This browser can\'t record audio' : 'The microphone needs https:// or localhost')}
            </div>
            <small class="form-hint">Opens a new form with what's typed here. There you choose whether this todo is deleted (only once the new one is saved) or kept.</small>
          </div>`);
        const openers = { text: openTextTodo, speech: openSpeechTodo, record: openRecordTodo };
        // aria-disabled rather than disabled, so the tooltip still says why
        form.querySelectorAll('[data-replace]:not([aria-disabled])').forEach((btn) => btn.addEventListener('click', () => {
          const prefill = { title: form.elements.title.value, due_date: form.elements.due_date.value };
          stopPlayingTodo(todo);
          form.closest('dialog').close();
          openers[btn.dataset.replace]({ replace: todo, prefill });
        }));
      },
      delete: ({ id }) => {
        const todo = byId(id);
        if (!todo) return;
        confirmModal({
          title: 'Delete Todo',
          message: `Delete "${todo.title}"${todo.entries.length ? ` and its ${entriesWord(todo.entries.length)}` : ''}? This can't be undone.`,
          confirmLabel: 'Delete',
          onConfirm: async () => {
            stopPlayingTodo(todo);
            await api(`/todos/${id}`, { method: 'DELETE' });
            refresh();
            return 'Todo deleted';
          },
        });
      },
    });
  },
};
