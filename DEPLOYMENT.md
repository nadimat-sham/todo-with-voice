# Voice Todo — setup and deployment

A todo list you can fill in by voice. Node + Express 5 API with a Vite
frontend, backed by its own MySQL 8 database `voice_todo`
(utf8mb4_0900_ai_ci). It shares nothing with the other projects at runtime.

## Accounts

Anyone with a Google address (Gmail or Google Workspace) can sign up on the
login page. Sign-up and Forgot password email a one-time password (valid 30
minutes) from the system mailbox below; signing in with it asks for a new
password straight away. Each account sees only its own data.

## Configuration

All credentials live only in `.env` (mode `600`, never committed). Copy
`.env.example` and fill in:

- `DB_USER=voice_todo_app` / `DB_PASSWORD` — app database account, limited
  to data reads and writes (SELECT, INSERT, UPDATE, DELETE); it cannot change
  the schema.
- `PORT=3004`
- `SESSION_SECRET` — signs the login cookie. Changing it signs everyone out.
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`,
  `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — the **system mailbox** that
  sends one-time passwords. `SMTP_PASSWORD` is a Google **App Password**,
  not the account password: turn on 2-Step Verification for that Google
  account, then create one at https://myaccount.google.com/apppasswords.
- `APP_URL` (optional) — the address the app is opened at, e.g.
  `https://todo.example.com`; adds a sign-in link to one-time password mails.
- `TRUST_PROXY` (production only) — address of the reverse proxy in front of
  the app, so login throttling sees real client addresses.

## Database

Create the database and app account once, as a MySQL admin (the server
enforces `validate_password`, so use a strong password):

```sql
CREATE DATABASE voice_todo CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'voice_todo_app'@'localhost' IDENTIFIED BY '<strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_todo.* TO 'voice_todo_app'@'localhost';
```

The schema changes only through numbered files in `db/migrations/`. Apply each
new one once, in order, before starting an app version that needs it, after
backing up the database:

```bash
sudo mysql voice_todo < db/migrations/NNN_description.sql
```

## Development

```bash
npm install
npm run dev:api   # Express API on :3004 (nodemon: server.js, src, .env)
npm run dev       # Vite on http://127.0.0.1:5182, /api proxied to :3004
```

## Production

```bash
npm ci
npm run build     # builds frontend/ into dist/
npm start         # Express serves dist/ and /api on :3004
```

Check health: `curl http://127.0.0.1:3004/api/health`

## Voice todos

**Voice to Text Todo** and **Record Todo** use the browser's microphone,
which browsers only allow on `https://` pages or on `localhost`, so in
production serve the app over HTTPS.

- **Voice to Text Todo** types what's said into the todo, using the
  browser's own speech service (Chrome, Edge and Safari; not Firefox).
  Nothing is recorded.
- **Record Todo** saves a voice recording with the todo (in the database,
  at most 5 minutes / 10 MB each). Nothing is typed in.

Each todo holds any number of entries of all three kinds — typed, voice to
text and recordings — added from the todo's row in the list.

## Passwords

Each account changes its own password with **Change password** at the
bottom of the sidebar (other signed-in browsers are signed out). A forgotten
password is reset by the account itself with **Forgot password?** on the
login page.
