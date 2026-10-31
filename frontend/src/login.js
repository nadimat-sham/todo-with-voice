import '@fontsource-variable/dm-sans';
import './styles/login.css';
import './ocean.js';

// Four views on one page, picked by the URL hash: #signin (default),
// #signup, #forgot, #set-password (after signing in with an emailed
// one-time password).

// Where to go after signing in: the page the user was on when they were sent
// here (?next=#users), but only ever an in-app #hash — never another site.
function nextUrl() {
  const next = new URLSearchParams(location.search).get('next') || '';
  return next.startsWith('#') ? `/${next}` : '/';
}

const views = [...document.querySelectorAll('.auth-view')];
const TITLES = { signin: 'Sign in', signup: 'Sign up', forgot: 'Forgot password', 'set-password': 'Choose a password' };

function showView(name) {
  const view = views.find((v) => v.dataset.view === name) ? name : 'signin';
  views.forEach((v) => { v.hidden = v.dataset.view !== view; });
  document.title = `${TITLES[view]} · NADIM Voice Todo`;
  const active = views.find((v) => !v.hidden);
  active.querySelectorAll('.form-error').forEach((el) => { el.textContent = ''; });
  active.querySelector('input:not([type="checkbox"])')?.focus();
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

// Signed in already? Go straight in — or, still on a one-time password,
// straight to choosing one.
async function checkSession() {
  try {
    const res = await fetch('/api/auth/session');
    if (!res.ok) return showView(location.hash.slice(1));
    const { data } = await res.json();
    if (data.mustChangePassword) {
      history.replaceState(null, '', `${location.pathname}${location.search}#set-password`);
      showView('set-password');
    } else {
      location.replace(nextUrl());
    }
  } catch {
    showView(location.hash.slice(1));
  }
}
checkSession();

// Show/hide password buttons
document.querySelectorAll('.password-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const input = toggle.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
});

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.message || `Request failed (${res.status})`);
  return json;
}

// Wires a form: disables its button while busy, shows any error inside it.
function handle(formId, busyLabel, run) {
  const form = document.getElementById(formId);
  const errorBox = form.querySelector('.form-error');
  const submit = form.querySelector('[type="submit"]');
  const label = submit.querySelector('.submit-label');
  const idleLabel = label.textContent;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    label.textContent = busyLabel;
    errorBox.textContent = '';
    try {
      await run(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      submit.disabled = false;
      label.textContent = idleLabel;
    }
  });
}

// ---------- Sign in ----------
const signinEmail = document.getElementById('signin-email');
const signinPassword = document.getElementById('signin-password');
const remember = document.getElementById('remember-email');
const notice = document.querySelector('.form-notice');
try {
  signinEmail.value = localStorage.getItem('vtodo-remembered-email') || '';
  remember.checked = Boolean(signinEmail.value);
} catch { /* Storage is optional. */ }

// After a one-time password is mailed: back to sign in, email filled in
function sentOneTimePassword(email, message) {
  signinEmail.value = email;
  signinPassword.value = '';
  notice.textContent = `${message} Enter it below as your password.`;
  location.hash = 'signin';
  showView('signin');
  signinPassword.focus();
}

handle('signin-form', 'Signing in…', async (values) => {
  try {
    const { data } = await post('/api/auth/login', values);
    try {
      if (remember.checked) localStorage.setItem('vtodo-remembered-email', values.email);
      else localStorage.removeItem('vtodo-remembered-email');
    } catch { /* Signing in does not require local storage. */ }
    if (data.mustChangePassword) {
      notice.textContent = '';
      location.hash = 'set-password';
    } else {
      location.replace(nextUrl());
    }
  } catch (err) {
    signinPassword.select();
    throw err;
  }
});

// ---------- Sign up / forgot password ----------
handle('signup-form', 'Sending…', async ({ email }) => {
  const { message } = await post('/api/auth/signup', { email });
  sentOneTimePassword(email, message);
});

handle('forgot-form', 'Sending…', async ({ email }) => {
  const { message } = await post('/api/auth/forgot-password', { email });
  sentOneTimePassword(email, message);
});

// Prefill the email when switching between views
document.querySelectorAll('a[href="#signup"], a[href="#forgot"]').forEach((link) => {
  link.addEventListener('click', () => {
    const target = document.getElementById(`${link.getAttribute('href').slice(1)}-email`);
    if (!target.value) target.value = signinEmail.value;
  });
});

// ---------- Choose a password ----------
handle('set-password-form', 'Saving…', async (values) => {
  if (values.new_password !== values.confirm_password) throw new Error('The two passwords don\'t match');
  await post('/api/auth/change-password', { new_password: values.new_password });
  location.replace(nextUrl());
});

document.getElementById('set-password-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.hash = 'signin';
  showView('signin');
});
