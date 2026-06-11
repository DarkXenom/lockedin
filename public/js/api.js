// api.js — fetch wrapper + socket
export let token = localStorage.getItem('li_token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('li_token', t);
  else localStorage.removeItem('li_token');
}

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let socket = null;
export function connectSocket(handlers) {
  if (socket) { socket.disconnect(); socket = null; }
  socket = io({ auth: { token } });
  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
  return socket;
}
export function getSocket() { return socket; }
export function disconnectSocket() { if (socket) { socket.disconnect(); socket = null; } }
