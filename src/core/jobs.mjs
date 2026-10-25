// İş durum makinesi. Bir iş = bir sayfa değişikliği (ya da bir yeni blog yazısı).
// Dış dünyaya dokunan her adım "kiralanan" bir ara durumdan geçer (generating, backing_up,
// applying, verifying). Süreç o sırada ölürse kira süresi dolar ve recover.mjs işi güvenli bir
// noktaya geri alır. Bu yüzden bir adım ya tamamen kaydedilir ya da hiç olmamış sayılır.
import { nowIso, tx } from '../db/db.mjs';

export const TRANSITIONS = {
  planned: ['generating', 'cancelled', 'paused_budget'],
  paused_budget: ['planned', 'cancelled'],
  generating: ['generated', 'planned', 'failed'],
  generated: ['validated', 'rejected'],
  validated: ['awaiting_image', 'awaiting_approval', 'approved'],
  awaiting_image: ['validated', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['backing_up', 'export', 'cancelled'],
  backing_up: ['backed_up', 'approved', 'conflict', 'failed'],
  backed_up: ['applying', 'cancelled'],
  applying: ['applied', 'backed_up', 'conflict', 'failed'],
  applied: ['verifying'],
  verifying: ['verified', 'verify_failed', 'applied'],
  verify_failed: ['backed_up', 'cancelled'],
  conflict: ['backed_up', 'cancelled'],
  verified: [],
  rejected: [],
  failed: ['planned'],
  export: [],
  cancelled: [],
};

// Kiralı durumlar: süreç burada ölürse recover devreye girer.
export const LEASED = new Set(['generating', 'backing_up', 'applying', 'verifying']);
export const LEASE_MS = { generating: 15 * 60_000, backing_up: 2 * 60_000, applying: 5 * 60_000, verifying: 5 * 60_000 };
export const MAX_ATTEMPTS = 3;
// Deneme sayacı adım başına tutulur: kiralı bir adım başarıyla bittiğinde sıfırlanır,
// geri alma (generating → planned gibi) sayacı korur ki sonsuz döngü olmasın.
const STEP_DONE = new Set(['generated', 'backed_up', 'applied', 'verified', 'verify_failed', 'conflict']);

function event(db, jobId, from, to, note) {
  db.prepare('INSERT INTO job_events(job_id, from_state, to_state, note, at) VALUES (?,?,?,?,?)').run(jobId, from, to, note ?? null, nowIso());
}

export function getJob(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

// Aynı idempotency anahtarıyla ikinci kez çağrılırsa yeni iş açmaz, var olanı döner.
export function createJob(db, { kind, pageId = null, targetKeyword = null, idempotencyKey, state = 'planned' }) {
  return tx(db, () => {
    const now = nowIso();
    const res = db.prepare(`INSERT INTO jobs(kind, page_id, target_keyword, state, idempotency_key, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`).run(kind, pageId, targetKeyword, state, idempotencyKey, now, now);
    const job = db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(idempotencyKey);
    if (res.changes) event(db, job.id, null, state, 'created');
    return job;
  });
}

const COLUMNS = new Set(['draft_json', 'draft_hash', 'intended_hash', 'backup_id', 'result_json', 'last_error', 'target_keyword']);

// İyimser geçiş: iş hâlâ `from` durumundaysa `to`ya geçer. Başka biri işi değiştirmişse hata verir.
export function transition(db, jobId, from, to, fields = {}, note) {
  if (!TRANSITIONS[from]?.includes(to)) throw new Error(`geçersiz geçiş: ${from} → ${to}`);
  return tx(db, () => {
    const cur = getJob(db, jobId);
    if (cur?.state === from && LEASED.has(to) && cur.attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE jobs SET state = 'failed', lease_until = NULL, lease_owner = NULL, updated_at = ? WHERE id = ?").run(nowIso(), jobId);
      event(db, jobId, from, 'failed', `max_attempts before ${to}`);
      return getJob(db, jobId);
    }
    const sets = ['state = ?', 'updated_at = ?'];
    const vals = [to, nowIso()];
    for (const [k, v] of Object.entries(fields)) {
      if (!COLUMNS.has(k)) throw new Error(`bilinmeyen alan: ${k}`);
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    if (LEASED.has(to)) {
      sets.push('lease_until = ?', 'attempts = attempts + 1', 'lease_owner = ?');
      vals.push(nowIso(Date.now() + LEASE_MS[to]), `${to}-${process.pid}`);
    } else {
      sets.push('lease_until = NULL', 'lease_owner = NULL');
      if (LEASED.has(from) && STEP_DONE.has(to)) sets.push('attempts = 0');
    }
    const res = db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND state = ?`).run(...vals, jobId, from);
    if (!res.changes) throw new Error(`iş ${jobId} artık ${from} durumunda değil`);
    event(db, jobId, from, to, note);
    return getJob(db, jobId);
  });
}

// Kiralı bir duruma geçmek için sıradaki işi kapar. Aynı anda ikinci bir süreç aynı işi alamaz.
// `skip`: bu turda zaten işlenmiş iş kimlikleri (yeniden denemeye düşen iş aynı turda tekrar alınmaz).
export function claimNext(db, { from, to, owner, kind, skip = [] }) {
  if (!LEASED.has(to)) throw new Error(`${to} kiralı bir durum değil`);
  return tx(db, () => {
    const notIn = skip.length ? `AND id NOT IN (${skip.map(() => '?').join(',')})` : '';
    const job = db.prepare(`SELECT * FROM jobs WHERE state = ? ${kind ? 'AND kind = ?' : ''} ${notIn} ORDER BY id LIMIT 1`).get(...[from, kind].filter(Boolean), ...skip);
    if (!job) return null;
    if (job.attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE jobs SET state = 'failed', last_error = coalesce(last_error, 'deneme sınırı aşıldı'), updated_at = ? WHERE id = ?").run(nowIso(), job.id);
      event(db, job.id, from, 'failed', 'max_attempts');
      return null;
    }
    db.prepare('UPDATE jobs SET state = ?, lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = ?')
      .run(to, owner, nowIso(Date.now() + LEASE_MS[to]), nowIso(), job.id, from);
    event(db, job.id, from, to, `claimed by ${owner}`);
    return getJob(db, job.id);
  });
}

// Uzun süren bir adımın kirasını uzatır (ör. yapay zekâ cevabı geç geliyor).
export function renewLease(db, jobId, state) {
  db.prepare('UPDATE jobs SET lease_until = ? WHERE id = ? AND state = ?').run(nowIso(Date.now() + LEASE_MS[state]), jobId, state);
}

// Kirası dolmuş ya da sahibi ölmüş (bilgisayar kapandı, süreç öldürüldü) işler. Sahip süreç
// ölmüşse kiranın dolmasını beklemeye gerek yok: açılıştaki ilk tick hemen toparlar.
const ownerPid = (owner) => Number(String(owner || '').split('-').pop()) || null;
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

export function expiredLeases(db, at = nowIso()) {
  const rows = db.prepare(`SELECT * FROM jobs WHERE state IN (${[...LEASED].map(() => '?').join(',')}) ORDER BY id`).all(...LEASED);
  return rows.filter((j) => {
    if (!j.lease_until || j.lease_until < at) return true;
    const pid = ownerPid(j.lease_owner);
    return pid && pid !== process.pid && !pidAlive(pid);
  });
}

export function countByState(db) {
  return Object.fromEntries(db.prepare('SELECT state, count(*) AS n FROM jobs GROUP BY state').all().map((r) => [r.state, r.n]));
}
