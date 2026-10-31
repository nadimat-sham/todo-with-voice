// Thin wrapper over fetch for the { success, data, message } JSON shape every
// API route returns. Resolves to `data`; throws an Error carrying the
// server's own message on any failure.
// A Blob body (e.g. a voice recording) is sent as-is with its own type.
export async function api(path, { method = 'GET', body } = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': raw ? body.type : 'application/json' } : undefined,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  // Signed out (or the session expired): go to the login page, and come back
  // to this same page afterwards.
  if (res.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.hash)}`;
    return new Promise(() => {}); // never settles — the page is going away
  }
  const json = await res.json().catch(() => ({}));
  // Still on an emailed one-time password: choose a real one first
  if (res.status === 403 && json.mustChangePassword) {
    location.href = '/login.html#set-password';
    return new Promise(() => {});
  }
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `Request failed (${res.status})`);
  }
  return json.data;
}
