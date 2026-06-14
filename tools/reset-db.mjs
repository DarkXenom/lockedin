// reset-db.mjs — wipes the production Turso database for a clean launch.
// keeps the schema and the VAPID push keys; clears all gameplay data + test accounts.
//
// usage: node tools/reset-db.mjs <TURSO_PLATFORM_TOKEN> [WIPE]
//   without WIPE  -> dry run: prints the exact target + row counts, deletes nothing.
//   with    WIPE  -> performs the wipe, but ONLY if the resolved host matches
//                    EXPECTED_HOST below (guards against hitting the wrong db/org).
import { createClient } from '@libsql/client';

const platformToken = process.argv[2];
const confirm = process.argv[3];
if (!platformToken) { console.error('usage: node tools/reset-db.mjs <TURSO_PLATFORM_TOKEN> [WIPE]'); process.exit(1); }

// the one and only database this script is ever allowed to touch.
const EXPECTED_HOST = 'lockedin-darkxenom.aws-us-east-1.turso.io';
const DB_NAME = 'lockedin';

async function turso(path, opts = {}) {
  const res = await fetch('https://api.turso.tech' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + platformToken, 'Content-Type': 'application/json' },
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const orgsRaw = await turso('/v1/organizations');
const orgList = orgsRaw.organizations || orgsRaw;
const org = orgList.find(o => o.type === 'personal') || orgList[0];
if (!org) { console.error('no turso organization found for this token'); process.exit(1); }
const slug = org.slug;
const db = (await turso(`/v1/organizations/${slug}/databases/${DB_NAME}`)).database;
const host = db.Hostname || db.hostname;

console.log('target org : ' + slug);
console.log('target db  : ' + DB_NAME);
console.log('target host: ' + host);

// hard guard: refuse to touch anything that isn't the known production db.
if (host !== EXPECTED_HOST) {
  console.error(`\nABORT: resolved host does not match EXPECTED_HOST (${EXPECTED_HOST}).`);
  console.error('refusing to wipe an unexpected database. nothing was changed.');
  process.exit(1);
}

const tok = await turso(`/v1/organizations/${slug}/databases/${DB_NAME}/auth/tokens?expiration=1h&authorization=full-access`, { method: 'POST' });
const client = createClient({ url: 'libsql://' + host, authToken: tok.jwt });

// child tables before parents (safe whether or not FK enforcement is on). meta handled specially.
const TABLES = [
  'reactions', 'excuse_votes', 'wager_members', 'callouts', 'pot_entries', 'wrapped',
  'messages', 'checkins', 'events', 'hall', 'inventory', 'wagers', 'push_subs', 'tokens', 'users',
];

const counts = {};
for (const t of TABLES) counts[t] = (await client.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
console.log('\ncurrent rows: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '));

if (confirm !== 'WIPE') {
  console.log('\nDRY RUN. re-run with the word WIPE as the 2nd argument to actually reset.');
  console.log('  node tools/reset-db.mjs <token> WIPE');
  process.exit(0);
}

console.log('\nWIPE confirmed. clearing...');
for (const t of TABLES) {
  await client.execute(`DELETE FROM ${t}`);
  console.log('  cleared', t);
}
await client.execute(`DELETE FROM meta WHERE key NOT IN ('vapid_public','vapid_private')`);
console.log('  cleared meta (kept vapid keys)');
try { await client.execute('DELETE FROM sqlite_sequence'); console.log('  reset id counters'); } catch { /* no sequence yet */ }

const after = (await client.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n;
console.log('\nusers after reset:', after);
console.log('RESET COMPLETE — clean slate for june 15 launch.');
