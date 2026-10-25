// Bir iş "uygulandı" olduğunda yerel sayfa kaydı da güncellenir: yeni içerik, özet ve 42 gün
// kilidinin başladığı tarih. Hem normal uygulama hem de açılıştaki mutabakat (recover) bunu çağırır;
// aksi halde çökme sonrası toparlanan bir sayfa kilitsiz kalır ve yeniden yazılabilirdi.
import { nowIso } from '../db/db.mjs';

export function recordApplied(db, job) {
  if (!job.page_id) return;
  const d = JSON.parse(job.draft_json || '{}');
  db.prepare('UPDATE pages SET body_html = ?, seo_title = ?, seo_description = ?, content_hash = ?, last_applied_at = ?, target_keyword = coalesce(?, target_keyword) WHERE id = ?')
    .run(d.html ?? '', d.seoTitle ?? null, d.seoDescription ?? null, job.intended_hash, nowIso(), job.target_keyword, job.page_id);
}
