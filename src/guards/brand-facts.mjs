// Sahibin onayladığı marka bilgileri (brand-facts.json). İki iş yapar:
//   1. Her istemin içine TAM olarak girer (gerçek bir mağazada metin 1500 karakterde kesildiği için
//      sondaki "1998'den beri" paragrafı modele hiç ulaşmamış, 25 sayfanın 24'ünde kaybolmuştu).
//   2. Eski metinde geçen onaylı bir bilgi yeni metinde yoksa taslak yayına alınmaz.
import { stripHtml } from '../keywords/text.mjs';

export function brandFactsText(brandFacts) {
  const facts = brandFacts?.facts || [];
  if (!facts.length) return '(marka bilgisi girilmemiş)';
  return facts.map((f) => `- ${f.text}`).join('\n') +
    '\nBu bilgiler eski metinde geçiyorsa yeni metinde de doğal bir cümleyle koru. Geçmiyorsa uygun bir yerde en fazla bir kez kullanabilirsin.';
}

export function lostFacts(beforeHtml, afterHtml, brandFacts) {
  const before = stripHtml(beforeHtml);
  const after = stripHtml(afterHtml);
  return (brandFacts?.facts || [])
    .filter((f) => f.preservePattern)
    .filter((f) => {
      const re = new RegExp(f.preservePattern, 'i');
      return re.test(before) && !re.test(after);
    })
    .map((f) => f.id || f.text);
}
