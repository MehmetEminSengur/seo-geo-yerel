// İç bağlantılar. Ürün ve kategori sayfalarında bağlantıları model değil sistem ekler (model
// adres uydurmasın). Blogda model yalnızca buradaki izin listesinden bağlantı verebilir.
import { overlap } from '../keywords/text.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const a = (p) => `<a href="${esc(p.url)}">${esc(p.title)}</a>`;

function collectionByHandle(db, handle) {
  return handle ? db.prepare("SELECT * FROM pages WHERE type = 'collection' AND handle = ? AND lifecycle = 'active'").get(handle) : null;
}

// Ürün: kendi kategorisi + aynı kategoriden başlığı en yakın bir alternatif.
export function productLinks(db, page) {
  const col = collectionByHandle(db, page.parent_handle);
  const siblings = page.parent_handle
    ? db.prepare("SELECT * FROM pages WHERE type = 'product' AND parent_handle = ? AND id != ? AND lifecycle = 'active'").all(page.parent_handle, page.id)
    : [];
  const alt = siblings.map((p) => ({ p, s: overlap(p.title, page.title) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s)[0]?.p;
  const parts = [];
  if (col) parts.push(`Bu ürün ${a(col)} kategorisinde yer alıyor.`);
  if (alt) parts.push(`Benzer bir seçenek: ${a(alt)}.`);
  const links = [col, alt].filter(Boolean).map((p) => ({ url: p.url, type: p.type }));
  return { html: parts.length ? `<div data-seo-geo="links"><p>${parts.join(' ')}</p></div>` : '', links };
}

// Menü yolundan akrabalar: üst, alt ve kardeş kategoriler.
export function relatedCollections(db, page, limit = 8) {
  const all = db.prepare("SELECT * FROM pages WHERE type = 'collection' AND lifecycle = 'active' AND id != ?").all(page.id);
  const path = (page.menu_path || '').split(' > ');
  const parentPath = path.slice(0, -1).join(' > ');
  const score = (c) => {
    const cp = (c.menu_path || '').split(' > ');
    if (page.menu_path && c.menu_path) {
      if (c.menu_path === parentPath) return 3; // üst
      if (c.menu_path.startsWith(page.menu_path + ' > ')) return 3; // alt
      if (cp.slice(0, -1).join(' > ') === parentPath) return 2; // kardeş
    }
    return overlap(c.title, page.title) > 0 ? 1 : 0;
  };
  return all.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.c);
}

export function collectionLinks(db, page, { productLimit = 6 } = {}) {
  const related = relatedCollections(db, page);
  const products = db.prepare("SELECT * FROM pages WHERE type = 'product' AND parent_handle = ? AND lifecycle = 'active' ORDER BY title LIMIT ?").all(page.handle, productLimit);
  const blocks = [];
  if (related.length) blocks.push(`<h2>İlgili kategoriler</h2>\n<ul>${related.map((c) => `<li>${a(c)}</li>`).join('')}</ul>`);
  if (products.length) blocks.push(`<h2>Bu kategoride öne çıkanlar</h2>\n<ul>${products.map((p) => `<li>${a(p)}</li>`).join('')}</ul>`);
  const links = [...related, ...products].map((p) => ({ url: p.url, type: p.type }));
  return { html: blocks.length ? `<div data-seo-geo="links">\n${blocks.join('\n')}\n</div>` : '', links, related, products };
}

// Blog için izin listesi: konuya en yakın kategoriler ve eski yazılar.
export function blogAllowlist(db, keyword, { collections = 6, articles = 8 } = {}) {
  const rank = (rows) => rows.map((p) => ({ p, s: overlap(p.title, keyword) })).sort((x, y) => y.s - x.s).map((x) => x.p);
  const cols = rank(db.prepare("SELECT * FROM pages WHERE type = 'collection' AND lifecycle = 'active' AND url IS NOT NULL").all()).slice(0, collections);
  const arts = rank(db.prepare("SELECT * FROM pages WHERE type = 'article' AND lifecycle = 'active' AND url IS NOT NULL").all()).slice(0, articles);
  return { collections: cols, articles: arts, urls: new Set([...cols, ...arts].map((p) => p.url)) };
}
