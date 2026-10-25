// Gerçek çökme tatbikatı: `apply` komutu ayrı bir süreçte çalışırken, yazma isteği mağazaya
// ulaştıktan sonra ama cevap gelmeden SIGKILL ile öldürülür (fişi çekmekle aynı: hiçbir
// temizlik kodu çalışmaz). Sonra yeni bir süreç toparlar. Beklenen: mağazaya tek yazma, iş tamam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockShopify } from './mock-shopify.mjs';
import { openDb } from '../src/db/db.mjs';
import { createJob, transition, getJob } from '../src/core/jobs.mjs';
import { canonicalHash } from '../src/core/content-hash.mjs';

const BIN = path.join(import.meta.dirname, '..', 'bin', 'seo-geo.mjs');
const NEW = { html: '<blockquote><p>Yeni kısa cevap.</p></blockquote><p>Yeni metin. 1998den beri.</p>', seoTitle: 'Folyo 30 cm | Marka', seoDescription: 'Folyo 30 cm rulo, mutfak ve paketleme işlerinde kullanılan pratik bir alüminyum folyodur ve rulo halinde gelir.' };

// Sahte mağaza bu süreçte çalıştığı için CLI'yi eşzamansız çalıştırmak şart (spawnSync olay döngüsünü kilitler).
const run = (home, ...args) => new Promise((resolve) => {
  const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, SEO_GEO_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  c.on('exit', (status) => resolve({ status, out }));
});

test('apply yazma anında öldürülür → toparlanınca tek yazma, iş doğrulanır', async () => {
  const mock = await startMockShopify();
  try {
    const home = mkdtempSync(path.join(tmpdir(), 'seo-geo-drill-'));
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ store: { platform: 'shopify', domain: 'mock.myshopify.com', adminBaseUrl: mock.url, publicUrl: mock.url } }));
    writeFileSync(path.join(home, '.env'), 'SHOPIFY_ADMIN_TOKEN=test\n');
    assert.equal((await run(home, 'sync')).status, 0);

    const db = openDb(path.join(home, 'data'));
    const page = db.prepare("SELECT * FROM pages WHERE type = 'product'").get();
    const job = createJob(db, { kind: 'update_page', pageId: page.id, idempotencyKey: 'drill' });
    transition(db, job.id, 'planned', 'generating');
    transition(db, job.id, 'generating', 'generated', { draft_json: JSON.stringify({ ...NEW, baseHash: page.content_hash }), intended_hash: canonicalHash(NEW) });
    transition(db, job.id, 'generated', 'validated');
    transition(db, job.id, 'validated', 'approved');
    db.close();

    // Yazma mağazaya ulaşsın, cevap 5 sn gecikecek; o arada fişi çek.
    mock.state.writeDelayMs = 5000;
    const child = spawn(process.execPath, [BIN, 'apply'], { env: { ...process.env, SEO_GEO_HOME: home }, stdio: 'ignore' });
    for (let i = 0; i < 100 && mock.state.writes === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(mock.state.writes, 1, 'yazma mağazaya ulaşmış olmalı');
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    const db2 = openDb(path.join(home, 'data'));
    assert.equal(getJob(db2, job.id).state, 'applying', 'süreç cevabı kaydedemeden öldü');
    db2.close();

    // Bilgisayar yeniden açıldı: kira dolmasını beklemeden (sahip süreç ölü) toparlanır.
    mock.state.writeDelayMs = 0;
    assert.equal((await run(home, 'recover')).status, 0);
    assert.equal((await run(home, 'apply')).status, 0);

    const db3 = openDb(path.join(home, 'data'));
    assert.equal(getJob(db3, job.id).state, 'verified');
    assert.equal(mock.state.writes, 1, 'mağazaya ikinci kez yazılmamalı');
    assert.ok(db3.prepare('SELECT last_applied_at FROM pages WHERE id = ?').get(page.id).last_applied_at);
    db3.close();

    // Geri alma: yedekteki eski hal geri gelir.
    const r = await run(home, 'restore', String(job.id));
    assert.equal(r.status, 0, r.out);
    assert.equal(mock.state.product.seo.title, 'Eski başlık');
  } finally {
    mock.close();
  }
});
