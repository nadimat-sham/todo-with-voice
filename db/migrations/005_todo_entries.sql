-- 005: a todo can hold any number of entries — typed text, voice to text
-- (spoken, typed in by the browser) and voice recordings. Replaces the single
-- notes field (002) and the single recording per todo (003): both are copied
-- into entries first, and only then removed. Back up first, then run once as
-- a MySQL admin:
--   sudo mysql voice_todo < db/migrations/005_todo_entries.sql
-- (the mysql client stops at the first error, so nothing is dropped unless
-- the copies above it succeeded)

CREATE TABLE IF NOT EXISTS todo_entries (
  entry_id    INT AUTO_INCREMENT PRIMARY KEY,
  todo_id     INT           NOT NULL,
  account_id  INT           NOT NULL,
  -- text = typed, voice = spoken and typed in by the browser, recording = audio
  kind        ENUM('text', 'voice', 'recording') NOT NULL,
  -- The words, for text and voice entries
  body        TEXT          NULL,
  -- The audio, for recording entries (duration measured while recording)
  mime_type   VARCHAR(100)  NULL,
  byte_size   INT           NULL,
  duration_ms INT           NULL,
  audio       MEDIUMBLOB    NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_todo_entries_todo (todo_id),
  KEY idx_todo_entries_account (account_id),
  -- Deleting a todo deletes its entries
  CONSTRAINT fk_todo_entries_todo FOREIGN KEY (todo_id) REFERENCES todos (todo_id) ON DELETE CASCADE,
  CONSTRAINT fk_todo_entries_account FOREIGN KEY (account_id) REFERENCES accounts (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Existing notes become typed entries
INSERT INTO todo_entries (todo_id, account_id, kind, body, created_at)
  SELECT todo_id, account_id, 'text', notes, created_at
  FROM todos WHERE notes IS NOT NULL AND TRIM(notes) <> '';

-- Existing recordings become recording entries
INSERT INTO todo_entries (todo_id, account_id, kind, mime_type, byte_size, duration_ms, audio, created_at)
  SELECT todo_id, account_id, 'recording', mime_type, byte_size, duration_ms, audio, created_at
  FROM todo_audio;

DROP TABLE todo_audio;
ALTER TABLE todos DROP COLUMN notes;
