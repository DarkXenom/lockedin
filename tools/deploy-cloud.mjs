// deploy-cloud.mjs — creates the Turso database and the Render web service via their APIs.
// usage: node tools/deploy-cloud.mjs <TURSO_PLATFORM_TOKEN> <RENDER_API_KEY>
// writes nothing secret to the repo; tokens stay in argv + Render env config.
const [tursoToken, renderKey] = process.argv.slice(2);
if (!tursoToken || !renderKey) {
  console.error('usage: node tools/deploy-cloud.mjs <TURSO_PLATFORM_TOKEN> <RENDER_API_KEY>');
  process.exit(1);
}
const REPO = 'https://github.com/DarkXenom/lockedin';
const INVITE_CODE = 'shredpact1220';

async function api(base, path, token, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}
const turso = (path, opts) => api('https://api.turso.tech', path, tursoToken, opts);
const render = (path, opts) => api('https://api.render.com', path, renderKey, opts);

// ============ TURSO ============
console.log('[1/4] turso: locating organization…');
const orgs = await turso('/v1/organizations');
const org = (orgs.find ? orgs : orgs.organizations || []).find(o => o.type === 'personal') || (orgs.find ? orgs[0] : (orgs.organizations || [])[0]);
if (!org) throw new Error('no turso organization found');
const slug = org.slug;
console.log('      org:', slug);

console.log('[2/4] turso: creating database "lockedin"…');
let groups = await turso(`/v1/organizations/${slug}/groups`).catch(() => ({ groups: [] }));
groups = groups.groups || groups;
let group = groups[0] && groups[0].name;
if (!group) {
  // co-locate with the render service (virginia) — server↔db latency dominates request time
  await turso(`/v1/organizations/${slug}/groups`, { method: 'POST', body: { name: 'default', location: 'aws-us-east-1' } });
  group = 'default';
}
let db;
try {
  db = await turso(`/v1/organizations/${slug}/databases`, { method: 'POST', body: { name: 'lockedin', group } });
  db = db.database || db;
} catch (e) {
  if (!String(e.message).includes('409') && !String(e.message).toLowerCase().includes('already')) throw e;
  db = (await turso(`/v1/organizations/${slug}/databases/lockedin`)).database;
}
const dbUrl = 'libsql://' + (db.Hostname || db.hostname);
console.log('      db url:', dbUrl);

console.log('      minting database token…');
const tok = await turso(`/v1/organizations/${slug}/databases/lockedin/auth/tokens?expiration=never&authorization=full-access`, { method: 'POST' });
const dbToken = tok.jwt;
if (!dbToken) throw new Error('no jwt in token response');
console.log('      token: ok (' + dbToken.slice(0, 12) + '…)');

// ============ RENDER ============
console.log('[3/4] render: locating owner…');
const owners = await render('/v1/owners?limit=20');
const owner = (owners[0] && (owners[0].owner || owners[0]));
if (!owner || !owner.id) throw new Error('no render owner found — is the api key valid?');
console.log('      owner:', owner.id, owner.name || '');

console.log('[4/4] render: creating web service "lockedin"…');
let service;
try {
  const created = await render('/v1/services', {
    method: 'POST',
    body: {
      type: 'web_service',
      name: 'lockedin',
      ownerId: owner.id,
      repo: REPO,
      branch: 'master',
      autoDeploy: 'yes',
      envVars: [
        { key: 'TURSO_DATABASE_URL', value: dbUrl },
        { key: 'TURSO_AUTH_TOKEN', value: dbToken },
        { key: 'INVITE_CODE', value: INVITE_CODE },
      ],
      serviceDetails: {
        env: 'node',
        plan: 'free',
        region: 'virginia',
        healthCheckPath: '/api/config',
        envSpecificDetails: {
          buildCommand: 'npm install',
          startCommand: 'npm start',
        },
      },
    },
  });
  service = created.service || created;
} catch (e) {
  console.error('      service create failed:', e.message);
  throw e;
}
console.log('      service id:', service.id);
const liveUrl = (service.serviceDetails && service.serviceDetails.url) || `https://${service.slug || 'lockedin'}.onrender.com`;
console.log('');
console.log('DEPLOY STARTED');
console.log('live url (once built):', liveUrl);
console.log('invite code:', INVITE_CODE);
