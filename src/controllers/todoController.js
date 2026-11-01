const express = require("express");
const pool = require("../config/db");
const { withTransaction } = require("../utils/transaction");

// Every query here is scoped to req.account (set by requireLogin), so an
// account can only ever see or change its own todos.

const MAX_TITLE = 500;
const MAX_BODY = 5000;
// How a todo was first added, and the kinds of entry it can hold:
// text = typed, voice = spoken and typed in by the browser, recording = audio
const SOURCES = ["text", "voice", "recording"];
const WORD_KINDS = ["text", "voice"];

const MAX_AUDIO_MB = 10;
const MAX_AUDIO_MS = 5 * 60 * 1000;

const TODO_COLUMNS = "todo_id, title, due_date, source, is_done, done_at, created_at, updated_at";
// Never the audio itself — that's fetched on its own when played
const ENTRY_COLUMNS = "entry_id, todo_id, kind, body, duration_ms, byte_size, created_at, updated_at";

// MySQL BOOLEAN comes back as 0/1
const shapeTodo = (row, entries) => ({ ...row, is_done: Boolean(row.is_done), entries });

// Each todo with its entries (oldest first)
async function withEntries(accountId, todos) {
  if (todos.length === 0) return [];
  const [entries] = await pool.query(
    `SELECT ${ENTRY_COLUMNS} FROM todo_entries WHERE account_id = ? AND todo_id IN (?) ORDER BY created_at, entry_id`,
    [accountId, todos.map((t) => t.todo_id)],
  );
  return todos.map((t) => shapeTodo(t, entries.filter((e) => e.todo_id === t.todo_id)));
}

// Checks and tidies { title, due_date } from a request body. Returns
// { values } or { error } (a message for a 400).
function readTodo(body) {
  const title = String(body?.title ?? "").replace(/\s+/g, " ").trim();
  const due = String(body?.due_date ?? "").trim();
  if (!title) return { error: "What to do is required" };
  if (title.length > MAX_TITLE) return { error: `What to do can be at most ${MAX_TITLE} characters` };
  if (due && !isRealDate(due)) return { error: "Due date must be a real date (YYYY-MM-DD)" };
  return { values: { title, due_date: due || null } };
}

// The words of a text/voice entry: { body } or { error }
function readBody(value, { required }) {
  const body = String(value ?? "").trim();
  if (!body && required) return { error: "The entry can't be empty" };
  if (body.length > MAX_BODY) return { error: `An entry can be at most ${MAX_BODY} characters` };
  return { body: body || null };
}

// 'YYYY-MM-DD' that names a day that exists (no 2026-02-30)
function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(match[1], match[2] - 1, match[3]));
  return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === match[2] - 1 && d.getUTCDate() === Number(match[3]);
}

function readId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function findTodo(accountId, todoId) {
  const [rows] = await pool.query(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE todo_id = ? AND account_id = ?`,
    [todoId, accountId],
  );
  return rows[0] ? (await withEntries(accountId, rows))[0] : null;
}

async function findEntry(accountId, todoId, entryId) {
  const [rows] = await pool.query(
    `SELECT ${ENTRY_COLUMNS} FROM todo_entries WHERE entry_id = ? AND todo_id = ? AND account_id = ?`,
    [entryId, todoId, accountId],
  );
  return rows[0] || null;
}

const notFound = (res) => res.status(404).json({ success: false, message: "Todo not found" });
const entryNotFound = (res) => res.status(404).json({ success: false, message: "Entry not found" });
const failed = (res, err) => {
  console.error(err);
  res.status(500).json({ success: false, message: err.message });
};

// GET /api/todos — each with its entries. Open ones first (soonest due
// first, undated last), then done ones (latest first).
exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${TODO_COLUMNS} FROM todos WHERE account_id = ?
       ORDER BY is_done,
         CASE WHEN is_done THEN 0 ELSE due_date IS NULL END,
         CASE WHEN is_done THEN NULL ELSE due_date END,
         done_at DESC, created_at DESC`,
      [req.account.account_id],
    );
    res.json({ success: true, data: await withEntries(req.account.account_id, rows) });
  } catch (err) {
    failed(res, err);
  }
};

// POST /api/todos — { title, due_date?, source, notes? }. Notes, if given,
// become the todo's first (typed) entry.
exports.create = async (req, res) => {
  const { values, error } = readTodo(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  const source = String(req.body?.source || "text");
  if (!SOURCES.includes(source)) return res.status(400).json({ success: false, message: "Source must be text, voice or recording" });
  const notes = readBody(req.body?.notes, { required: false });
  if (notes.error) return res.status(400).json({ success: false, message: `Notes can be at most ${MAX_BODY} characters` });

  try {
    const todoId = await withTransaction(async (conn) => {
      const [result] = await conn.query(
        "INSERT INTO todos (account_id, title, due_date, source) VALUES (?, ?, ?, ?)",
        [req.account.account_id, values.title, values.due_date, source],
      );
      if (notes.body) {
        await conn.query(
          "INSERT INTO todo_entries (todo_id, account_id, kind, body) VALUES (?, ?, 'text', ?)",
          [result.insertId, req.account.account_id, notes.body],
        );
      }
      return result.insertId;
    });
    res.status(201).json({ success: true, data: await findTodo(req.account.account_id, todoId) });
  } catch (err) {
    failed(res, err);
  }
};

// PUT /api/todos/:id — { title, due_date? } (how it was added never changes)
exports.update = async (req, res) => {
  const id = readId(req.params.id);
  if (!id) return notFound(res);
  const { values, error } = readTodo(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [result] = await pool.query(
      "UPDATE todos SET title = ?, due_date = ? WHERE todo_id = ? AND account_id = ?",
      [values.title, values.due_date, id, req.account.account_id],
    );
    if (result.affectedRows === 0) return notFound(res);
    res.json({ success: true, data: await findTodo(req.account.account_id, id) });
  } catch (err) {
    failed(res, err);
  }
};

// PATCH /api/todos/:id/done — { done: true | false }
exports.setDone = async (req, res) => {
  const id = readId(req.params.id);
  if (!id) return notFound(res);
  if (typeof req.body?.done !== "boolean") {
    return res.status(400).json({ success: false, message: "done must be true or false" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE todos SET is_done = ?, done_at = IF(?, COALESCE(done_at, NOW()), NULL)
       WHERE todo_id = ? AND account_id = ?`,
      [req.body.done, req.body.done, id, req.account.account_id],
    );
    if (result.affectedRows === 0) return notFound(res);
    res.json({ success: true, data: await findTodo(req.account.account_id, id) });
  } catch (err) {
    failed(res, err);
  }
};

// DELETE /api/todos/:id — todos have no history behind them, so they're
// removed outright (with all their entries)
exports.remove = async (req, res) => {
  const id = readId(req.params.id);
  if (!id) return notFound(res);

  try {
    const [result] = await pool.query(
      "DELETE FROM todos WHERE todo_id = ? AND account_id = ?",
      [id, req.account.account_id],
    );
    if (result.affectedRows === 0) return notFound(res);
    res.json({ success: true, message: "Todo deleted" });
  } catch (err) {
    failed(res, err);
  }
};

// ---------- Entries ----------

// POST /api/todos/:id/entries — { kind: 'text' | 'voice', body }
exports.addEntry = async (req, res) => {
  const id = readId(req.params.id);
  if (!id) return notFound(res);
  const kind = String(req.body?.kind || "");
  if (!WORD_KINDS.includes(kind)) {
    return res.status(400).json({ success: false, message: "Kind must be text or voice (recordings are sent as audio)" });
  }
  const { body, error } = readBody(req.body?.body, { required: true });
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    if (!(await findTodo(req.account.account_id, id))) return notFound(res);
    const [result] = await pool.query(
      "INSERT INTO todo_entries (todo_id, account_id, kind, body) VALUES (?, ?, ?, ?)",
      [id, req.account.account_id, kind, body],
    );
    res.status(201).json({ success: true, data: await findEntry(req.account.account_id, id, result.insertId) });
  } catch (err) {
    failed(res, err);
  }
};

// Body parser for the recording upload: the audio itself is the request
// body. Turns "too large" into a JSON 413 like every other API error.
const audioBody = express.raw({ type: "audio/*", limit: `${MAX_AUDIO_MB}mb` });
exports.readAudio = (req, res, next) => {
  audioBody(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ success: false, message: `The recording is too large (at most ${MAX_AUDIO_MB} MB)` });
    }
    next(err);
  });
};

// POST /api/todos/:id/entries/recording?duration_ms=N — body: the recording
// (Content-Type audio/*)
exports.addRecording = async (req, res) => {
  const id = readId(req.params.id);
  if (!id) return notFound(res);
  if (!Buffer.isBuffer(req.body) || !String(req.headers["content-type"] || "").startsWith("audio/")) {
    return res.status(400).json({ success: false, message: "Send the recording as audio" });
  }
  if (req.body.length === 0) return res.status(400).json({ success: false, message: "The recording is empty" });
  const duration = Number(req.query.duration_ms);
  if (!Number.isInteger(duration) || duration <= 0) {
    return res.status(400).json({ success: false, message: "duration_ms must be a positive whole number" });
  }
  if (duration > MAX_AUDIO_MS + 5000) {
    return res.status(400).json({ success: false, message: `Recordings can be at most ${MAX_AUDIO_MS / 60000} minutes` });
  }
  const mime = String(req.headers["content-type"]).slice(0, 100);

  try {
    if (!(await findTodo(req.account.account_id, id))) return notFound(res);
    const [result] = await pool.query(
      `INSERT INTO todo_entries (todo_id, account_id, kind, mime_type, byte_size, duration_ms, audio)
       VALUES (?, ?, 'recording', ?, ?, ?, ?)`,
      [id, req.account.account_id, mime, req.body.length, duration, req.body],
    );
    res.status(201).json({ success: true, data: await findEntry(req.account.account_id, id, result.insertId) });
  } catch (err) {
    failed(res, err);
  }
};

// PUT /api/todos/:id/entries/:entryId — { body } (text and voice entries)
exports.updateEntry = async (req, res) => {
  const id = readId(req.params.id);
  const entryId = readId(req.params.entryId);
  if (!id || !entryId) return entryNotFound(res);
  const { body, error } = readBody(req.body?.body, { required: true });
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const entry = await findEntry(req.account.account_id, id, entryId);
    if (!entry) return entryNotFound(res);
    if (entry.kind === "recording") {
      return res.status(400).json({ success: false, message: "A recording can't be edited — delete it and record a new one" });
    }
    await pool.query("UPDATE todo_entries SET body = ? WHERE entry_id = ?", [body, entryId]);
    res.json({ success: true, data: await findEntry(req.account.account_id, id, entryId) });
  } catch (err) {
    failed(res, err);
  }
};

// DELETE /api/todos/:id/entries/:entryId
exports.removeEntry = async (req, res) => {
  const id = readId(req.params.id);
  const entryId = readId(req.params.entryId);
  if (!id || !entryId) return entryNotFound(res);
  try {
    const [result] = await pool.query(
      "DELETE FROM todo_entries WHERE entry_id = ? AND todo_id = ? AND account_id = ?",
      [entryId, id, req.account.account_id],
    );
    if (result.affectedRows === 0) return entryNotFound(res);
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    failed(res, err);
  }
};

// GET /api/todos/:id/entries/:entryId/audio — a recording, for playing
exports.getAudio = async (req, res) => {
  const id = readId(req.params.id);
  const entryId = readId(req.params.entryId);
  if (!id || !entryId) return entryNotFound(res);
  try {
    const [rows] = await pool.query(
      "SELECT mime_type, audio FROM todo_entries WHERE entry_id = ? AND todo_id = ? AND account_id = ? AND kind = 'recording'",
      [entryId, id, req.account.account_id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "Recording not found" });
    res.set({ "Content-Type": rows[0].mime_type, "Cache-Control": "private, no-cache" });
    res.send(rows[0].audio);
  } catch (err) {
    failed(res, err);
  }
};
