import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';
import { createJob, transition, getJob } from '../src/core/jobs.mjs';
import { applyApproved } from '../src/pipeline/apply.mjs';
import { recover } from '../src/core/recover.mjs';
import { upsertPages } from '../src/platforms/adapter.mjs';
import { canonicalHash } from '../src/core/content-hash.mjs';

const OLD = { html: '<p>Eski</p>', seoTitle: 'Eski', seoDescription: 'Eski açıklama' };
const NEW = { html: '<blockquote><p>Yeni</p></blockquote>', seoTitle: 'Yeni | Marka', seoDescription: 'Yeni açıklama cümlesi.' };

// Gerçek adaptör arayüzünü taklit eden bellek içi mağaza. failAfterWrite: yazma platforma ulaşır
// ama cevap gelmeden bağlantı kopar (elektrik kesintisinin en kötü anı).
function memoryAdapter({ caps = { product: { body: true } }, failAfterWrite = false } = {}) {
  const live = new Map([['gid://p/1', { ...OLD }]]);
  const a = {
    writes: 0,
    live,
    capabilities: () => caps,
    async readPage(_type, id) { return live.get(id) ? { ...live.get(id) } : null; },
    async writePage(_type, id, content) {
      a.writes++;
      live.set(id, { ...content });
      if (failAfterWrite) { failAfterWrite = false; throw new Error('ECONNRESET'); }
    },
    async readLive(db, job) {
      const p = db.prepare('SELECT external_id FROM pages WHERE id = ?').get(job.page_id);
      return a.readPage('product', p.external_id);
    },
  };
  return a;
}

function setup(adapterOpts) {
  const { db, dir } = tempData();
  upsertPages(db, 'mem', [{ type: 'product', externalId: 'gid://p/1', handle: 'folyo', title: 'Folyo', url: null, bodyHtml: OLD.html, seoTitle: OLD.seoTitle, seoDescription: OLD.seoDescription }]);
  const job = createJob(db, { kind: 'update_page', pageId: 'mem:product:gid://p/1', idempotencyKey: 'j1' });
  transition(db, job.id, 'planned', 'generating');
  transition(db, job.id, 'generating', 'generated', { draft_json: JSON.stringify({ ...NEW, baseHash: canonicalHash(OLD) }), intended_hash: canonicalHash(NEW) });
  transition(db, job.id, 'generated', 'validated');
  transition(db, job.id, 'validated', 'approved');
  const adapter = memoryAdapter(adapterOpts);
  const ctx = { db, adapter, config: { dataDir: dir }, log: () => {} };
  return { db, ctx, adapter, jobId: job.id };
}

test('onaylı iş yedeklenir, uygulanır, doğrulanır; kilit tarihi yazılır', async () => {
  const { db, ctx, adapter, jobId } = setup();
  await applyApproved(ctx);
  const job = getJob(db, jobId);
  assert.equal(job.state, 'verified');
  assert.ok(job.backup_id);
  assert.equal(adapter.writes, 1);
  assert.ok(db.prepare('SELECT last_applied_at FROM pages').get().last_applied_at);
  await applyApproved(ctx);
  assert.equal(adapter.writes, 1, 'ikinci çalışma hiçbir şey yazmamalı');
});

test('yazma platforma ulaşıp cevap kaybolursa: recover yazıldığını görür, ikinci kez yazmaz', async () => {
  const { db, ctx, adapter, jobId } = setup({ failAfterWrite: true });
  await applyApproved(ctx);
  assert.equal(getJob(db, jobId).state, 'applying');
  await recover(db, { adapter });
  assert.equal(getJob(db, jobId).state, 'applied');
  await applyApproved(ctx);
  assert.equal(getJob(db, jobId).state, 'verified');
  assert.equal(adapter.writes, 1);
});

test('taslaktan sonra mağaza sahibi sayfayı değiştirdiyse conflict, üzerine yazılmaz', async () => {
  const { db, ctx, adapter, jobId } = setup();
  adapter.live.set('gid://p/1', { ...OLD, html: '<p>Sahibin yeni metni</p>' });
  await applyApproved(ctx);
  assert.equal(getJob(db, jobId).state, 'conflict');
  assert.equal(adapter.writes, 0);
});

test('platform yazamıyorsa iş dışa aktarmaya düşer ve dosya üretilir', async () => {
  const { db, ctx, adapter, jobId } = setup({ caps: { product: { body: false } } });
  await applyApproved(ctx);
  assert.equal(getJob(db, jobId).state, 'export');
  assert.equal(adapter.writes, 0);
});

test('blog: yazı açılmış ama SEO alanları yazılmadan kesilmişse ikinci yazı açılmaz, eksik tamamlanır', async () => {
  const { db, dir } = tempData();
  const draft = { handle: 'folyo-nedir', title: 'Folyo nedir?', html: '<p>Giriş</p><blockquote><p>Cevap</p></blockquote>', seoTitle: 'Folyo Nedir? | Marka', seoDescription: 'Folyo nedir sorusunun kısa cevabı ve seçim rehberi burada yer alıyor, işletmeler için.' };
  const job = createJob(db, { kind: 'create_article', targetKeyword: 'folyo nedir', idempotencyKey: 'b1' });
  transition(db, job.id, 'planned', 'generating');
  transition(db, job.id, 'generating', 'generated', { draft_json: JSON.stringify(draft), intended_hash: canonicalHash(draft) });
  for (const [a, b] of [['generated', 'validated'], ['validated', 'approved']]) transition(db, job.id, a, b);
  const created = [];
  let article = { ref: { externalId: 'a1', url: null }, html: draft.html, seoTitle: null, seoDescription: null }; // SEO yazılmadan kesildi
  const adapter = {
    capabilities: () => ({ article: { create: true } }),
    async findArticle() { return article; },
    async createArticle() { created.push(1); },
    async setArticleSeo(_id, t, d) { article = { ...article, seoTitle: t, seoDescription: d }; },
  };
  adapter.readLive = async () => article;
  await applyApproved({ db, adapter, config: { dataDir: dir }, log: () => {} });
  assert.equal(created.length, 0, 'ikinci yazı açılmamalı');
  assert.equal(getJob(db, job.id).state, 'verified');
});
