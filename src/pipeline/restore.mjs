// Geri alma: bir işin uyguladığı değişikliği yedekteki eski haline döndürür. Sayfa bu arada elle
// değiştirildiyse (canlı içerik bizim yazdığımız değilse) --zorla verilmeden dokunmaz.
import { loadBackup } from '../core/backups.mjs';
import { canonicalHash } from '../core/content-hash.mjs';
import { nowIso } from '../db/db.mjs';

export async function restoreJob(ctx, jobId, { force = false } = {}) {
  const { db, adapter } = ctx;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`iş ${jobId} yok`);
  if (job.kind !== 'update_page') throw new Error('yalnız sayfa güncellemeleri geri alınabilir; yeni blog yazısını platform panelinden silin');
  const backup = loadBackup(db, job.backup_id);
  if (!backup) throw new Error('bu işin geçerli bir yedeği yok');
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(job.page_id);
  const live = await adapter.readPage(page.type, page.external_id);
  const liveHash = canonicalHash(live);
  if (liveHash === backup.content_hash) return { status: 'zaten eski halinde' };
  if (liveHash !== job.intended_hash && !force) {
    throw new Error('sayfa bu işten sonra elle değiştirilmiş; yine de geri almak için --zorla ekleyin');
  }
  await adapter.writePage(page.type, page.external_id, backup.live);
  db.prepare('UPDATE pages SET body_html = ?, seo_title = ?, seo_description = ?, content_hash = ? WHERE id = ?')
    .run(backup.live.html, backup.live.seoTitle, backup.live.seoDescription, backup.content_hash, page.id);
  db.prepare('INSERT INTO job_events(job_id, from_state, to_state, note, at) VALUES (?,?,?,?,?)').run(job.id, job.state, job.state, `geri alındı (yedek #${backup.id})`, nowIso());
  return { status: 'geri alındı', page: page.handle, backup: backup.id };
}
