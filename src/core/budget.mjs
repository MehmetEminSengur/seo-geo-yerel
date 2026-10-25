// Harcama ve kota sınırları. Sınır aşıldığında hata atılmaz; çağıran iş "sonraki güne kaldı"
// diye bekler. Ücretli bir çağrıdan ÖNCE `canSpend`, sonra `record` çağrılır.
import { nowIso } from '../db/db.mjs';

export function spentSince(db, provider, sinceIso) {
  return db.prepare('SELECT coalesce(sum(amount_usd),0) AS usd, coalesce(sum(units),0) AS units FROM budget_ledger WHERE provider = ? AND at >= ?')
    .get(provider, sinceIso);
}

const startOfDay = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

export function canSpend(db, provider, { usd = 0, units = 1 }, limits) {
  const lim = limits?.[provider];
  if (!lim) return true;
  const day = spentSince(db, provider, startOfDay());
  const all = spentSince(db, provider, '0000');
  if (lim.dailyUsd != null && day.usd + usd > lim.dailyUsd + 1e-9) return false;
  if (lim.totalUsd != null && all.usd + usd > lim.totalUsd + 1e-9) return false;
  if (lim.dailyCalls != null && day.units + units > lim.dailyCalls) return false;
  return true;
}

export function record(db, provider, { usd = 0, units = 1, note = null } = {}) {
  db.prepare('INSERT INTO budget_ledger(provider, amount_usd, units, note, at) VALUES (?,?,?,?,?)').run(provider, usd, units, note, nowIso());
}
