// Anahtar kelime hattı: topla → süz → hacim → raf → tek hedef.
import { expandSeed } from '../keywords/autocomplete.mjs';
import { createDataForSeo, BudgetExceeded } from '../keywords/dataforseo.mjs';
import { buildRules, classifyKeyword } from '../keywords/intent-filter.mjs';
import { chooseTarget } from '../keywords/mapper.mjs';
import { words } from '../keywords/text.mjs';
import { pagesInScope } from './scope.mjs';
import { nowIso, tx } from '../db/db.mjs';

function seedsFrom(pages, max = 15) {
  const cols = pages.filter((p) => p.type === 'collection').map((p) => p.title);
  const seeds = cols.length ? cols : [...new Set(pages.map((p) => words(p.title).slice(0, 2).join(' ')))];
  return [...new Set(seeds.map((s) => s.toLocaleLowerCase('tr-TR').trim()))].filter(Boolean).slice(0, max);
}

export async function collectKeywords(ctx) {
  const { db, config, log } = ctx;
  const pages = pagesInScope(db, config);
  const dfs = config.keywords.source === 'dataforseo' ? createDataForSeo(config, db) : null;
  const insert = db.prepare(`INSERT INTO keywords(keyword, source, volume, fetched_at) VALUES (?,?,?,?)
    ON CONFLICT(keyword) DO UPDATE SET volume = coalesce(excluded.volume, keywords.volume)`);
  let found = 0;
  let incomplete = false;
  for (const seed of seedsFrom(pages)) {
    const list = (await expandSeed(seed, { depth: config.keywords.autocompleteDepth })).map((k) => ({ keyword: k, source: 'autocomplete', volume: null }));
    if (dfs) {
      try {
        list.push(...(await dfs.suggestions(seed)).map((x) => ({ ...x, source: 'dataforseo' })));
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        incomplete = true;
      }
    }
    tx(db, () => { for (const k of list) insert.run(k.keyword.toLocaleLowerCase('tr-TR'), k.source, k.volume, nowIso()); });
    found += list.length;
  }
  if (dfs && !incomplete) {
    const missing = db.prepare("SELECT keyword FROM keywords WHERE volume IS NULL AND status = 'new'").all().map((r) => r.keyword);
    try {
      const vols = missing.length ? await dfs.overview(missing) : [];
      const up = db.prepare('UPDATE keywords SET volume = ? WHERE keyword = ?');
      tx(db, () => { for (const v of vols) up.run(v.volume ?? 0, v.keyword); });
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      incomplete = true;
    }
  }
  log('keywords_collected', { found, incomplete });
  return { found, incomplete };
}

// Yeni kelimeleri süzer ve rafa koyar. Her sayfanın hedef kelimesi bir kez seçilir ve sabit kalır;
// sonradan gelen ilgili kelimeler sayfayı yeniden yazdırmaz, yalnız ikincil olarak eklenir.
export async function mapKeywords(ctx, { serpBudget = 10 } = {}) {
  const { db, config, log } = ctx;
  const rules = buildRules(config.brandFacts);
  const pages = pagesInScope(db, config);
  const dfs = config.keywords.source === 'dataforseo' ? createDataForSeo(config, db) : null;
  const titles = pages.map((p) => p.title);
  const fresh = db.prepare("SELECT * FROM keywords WHERE status = 'new' ORDER BY coalesce(volume, 0) DESC, length(keyword)").all();
  const stats = { accepted: 0, blog: 0, rejected: 0, unmatched: 0 };
  for (const k of fresh) {
    const verdict = classifyKeyword(k.keyword, rules, titles);
    if (verdict.route === 'drop') {
      db.prepare("UPDATE keywords SET status = 'rejected', reject_reason = ? WHERE id = ?").run(verdict.reason, k.id);
      stats.rejected++;
      continue;
    }
    if (verdict.route === 'blog') {
      db.prepare("UPDATE keywords SET status = 'accepted', intent = 'informational', page_id = NULL WHERE id = ?").run(k.id);
      stats.blog++;
      continue;
    }
    let serpType = null;
    if (dfs && serpBudget > 0 && (k.volume ?? 0) > 0) {
      try {
        serpType = (await dfs.serpPageType(k.keyword)).pageType;
        serpBudget--;
        db.prepare('UPDATE keywords SET serp_page_type = ? WHERE id = ?').run(serpType, k.id);
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        serpBudget = 0;
      }
    }
    const target = chooseTarget(k.keyword, pages, serpType);
    if (!target) {
      db.prepare("UPDATE keywords SET status = 'rejected', reject_reason = 'eşleşen sayfa ailesi yok' WHERE id = ?").run(k.id);
      stats.unmatched++;
      continue;
    }
    tx(db, () => {
      db.prepare("UPDATE keywords SET status = 'accepted', intent = ?, page_id = ? WHERE id = ?").run(target.pageType === 'product' ? 'product' : 'transactional', target.page.id, k.id);
      db.prepare('UPDATE pages SET target_keyword = coalesce(target_keyword, ?) WHERE id = ?').run(k.keyword, target.page.id);
    });
    stats.accepted++;
  }
  log('keywords_mapped', stats);
  return stats;
}
