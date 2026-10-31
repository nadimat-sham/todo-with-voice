-- 003: voice recordings kept with voice todos (one per todo). Run once as a
-- MySQL admin:
--   sudo mysql voice_todo < db/migrations/003_todo_audio.sql
-- Kept apart from todos so listing todos never reads the audio itself.

CREATE TABLE IF NOT EXISTS todo_audio (
  todo_id     INT           NOT NULL PRIMARY KEY,
  account_id  INT           NOT NULL,
  mime_type   VARCHAR(100)  NOT NULL,
  byte_size   INT           NOT NULL,
  -- Measured while recording (browser recordings often carry no length of their own)
  duration_ms INT           NOT NULL,
  audio       MEDIUMBLOB    NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_todo_audio_account (account_id),
  -- Deleting a todo deletes its recording
  CONSTRAINT fk_todo_audio_todo FOREIGN KEY (todo_id) REFERENCES todos (todo_id) ON DELETE CASCADE,
  CONSTRAINT fk_todo_audio_account FOREIGN KEY (account_id) REFERENCES accounts (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
