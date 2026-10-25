// Açılışta (her tick'ten önce) çalışır. Kirası dolmuş, yani yarıda kalmış işleri güvenli bir
// noktaya geri alır. En kritik dal `applying`: platforma yazma isteği gitmiş ama cevabı
// kaydedilememiş olabilir. Platformdaki canlı içerik okunup karar verilir:
//   canlı = yazmak istediğimiz   → applied (yazma gerçekleşmiş)
//   canlı = yedekteki eski hali  → backed_up (yazma hiç olmamış, yeniden denenir)
//   ikisi de değil              → conflict (biri elle değiştirmiş; asla üzerine yazılmaz)
import { expiredLeases, transition } from './jobs.mjs';
import { loadBackup } from './backups.mjs';
import { canonicalHash, normalizeHtml } from './content-hash.mjs';

// Yeni yazı açılmış, gövdesi bizimki ama SEO alanları yazılmadan kesilmiş → uygulama adımı tamamlar.
const sameBody = (live, job) => normalizeHtml(live.html) === normalizeHtml(JSON.parse(job.draft_json || '{}').html);
import { recordApplied } from './applied.mjs';

const recoverers = [];
// Platform adaptörleri kendi kurtarma adımlarını ekleyebilir (ör. token journal'ı).
export function registerRecoverer(fn) {
  recoverers.push(fn);
}

export async function recover(db, { adapter, log = () => {} } = {}) {
  const summary = { requeued: 0, reconciled_applied: 0, reconciled_retry: 0, conflicts: 0, skipped_offline: 0 };
  for (const fn of recoverers) await fn({ db, log });

  for (const job of expiredLeases(db)) {
    const note = 'recover: kira süresi doldu';
    if (job.state === 'generating') {
      transition(db, job.id, 'generating', 'planned', {}, note);
      summary.requeued++;
    } else if (job.state === 'backing_up') {
      transition(db, job.id, 'backing_up', loadBackup(db, job.backup_id) ? 'backed_up' : 'approved', {}, note);
      summary.requeued++;
    } else if (job.state === 'verifying') {
      transition(db, job.id, 'verifying', 'applied', {}, note);
      summary.requeued++;
    } else if (job.state === 'applying') {
      if (!adapter) {
        summary.skipped_offline++;
        continue;
      }
      let live;
      try {
        live = await adapter.readLive(db, job);
      } catch (err) {
        log('recover_read_failed', { job: job.id, error: String(err.message || err) });
        summary.skipped_offline++;
        continue; // çevrimdışı: bir sonraki tick yeniden dener, hiçbir şey yazılmaz
      }
      const liveHash = live ? canonicalHash(live) : null;
      const backup = loadBackup(db, job.backup_id);
      if (liveHash && liveHash === job.intended_hash) {
        recordApplied(db, transition(db, job.id, 'applying', 'applied', { result_json: JSON.stringify(live.ref ?? null) }, 'recover: yazma gerçekleşmiş'));
        summary.reconciled_applied++;
      } else if ((backup && liveHash === backup.content_hash) || (job.kind === 'create_article' && (!live || sameBody(live, job)))) {
        transition(db, job.id, 'applying', 'backed_up', {}, 'recover: yazma gerçekleşmemiş, yeniden denenecek');
        summary.reconciled_retry++;
      } else {
        transition(db, job.id, 'applying', 'conflict', { last_error: 'canlı içerik ne yedekle ne taslakla eşleşiyor' }, 'recover: elle değişiklik');
        summary.conflicts++;
      }
    }
  }
  if (Object.values(summary).some(Boolean)) log('recover', summary);
  return summary;
}
