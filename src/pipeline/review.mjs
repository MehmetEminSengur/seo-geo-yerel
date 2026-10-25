// Önizleme raporu ve onay. Rapor tek bir HTML dosyası: her iş için önce/sonra, Google'da nasıl
// görüneceği, uyarılar ve reddedilenlerin nedenleri. Onay komut satırından ya da ajandan verilir.
import path from 'node:path';
import { transition } from '../core/jobs.mjs';
import { atomicWrite } from '../core/fsutil.mjs';
import { listQueue, doneFileFor } from '../engines/image/index.mjs';
import { readFileSync, unlinkSync } from 'node:fs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const frame = (html) => `<iframe sandbox srcdoc="${esc(`<meta charset=utf-8><style>body{font:15px/1.55 system-ui;margin:12px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}blockquote{border-left:3px solid #c8a46a;margin:0 0 12px;padding:4px 12px;background:#faf6ef}</style>${html || '<p><em>(boş)</em></p>'}`)}"></iframe>`;

function serp(title, url, desc) {
  return `<div class="serp"><div class="u">${esc(url || '')}</div><div class="t">${esc(title || '(başlık yok)')}</div><div class="d">${esc(desc || '(açıklama yok)')}</div></div>`;
}

export function writeReport(ctx) {
  const { db, config } = ctx;
  const rows = db.prepare(`SELECT j.*, p.title AS page_title, p.url, p.body_html, p.seo_title AS old_title, p.seo_description AS old_desc, p.type AS page_type
    FROM jobs j LEFT JOIN pages p ON p.id = j.page_id WHERE j.state IN ('awaiting_approval','rejected','conflict','awaiting_image','verify_failed') ORDER BY j.state, j.id`).all();
  const cards = rows.map((r) => {
    const d = JSON.parse(r.draft_json || '{}');
    const v = d.validation || { errors: [], warnings: [] };
    const name = r.page_title || d.title || r.target_keyword;
    const badges = [...(v.errors || []).map((e) => `<li class="err">${esc(e)}</li>`), ...(v.warnings || []).map((w) => `<li class="warn">${esc(w)}</li>`)].join('');
    const isNew = r.kind === 'create_article';
    return `<section class="card ${r.state}">
  <h2>#${r.id} · ${esc(name)} <span class="state">${esc(r.state)}</span></h2>
  <p class="meta">${isNew ? 'Yeni blog yazısı' : esc(r.page_type)} · hedef kelime: <b>${esc(r.target_keyword || '-')}</b>${r.last_error ? ` · <span class="err">${esc(r.last_error)}</span>` : ''}</p>
  ${badges ? `<ul class="checks">${badges}</ul>` : ''}
  <div class="cols">
    <div><h3>Önce</h3>${isNew ? '<p><em>Yeni yazı</em></p>' : serp(r.old_title, r.url, r.old_desc) + frame(r.body_html)}</div>
    <div><h3>Sonra</h3>${serp(d.seoTitle, r.url || d.handle, d.seoDescription)}${d.imageUrl ? `<img class="hero" src="${esc(d.imageUrl)}" alt="${esc(d.imageAlt)}">` : ''}${frame(d.html)}</div>
  </div>
</section>`;
  }).join('\n');
  const counts = db.prepare('SELECT state, count(*) n FROM jobs GROUP BY state').all().map((c) => `${c.state}: ${c.n}`).join(' · ');
  const html = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO/GEO önizleme</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f4efe6;color:#222}
h1{margin:0 0 4px} .sum{color:#555;margin-bottom:16px}
.card{background:#fff;border-radius:10px;padding:16px;margin:0 0 18px;box-shadow:0 1px 3px #0001}
.card.rejected,.card.conflict,.card.verify_failed{border-left:5px solid #c0392b}.card.awaiting_approval{border-left:5px solid #2e7d32}
.state{font-size:12px;background:#eee;border-radius:4px;padding:2px 6px;vertical-align:middle}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.cols{grid-template-columns:1fr}}
iframe{width:100%;height:520px;border:1px solid #ddd;border-radius:6px;background:#fff}
.serp{border:1px solid #e3e3e3;border-radius:8px;padding:10px;margin-bottom:8px}.serp .u{color:#1a6b2e;font-size:12px;word-break:break-all}.serp .t{color:#1a0dab;font-size:18px}.serp .d{color:#444;font-size:13px}
.checks{margin:8px 0;padding-left:18px}.err{color:#b00020}.warn{color:#9a6700}.hero{max-width:100%;border-radius:6px;margin-bottom:8px}
code{background:#eee;padding:1px 4px;border-radius:3px}
</style>
<h1>SEO/GEO önizleme</h1>
<p class="sum">${esc(counts)}<br>Onaylamak için: <code>node bin/seo-geo.mjs approve &lt;numara&gt;</code> ya da <code>approve --hepsi</code> · Reddetmek: <code>reject &lt;numara&gt;</code></p>
${cards || '<p>Onay bekleyen iş yok.</p>'}
</html>`;
  const file = path.join(config.dataDir, 'rapor', 'onizleme.html');
  atomicWrite(file, html);
  return { file, count: rows.length };
}

export function approve(ctx, ids, { all = false } = {}) {
  const rows = all
    ? ctx.db.prepare("SELECT id FROM jobs WHERE state = 'awaiting_approval'").all().map((r) => r.id)
    : ids.map(Number);
  const done = [];
  for (const id of rows) {
    try {
      transition(ctx.db, id, 'awaiting_approval', 'approved', {}, 'kullanıcı onayı');
      done.push(id);
    } catch (err) {
      ctx.log('approve_skipped', { job: id, error: err.message });
    }
  }
  return done;
}

export function reject(ctx, ids) {
  const done = [];
  for (const id of ids.map(Number)) {
    const job = ctx.db.prepare('SELECT state FROM jobs WHERE id = ?').get(id);
    if (!job) continue;
    const to = ['awaiting_approval'].includes(job.state) ? 'rejected' : 'cancelled';
    try {
      transition(ctx.db, id, job.state, to, {}, 'kullanıcı reddetti');
      done.push(id);
    } catch (err) {
      ctx.log('reject_skipped', { job: id, error: err.message });
    }
  }
  return done;
}

// Ajanın ürettiği görselleri toplar: data/images/done/job-<id>.png varsa yazı onaya ilerler.
export function collectImages(ctx) {
  const { db, config } = ctx;
  const waiting = db.prepare("SELECT * FROM jobs WHERE state = 'awaiting_image'").all();
  let moved = 0;
  for (const job of waiting) {
    const file = doneFileFor(config.dataDir, job.id);
    if (!file) continue;
    const draft = JSON.parse(job.draft_json);
    draft.imageFile = file;
    db.prepare('UPDATE jobs SET draft_json = ? WHERE id = ?').run(JSON.stringify(draft), job.id);
    transition(db, job.id, 'awaiting_image', 'validated', {}, 'görsel hazır');
    transition(db, job.id, 'validated', config.mode === 'auto' ? 'approved' : 'awaiting_approval');
    const q = path.join(config.dataDir, 'images', 'queue', `job-${job.id}.json`);
    try { unlinkSync(q); } catch { /* kuyruk dosyası zaten yok */ }
    moved++;
  }
  return { moved, pending: listQueue(config.dataDir).map((f) => JSON.parse(readFileSync(f, 'utf8'))) };
}
