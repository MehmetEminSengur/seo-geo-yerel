// SQLite bağlantısı. Tek doğruluk kaynağı burası: her durum değişikliği bir transaction içinde
// yazılır, WAL + synchronous=FULL sayesinde ani kapanmada son commit kaybolmaz.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = '1';

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'seo.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec(readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run('schema_version', SCHEMA_VERSION);
  return db;
}

// BEGIN IMMEDIATE: yazma kilidini en başta alır, iki süreç aynı işi aynı anda kapamaz.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
