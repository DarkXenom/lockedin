// timewarp.mjs — backdates test data to exercise streak-pause, wrapped, and levelup paths.
// run ONLY with the server stopped. usage: node test/timewarp.mjs <scenario>
import { createClient } from '@libsql/client';
const db = createClient({ url: 'file:data/lockedin.db' });
const q = async (sql, ...args) => (await db.execute({ sql, args })).rows;

const scenario = process.argv[2] || 'help';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

if (scenario === 'streak-pause') {
  // give a user: yes, yes, rest, yes over the last 4 days → expected streak 3 (rest pauses)
  const who = process.argv[3] || 'rohan';
  const [u] = await q('SELECT id, joined_date FROM users WHERE username = ?', who);
  const t = today();
  const days = [[addDays(t, -3), 'yes'], [addDays(t, -2), 'yes'], [addDays(t, -1), 'rest'], [t, 'yes']];
  await db.execute({ sql: 'DELETE FROM checkins WHERE user_id = ?', args: [u.id] });
  for (const [date, status] of days) {
    await db.execute({
      sql: `INSERT INTO checkins (user_id, date, status, xp_delta, created_at) VALUES (?,?,?,?,?)`,
      args: [u.id, date, status, status === 'yes' ? 50 : 15, Date.now()],
    });
  }
  await db.execute({ sql: 'UPDATE users SET joined_date = ? WHERE id = ?', args: [addDays(t, -3), u.id] });
  console.log(JSON.stringify({ planted: days, expectStreak: 3 }));
} else if (scenario === 'wrapped') {
  // backdate a user into last month with activity so wrapped generates on next reconcile
  const who = process.argv[3] || 'dev';
  const [u] = await q('SELECT id FROM users WHERE username = ?', who);
  const t = today();
  const lastMonthEnd = addDays(t.slice(0, 7) + '-01', -1);
  const start = lastMonthEnd.slice(0, 7) + '-15';
  await db.execute({ sql: 'UPDATE users SET joined_date = ? WHERE id = ?', args: [start, u.id] });
  let d = start;
  let i = 0;
  while (d <= lastMonthEnd) {
    const status = i % 4 === 3 ? 'rest' : 'yes';
    await db.execute({
      sql: `INSERT OR IGNORE INTO checkins (user_id, date, status, xp_delta, created_at) VALUES (?,?,?,?,?)`,
      args: [u.id, d, status, status === 'yes' ? 50 : 15, Date.now() - 20 * 86400000],
    });
    d = addDays(d, 1); i++;
  }
  // fill the gap from month start to today so reconcile doesn't nuke them with auto-skips
  d = t.slice(0, 7) + '-01';
  while (d < t) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO checkins (user_id, date, status, xp_delta, created_at) VALUES (?,?,'yes',50,?)`,
      args: [u.id, d, Date.now() - 5 * 86400000],
    });
    d = addDays(d, 1);
  }
  await db.execute({ sql: `DELETE FROM meta WHERE key = 'wrapped_done_month'`, args: [] });
  console.log(JSON.stringify({ planted: `${start}..${lastMonthEnd} + gap fill`, note: 'restart server → wrapped generates' }));
} else if (scenario === 'near-levelup') {
  const who = process.argv[3] || 'rohan';
  await db.execute({ sql: 'UPDATE users SET xp = 230 WHERE username = ?', args: [who] });
  console.log(JSON.stringify({ note: `${who} at 230 xp — next YES (+50ish) crosses 250 → levelup cinematic` }));
} else if (scenario === 'redo-today') {
  // wipe today's check-in and park xp just under the lv2 threshold → next YES = levelup
  const who = process.argv[3] || 'pranav';
  const [u] = await q('SELECT id FROM users WHERE username = ?', who);
  await db.execute({ sql: 'DELETE FROM checkins WHERE user_id = ? AND date = ?', args: [u.id, today()] });
  await db.execute({ sql: 'UPDATE users SET xp = 230 WHERE id = ?', args: [u.id] });
  console.log(JSON.stringify({ note: `${who}: today's check-in wiped, xp=230. next YES crosses 250.` }));
} else if (scenario === 'coins') {
  const who = process.argv[3] || 'pranav';
  await db.execute({ sql: 'UPDATE users SET coins = 2000 WHERE username = ?', args: [who] });
  console.log(JSON.stringify({ note: `${who} has 2000 coins` }));
} else {
  console.log('scenarios: streak-pause [who] | wrapped [who] | near-levelup [who] | coins [who]');
}
db.close();
