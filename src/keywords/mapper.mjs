// Kelimeyi doğru rafa koyar: ürün mü, kategori mi? Kural:
//   1. Sayfa ailesi tutmalı (familyMatch) — "rulo" geçiyor diye havlu kağıdı pos rulosuna verme.
//   2. Sayfa tipi: DataForSEO varsa Google'ın ilk 10 sonucu karar verir; yoksa kelimenin biçimi
//      (ölçü/adet içeren → ürün; "fiyat", "toptan", "çeşitleri" → kategori).
//   3. Aynı tipte birden fazla aday varsa başlığı en çok örtüşen kazanır.
import { familyMatch, overlap, norm, words, sameRoot } from './text.mjs';

const PRODUCT_HINT = /\b\d+([.,]\d+)?\s*(cm|mm|m|mt|metre|mikron|gr|g|kg|lt|l|ml|oz|adet|li|lu|lik|luk)\b|\b\d+\s*x\s*\d+\b/;
const COLLECTION_HINT = /\b(fiyat|fiyati|fiyatlari|toptan|cesitleri|cesit|modelleri|markalari|ucuz|en iyi|satin al)\b/;

export function guessPageType(keyword) {
  const k = norm(keyword);
  if (PRODUCT_HINT.test(k)) return 'product';
  if (COLLECTION_HINT.test(k)) return 'collection';
  return k.split(' ').length <= 3 ? 'collection' : 'product';
}

// Bir kelime ancak o ürünü kardeşlerinden ayıran bir ifade içeriyorsa (marka, ölçü, gramaj…) ürün
// sayfasına gider. "alüminyum folyo fiyatı" tek bir ürünün değil kategorinin kelimesidir.
export function distinguishesProduct(keyword, product, pages) {
  // Ortak kelimeler: ürünün kendi kategorisi ve bu kelimeye uyan tüm kategorilerin başlıkları.
  const cols = pages.filter((p) => p.type === 'collection' && ((p.handle && p.handle === product.parent_handle) || familyMatch(p.title, keyword)));
  const shared = cols.flatMap((c) => words(c.title));
  const kw = words(keyword);
  return words(product.title).some((t) => kw.some((k) => sameRoot(k, t)) && !shared.some((x) => sameRoot(x, t)));
}

export function chooseTarget(keyword, pages, serpType = null) {
  const family = pages.filter((p) => familyMatch(p.title, keyword) && (p.type !== 'product' || distinguishesProduct(keyword, p, pages)));
  if (!family.length) return null;
  // Ürünü ayıran ifade içeren kelime (marka, ölçü) özeldir: Google aksini söylemedikçe ürüne gider.
  const specific = family.some((p) => p.type === 'product');
  const want = serpType && serpType !== 'mixed' && serpType !== 'article' ? serpType : specific ? 'product' : guessPageType(keyword);
  const ranked = (list) => list.map((p) => ({ p, s: overlap(p.title, keyword) + (p.menu_path ? 0.05 : 0) })).sort((a, b) => b.s - a.s);
  const preferred = ranked(family.filter((p) => p.type === want));
  const pick = preferred[0] || ranked(family)[0];
  return pick ? { page: pick.p, pageType: pick.p.type, basis: serpType ? `serp:${serpType}` : `biçim:${want}` } : null;
}
