// push.js — web push. the ref, but in your pocket.
import webpush from 'web-push';
import { q, getMeta, setMeta } from './db.js';
import { localDate, localHM, validTz } from './game.js';

let vapidPublic = null;

export async function initPush() {
  vapidPublic = await getMeta('vapid_public');
  let vapidPrivate = await getMeta('vapid_private');
  if (!vapidPublic || !vapidPrivate) {
    const keys = webpush.generateVAPIDKeys();
    vapidPublic = keys.publicKey;
    vapidPrivate = keys.privateKey;
    await setMeta('vapid_public', vapidPublic);
    await setMeta('vapid_private', vapidPrivate);
  }
  webpush.setVapidDetails('mailto:squad@lockedin.local', vapidPublic, vapidPrivate);
  return vapidPublic;
}
export function vapidPublicKey() { return vapidPublic; }

export async function saveSubscription(userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys) throw new Error('bad subscription');
  await q.run(
    `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}
export async function removeSubscription(endpoint) {
  await q.run('DELETE FROM push_subs WHERE endpoint = ?', endpoint);
}

// fire-and-forget — never let a push failure break a request
export async function pushToUser(userId, body, { title = 'the ref', tag = 'ref' } = {}) {
  try {
    const user = await q.get('SELECT push_enabled FROM users WHERE id = ?', userId);
    if (!user || !user.push_enabled) return;
    const subs = await q.all('SELECT * FROM push_subs WHERE user_id = ?', userId);
    const payload = JSON.stringify({ title, body, tag });
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await removeSubscription(s.endpoint);
      }
    }
  } catch (err) { console.error('push failed:', err.message); }
}
export function pushMany(pushes) {
  for (const p of pushes || []) pushToUser(p.userId, p.body); // intentionally not awaited
}

// ============================================================
// DAILY REMINDER — 8pm in each member's own timezone if they
// haven't answered the daily question. one per day. deadpan.
// ============================================================
export async function reminderTick() {
  const users = await q.all('SELECT * FROM users WHERE push_enabled = 1');
  for (const u of users) {
    const tz = validTz(u.tz);
    const hm = localHM(tz);
    if (hm < '20:00' || hm >= '20:30') continue;
    const today = localDate(tz);
    if (u.last_reminded === today) continue;
    const c = await q.get('SELECT 1 FROM checkins WHERE user_id = ? AND date = ?', u.id, today);
    if (c) continue;
    await q.run('UPDATE users SET last_reminded = ? WHERE id = ?', today, u.id);
    const body = u.current_streak > 0
      ? `your ${u.current_streak}-day streak dies at midnight. just so you know.`
      : 'no check-in yet today. the daily question is still on the table.';
    pushToUser(u.id, body, { tag: 'reminder' });
  }
}
