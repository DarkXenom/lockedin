// db.js — libsql layer. file: locally, libsql://…turso.io in production.
// Same async API either way: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to go cloud.
import { createClient } from '@libsql/client';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, 'lockedin.db').replace(/\\/g, '/')}`;
if (url.startsWith('file:') && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

export async function migrate() {
  if (url.startsWith('file:')) {
    try { await db.execute('PRAGMA journal_mode = WAL'); } catch { /* fine */ }
  }
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pin_hash      TEXT NOT NULL,
      pin_salt      TEXT NOT NULL,
      tz            TEXT NOT NULL DEFAULT 'UTC',
      joined_date   TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      xp            INTEGER NOT NULL DEFAULT 0,
      coins         INTEGER NOT NULL DEFAULT 0,
      aura          INTEGER NOT NULL DEFAULT 100,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      double_xp_date TEXT,
      last_seen     INTEGER NOT NULL DEFAULT 0,
      push_enabled  INTEGER NOT NULL DEFAULT 1,
      last_reminded TEXT NOT NULL DEFAULT '',
      signed_at     INTEGER,
      photo_before  TEXT,
      photo_before_at INTEGER,
      photo_after   TEXT,
      photo_after_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS checkins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      date        TEXT NOT NULL,
      status      TEXT NOT NULL CHECK(status IN ('yes','no','rest','skip')),
      description TEXT NOT NULL DEFAULT '',
      excuse      TEXT NOT NULL DEFAULT '',
      auto        INTEGER NOT NULL DEFAULT 0,
      frozen      INTEGER NOT NULL DEFAULT 0,
      over_quota  INTEGER NOT NULL DEFAULT 0,
      excuse_capped INTEGER NOT NULL DEFAULT 0,
      xp_delta    INTEGER NOT NULL DEFAULT 0,
      aura_delta  INTEGER NOT NULL DEFAULT 0,
      coin_delta  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      UNIQUE(user_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS excuse_votes (
      checkin_id  INTEGER NOT NULL REFERENCES checkins(id),
      voter_id    INTEGER NOT NULL REFERENCES users(id),
      valid       INTEGER NOT NULL,
      UNIQUE(checkin_id, voter_id)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id),
      type        TEXT NOT NULL DEFAULT 'user' CHECK(type IN ('user','system','card','wrapped')),
      text        TEXT NOT NULL DEFAULT '',
      meta        TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS reactions (
      message_id  INTEGER NOT NULL REFERENCES messages(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      emoji       TEXT NOT NULL,
      UNIQUE(message_id, user_id, emoji)
    )`,
    `CREATE TABLE IF NOT EXISTS inventory (
      user_id     INTEGER NOT NULL REFERENCES users(id),
      item_id     TEXT NOT NULL,
      qty         INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      kind        TEXT NOT NULL,
      xp_delta    INTEGER NOT NULL DEFAULT 0,
      aura_delta  INTEGER NOT NULL DEFAULT 0,
      coin_delta  INTEGER NOT NULL DEFAULT 0,
      note        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS hall (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      kind        TEXT NOT NULL CHECK(kind IN ('shame','fame')),
      week        TEXT NOT NULL,
      reason      TEXT NOT NULL,
      caption     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wagers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id  INTEGER NOT NULL REFERENCES users(id),
      title       TEXT NOT NULL,
      stake       TEXT NOT NULL,
      deadline    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled')),
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wager_members (
      wager_id    INTEGER NOT NULL REFERENCES wagers(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      is_loser    INTEGER NOT NULL DEFAULT 0,
      paid        INTEGER NOT NULL DEFAULT 0,
      UNIQUE(wager_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS callouts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_id   INTEGER NOT NULL REFERENCES users(id),
      target_id   INTEGER NOT NULL REFERENCES users(id),
      week        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','expired')),
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tokens (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS push_subs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pot_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      amount      INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      date        TEXT NOT NULL,
      settled     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wrapped (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      month       TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE(user_id, month)
    )`,
    `CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_hall_week ON hall(week, kind)`,
  ];
  for (const sql of ddl) await db.execute(sql);
}

// ---- tiny async helpers ----
export const q = {
  get: async (sql, ...args) => (await db.execute({ sql, args })).rows[0] ?? null,
  all: async (sql, ...args) => (await db.execute({ sql, args })).rows,
  run: async (sql, ...args) => {
    const r = await db.execute({ sql, args });
    return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
  },
};

export async function getMeta(key, fallback = null) {
  const row = await q.get('SELECT value FROM meta WHERE key = ?', key);
  return row ? row.value : fallback;
}
export async function setMeta(key, value) {
  await q.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
