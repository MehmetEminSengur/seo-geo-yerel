// `kontrol` komutu: kurulumun her parçasını sınar ve Türkçe, madde madde sonuç verir. Ajan bu
// çıktıya bakarak kullanıcıya eksik olanı söyler. Gizli anahtarların değeri asla yazdırılmaz.
import { loadConfig } from './core/config.mjs';
import { probeEngines } from './engines/text/index.mjs';
import { openDb } from './db/db.mjs';
import { createAdapter } from './platforms/adapter.mjs';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`  · ${m}`);

const NEEDS = {
  shopify: [['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'], ['SHOPIFY_ADMIN_TOKEN']],
  ideasoft: [['IDEASOFT_CLIENT_ID', 'IDEASOFT_CLIENT_SECRET', 'IDEASOFT_REFRESH_TOKEN']],
  ikas: [['IKAS_CLIENT_ID', 'IKAS_CLIENT_SECRET']],
  'shopify-public': [[]],
};

export async function runSetup() {
  const config = loadConfig();
  let problems = 0;
  console.log('\n1) Node.js');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`); else { bad(`Node ${process.versions.node} — en az 22 gerekli`); problems++; }

  console.log('\n2) Ayar dosyaları');
  if (config.configured) ok('config.json var'); else { bad('config.json yok — config.example.json dosyasını kopyalayıp doldurun'); problems++; }
  if (config.brandFacts) ok(`brand-facts.json var (${config.brandFacts.facts?.length || 0} marka bilgisi, ${config.brandFacts.competitors?.length || 0} rakip)`);
  else info('brand-facts.json yok — marka bilgileri olmadan da çalışır ama önerilir');

  console.log('\n3) Mağaza anahtarları (.env)');
  const platform = config.store?.platform;
  const sets = NEEDS[platform];
  if (!sets) { bad(`store.platform tanımsız ya da desteklenmiyor: ${platform}`); problems++; }
  else {
    const complete = sets.find((keys) => keys.every((k) => config.env[k]));
    if (complete) ok(complete.length ? `${platform}: ${complete.join(', ')} tanımlı` : `${platform}: anahtar gerekmez (salt-okunur önizleme modu)`);
    else { bad(`${platform} için .env içinde şunlar eksik: ${sets.map((s) => s.join(' + ')).join('  YA DA  ')}`); problems++; }
  }
  if (config.keywords.source === 'dataforseo') {
    if (config.env.DATAFORSEO_LOGIN && config.env.DATAFORSEO_PASSWORD) ok('DataForSEO giriş bilgileri tanımlı');
    else { bad('keywords.source = dataforseo ama DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD yok'); problems++; }
  } else info('Kelime verisi: ücretsiz kaynaklar (Google önerileri)');

  console.log('\n4) Yapay zekâ motoru');
  const engines = await probeEngines();
  for (const [name, v] of Object.entries(engines)) info(`${name}: ${v ?? 'kurulu değil'}`);
  const chosen = config.engines.text;
  if (engines[chosen]) ok(`seçili motor (${chosen}) kurulu`); else { bad(`seçili motor (${chosen}) bulunamadı`); problems++; }
  if (config.engines.image === 'api' && !config.env.OPENAI_API_KEY && !config.env.GEMINI_API_KEY) { bad('engines.image = api ama OPENAI_API_KEY / GEMINI_API_KEY yok'); problems++; }

  if (config.configured && sets) {
    console.log('\n5) Mağaza bağlantısı');
    try {
      const db = openDb(config.dataDir);
      const adapter = createAdapter(config, db, () => {});
      const pages = await adapter.listAll();
      const by = pages.reduce((m, p) => ({ ...m, [p.type]: (m[p.type] || 0) + 1 }), {});
      ok(`Bağlandı: ${by.product || 0} ürün, ${by.collection || 0} kategori, ${by.article || 0} blog yazısı`);
      const caps = adapter.capabilities();
      const writable = Object.entries(caps).filter(([, v]) => v === true || v?.body || v?.create).map(([k]) => k);
      info(writable.length ? `API ile yazılabilenler: ${writable.join(', ')}` : 'Yazma yetkisi yok: onaylananlar data/export klasörüne kopyala-yapıştır dosyası olarak yazılır');
    } catch (err) {
      bad(`Bağlantı kurulamadı: ${err.message}`);
      problems++;
    }
  }
  console.log(problems ? `\n${problems} sorun var. Yukarıdaki ✗ satırlarını düzeltin.\n` : '\nHer şey hazır. Sıradaki adım: node bin/seo-geo.mjs preview\n');
  process.exitCode = problems ? 1 : 0;
}
