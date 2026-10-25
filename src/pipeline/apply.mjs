// Onaylanmış işleri platforma taşır: yedek → uygula → doğrula. Her adım kiralı bir durumdan
// geçer; süreç herhangi bir anda ölürse recover.mjs işi güvenli noktaya geri alır.
import { claimNext, transition, getJob } from '../core/jobs.mjs';
import { createBackup, loadBackup } from '../core/backups.mjs';
import { canonicalHash, normalizeHtml } from '../core/content-hash.mjs';
import { fetchText } from '../platforms/http.mjs';
import { recordApplied } from '../core/applied.mjs';
import { atomicWrite } from '../core/fsutil.mjs';
import path from 'node:path';

const OWNER = `apply-${process.pid}`;

function draftContent(job) {
  const d = JSON.parse(job.draft_json);
  return { html: d.html, seoTitle: d.seoTitle, seoDescription: d.seoDescription };
}

// 1) Yedek: sayfanın canlı hali alınır. Taslak üretildikten sonra mağaza sahibi sayfayı elle
// değiştirdiyse taslak eski içeriğe göre yazılmıştır; üzerine yazmak yerine conflict.
async function backupOne(ctx, job) {
  const { db, adapter, config } = ctx;
  if (job.kind === 'create_article') {
    return transition(db, job.id, 'backing_up', 'backed_up', {}, 'yeni yazı: yedeklenecek eski içerik yok');
  }
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(job.page_id);
  const live = await adapter.readPage(page.type, page.external_id);
  if (!live) return transition(db, job.id, 'backing_up', 'failed', { last_error: 'sayfa platformda bulunamadı' });
  const base = JSON.parse(job.draft_json).baseHash;
  if (base && canonicalHash(live) !== base) {
    return transition(db, job.id, 'backing_up', 'conflict', { last_error: 'taslaktan sonra sayfa elle değiştirilmiş' });
  }
  const backupId = createBackup(db, config.dataDir, { pageId: job.page_id, jobId: job.id, live });
  return transition(db, job.id, 'backing_up', 'backed_up', { backup_id: backupId });
}

// 2) Uygula. Yazmadan önce bir kez daha canlıya bakılır (önceki çalışma yazmış olabilir).
async function applyOne(ctx, job) {
  const { db, adapter } = ctx;
  const draft = JSON.parse(job.draft_json);
  if (job.kind === 'create_article') {
    const existing = await adapter.findArticle(draft.handle);
    if (existing) {
      if (canonicalHash(existing) === job.intended_hash) return markApplied(ctx, job, existing.ref);
      // Yazı açılmış ama SEO başlığı/açıklaması yazılmadan kesilmiş: eksik kısmı tamamla.
      if (normalizeHtml(existing.html) === normalizeHtml(draft.html) && adapter.setArticleSeo) {
        await adapter.setArticleSeo(existing.ref.externalId, draft.seoTitle, draft.seoDescription);
        return markApplied(ctx, job, existing.ref);
      }
      return transition(db, job.id, 'applying', 'conflict', { last_error: `"${draft.handle}" adresinde başka bir yazı var` });
    }
    if (draft.imageFile && !draft.imageUrl && adapter.uploadImage) {
      // Görsel bir kez yüklenir; adres taslağa yazılır ki tekrar denemede yeniden yüklenmesin.
      draft.imageUrl = await adapter.uploadImage(draft.imageFile, draft.imageAlt);
      db.prepare('UPDATE jobs SET draft_json = ? WHERE id = ?').run(JSON.stringify(draft), job.id);
    }
    const ref = await adapter.createArticle(draft);
    return markApplied(ctx, job, ref);
  }
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(job.page_id);
  const backup = loadBackup(db, job.backup_id);
  if (!backup) return transition(db, job.id, 'applying', 'failed', { last_error: 'geçerli yedek yok, uygulama reddedildi' });
  const live = await adapter.readPage(page.type, page.external_id);
  const liveHash = canonicalHash(live);
  if (liveHash === job.intended_hash) return markApplied(ctx, job, { externalId: page.external_id, url: page.url });
  if (liveHash !== backup.content_hash) {
    return transition(db, job.id, 'applying', 'conflict', { last_error: 'yedekten sonra sayfa elle değiştirilmiş' });
  }
  await adapter.writePage(page.type, page.external_id, draftContent(job));
  return markApplied(ctx, job, { externalId: page.external_id, url: page.url });
}

function markApplied(ctx, job, ref) {
  const done = transition(ctx.db, job.id, 'applying', 'applied', { result_json: JSON.stringify(ref ?? null) });
  recordApplied(ctx.db, done);
  return done;
}

// 3) Doğrula: API'den okunan içerik bizim yazdığımızla aynı mı, herkese açık sayfa açılıyor ve
// yeni meta açıklamasını gösteriyor mu? CDN önbelleği yüzünden ilk denemede tutmayabilir;
// birkaç tick boyunca yeniden denenir.
async function verifyOne(ctx, job) {
  const { db, adapter } = ctx;
  const ref = JSON.parse(job.result_json || 'null');
  const live = job.kind === 'create_article' ? await adapter.findArticle(JSON.parse(job.draft_json).handle) : await adapter.readLive(db, job);
  if (!live || canonicalHash(live) !== job.intended_hash) {
    return transition(db, job.id, 'verifying', 'verify_failed', { last_error: 'platformdaki içerik yazdığımızla eşleşmiyor' });
  }
  const url = ref?.url || live.ref?.url;
  const { seoDescription } = draftContent(job);
  let publicOk = true;
  let locked = false;
  if (url) {
    try {
      const pageRes = await fetchText(url);
      // Şifreli vitrin (geliştirme mağazası ya da "yakında açılıyor"): dışarıdan görülemez, API doğrulaması yeterli.
      locked = /\/password(\?|$)/.test(pageRes.url || '');
      publicOk = locked || (pageRes.status === 200 && (!seoDescription || normalizeHtml(pageRes.text).includes(normalizeHtml(seoDescription).slice(0, 60))));
    } catch {
      publicOk = false;
    }
  }
  if (!publicOk && job.attempts < 3) return transition(db, job.id, 'verifying', 'applied', {}, 'herkese açık sayfa henüz güncellenmemiş, sonra tekrar');
  const note = locked ? 'API doğrulandı; vitrin şifreli olduğu için dışarıdan bakılamadı' : publicOk ? 'API + herkese açık sayfa doğrulandı' : 'API doğrulandı; herkese açık sayfa önbellekte';
  return transition(db, job.id, 'verifying', 'verified', {}, note);
}

async function drain(ctx, from, to, fn) {
  const done = [];
  const seen = [];
  for (let job; (job = claimNext(ctx.db, { from, to, owner: OWNER, skip: seen })); ) {
    seen.push(job.id);
    try {
      done.push((await fn(ctx, job)).state);
    } catch (err) {
      // Ağ hatası vb.: kira dolunca recover işi geri alır; burada kirayı hemen bırakıp hata yazıyoruz.
      const back = { backing_up: 'approved', applying: 'backed_up', verifying: 'applied' }[to];
      const cur = getJob(ctx.db, job.id);
      if (cur.state === to) {
        if (to === 'applying') {
          // Yazma isteği gitmiş olabilir: geri almadan önce recover'ın mutabakatına bırak.
          ctx.db.prepare("UPDATE jobs SET lease_until = '1970-01-01T00:00:00.000Z', last_error = ? WHERE id = ?").run(String(err.message), job.id);
        } else {
          transition(ctx.db, job.id, to, back, { last_error: String(err.message).slice(0, 500) });
        }
      }
      ctx.log('apply_step_failed', { job: job.id, step: to, error: String(err.message).slice(0, 300) });
      done.push('error');
    }
  }
  return done;
}

export async function routeExports(ctx) {
  // Platformun yazamadığı sayfa tipleri dışa aktarmaya düşer (kopyala-yapıştır dosyası).
  const caps = ctx.adapter.capabilities();
  const rows = ctx.db.prepare("SELECT j.*, p.type, p.handle AS page_handle, p.title AS page_title FROM jobs j LEFT JOIN pages p ON p.id = j.page_id WHERE j.state = 'approved'").all();
  let n = 0;
  for (const r of rows) {
    const writable = r.kind === 'create_article' ? caps.article?.create : caps[r.type]?.body;
    if (!writable) {
      const d = JSON.parse(r.draft_json);
      const name = `${r.type || 'blog'}-${r.page_handle || d.handle || r.id}`;
      atomicWrite(path.join(ctx.config.dataDir, 'export', `${name}.html`), d.html);
      atomicWrite(path.join(ctx.config.dataDir, 'export', `${name}.txt`),
        [`Sayfa: ${r.page_title || d.title}`, `SEO başlığı: ${d.seoTitle}`, `Meta açıklama: ${d.seoDescription}`, '', 'İçerik HTML olarak yanındaki .html dosyasında; panelde "HTML/kaynak" görünümüne yapıştırın.'].join('\n'));
      transition(ctx.db, r.id, 'approved', 'export', {}, 'platform bu alanı API ile yazamıyor → data/export');
      n++;
    }
  }
  return n;
}

export async function applyApproved(ctx) {
  const exported = await routeExports(ctx);
  const backups = await drain(ctx, 'approved', 'backing_up', backupOne);
  const applied = await drain(ctx, 'backed_up', 'applying', applyOne);
  const verified = await drain(ctx, 'applied', 'verifying', verifyOne);
  return { exported, backups: backups.length, applied: applied.length, verified: verified.length };
}
