// races.mjs — regression test for the concurrency fixes.
// fires concurrent duplicate requests; exactly one must win each race.
const BASE = 'http://localhost:3000';
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function login(username, pin, tz) {
  let r = await api('/login', { method: 'POST', body: { username, pin, tz } });
  if (r.status !== 200) {
    r = await api('/register', { method: 'POST', body: { username, pin, tz } });
    await api('/constitution/sign', { method: 'POST', token: r.data.token });
  }
  return r.data;
}

const racer = await login('racer', '9999', 'Asia/Kolkata');
const judge1 = await login('judge1', '8888', 'Asia/Kolkata');
const judge2 = await login('judge2', '7777', 'Asia/Kolkata');

// RACE 1: double-tapped skip check-in — exactly one shame row + one pot entry, no 500
const [a, b] = await Promise.all([
  api('/checkin', { method: 'POST', token: racer.token, body: { status: 'skip' } }),
  api('/checkin', { method: 'POST', token: racer.token, body: { status: 'skip' } }),
]);
const statuses = [a.status, b.status].sort();
console.log('race1 double-skip:', JSON.stringify({ statuses, expect: [200, 409] }));

const me = await api('/me', { token: racer.token });
console.log('race1 aura (expect 100-150=-50, not -200):', me.data.user.aura);

// RACE 2: concurrent tribunal cap votes — punishment applies exactly once
const noUser = await login('excuser', '6666', 'Asia/Kolkata');
await api('/checkin', { method: 'POST', token: noUser.token, body: { status: 'no', excuse: 'traffic (distance walked: 0)' } });
const pending = await api('/excuse/pending', { token: judge1.token });
const target = pending.data.find(p => p.username === 'excuser');
const [v1, v2] = await Promise.all([
  api(`/excuse/${target.id}/vote`, { method: 'POST', token: judge1.token, body: { valid: false } }),
  api(`/excuse/${target.id}/vote`, { method: 'POST', token: judge2.token, body: { valid: false } }),
]);
const ex = await api('/me', { token: noUser.token });
console.log('race2 tribunal: votes', v1.status, v2.status, '— excuser aura (expect 100-50-100=-50, not -150):', ex.data.user.aura);

// RACE 3: concurrent wager settles — losers fined once
const w = await api('/wagers', { method: 'POST', token: racer.token, body: { title: 'race wager', stake: 'test stake', deadline: '2026-12-01' } });
await api(`/wagers/${w.data.id}/join`, { method: 'POST', token: judge1.token });
const [s1, s2] = await Promise.all([
  api(`/wagers/${w.data.id}/settle`, { method: 'POST', token: racer.token, body: { loserIds: [judge1.data ? judge1.user.id : judge1.user.id] } }),
  api(`/wagers/${w.data.id}/settle`, { method: 'POST', token: racer.token, body: { loserIds: [judge1.user.id] } }),
]);
const j1 = await api('/me', { token: judge1.token });
console.log('race3 settle:', JSON.stringify([s1.status, s2.status].sort()), '— judge1 aura (expect 100-75=25, not -50):', j1.data.user.aura);

// brute force: 9th rapid login attempt throttles
let last = null;
for (let i = 0; i < 9; i++) last = await api('/login', { method: 'POST', body: { username: 'racer', pin: '0000' } });
console.log('rate limit on 9th bad pin (expect 429):', last.status);
