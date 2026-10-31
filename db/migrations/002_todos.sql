-- 002: todos — each account's own todo list, typed or spoken. Run once as a
-- MySQL admin:
--   sudo mysql voice_todo < db/migrations/002_todos.sql

CREATE TABLE IF NOT EXISTS todos (
  todo_id     INT AUTO_INCREMENT PRIMARY KEY,
  account_id  INT           NOT NULL,
  title       VARCHAR(500)  NOT NULL,
  notes       TEXT          NULL,
  due_date    DATE          NULL,
  -- How it was first added: typed, or spoken and transcribed in the browser
  source      ENUM('text', 'voice') NOT NULL DEFAULT 'text',
  is_done     BOOLEAN       NOT NULL DEFAULT FALSE,
  done_at     TIMESTAMP     NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_todos_account_done (account_id, is_done),
  CONSTRAINT fk_todos_account FOREIGN KEY (account_id) REFERENCES accounts (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
