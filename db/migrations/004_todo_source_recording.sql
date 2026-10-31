-- 004: a third way to add a todo — as a voice recording (Record Todo), next
-- to typed ('text') and spoken-and-typed-in ('voice'). Run once as a MySQL
-- admin:
--   sudo mysql voice_todo < db/migrations/004_todo_source_recording.sql

ALTER TABLE todos
  MODIFY source ENUM('text', 'voice', 'recording') NOT NULL DEFAULT 'text';
