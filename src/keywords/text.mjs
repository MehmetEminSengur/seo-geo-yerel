// Türkçe metin karşılaştırma yardımcıları. Gerçek bir mağazada kullanılan eşleme kapısından genelleştirildi:
// küçük harf, aksansız, ı→i; Türkçe ünsüz yumuşaması (kap→kabı, kağıt→kağıdı) aynı kök sayılır.
const STOP = new Set(['ve', 'ile', 'icin', 'bir', 'en', 'de', 'da', 'mi', 'mu', 'ne', 'li', 'lu']);

export const norm = (s) => String(s || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export const words = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

export const hasPhrase = (text, phrase) => ` ${norm(text)} `.includes(` ${norm(phrase)} `);

export const stripHtml = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const rootMatch = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
const unvoice = (s) => s.replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k');

// Kaba Türkçe gövdeleme: çoğul ve hal ekleri soyulur (kapları → kap, kasesi → kase). Gövde en az 3 harf kalır.
const SUFFIXES = ['larindan', 'lerinden', 'lari', 'leri', 'nin', 'nun', 'dan', 'den', 'tan', 'ten', 'lar', 'ler', 'si', 'su', 'in', 'un', 'da', 'de', 'ta', 'te', 'i', 'u'];
export function stem(w) {
  let s = w;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= 3) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }
  return s;
}

export const sameRoot = (a, b) => rootMatch(a, b) || rootMatch(unvoice(a), unvoice(b)) || rootMatch(unvoice(stem(a)), unvoice(stem(b)));

// Kelime bu sayfanın ailesinden mi? Sayfa başlığındaki anlamlı kelimeler aramada da geçmeli:
// 1-2 kelimelik başlıkta hepsi, daha uzun başlıkta en az ikisi. "havlu kağıt rulosu" → "Pos Ruloları"
// yalnız "rulo"da eşleştiği için reddedilir.
export function familyMatch(pageTitle, keyword) {
  const title = words(pageTitle);
  const kw = words(keyword);
  const hits = title.filter((t) => kw.some((k) => sameRoot(t, k))).length;
  return title.length > 0 && (title.length <= 2 ? hits === title.length : hits >= 2);
}

// İki ifade ne kadar örtüşüyor (0–1)? Blog konusu çakışması için.
export function overlap(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return 0;
  const hits = A.filter((x) => B.some((y) => sameRoot(x, y))).length;
  return hits / Math.max(A.length, B.length);
}
