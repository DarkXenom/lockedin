// timewarp.mjs — backdates test data to exercise reconcile, quota, and expiry paths.
// run ONLY with the server stopped.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/lockedin.db');

const marcus = db.prepare('SELECT id FROM users WHERE username = ?').get('marcus');
const pranav = db.prepare('SELECT id FROM users WHERE username = ?').get('pranav');

// 1. pranav gets shop money (audit only)
db.prepare('UPDATE users SET coins = 2000 WHERE id = ?').run(pranav.id);

// 2. marcus joined monday, took "rest days" mon+tue, ghosted wednesday
db.prepare('UPDATE users SET joined_date = ? WHERE id = ?').run('2026-06-08', marcus.id);
const ins = db.prepare(
  `INSERT INTO checkins (user_id, date, status, description, excuse, auto, frozen, over_quota, xp_delta, aura_delta, coin_delta, created_at)
   VALUES (?,?,?,'','',0,0,0,15,0,5,?)`);
ins.run(marcus.id, '2026-06-08', 'rest', Date.now() - 3 * 86400000);
ins.run(marcus.id, '2026-06-09', 'rest', Date.now() - 2 * 86400000);
// 06-10 left missing — reconcile should auto-skip it

// 3. backdate pranav's open callout on rohan past the 48h window
db.prepare(`UPDATE callouts SET created_at = ? WHERE status = 'open'`).run(Date.now() - 49 * 3600000);

console.log(JSON.stringify({
  pranavCoins: db.prepare('SELECT coins FROM users WHERE id = ?').get(pranav.id).coins,
  marcusCheckins: db.prepare('SELECT date, status FROM checkins WHERE user_id = ? ORDER BY date').all(marcus.id),
  callouts: db.prepare('SELECT id, status, created_at FROM callouts').all(),
}, null, 1));
db.close();
