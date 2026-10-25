import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tempData, fakeStore } from './helpers.mjs';
import { createJob, transition, claimNext, getJob, MAX_ATTEMPTS } from '../src/core/jobs.mjs';
import { recover } from '../src/core/recover.mjs';
import { createBackup } from '../src/core/backups.mjs';
import { canonicalHash, normalizeHtml } from '../src/core/content-hash.mjs';
import { runDue, DAY } from '../src/core/scheduler.mjs';
import { acquireLock, STALE_MS } from '../src/core/lock.mjs';
import { canSpend, record } from '../src/core/budget.mjs';

const OLD = { html: '<p>Eski metin</p>', seoTitle: 'Eski', seoDescription: 'Eski açıklama' };
const NEW = { html: '<p>Yeni metin</p>', seoTitle: 'Yeni', seoDescription: 'Yeni açıklama' };

// İşi "applying" durumuna kadar götürür ve kirasını geçmişe çeker: yazma ortasında elektrik kesildi.
function jobStuckInApplying(db, dir) {
  const job = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'k1' });
  transition(db, job.id, 'planned', 'generating');
  transition(db, job.id, 'generating', 'generated', { draft_json: JSON.stringify(NEW) });
  transition(db, job.id, 'generated', 'validated');
  transition(db, job.id, 'validated', 'approved');
  transition(db, job.id, 'approved', 'backing_up');
  const backupId = createBackup(db, dir, { pageId: 'p1', jobId: job.id, live: OLD });
  transition(db, job.id, 'backing_up', 'backed_up', { backup_id: backupId });
  transition(db, job.id, 'backed_up', 'applying', { intended_hash: canonicalHash(NEW) });
  db.prepare("UPDATE jobs SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(job.id);
  return job.id;
}

test('aynı idempotency anahtarı ikinci iş açmaz', () => {
  const { db } = tempData();
  const a = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  const b = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  assert.equal(a.id, b.id);
  assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 1);
});

test('geçersiz geçiş reddedilir, eski durumdan geçiş reddedilir', () => {
  const { db } = tempData();
  const j = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  assert.throws(() => transition(db, j.id, 'planned', 'applied'), /geçersiz geçiş/);
  transition(db, j.id, 'planned', 'generating');
  assert.throws(() => transition(db, j.id, 'planned', 'generating'), /artık planned durumunda değil/);
});

test('deneme sayacı adım başına: başarılı adım sıfırlar, sınır aşılınca failed', () => {
  const { db } = tempData();
  const j = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  transition(db, j.id, 'planned', 'generating');
  transition(db, j.id, 'generating', 'generated');
  assert.equal(getJob(db, j.id).attempts, 0);
  transition(db, j.id, 'generated', 'validated');
  transition(db, j.id, 'validated', 'approved');
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    transition(db, j.id, 'approved', 'backing_up');
    transition(db, j.id, 'backing_up', 'approved');
  }
  assert.equal(transition(db, j.id, 'approved', 'backing_up').state, 'failed');
});

test('claimNext aynı işi iki kez vermez', () => {
  const { db } = tempData();
  createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  assert.ok(claimNext(db, { from: 'planned', to: 'generating', owner: 'a' }));
  assert.equal(claimNext(db, { from: 'planned', to: 'generating', owner: 'b' }), null);
});

test('recover: yazma gerçekleşmişse applied (çift yazma yok)', async () => {
  const { db, dir } = tempData();
  const id = jobStuckInApplying(db, dir);
  const store = fakeStore({ p1: NEW });
  const s = await recover(db, { adapter: store });
  assert.equal(getJob(db, id).state, 'applied');
  assert.equal(s.reconciled_applied, 1);
  assert.equal(store.writes, 0);
});

test('recover: yazma hiç olmamışsa backed_up (yeniden denenir)', async () => {
  const { db, dir } = tempData();
  const id = jobStuckInApplying(db, dir);
  await recover(db, { adapter: fakeStore({ p1: { ...OLD, html: '<P>Eski   metin</P>' } }) });
  assert.equal(getJob(db, id).state, 'backed_up');
});

test('recover: biri elle değiştirmişse conflict, üzerine yazılmaz', async () => {
  const { db, dir } = tempData();
  const id = jobStuckInApplying(db, dir);
  await recover(db, { adapter: fakeStore({ p1: { ...OLD, seoTitle: 'Mağaza sahibinin başlığı' } }) });
  assert.equal(getJob(db, id).state, 'conflict');
});

test('recover: çevrimdışıyken hiçbir şeye dokunmaz', async () => {
  const { db, dir } = tempData();
  const id = jobStuckInApplying(db, dir);
  const offline = { async readLive() { throw new Error('ENOTFOUND'); } };
  const s = await recover(db, { adapter: offline });
  assert.equal(getJob(db, id).state, 'applying');
  assert.equal(s.skipped_offline, 1);
});

test('recover: yarım yazılmış yedek dosyası geçersiz sayılır, yedek yeniden alınır', async () => {
  const { db, dir } = tempData();
  const j = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  for (const [a, b] of [['planned', 'generating'], ['generating', 'generated'], ['generated', 'validated'], ['validated', 'approved']]) transition(db, j.id, a, b);
  transition(db, j.id, 'approved', 'backing_up');
  const backupId = createBackup(db, dir, { pageId: 'p1', jobId: j.id, live: OLD });
  db.prepare("UPDATE jobs SET backup_id = ?, lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(backupId, j.id);
  const file = db.prepare('SELECT file_path FROM backups WHERE id = ?').get(backupId).file_path;
  writeFileSync(file, '{"yarım');
  await recover(db, {});
  assert.equal(getJob(db, j.id).state, 'approved');
});

test('recover: üretim ortasında kesilen iş kuyruğa döner', async () => {
  const { db } = tempData();
  const j = createJob(db, { kind: 'update_page', pageId: 'p1', idempotencyKey: 'x' });
  transition(db, j.id, 'planned', 'generating');
  db.prepare("UPDATE jobs SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(j.id);
  await recover(db, {});
  assert.equal(getJob(db, j.id).state, 'planned');
});

test('normalizeHtml biçim farkını yutar ama bağlantı değişikliğini yakalar', () => {
  assert.equal(normalizeHtml('<P CLASS="a"  id=x>Merhaba<br/></P>'), normalizeHtml('<p id="x" class="a">Merhaba<br></p>'));
  assert.notEqual(normalizeHtml('<a href="/a">x</a>'), normalizeHtml('<a href="/b">x</a>'));
});

test('zamanlayıcı: 20 gün kapalı kalınca haftalık görev bir kez çalışır, ikinci tick boş geçer', async () => {
  const { db } = tempData();
  let t = Date.parse('2026-10-01T09:00:00Z');
  let runs = 0;
  const tasks = [{ name: 'weekly', everyMs: 7 * DAY, run: async () => { runs++; } }];
  await runDue(db, tasks, { now: () => t });
  t += 20 * DAY; // bilgisayar 20 gün kapalı kaldı
  await runDue(db, tasks, { now: () => t });
  await runDue(db, tasks, { now: () => t + 1000 });
  assert.equal(runs, 2);
});

test('zamanlayıcı: eksik kalan görev başarı yazmaz, sonraki tick yeniden dener', async () => {
  const { db } = tempData();
  let runs = 0;
  const tasks = [{ name: 'gen', everyMs: DAY, run: async () => { runs++; return { incomplete: true }; } }];
  await runDue(db, tasks);
  await runDue(db, tasks);
  assert.equal(runs, 2);
});

test('kilit: ikinci süreç alamaz; sahibi ölmüş kilit devralınır', () => {
  const { dir } = tempData();
  const a = acquireLock(dir);
  assert.ok(a);
  assert.equal(acquireLock(dir), null);
  a.release();
  writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: 999999, host: 'baska-makine', startedAt: '2000-01-01T00:00:00Z', heartbeatAt: new Date(Date.now() - STALE_MS - 1000).toISOString() }));
  const b = acquireLock(dir);
  assert.ok(b);
  b.release();
  assert.equal(existsSync(path.join(dir, '.lock')), false);
});

test('bütçe: toplam sınır aşılınca harcama durur', () => {
  const { db } = tempData();
  const limits = { dataforseo: { totalUsd: 1 } };
  record(db, 'dataforseo', { usd: 0.95 });
  assert.equal(canSpend(db, 'dataforseo', { usd: 0.04 }, limits), true);
  assert.equal(canSpend(db, 'dataforseo', { usd: 0.06 }, limits), false);
});

test('dönen token: veritabanına yazılamadan kesilirse journal\'dan kurtarılır', async () => {
  const { replayTokenJournal } = await import('../src/platforms/ideasoft.mjs');
  const { atomicWrite } = await import('../src/core/fsutil.mjs');
  const { db, dir } = tempData();
  atomicWrite(path.join(dir, 'journal', 'ideasoft-token.json'), JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_at: '2030-01-01T00:00:00Z' }));
  assert.equal(replayTokenJournal(db, dir), true);
  assert.equal(db.prepare("SELECT refresh_token FROM tokens WHERE provider = 'ideasoft'").get().refresh_token, 'r2');
  assert.equal(existsSync(path.join(dir, 'journal', 'ideasoft-token.json')), false);
  assert.equal(replayTokenJournal(db, dir), false);
});
