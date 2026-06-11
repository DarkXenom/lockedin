// db.js — SQLite layer (node:sqlite, zero native deps)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'lockedin.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pin_hash      TEXT NOT NULL,
    pin_salt      TEXT NOT NULL,
    token         TEXT,
    joined_date   TEXT NOT NULL,            -- YYYY-MM-DD, reconciliation starts here
    created_at    INTEGER NOT NULL,         -- epoch ms
    xp            INTEGER NOT NULL DEFAULT 0,
    coins         INTEGER NOT NULL DEFAULT 0,
    aura          INTEGER NOT NULL DEFAULT 100,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    double_xp_date TEXT,                    -- YYYY-MM-DD the 2x XP boost applies
    last_seen     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    date        TEXT NOT NULL,              -- YYYY-MM-DD
    status      TEXT NOT NULL CHECK(status IN ('yes','no','rest','skip')),
    description TEXT NOT NULL DEFAULT '',
    excuse      TEXT NOT NULL DEFAULT '',
    auto        INTEGER NOT NULL DEFAULT 0, -- 1 = auto-skip (ghosted the app)
    frozen      INTEGER NOT NULL DEFAULT 0, -- 1 = streak freeze consumed, no penalty
    over_quota  INTEGER NOT NULL DEFAULT 0, -- 1 = was a rest day past the 2/week quota
    excuse_capped INTEGER NOT NULL DEFAULT 0,
    xp_delta    INTEGER NOT NULL DEFAULT 0,
    aura_delta  INTEGER NOT NULL DEFAULT 0,
    coin_delta  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    UNIQUE(user_id, date)
  );

  CREATE TABLE IF NOT EXISTS excuse_votes (
    checkin_id  INTEGER NOT NULL REFERENCES checkins(id),
    voter_id    INTEGER NOT NULL REFERENCES users(id),
    valid       INTEGER NOT NULL,           -- 1 = valid, 0 = cap
    UNIQUE(checkin_id, voter_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),  -- NULL = THE REF (system)
    type        TEXT NOT NULL DEFAULT 'user' CHECK(type IN ('user','system','card')),
    text        TEXT NOT NULL DEFAULT '',
    meta        TEXT NOT NULL DEFAULT '{}',    -- JSON
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reactions (
    message_id  INTEGER NOT NULL REFERENCES messages(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    emoji       TEXT NOT NULL,
    UNIQUE(message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    user_id     INTEGER NOT NULL REFERENCES users(id),
    item_id     TEXT NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL,              -- checkin_yes, skip, milestone, levelup, purchase, wager_loss...
    xp_delta    INTEGER NOT NULL DEFAULT 0,
    aura_delta  INTEGER NOT NULL DEFAULT 0,
    coin_delta  INTEGER NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hall (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL CHECK(kind IN ('shame','fame')),
    week        TEXT NOT NULL,              -- e.g. 2026-W24
    reason      TEXT NOT NULL,              -- skip, rest_abuse, streak_lost, capped, top_xp, perfect_week...
    caption     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wagers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id  INTEGER NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    stake       TEXT NOT NULL,              -- free text: "loser buys protein"
    deadline    TEXT NOT NULL,              -- YYYY-MM-DD
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled')),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wager_members (
    wager_id    INTEGER NOT NULL REFERENCES wagers(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    is_loser    INTEGER NOT NULL DEFAULT 0,
    paid        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(wager_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS callouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id   INTEGER NOT NULL REFERENCES users(id),
    target_id   INTEGER NOT NULL REFERENCES users(id),
    week        TEXT NOT NULL,              -- rate limit: one per caller per week
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','expired')),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tokens (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_hall_week ON hall(week, kind);
`);

// ---- tiny helpers ----
export const q = {
  get: (sql, ...params) => db.prepare(sql).get(...params),
  all: (sql, ...params) => db.prepare(sql).all(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};

export function getMeta(key, fallback = null) {
  const row = q.get('SELECT value FROM meta WHERE key = ?', key);
  return row ? row.value : fallback;
}
export function setMeta(key, value) {
  q.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
