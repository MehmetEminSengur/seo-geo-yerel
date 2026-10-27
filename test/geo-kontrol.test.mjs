// robots.txt yorumu RFC 9309'a göre: yanlış yorum, açık bir siteyi "kapalı" ya da tersini gösterir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, jsonLd, schemaFindings } from '../src/site/geo-kontrol.mjs';

const allowed = (txt, ua, path) => isAllowed(parseRobots(txt), ua, path).allowed;

test('robots.txt yoksa ya da boşsa her şey açık', () => {
  assert.equal(allowed('', 'OAI-SearchBot', '/products/x'), true);
  assert.equal(allowed('User-agent: *\nDisallow:', 'GPTBot', '/'), true);
});

test('bota özel grup varsa "*" grubu o bot için hiç uygulanmaz', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /';
  assert.equal(allowed(txt, 'OAI-SearchBot', '/products/x'), true);
  assert.equal(allowed(txt, 'PerplexityBot', '/products/x'), false);
});

test('bot adı büyük/küçük harfe duyarsız, art arda user-agent satırları tek grup', () => {
  const txt = 'User-agent: gptbot\nUser-agent: ClaudeBot\nDisallow: /';
  assert.equal(allowed(txt, 'GPTBot', '/'), false);
  assert.equal(allowed(txt, 'ClaudeBot', '/a'), false);
  assert.equal(allowed(txt, 'Claude-SearchBot', '/a'), true);
});

test('en uzun kural kazanır, eşitlikte Allow', () => {
  const txt = 'User-agent: *\nDisallow: /collections\nAllow: /collections/folyo\nDisallow: /a\nAllow: /a';
  assert.equal(allowed(txt, 'Bingbot', '/collections/streç'), false);
  assert.equal(allowed(txt, 'Bingbot', '/collections/folyo'), true);
  assert.equal(allowed(txt, 'Bingbot', '/a'), true);
});

test('* ve $ joker karakterleri: Shopify\'ın varsayılan robots.txt kuralları ürünü kapatmaz', () => {
  const shopify = 'User-agent: *\nDisallow: /cart\nDisallow: /collections/*sort_by*\nDisallow: /*/collections/*+*\nDisallow: /search';
  assert.equal(allowed(shopify, 'OAI-SearchBot', '/products/streç-film'), true);
  assert.equal(allowed(shopify, 'OAI-SearchBot', '/collections/folyo'), true);
  assert.equal(allowed(shopify, 'OAI-SearchBot', '/collections/folyo?sort_by=price'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /*.pdf$', 'GPTBot', '/a.pdf'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /*.pdf$', 'GPTBot', '/a.pdf?x=1'), true);
});

test('Cloudflare\'in yönettiği blok yapay zekâ eğitim botlarını kapatır, arama botlarını değil', () => {
  const cf = '# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n# END Cloudflare Managed Content\n\nUser-agent: *\nDisallow: /cart';
  assert.equal(allowed(cf, 'GPTBot', '/'), false);
  assert.equal(allowed(cf, 'OAI-SearchBot', '/products/x'), true);
});

test('JSON-LD: @graph, dizi ve bozuk blok', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Product","Thing"]}]}</script>
    <script type='application/ld+json'>[{"@type":"BreadcrumbList"}]</script>
    <script type="application/ld+json">{ bozuk </script>
    <script type="application/ld+json" data-seo-geo="faq-schema">{"@type":"FAQPage"}</script>`;
  const ld = jsonLd(html);
  assert.deepEqual(ld.types.sort(), ['BreadcrumbList', 'FAQPage', 'Organization', 'Product', 'Thing']);
  assert.equal(ld.broken, 1);
  assert.equal(ld.systemFaq, true);
});

test('şema bulguları: ürün şeması eksikse ve sistemin SSS şeması yayında silinmişse hata', () => {
  const bad = schemaFindings('product', { types: ['Organization'], broken: 0, systemFaq: false }, { faqInDb: true }).filter((f) => f.durum === 'bad');
  assert.equal(bad.length, 2);
  const good = schemaFindings('product', { types: ['Product', 'FAQPage'], broken: 0, systemFaq: true }, { faqInDb: true });
  assert.ok(good.every((f) => f.durum === 'ok'));
  // Kategori şeması çoğu temada yok: hata sayılmaz.
  assert.ok(schemaFindings('collection', { types: [], broken: 0, systemFaq: false }).every((f) => f.durum !== 'bad'));
});
