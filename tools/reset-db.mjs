// reset-db.mjs — wipes the production Turso database for a clean launch.
// keeps the schema and the VAPID push keys; clears all gameplay data + test accounts.
// usage: node tools/reset-db.mjs <TURSO_PLATFORM_TOKEN>
//   (mints a short-lived DB token, wipes, done — nothing persisted to disk)
import { createClient } from '@libsql/client';

const platformToken = process.argv[2];
if (!platformToken) { console.error('usage: node tools/reset-db.mjs <TURSO_PLATFORM_TOKEN>'); process.exit(1); }

async function turso(path, opts = {}) {
  const res = await fetch('https://api.turso.tech' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + platformToken, 'Content-Type': 'application/json' },
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const orgs = await turso('/v1/organizations');
const slug = (orgs.find ? orgs : orgs.organizations).find(o => o.type === 'personal')?.slug
  || (orgs[0] || orgs.organizations[0]).slug;
const db = (await turso(`/v1/organizations/${slug}/databases/lockedin`)).database;
const host = db.Hostname || db.hostname;
const tok = await turso(`/v1/organizations/${slug}/databases/lockedin/auth/tokens?expiration=1h&authorization=full-access`, { method: 'POST' });

const client = createClient({ url: 'libsql://' + host, authToken: tok.jwt });

// every gameplay table. meta is handled specially to preserve push (VAPID) keys.
const TABLES = [
  'reactions', 'excuse_votes', 'wager_members', 'callouts', 'pot_entries', 'wrapped',
  'messages', 'checkins', 'events', 'hall', 'inventory', 'wagers', 'push_subs', 'tokens', 'users',
];

console.log('connected to', host);
const before = await client.execute('SELECT COUNT(*) AS n FROM users');
console.log('users before reset:', before.rows[0].n);

for (const t of TABLES) {
  await client.execute(`DELETE FROM ${t}`);
  console.log('  cleared', t);
}
// preserve VAPID so push stays stable across restarts; drop everything else (pot cfg, weekly/monthly markers)
await client.execute(`DELETE FROM meta WHERE key NOT IN ('vapid_public','vapid_private')`);
console.log('  cleared meta (kept vapid keys)');
// reset autoincrement so the first real member is user #1
try { await client.execute('DELETE FROM sqlite_sequence'); console.log('  reset id counters'); } catch { /* no sequence yet */ }

const after = await client.execute('SELECT COUNT(*) AS n FROM users');
console.log('users after reset:', after.rows[0].n);
console.log('RESET COMPLETE — clean slate for june 15 launch.');
