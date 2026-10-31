-- 001: starting schema — app settings and sign-in accounts. Run once as a
-- MySQL admin:
--   sudo mysql voice_todo < db/migrations/001_accounts.sql
-- Feature tables arrive in later numbered migrations; every one of them gets
-- an account_id, since each account sees only its own data.

-- Key/value app settings
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  setting_value TEXT         NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Anyone with a Google address can sign up. Each account signs in with its
-- own email and password.
CREATE TABLE IF NOT EXISTS accounts (
  account_id               INT AUTO_INCREMENT PRIMARY KEY,
  email                    VARCHAR(254) NOT NULL UNIQUE,
  password_hash            VARCHAR(255) NOT NULL,
  -- Set while the password is an emailed one-time password (sign up,
  -- forgot password): the account must choose its own before anything else
  must_change_password     BOOLEAN      NOT NULL DEFAULT TRUE,
  temp_password_expires_at TIMESTAMP    NULL,
  -- Bumped on every password change; sessions carry it, so older ones stop working
  session_version          INT          NOT NULL DEFAULT 1,
  -- When the last one-time password was mailed (limits how often one can be sent)
  last_otp_sent_at         TIMESTAMP    NULL,
  last_login_at            TIMESTAMP    NULL,
  created_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
