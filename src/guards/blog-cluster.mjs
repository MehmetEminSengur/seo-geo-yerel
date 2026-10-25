// Blog konu kontrolü. Gerçek bir mağazada 10 günde 4 baharat yazısı çıkmıştı.
//   - Aynı konu ailesinden son N günde yazı planlandıysa bekle (küme bekleme süresi).
//   - Sitede aynı soruyu cevaplayan bir yazı zaten varsa yeni yazı açma (çakışma).
import { overlap } from '../keywords/text.mjs';

export function blogBlocked(db, keyword, { clusterCooldownDays = 14, now = Date.now() } = {}) {
  const since = new Date(now - clusterCooldownDays * 86_400_000).toISOString();
  const recent = db.prepare("SELECT target_keyword FROM jobs WHERE kind = 'create_article' AND created_at >= ? AND state NOT IN ('rejected','cancelled','failed')").all(since);
  const hot = recent.find((r) => overlap(r.target_keyword, keyword) >= 0.5);
  if (hot) return `son ${clusterCooldownDays} günde benzer konu planlandı: "${hot.target_keyword}"`;
  const articles = db.prepare("SELECT title FROM pages WHERE type = 'article' AND lifecycle = 'active'").all();
  const same = articles.find((a) => overlap(a.title, keyword) >= 0.6);
  if (same) return `sitede benzer yazı var: "${same.title}"`;
  const pending = db.prepare("SELECT target_keyword FROM jobs WHERE kind = 'create_article' AND state NOT IN ('rejected','cancelled','failed','verified','export')").all();
  const dup = pending.find((r) => overlap(r.target_keyword, keyword) >= 0.6);
  if (dup) return `bekleyen benzer yazı var: "${dup.target_keyword}"`;
  return null;
}
