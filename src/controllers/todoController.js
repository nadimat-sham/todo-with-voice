const express = require("express");
const pool = require("../config/db");

// Every query here is scoped to req.account (set by requireLogin), so an
// account can only ever see or change its own todos.

const MAX_TITLE = 500;
const MAX_NOTES = 5000;
// text = typed, voice = spoken and typed in by the browser, recording = a voice recording
const SOURCES = ["text", "voice", "recording"];

const MAX_AUDIO_MB = 10;
const MAX_AUDIO_MS = 5 * 60 * 1000;

// Always read from "todos t LEFT JOIN todo_audio a" — says whether a
// recording exists and how long it is, without reading the audio itself.
const TODO_COLUMNS = `t.todo_id, t.title, t.notes, t.due_date, t.source, t.is_done, t.done_at,
  t.created_at, t.updated_at, a.todo_id IS NOT NULL AS has_audio, a.duration_ms AS audio_duration_ms`;
const TODO_FROM = "todos t LEFT JOIN todo_audio a ON a.todo_id = t.todo_id";

// MySQL BOOLEAN comes back as 0/1
const shape = (row) => ({ ...row, is_done: Boolean(row.is_done), has_audio: Boolean(row.has_audio) });

// Checks and tidies { title, notes, due_date } from a request body. Returns
// { values } or { error } (a message for a 400).
function readTodo(body) {
  const title = String(body?.title ?? "").replace(/\s+/g, " ").trim();
  const notes = String(body?.notes ?? "").trim();
  const due = String(body?.due_date ?? "").trim();
  if (!title) return { error: "What to do is required" };
  if (title.length > MAX_TITLE) return { error: `What to do can be at most ${MAX_TITLE} characters` };
  if (notes.length > MAX_NOTES) return { error: `Notes can be at most ${MAX_NOTES} characters` };
  if (due && !isRealDate(due)) return { error: "Due date must be a real date (YYYY-MM-DD)" };
  return { values: { title, notes: notes || null, due_date: due || null } };
}

// 'YYYY-MM-DD' that names a day that exists (no 2026-02-30)
function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(match[1], match[2] - 1, match[3]));
  return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === match[2] - 1 && d.getUTCDate() === Number(match[3]);
}

function readId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function findTodo(accountId, todoId) {
  const [rows] = await pool.query(
    `SELECT ${TODO_COLUMNS} FROM ${TODO_FROM} WHERE t.todo_id = ? AND t.account_id = ?`,
    [todoId, accountId],
  );
  return rows[0] ? shape(rows[0]) : null;
}

const notFound = (res) => res.status(404).json({ success: false, message: "Todo not found" });

// GET /api/todos — open ones first (soonest due first, undated last), then done ones (latest first)
exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${TODO_COLUMNS} FROM ${TODO_FROM} WHERE t.account_id = ?
       ORDER BY t.is_done,
         CASE WHEN t.is_done THEN 0 ELSE t.due_date IS NULL END,
         CASE WHEN t.is_done THEN NULL ELSE t.due_date END,
         t.done_at DESC, t.created_at DESC`,
      [req.account.account_id],
    );
    res.json({ success: true, data: rows.map(shape) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/todos — { title, notes?, due_date?, source: 'text' | 'voice' | 'recording' }
exports.create = async (req, res) => {
  const { values, error } = readTodo(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  const source = String(req.body?.source || "text");
  if (!SOURCES.includes(source)) return res.status(400).json({ success: false, message: "Source must be text, voice or recording" });

  try {
    const [result] = await pool.query(
      "INSERT INTO todos (account_id, title, notes, due_date, source) VALUES (?, ?, ?, ?, ?)",
      [req.account.account_id, values.title, values.notes, values.due_date, source],
    );
    res.status(201).json({ success: true, data: await findTodo(req.account.account_id, result.insertId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/todos/:id — { title, notes?, due_date? } (how it was added never changes)
exports.update = async (req, res) => {
  const id = readId(req);
  if (!id) return notFound(res);
  const { values, error } = readTodo(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [result] = await pool.query(
      "UPDATE todos SET title = ?, notes = ?, due_date = ? WHERE todo_id = ? AND account_id = ?",
      [values.title, values.notes, values.due_date, id, req.account.account_id],
    );
    if (result.affectedRows === 0) return notFound(res);
    res.json({ success: true, data: await findTodo(req.account.account_id, id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/todos/:id/done — { done: true | false }
exports.setDone = async (req, res) => {
  const id = readId(req);
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
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/todos/:id — todos have no history behind them, so they're
// removed outright (with their recording)
exports.remove = async (req, res) => {
  const id = readId(req);
  if (!id) return notFound(res);

  try {
    const [result] = await pool.query(
      "DELETE FROM todos WHERE todo_id = ? AND account_id = ?",
      [id, req.account.account_id],
    );
    if (result.affectedRows === 0) return notFound(res);
    res.json({ success: true, message: "Todo deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------- Voice recordings ----------

// Body parser for PUT /:id/audio: the recording itself as the request body.
// Turns "too large" into a JSON 413 like every other API error.
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

// PUT /api/todos/:id/audio?duration_ms=N — body: the recording (Content-Type
// audio/*). Replaces any recording the todo already has.
exports.saveAudio = async (req, res) => {
  const id = readId(req);
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
    await pool.query(
      `INSERT INTO todo_audio (todo_id, account_id, mime_type, byte_size, duration_ms, audio) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), byte_size = VALUES(byte_size),
         duration_ms = VALUES(duration_ms), audio = VALUES(audio), created_at = CURRENT_TIMESTAMP`,
      [id, req.account.account_id, mime, req.body.length, duration, req.body],
    );
    res.json({ success: true, data: await findTodo(req.account.account_id, id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/todos/:id/audio — the recording, for an <audio> element
exports.getAudio = async (req, res) => {
  const id = readId(req);
  if (!id) return notFound(res);
  try {
    const [rows] = await pool.query(
      "SELECT mime_type, audio FROM todo_audio WHERE todo_id = ? AND account_id = ?",
      [id, req.account.account_id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "This todo has no recording" });
    res.set({ "Content-Type": rows[0].mime_type, "Cache-Control": "private, no-cache" });
    res.send(rows[0].audio);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/todos/:id/audio — removes the recording, keeps the todo
exports.removeAudio = async (req, res) => {
  const id = readId(req);
  if (!id) return notFound(res);
  try {
    const [result] = await pool.query(
      "DELETE FROM todo_audio WHERE todo_id = ? AND account_id = ?",
      [id, req.account.account_id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "This todo has no recording" });
    res.json({ success: true, message: "Recording deleted", data: await findTodo(req.account.account_id, id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};
