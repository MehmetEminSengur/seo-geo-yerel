// API anahtarı olmadan, herkese açık Shopify verisinden SALT-OKUNUR okuma. İki işe yarar:
//   - İzleyici anahtar almadan önce "preview" ile sistemin kendi mağazasında ne yazacağını görür.
//   - Yazma yetkisi olmadığı için onaylanan işler dışa aktarmaya (kopyala-yapıştır dosyası) düşer.
// Kaynak: /collections.json, /collections/<handle>/products.json ve sayfanın HTML'indeki <title>/<meta>.
import { fetchText } from './http.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
const decode = (s) => s && s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));

export function createShopifyPublic(config, _db, log = () => {}) {
  const base = String(config.store.publicUrl || `https://${config.store.domain}`).replace(/\/$/, '');

  async function json(pathname) {
    const res = await fetchText(`${base}${pathname}`, { headers: { accept: 'application/json' } });
    if (res.status !== 200) throw new Error(`${pathname} → ${res.status}`);
    return JSON.parse(res.text);
  }

  async function seoOf(url) {
    try {
      const { text } = await fetchText(url);
      const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, ' ').trim() ?? null;
      const desc = (text.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] ?? null;
      return { title: decode(title), desc: decode(desc) };
    } catch {
      return { title: null, desc: null };
    }
  }

  const scopeCols = config.scope?.collections;

  return {
    name: 'shopify-public',
    publicBase: base,
    capabilities: () => ({ product: { body: false }, collection: { body: false }, article: { create: false } }),
    publicUrl: (type, handle, blog) => (type === 'product' ? `${base}/products/${handle}` : type === 'collection' ? `${base}/collections/${handle}` : `${base}/blogs/${blog || 'news'}/${handle}`),

    async listAll() {
      const pages = [];
      const cols = [];
      for (let page = 1; page < 20; page++) {
        const r = await json(`/collections.json?limit=250&page=${page}`);
        cols.push(...r.collections);
        if (r.collections.length < 250) break;
      }
      const wanted = cols.filter((c) => scopeCols === 'all' || !Array.isArray(scopeCols) || scopeCols.includes(c.handle));
      for (const c of wanted) {
        const url = this.publicUrl('collection', c.handle);
        const seo = await seoOf(url);
        if (!c.body_html) {
          // Liste uç noktası bazı mağazalarda açıklamayı boş döner; tekil uç nokta dolu verir.
          try {
            const one = (await json(`/collections/${c.handle}.json`)).collection;
            c.body_html = one?.body_html || one?.description || '';
          } catch { /* okunamadı: aşağıda işaretlenir */ }
        }
        // Açıklama okunamadıysa sayfa "boş" sanılıp sıfırdan yazılmasın (içindeki marka bilgisi kaybolur).
        const bodyUnknown = !c.body_html;
        pages.push({ type: 'collection', externalId: String(c.id), handle: c.handle, title: c.title, url, bodyHtml: c.body_html || '',
          seoTitle: seo.title, seoDescription: seo.desc, imageUrl: c.image?.src ?? null, menuPath: null, updatedAt: c.updated_at, raw: { id: c.id, bodyUnknown } });
        const prods = (await json(`/collections/${c.handle}/products.json?limit=250`)).products;
        for (const p of prods) {
          if (pages.some((x) => x.type === 'product' && x.externalId === String(p.id))) continue;
          const purl = this.publicUrl('product', p.handle);
          const pseo = await seoOf(purl);
          pages.push({ type: 'product', externalId: String(p.id), handle: p.handle, title: p.title, url: purl, bodyHtml: p.body_html || '',
            seoTitle: pseo.title, seoDescription: pseo.desc, imageUrl: p.images?.[0]?.src ?? null, parentHandle: c.handle, menuPath: c.title, updatedAt: p.updated_at, raw: { id: p.id } });
          await sleep(700);
        }
        await sleep(1000);
      }
      // Blog yazıları: Shopify'ın herkese açık Atom akışı (konu çakışması ve iç bağlantı listesi için).
      const blogHandle = config.store.blogHandle || 'news';
      try {
        const { status, text } = await fetchText(`${base}/blogs/${blogHandle}.atom`);
        if (status === 200) {
          for (const e of text.split('<entry>').slice(1)) {
            const title = (e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]?.trim();
            const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1];
            const id = (e.match(/<id>([^<]+)<\/id>/) || [])[1] || link;
            if (title && link) pages.push({ type: 'article', externalId: id, handle: link.split('/').pop(), title: title.replace(/&amp;/g, '&'), url: link, bodyHtml: '', parentHandle: blogHandle, raw: null });
          }
        }
      } catch (err) {
        log('public_blog_unavailable', { error: String(err.message).slice(0, 120) });
      }
      log('public_read', { collections: wanted.length, pages: pages.length });
      return pages;
    },

    async readPage(type, externalId) {
      throw new Error(`salt-okunur modda ${type} ${externalId} canlı okunamaz; API anahtarı ekleyin`);
    },
    async writePage() {
      throw new Error('salt-okunur mod: mağazaya yazma yetkisi yok');
    },
    async findArticle() {
      return null;
    },
  };
}
