// İkas adaptörü (okuma + dışa aktarma). TEST EDİLMEDİ: gerçek bir İkas mağazasında denenmedi.
// Kimlik: Özel Uygulama (Private App) → client_credentials, token ~4 saat (expires_in 14400).
// Okuma: Admin GraphQL v1 (listProduct, listCategory).
// Yazma YOK: saveProduct girdisi ürünün tüm varyantlarını (fiyat, stok) zorunlu istiyor; eksik bir
// gönderim mağazadaki varyantları bozabilir. Bu yüzden onaylanan metinler data/export altına
// kopyala-yapıştır dosyası olarak yazılır.
import { fetchJson } from './http.mjs';
import { nowIso } from '../db/db.mjs';

const API = 'https://api.myikas.com/api/v1/admin/graphql';

export function createIkas(config, db, log = () => {}) {
  const store = String(config.store.domain || '').replace(/^https?:\/\//, '').replace(/\.myikas\.com.*$/, '');
  const base = String(config.store.publicUrl || '').replace(/\/$/, '');
  const env = config.env;
  if (!store) throw new Error('config.json → store.domain eksik (ör. magazam.myikas.com)');

  async function token() {
    const row = db.prepare("SELECT * FROM tokens WHERE provider = 'ikas'").get();
    if (row?.access_token && Date.parse(row.expires_at) - Date.now() > 5 * 60_000) return row.access_token;
    if (!env.IKAS_CLIENT_ID || !env.IKAS_CLIENT_SECRET) throw new Error('.env içinde IKAS_CLIENT_ID ve IKAS_CLIENT_SECRET yok');
    const res = await fetchJson(`https://${store}.myikas.com/api/admin/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.IKAS_CLIENT_ID, client_secret: env.IKAS_CLIENT_SECRET }).toString(),
    });
    const expiresAt = nowIso(Date.now() + (Number(res.expires_in) || 14_400) * 1000);
    db.prepare(`INSERT INTO tokens(provider, access_token, expires_at, updated_at) VALUES ('ikas', ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`).run(res.access_token, expiresAt, nowIso());
    log('ikas_token_refreshed', { expires_at: expiresAt });
    return res.access_token;
  }

  async function gql(query, variables = {}) {
    const res = await fetchJson(API, { method: 'POST', headers: { authorization: `Bearer ${await token()}` }, body: { query, variables } });
    if (res.errors?.length) throw new Error(`ikas: ${JSON.stringify(res.errors).slice(0, 300)}`);
    return res.data;
  }

  async function listAllOf(field, fields) {
    const out = [];
    for (let page = 1; page < 200; page++) {
      const d = await gql(`query($p: PaginationInput) { ${field}(pagination: $p) { data { ${fields} } hasNext } }`, { p: { page, limit: 50 } });
      out.push(...d[field].data);
      if (!d[field].hasNext) break;
    }
    return out;
  }

  const META = 'metaData { pageTitle description slug }';
  return {
    name: 'ikas',
    publicBase: base,
    capabilities: () => ({ product: { body: false }, collection: { body: false }, article: { create: false } }),
    publicUrl: (type, slug) => (base && slug ? `${base}/${slug}` : null),

    async listAll() {
      const cats = await listAllOf('listCategory', `id name description ${META} parentId`);
      const prods = await listAllOf('listProduct', `id name description ${META} categoryIds`);
      const catById = new Map(cats.map((c) => [c.id, c]));
      const pages = cats.map((c) => ({ type: 'collection', externalId: c.id, handle: c.metaData?.slug || c.id, title: c.name, url: this.publicUrl('collection', c.metaData?.slug),
        bodyHtml: c.description || '', seoTitle: c.metaData?.pageTitle ?? null, seoDescription: c.metaData?.description ?? null,
        menuPath: c.parentId && catById.get(c.parentId) ? `${catById.get(c.parentId).name} > ${c.name}` : c.name }));
      for (const p of prods) {
        const parent = catById.get(p.categoryIds?.[0]);
        pages.push({ type: 'product', externalId: p.id, handle: p.metaData?.slug || p.id, title: p.name, url: this.publicUrl('product', p.metaData?.slug),
          bodyHtml: p.description || '', seoTitle: p.metaData?.pageTitle ?? null, seoDescription: p.metaData?.description ?? null,
          parentHandle: parent?.metaData?.slug ?? null, menuPath: parent?.name ?? null });
      }
      return pages;
    },
    async readPage() { throw new Error('ikas: yazma kapalı olduğu için canlı okuma gerekmez'); },
    async writePage() { throw new Error('ikas: API ile yazma kapalı (dışa aktarma kullanılır)'); },
    async findArticle() { return null; },
  };
}
