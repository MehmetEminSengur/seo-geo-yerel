// Kaçırılan işleri telafi eden zamanlayıcı. İşletim sistemi `tick` komutunu saatlik ve açılışta
// çağırır; burada her görev "en son ne zaman başarıyla bitti?" sorusuna göre çalışır.
// Bilgisayar bir hafta kapalı kalsa bile açıldığında haftalık görev yalnızca BİR kez çalışır.
import { nowIso } from '../db/db.mjs';

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export function isDue(db, task, intervalMs, now = Date.now()) {
  const row = db.prepare('SELECT last_success_at FROM schedule_state WHERE task = ?').get(task);
  return !row?.last_success_at || now - Date.parse(row.last_success_at) >= intervalMs;
}

// tasks: [{ name, everyMs, run: async () => summary }]
export async function runDue(db, tasks, { now = Date.now, log = () => {} } = {}) {
  const results = [];
  for (const t of tasks) {
    if (!isDue(db, t.name, t.everyMs, now())) continue;
    db.prepare(`INSERT INTO schedule_state(task, last_started_at) VALUES (?, ?)
      ON CONFLICT(task) DO UPDATE SET last_started_at = excluded.last_started_at`).run(t.name, nowIso(now()));
    try {
      const summary = await t.run();
      // Görev "bugünlük bitmedi" derse (bütçe, çevrimdışı) başarı yazılmaz; sonraki tick yeniden dener.
      if (summary?.incomplete) {
        log('task_incomplete', { task: t.name, ...summary });
      } else {
        db.prepare('UPDATE schedule_state SET last_success_at = ?, last_error = NULL WHERE task = ?').run(nowIso(now()), t.name);
      }
      results.push({ task: t.name, ok: true, summary });
    } catch (err) {
      db.prepare('UPDATE schedule_state SET last_error = ? WHERE task = ?').run(String(err.message || err), t.name);
      log('task_failed', { task: t.name, error: String(err.message || err) });
      results.push({ task: t.name, ok: false, error: String(err.message || err) });
    }
  }
  return results;
}
