import Database from 'better-sqlite3'
import path from 'node:path'

const DB_PATH = process.env['HUB_DB_PATH'] ?? path.join(process.cwd(), 'hub.db')

export const db = new Database(DB_PATH)

// WAL mode for concurrent reads during scanning
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS hub_tickets (
    ticket_id     TEXT PRIMARY KEY,
    event_id      TEXT NOT NULL,
    totp_secret   TEXT NOT NULL,  -- plaintext in hub (decrypted at sync time)
    buyer_name    TEXT NOT NULL,
    type_name     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'issued',
    synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hub_redemptions (
    ticket_id   TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    door_label  TEXT NOT NULL,
    scanned_at  TEXT NOT NULL,
    synced      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS hub_revocations (
    ticket_id   TEXT PRIMARY KEY,
    revoked_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hub_orders (
    order_id    TEXT PRIMARY KEY,
    station     TEXT NOT NULL,
    table_label TEXT,
    token       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'paid',
    items       TEXT NOT NULL,  -- JSON
    created_at  TEXT NOT NULL,
    synced      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS hub_devices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    key_hash    TEXT NOT NULL,
    revoked_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    direction   TEXT NOT NULL,  -- 'push' | 'pull'
    type        TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
    error       TEXT
  );
`)
