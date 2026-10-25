// Değişiklikten önce sayfanın canlıdaki hali diske ve veritabanına yazılır. Uygulama adımı
// geçerli bir yedek satırı görmeden platforma yazmaz; restore komutu da buradan okur.
import path from 'node:path';
import { atomicWrite, readJsonIfComplete } from './fsutil.mjs';
import { canonicalHash } from './content-hash.mjs';
import { nowIso } from '../db/db.mjs';

const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');

export function createBackup(db, dataDir, { pageId, jobId, live }) {
  const contentHash = canonicalHash(live);
  const file = path.join(dataDir, 'backups', safe(pageId), `${nowIso().replace(/[:.]/g, '')}-job${jobId}.json`);
  atomicWrite(file, JSON.stringify({ pageId, jobId, contentHash, savedAt: nowIso(), live }, null, 1));
  const res = db.prepare('INSERT INTO backups(page_id, job_id, file_path, content_hash, created_at) VALUES (?,?,?,?,?)')
    .run(pageId, jobId, file, contentHash, nowIso());
  return Number(res.lastInsertRowid);
}

// Yedek ancak dosyası tam okunabiliyor ve özeti tutuyorsa geçerlidir.
export function loadBackup(db, backupId) {
  const row = backupId ? db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId) : null;
  if (!row) return null;
  const body = readJsonIfComplete(row.file_path);
  if (!body || canonicalHash(body.live) !== row.content_hash) return null;
  return { ...row, live: body.live };
}

export function latestBackupForPage(db, pageId) {
  const rows = db.prepare('SELECT id FROM backups WHERE page_id = ? ORDER BY id DESC').all(pageId);
  for (const r of rows) {
    const b = loadBackup(db, r.id);
    if (b) return b;
  }
  return null;
}
