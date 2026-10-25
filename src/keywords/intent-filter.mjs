// Niyet süzgeci. Kelime araçları içinde ürün adı geçen her şeyi getirir: "karton bardakta kek",
// "karton bardaktan telefon yapımı", rakip marka adları. Bunlar ürün/kategori sayfasının hedefi
// olamaz. Bilgi niyetli olanlar (nedir, nasıl) silinmez; blog havuzuna gider.
import { norm, hasPhrase } from './text.mjs';

export const DEFAULT_RULES = {
  // Yemek kelimeleri (kek, pasta…) bir ambalaj mağazasında "Pasta Kutusu" gibi ürün adı da olabilir;
  // katalogda bir sayfa başlığında geçen kelime gürültü sayılmaz (classifyKeyword → catalogTitles).
  off_topic: ['yapimi', 'nasil yapilir', 'yapilisi', 'kendin yap', 'tarif', 'tarifi', 'tarifleri', 'zayiflama', 'diyet', 'kdv', 'kdv orani',
    'oyuncak', 'hikaye', 'sarki', 'sozleri', 'ruyada', 'ruya', 'anlami', 'resim', 'boyama', 'hobi', 'odev', 'proje odevi',
    'kek', 'puding', 'kurabiye', 'muffin', 'sufle', 'cupcake', 'tatli', 'yemek tarifi', 'hurda', 'ikinci el', 'kiralik', 'is ilani', 'is ilanlari', 'maas'],
  claim_risk: ['uretici', 'ureticisi', 'ureticileri', 'ureticiler', 'fabrika', 'fabrikasi', 'imalat', 'imalatci', 'imalatcilari'],
  informational: ['nedir', 'nasil', 'neden', 'nicin', 'hangisi', 'hangi', 'midir', 'mudur', 'mi', 'mu', 'farki', 'farklari', 'zararli mi', 'ne ise yarar', 'kac', 'ne kadar sure'],
};

// brand-facts.json içindeki rakipler ve "üretici miyiz?" bilgisi kuralları kişiselleştirir.
export function buildRules(brandFacts = {}) {
  const extra = brandFacts?.keywordRules || {};
  return {
    competitor_brands: (brandFacts?.competitors || []).map(norm),
    off_topic: [...DEFAULT_RULES.off_topic, ...(extra.offTopic || []).map(norm)],
    claim_risk: brandFacts?.isManufacturer ? [] : [...DEFAULT_RULES.claim_risk],
    informational: DEFAULT_RULES.informational,
  };
}

// Katalogdaki bir sayfa başlığında geçen kelime "gürültü" sayılmaz (ör. "Pasta Kutusu" ürünü varsa
// "pasta kutusu fiyat" elenmez). catalogTitles: kapsamdaki sayfa başlıkları.
// Dönen route: 'page' (ürün/kategori hedefi olabilir), 'blog' (bilgi niyeti), 'drop' (hiçbir yere).
export function classifyKeyword(keyword, rules, catalogTitles = []) {
  const titles = Array.isArray(catalogTitles) ? catalogTitles : [catalogTitles];
  const inCatalog = (p) => titles.some((t) => hasPhrase(t, p));
  const checks = [['competitor_brands', 'rakip marka', 'drop'], ['off_topic', 'konu dışı', 'drop'], ['claim_risk', 'iddia riski', 'drop'], ['informational', 'bilgi niyeti', 'blog']];
  for (const [key, label, route] of checks) {
    const hit = (rules[key] || []).find((p) => hasPhrase(keyword, p) && (key === 'competitor_brands' || !inCatalog(p)));
    if (hit) return { route, reason: `${label}: ${hit}` };
  }
  return { route: 'page', reason: null };
}
