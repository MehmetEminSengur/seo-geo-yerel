// `geo-kontrol` komutu: metin ne kadar iyi olursa olsun, yapay zekâ botu sayfayı okuyamıyorsa
// cevaplarda görünmez. İki şeye bakar ve mağazaya hiçbir şey yazmaz:
//   1. Bot erişimi: robots.txt hangi arama ve yapay zekâ botlarına kapıyı açıyor? (RFC 9309)
//   2. Şema: ürün/kategori/blog sayfalarının JavaScript çalışmadan gelen ilk HTML'inde hangi
//      JSON-LD kimlik kartları var? ChatGPT, Claude ve Perplexity botları JavaScript çalıştırmaz.
import { loadConfig } from '../core/config.mjs';
import { openDb } from '../db/db.mjs';

// onem: kritik = kapalıysa o arama/yapay zekâda görünmezsiniz; tercih = model eğitimi, kapatmak sizin seçiminiz.
export const BOTS = [
  { ua: 'Googlebot', ad: 'Google arama + yapay zekâ özetleri', onem: 'kritik' },
  { ua: 'Bingbot', ad: 'Bing + Copilot', onem: 'kritik' },
  { ua: 'OAI-SearchBot', ad: 'ChatGPT arama', onem: 'kritik' },
  { ua: 'ChatGPT-User', ad: 'ChatGPT kullanıcı adına sayfa açınca', onem: 'kritik' },
  { ua: 'PerplexityBot', ad: 'Perplexity arama', onem: 'kritik' },
  { ua: 'Claude-SearchBot', ad: 'Claude arama', onem: 'kritik' },
  { ua: 'GPTBot', ad: 'OpenAI model eğitimi', onem: 'tercih' },
  { ua: 'ClaudeBot', ad: 'Anthropic model eğitimi', onem: 'tercih' },
  { ua: 'Google-Extended', ad: 'Gemini eğitimi', onem: 'tercih' },
];

// Botun kimliğiyle istek atınca güvenlik duvarı farklı davranıyor mu? (Google'ı taklit etmiyoruz:
// sahte Googlebot'u engellemek doğru davranıştır, yanlış alarm verir.)
const UA_TEST = {
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Claude-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
};
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ---------- robots.txt ----------

export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let inAgents = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      // Art arda user-agent satırları tek grup; kuraldan sonra gelen user-agent yeni grup açar.
      if (!inAgents) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      inAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgents = false;
      if (cur && val) cur.rules.push({ allow: key === 'allow', path: val }); // boş Disallow = kural yok
    }
  }
  return groups;
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\*]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

// Botun adına birebir uyan grup(lar) varsa yalnız onlar, yoksa "*" grubu geçerli. En uzun eşleşen
// kural kazanır; eşitlikte Allow kazanır.
export function isAllowed(groups, ua, path) {
  if (path === '/robots.txt') return { allowed: true, group: null, rule: null };
  const token = ua.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(token));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const r of chosen.flatMap((g) => g.rules)) {
    if (!patternToRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return { allowed: best ? best.allow : true, group: own.length ? ua : chosen.length ? '*' : null, rule: best };
}

// ---------- JSON-LD ----------

export function jsonLd(html) {
  const types = [];
  let broken = 0;
  const collect = (node) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== 'object') return;
    for (const t of [].concat(node['@type'] ?? [])) types.push(String(t));
    if (node['@graph']) collect(node['@graph']);
  };
  for (const m of String(html || '').matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(m[1].trim())); } catch { broken++; }
  }
  return { types: [...new Set(types)], broken, systemFaq: /data-seo-geo=["']faq-schema["']/.test(html || '') };
}

// Shopify'da yayına açılmamış mağaza her adresi /password sayfasına yönlendirir; botlar da onu görür.
const passwordPage = (r) => { try { return new URL(r.url).pathname === '/password'; } catch { return false; } };

// --url ile verilen adresin tipi, adres kalıbından (Shopify, IdeaSoft) tahmin edilir.
export const guessType = (url) => { const p = new URL(url).pathname; return /\/(products|urun)\//.test(p) ? 'product' : /\/(collections|kategori)\//.test(p) ? 'collection' : /\/blogs\//.test(p) ? 'article' : 'extra'; };

const has = (types, ...want) => want.some((w) => types.includes(w));

// Sayfa tipine göre beklenen şemalar. Dönen satırlar: { durum: 'ok' | 'bad' | 'info', mesaj }.
export function schemaFindings(type, ld, { faqInDb = false } = {}) {
  const out = [];
  const ok = (mesaj) => out.push({ durum: 'ok', mesaj });
  const bad = (mesaj) => out.push({ durum: 'bad', mesaj });
  const info = (mesaj) => out.push({ durum: 'info', mesaj });
  if (ld.broken) bad(`${ld.broken} JSON-LD bloğu bozuk (JSON okunamıyor): botlar bunu yok sayar`);
  if (type === 'product') {
    if (has(ld.types, 'Product', 'ProductGroup')) ok('Ürün şeması (Product) ilk HTML\'de');
    else bad('Ürün şeması (Product) yok: fiyat, stok ve marka makineye anlatılmıyor. Temanız eklemiyor olabilir');
  } else if (type === 'article') {
    if (has(ld.types, 'Article', 'BlogPosting', 'NewsArticle')) ok('Blog şeması (Article) ilk HTML\'de');
    else bad('Blog şeması (Article / BlogPosting) yok');
  } else if (type === 'collection') {
    if (has(ld.types, 'CollectionPage', 'ItemList')) ok('Kategori şeması (CollectionPage / ItemList) ilk HTML\'de');
    else info('Kategori şeması yok: çoğu temada yoktur, zorunlu değil');
  }
  if (has(ld.types, 'BreadcrumbList')) ok('Gezinme yolu şeması (BreadcrumbList) var');
  if (faqInDb) {
    if (ld.systemFaq || has(ld.types, 'FAQPage')) ok('Sistemin eklediği SSS şeması (FAQPage) yayındaki sayfada da var');
    else bad('Sistem SSS şeması ekledi ama yayındaki sayfada yok: platform ya da tema <script> etiketini siliyor olabilir');
  }
  return out;
}

// ---------- komut ----------

async function get(url, ua = 'seo-geo-yerel/0.1 (+geo-kontrol)') {
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, text: await res.text(), headers: res.headers, url: res.url };
  } catch (err) {
    return { status: 0, text: '', headers: new Headers(), error: err.message };
  }
}

function samplePages(db) {
  // Her tipten bir sayfa; ürün için mümkünse sistemin SSS eklediği bir sayfa.
  const pick = (type) => db.prepare(`SELECT type, url, title, body_html FROM pages WHERE lifecycle = 'active' AND type = ? AND url IS NOT NULL
      ORDER BY (body_html LIKE '%data-seo-geo="faq-schema"%') DESC, last_applied_at DESC, title LIMIT 1`).get(type);
  return ['product', 'collection', 'article'].map(pick).filter(Boolean);
}

export async function runGeoCheck({ extraUrl } = {}) {
  const config = loadConfig();
  const line = { ok: (m) => console.log(`  ✓ ${m}`), bad: (m) => console.log(`  ✗ ${m}`), info: (m) => console.log(`  · ${m}`) };
  const base = String(config.store?.publicUrl || (config.store?.domain ? `https://${config.store.domain}` : '')).replace(/\/$/, '');
  if (!base) throw new Error('config.json içinde store.publicUrl yok (ör. https://www.magazam.com)');
  let problems = 0;
  const db = openDb(config.dataDir);
  const pages = samplePages(db);
  const paths = ['/', ...pages.map((p) => new URL(p.url).pathname)];

  console.log(`\nSite: ${base}\n\n1) robots.txt: botlar sayfalara girebiliyor mu?`);
  const robots = await get(`${base}/robots.txt`);
  const groups = robots.status === 200 ? parseRobots(robots.text) : [];
  if (robots.status === 200) line.ok('robots.txt okundu');
  else if (robots.status === 404) line.info('robots.txt yok: kural olmadığı için bütün botlara açık');
  else { line.bad(`robots.txt okunamadı (${robots.status || robots.error}). 5xx dönen robots.txt, Google'da bütün siteyi kapatmak gibi davranır`); problems++; }
  if (/Cloudflare Managed|BEGIN Cloudflare/i.test(robots.text)) line.info('robots.txt\'nin bir kısmını Cloudflare yönetiyor: yapay zekâ botlarını oradan da kapatabilir');
  for (const bot of BOTS) {
    const blocked = paths.map((p) => ({ p, r: isAllowed(groups, bot.ua, p) })).filter((x) => !x.r.allowed);
    const label = `${bot.ua} (${bot.ad})`;
    if (!blocked.length) line.ok(`${label}: açık`);
    else if (bot.onem === 'kritik') { line.bad(`${label}: KAPALI → ${blocked.map((b) => `${b.p} [${b.r.rule.path}]`).join(', ')}`); problems++; }
    else line.info(`${label}: kapalı. Bu yalnız model eğitimini etkiler; açıp açmamak sizin tercihiniz`);
  }

  console.log('\n2) Güvenlik duvarı: botun kimliğiyle gelen istek engelleniyor mu?');
  const human = await get(`${base}/`, BROWSER_UA);
  const cloudflare = (human.headers.get('server') || '').toLowerCase().includes('cloudflare') || human.headers.has('cf-ray');
  if (passwordPage(human)) { line.bad('Mağaza şifre korumalı: botlar da yalnız şifre ekranını görüyor. Mağazayı yayına açınca bu kontrolü tekrarlayın'); problems++; }
  const shopify = String(config.store?.platform || '').startsWith('shopify');
  if (cloudflare && shopify) line.info('Shopify mağazaları Cloudflare altyapısından sunulur; bu ayar Shopify\'ın elinde. Aşağıdaki testler geçiyorsa sorun yok');
  else if (cloudflare) line.info('Site Cloudflare arkasında. Cloudflare yapay zekâ botlarını varsayılan olarak engelleyebiliyor: panelde "AI Crawl Control" / yapay zekâ botu ayarlarına bakın');
  for (const [ua, header] of Object.entries(UA_TEST)) {
    const r = await get(`${base}/`, header);
    const challenged = r.headers.get('cf-mitigated') === 'challenge';
    if (human.status === 200 && r.status === 200 && !challenged) line.ok(`${ua} kimliğiyle ana sayfa açıldı`);
    else if (human.status === 200) {
      line.bad(`${ua} kimliğiyle ${challenged ? 'doğrulama ekranı' : `${r.status || r.error}`} döndü: güvenlik duvarı bu botu engelliyor olabilir. (Bu test bizim bilgisayardan yapılıyor; kesin cevap Cloudflare/hosting panelinde)`);
      problems++;
    } else line.info(`Ana sayfa normal tarayıcıyla da ${human.status || human.error} döndü; bot testi anlamlı değil`);
  }

  console.log('\n3) Şema: ilk HTML\'de (JavaScript çalışmadan) hangi kimlik kartları var?');
  if (!pages.length) line.info('Veritabanında sayfa yok: önce `node bin/seo-geo.mjs sync` (ya da preview) çalıştırın. Şimdilik yalnız ana sayfaya bakılıyor');
  const targets = [{ type: 'home', url: `${base}/`, title: 'Ana sayfa' }, ...pages, ...(extraUrl ? [{ type: guessType(extraUrl), url: extraUrl, title: '--url ile verilen sayfa' }] : [])];
  for (const p of targets) {
    const r = p.type === 'home' ? human : await get(p.url);
    console.log(`\n  ${p.title} — ${p.url}`);
    if (r.status !== 200) { line.bad(`sayfa açılmadı (${r.status || r.error})`); problems++; continue; }
    if (passwordPage(r)) { line.info('şifre ekranına yönlendi: şema kontrolü atlandı'); continue; }
    const ld = jsonLd(r.text);
    line.info(`bulunan şemalar: ${ld.types.length ? ld.types.join(', ') : 'hiç yok'}`);
    if (p.type === 'home') {
      if (has(ld.types, 'Organization', 'OnlineStore', 'Store', 'LocalBusiness', 'WebSite')) line.ok('Mağaza kimliği (Organization / WebSite) var');
      else line.info('Ana sayfada mağaza kimliği (Organization) yok: marka adı, logo ve iletişim makineye anlatılmıyor');
      continue;
    }
    for (const f of schemaFindings(p.type, ld, { faqInDb: /data-seo-geo="faq-schema"/.test(p.body_html || '') })) {
      line[f.durum](f.mesaj);
      if (f.durum === 'bad') problems++;
    }
    if (!/<meta[^>]+name=["']description["']/i.test(r.text)) line.info('meta açıklama etiketi yok');
  }

  const llms = await get(`${base}/llms.txt`);
  console.log('\n4) llms.txt');
  line.info(llms.status === 200 && !/<html/i.test(llms.text) ? 'var' : 'yok. Zorunlu değil; botların bu dosyayı okuduğuna dair güçlü bir kanıt yok');

  console.log(problems ? `\n${problems} sorun var. ✗ satırlarının nasıl düzeltileceği: docs/geo-kontrol.md\n` : '\nBotlar sayfalara girebiliyor ve şemalar ilk HTML\'de. Sorun yok.\n');
  process.exitCode = problems ? 1 : 0;
  return problems;
}
