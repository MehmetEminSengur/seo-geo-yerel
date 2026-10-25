// DataForSEO (isteğe bağlı, ücretli). Yeni hesaba 1 $ deneme kredisi verilir. Gerçek bir mağazada kullanılan
// uç noktaların aynısı: öneri (keyword_suggestions), hacim (keyword_overview) ve Google'ın ilk
// 10 sonucu (serp organic). Her çağrıdan önce bütçe kontrol edilir; gerçek ücret cevaptaki
// `cost` alanından kaydedilir.
import { fetchJson } from '../platforms/http.mjs';
import { canSpend, record } from '../core/budget.mjs';

const BASE = 'https://api.dataforseo.com/v3';
const ESTIMATE = { labs: 0.02, serp: 0.003 }; // çağrı öncesi kaba tahmin; asıl ücret cevaptan

export class BudgetExceeded extends Error {}

export function createDataForSeo(config, db) {
  const { DATAFORSEO_LOGIN: login, DATAFORSEO_PASSWORD: password } = config.env;
  if (!login || !password) return null;
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  const loc = { location_code: config.keywords.locationCode ?? 2792, language_code: config.keywords.language ?? 'tr' };

  async function post(endpoint, body, estimate) {
    if (!canSpend(db, 'dataforseo', { usd: estimate }, config.limits)) throw new BudgetExceeded('DataForSEO bütçe sınırı');
    const res = await fetchJson(`${BASE}/${endpoint}`, { method: 'POST', headers: { authorization: auth }, body, timeoutMs: 120_000 });
    record(db, 'dataforseo', { usd: Number(res?.cost) || estimate, note: endpoint });
    const task = res?.tasks?.[0];
    if (!task || task.status_code >= 40000) throw new Error(`DataForSEO: ${task?.status_message || res?.status_message}`);
    return task.result || [];
  }

  return {
    async suggestions(seed, limit = 20) {
      const r = await post('dataforseo_labs/google/keyword_suggestions/live', [{ keyword: seed, ...loc, limit, include_seed_keyword: true }], ESTIMATE.labs);
      return (r[0]?.items || []).map((i) => ({ keyword: i.keyword, volume: i.keyword_info?.search_volume ?? null }));
    },
    async overview(keywords) {
      const out = [];
      for (let i = 0; i < keywords.length; i += 700) {
        const r = await post('dataforseo_labs/google/keyword_overview/live', [{ keywords: keywords.slice(i, i + 700), ...loc }], ESTIMATE.labs);
        for (const it of r[0]?.items || []) out.push({ keyword: it.keyword, volume: it.keyword_info?.search_volume ?? null });
      }
      return out;
    },
    // Google'ın ilk 10 sonucuna bakıp bu arama hangi sayfa tipini istiyor, onu söyler.
    async serpPageType(keyword) {
      const r = await post('serp/google/organic/live/advanced', [{ keyword, ...loc, depth: 10 }], ESTIMATE.serp);
      const urls = (r[0]?.items || []).filter((i) => i.type === 'organic').map((i) => i.url);
      return { pageType: classifyUrls(urls), urls };
    },
  };
}

// URL kalıplarına göre sayfa tipi oylaması (Shopify, IdeaSoft, İkas, pazaryerleri, bloglar).
export function urlType(url) {
  const u = String(url).toLowerCase();
  if (/\/(blogs?|makale|makaleler|haber|haberler|rehber|icerik)\//.test(u) || /\/\d{4}\/\d{2}\//.test(u)) return 'article';
  if (/\/products?\/|\/urun\/|-p-\d+|\/p\/|,pr\?|-pm-|\/dp\//.test(u)) return 'product';
  if (/\/collections?\/|\/kategori\/|\/category\/|\/c\/|-x-c\d+|\/sr\?|\/kampanya/.test(u)) return 'collection';
  return null;
}

export function classifyUrls(urls) {
  const votes = { product: 0, collection: 0, article: 0 };
  for (const u of urls) {
    const t = urlType(u);
    if (t) votes[t]++;
  }
  const [top, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return n >= 3 ? top : 'mixed';
}
