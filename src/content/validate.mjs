// Taslak doğrulayıcı. Hatalar (errors) taslağı yayına almaz; uyarılar (warnings) önizlemede
// gösterilir. Kuralların çoğu gerçek bir mağazada yaşanmış bir sorundan geliyor.
import { stripHtml, norm, sameRoot, words } from '../keywords/text.mjs';
import { lostFacts } from '../guards/brand-facts.mjs';

const CTA = ['inceleyin', 'inceleyebilirsiniz', 'kesfedin', 'kesfet', 'satin alin', 'kacirmayin', 'hemen', 'tiklayin', 'en uygun fiyat', 'optimize edin'];
const CLAIMS = ['ce', 'fda', 'tse', 'iso', 'steril', 'biyobozunur', 'kompostlanabilir', 'sertifikali', 'antibakteriyel', '100'];
const HEDGE = /mevcut (urun )?(bilgi(si|sine|lerine)?|aciklama(si|sina)?|veri(si|sine)?) gore/;
const SPEC = /\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:cm|mm|m|mt|metre|mikron|micron|gr|g|kg|lt|l|ml|cl|oz|adet|li|lu|lik|luk|'li|'lu)\b/g;

const LIMITS = {
  product: { words: [120, 480], faq: [3, 5] },
  collection: { words: [220, 600], faq: [3, 5] },
  article: { words: [700, 1900], faq: [4, 6] },
};

const specsOf = (text) => new Set((norm(text).match(SPEC) || []).map((s) => s.replace(/\s+/g, '')));

export function validateDraft(draft, { type, source = '', beforeHtml = '', brandFacts, targetKeyword, allowedUrls } = {}) {
  const errors = [];
  const warnings = [];
  const lim = LIMITS[type];
  const title = draft.seoTitle || '';
  const desc = draft.seoDescription || '';
  const bodyText = stripHtml(draft.modelHtml ?? draft.html);

  if (title.length < 25 || title.length > 75) errors.push(`Google başlığı ${title.length} karakter (25-75 olmalı)`);
  else if (title.length < 45) warnings.push(`Google başlığı kısa: ${title.length} karakter`);
  if (desc.length < 110 || desc.length > 165) errors.push(`Meta açıklama ${desc.length} karakter (120-155 hedef)`);
  if (desc && !/[.!?]$/.test(desc.trim())) errors.push('Meta açıklama yarım cümleyle bitiyor');
  const ctaHit = CTA.find((c) => ` ${norm(desc)} `.includes(` ${c} `));
  if (ctaHit) errors.push(`Meta açıklamada reklam kalıbı: "${ctaHit}"`);

  const html = draft.modelHtml ?? draft.html ?? '';
  if (/<h1[\s>]/i.test(html)) errors.push('Gövdede <h1> var');
  if (/<img[\s>]|<script[\s>]/i.test(html)) errors.push('Gövdede <img> ya da <script> var');
  if (type !== 'article' && /<a[\s>]/i.test(html)) errors.push('Model bağlantı eklemiş; ürün/kategori bağlantılarını sistem ekler');
  if (type !== 'article' && !/^\s*<blockquote>/i.test(html)) errors.push('İlk blok kısa cevap (<blockquote>) değil');
  if (type === 'article') {
    const firstP = (html.match(/<p[\s>][\s\S]*?<\/p>/i) || [''])[0];
    if (/<a[\s>]/i.test(firstP)) errors.push('Giriş paragrafında bağlantı var');
    if (!/<blockquote>/i.test(html.split(/<h2[\s>]/i)[0] || '')) errors.push('İlk başlıktan önce kısa cevap bloğu yok');
    if (!/<table[\s>]/i.test(html)) warnings.push('Karşılaştırma tablosu yok');
    for (const href of [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
      if (!allowedUrls?.has(href)) errors.push(`İzin listesinde olmayan bağlantı: ${href}`);
    }
  }
  if (/[　-鿿가-힯Ѐ-ӿ]/.test(bodyText + title + desc)) errors.push('Türkçe dışı karakter (Çince/Kiril vb.) var');

  const n = bodyText.split(/\s+/).filter(Boolean).length;
  if (lim && (n < lim.words[0] || n > lim.words[1])) warnings.push(`Uzunluk ${n} kelime (hedef ${lim.words.join('-')})`);
  const faqN = draft.faq?.length || 0;
  if (lim && (faqN < lim.faq[0] || faqN > lim.faq[1])) warnings.push(`${faqN} SSS var (hedef ${lim.faq.join('-')})`);

  // Uydurma ölçü: taslaktaki her ölçü/adet ifadesi kaynakta da geçmeli.
  const srcSpecs = specsOf(source);
  const invented = [...specsOf(`${bodyText} ${(draft.faq || []).map((f) => `${f.q} ${f.a}`).join(' ')} ${title} ${desc}`)].filter((s) => !srcSpecs.has(s));
  if (invented.length) errors.push(`Kaynakta olmayan ölçü/adet: ${invented.slice(0, 5).join(', ')}`);

  const srcNorm = ` ${norm(source)} `;
  const outNorm = ` ${norm(`${bodyText} ${title} ${desc} ${(draft.faq || []).map((f) => f.a).join(' ')}`)} `;
  const claim = CLAIMS.find((c) => outNorm.includes(` ${c} `) && !srcNorm.includes(` ${c} `));
  if (claim) errors.push(`Kaynakta olmayan uygunluk iddiası: "${claim}"`);

  const lost = lostFacts(beforeHtml, html, brandFacts);
  if (lost.length) errors.push(`Eski metindeki onaylı marka bilgisi kaybolmuş: ${lost.join(', ')}`);
  if (HEDGE.test(norm(bodyText))) warnings.push('Çekingen kalıp: "mevcut ürün bilgisine göre"');

  if (targetKeyword) {
    const kw = words(targetKeyword);
    const t = words(title);
    const hit = kw.filter((k) => t.some((x) => sameRoot(x, k))).length;
    if (hit < Math.min(2, kw.length)) warnings.push(`Hedef kelime ("${targetKeyword}") Google başlığında zayıf`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
