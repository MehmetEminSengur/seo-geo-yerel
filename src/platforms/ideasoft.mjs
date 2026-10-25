// IdeaSoft adaptörü (okuma + dışa aktarma). TEST EDİLMEDİ: alan adları IdeaSoft Admin API'sinin
// bilinen kalıplarına göre yazıldı ve gerçek bir mağazada denenmedi. Yazma kapalıdır; onaylanan
// metinler data/export altına kopyala-yapıştır dosyası olarak yazılır.
//
// Kimlik: OAuth2. İlk bağlantı tarayıcıda bir kez yapılır (docs/api-anahtari/ideasoft.md), sonra
// IDEASOFT_REFRESH_TOKEN ile çalışır. IdeaSoft her yenilemede YENİ bir refresh token verir; eskisi
// geçersiz olur. Bilgisayar tam o sırada kapanırsa token kaybolmasın diye cevap önce
// data/journal/ altına fsync ile yazılır, sonra veritabanına; recover journal'ı okur.
import path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { fetchJson } from './http.mjs';
import { atomicWrite, readJsonIfComplete } from '../core/fsutil.mjs';
import { registerRecoverer } from '../core/recover.mjs';
import { nowIso } from '../db/db.mjs';

function saveToken(db, t) {
  db.prepare(`INSERT INTO tokens(provider, access_token, refresh_token, expires_at, updated_at) VALUES ('ideasoft', ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, tokens.refresh_token),
      expires_at = excluded.expires_at, updated_at = excluded.updated_at`).run(t.access_token, t.refresh_token ?? null, t.expires_at, nowIso());
}

// Journal'da kalmış (veritabanına yazılamadan kesilmiş) token varsa önce onu al.
export function replayTokenJournal(db, dataDir) {
  const file = path.join(dataDir, 'journal', 'ideasoft-token.json');
  const t = readJsonIfComplete(file);
  if (!t) return false;
  saveToken(db, t);
  unlinkSync(file);
  return true;
}

export function createIdeasoft(config, db, log = () => {}) {
  const base = `https://${String(config.store.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const publicBase = String(config.store.publicUrl || base).replace(/\/$/, '');
  const env = config.env;
  const journal = path.join(config.dataDir, 'journal', 'ideasoft-token.json');
  registerRecoverer(({ db: d, log: l }) => {
    if (replayTokenJournal(d, config.dataDir)) l('ideasoft_token_recovered_from_journal');
  });

  async function token() {
    if (existsSync(journal)) replayTokenJournal(db, config.dataDir);
    const row = db.prepare("SELECT * FROM tokens WHERE provider = 'ideasoft'").get();
    if (row?.access_token && Date.parse(row.expires_at) - Date.now() > 5 * 60_000) return row.access_token;
    const refresh = row?.refresh_token || env.IDEASOFT_REFRESH_TOKEN;
    if (!refresh) throw new Error('IdeaSoft bağlantısı yok: docs/api-anahtari/ideasoft.md adımlarını izleyin');
    const res = await fetchJson(`${base}/oauth/v2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, retries: 0,
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.IDEASOFT_CLIENT_ID, client_secret: env.IDEASOFT_CLIENT_SECRET, refresh_token: refresh }).toString(),
    });
    const t = { access_token: res.access_token, refresh_token: res.refresh_token, expires_at: nowIso(Date.now() + (Number(res.expires_in) || 3600) * 1000) };
    atomicWrite(journal, JSON.stringify(t)); // önce diske (fsync), sonra veritabanına
    saveToken(db, t);
    unlinkSync(journal);
    log('ideasoft_token_refreshed', { expires_at: t.expires_at });
    return t.access_token;
  }

  async function api(p) {
    return fetchJson(`${base}${p}`, { headers: { authorization: `Bearer ${await token()}` } });
  }

  async function all(resource) {
    const out = [];
    for (let page = 1; page < 500; page++) {
      const rows = await api(`/api/${resource}?limit=100&page=${page}`);
      const list = Array.isArray(rows) ? rows : rows?.data ?? [];
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  const seoOf = (x) => ({ seoTitle: x.pageTitle ?? x.metaTitle ?? null, seoDescription: x.metaDescription ?? x.meta_description ?? null });
  return {
    name: 'ideasoft',
    publicBase,
    capabilities: () => ({ product: { body: false }, collection: { body: false }, article: { create: false } }),
    publicUrl: (type, slug) => (slug ? `${publicBase}/${type === 'product' ? 'urun' : 'kategori'}/${slug}` : null),
    async listAll() {
      const cats = await all('categories');
      const prods = await all('products');
      const catById = new Map(cats.map((c) => [c.id, c]));
      const pages = cats.map((c) => ({ type: 'collection', externalId: String(c.id), handle: c.slug, title: c.name, url: this.publicUrl('collection', c.slug),
        bodyHtml: c.showcaseContent ?? c.description ?? '', ...seoOf(c), menuPath: c.parent?.name ? `${c.parent.name} > ${c.name}` : c.name }));
      for (const p of prods) {
        const cat = catById.get(p.categories?.[0]?.id ?? p.category?.id);
        pages.push({ type: 'product', externalId: String(p.id), handle: p.slug, title: p.name, url: this.publicUrl('product', p.slug),
          bodyHtml: p.detail?.details ?? p.details ?? '', ...seoOf(p), parentHandle: cat?.slug ?? null, menuPath: cat?.name ?? null });
      }
      return pages;
    },
    async readPage() { throw new Error('ideasoft: yazma kapalı olduğu için canlı okuma gerekmez'); },
    async writePage() { throw new Error('ideasoft: API ile yazma kapalı (dışa aktarma kullanılır)'); },
    async findArticle() { return null; },
  };
}
