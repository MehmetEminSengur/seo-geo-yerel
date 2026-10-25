// Sıkça sorulan sorular tek bir listeden hem sayfaya (görünür) hem de şema koduna (FAQPage
// JSON-LD) yazılır; ikisi hiçbir zaman birbirinden kopmaz. Sistem eklediği bölümleri
// data-seo-geo işaretiyle sarar ki sonraki üretimde modele "eski metin" olarak geri gitmesin.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function faqHtml(faq) {
  if (!faq?.length) return '';
  const items = faq.map((f) => `<p><strong>${esc(f.q)}</strong><br>${esc(f.a)}</p>`).join('\n');
  return `<div data-seo-geo="faq">\n<h2>Sıkça Sorulan Sorular</h2>\n${items}\n</div>`;
}

export function faqJsonLd(faq, url) {
  if (!faq?.length) return '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(url ? { '@id': `${url}#faq` } : {}),
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  return `<script type="application/ld+json" data-seo-geo="faq-schema">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// Önceki çalıştırmanın eklediği bölümleri metinden ayıklar.
export function stripSystemSections(html) {
  // Sistem bölümlerinin içinde iç içe <div> yok, bu yüzden ilk </div> bölümü kapatır.
  return String(html || '')
    .replace(/<div data-seo-geo="(faq|links)">[\s\S]*?<\/div>/g, '')
    .replace(/<script type="application\/ld\+json" data-seo-geo="[^"]*">[\s\S]*?<\/script>/g, '')
    .trim();
}
