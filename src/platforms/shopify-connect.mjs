// Shopify ilk bağlantısı (bir kez): Shopify CLI yoksa kurulur, sonra `shopify store auth` tarayıcıda
// Shopify'ın izin ekranını açar. Okuma ve yazma izinleri birlikte istenir; mağaza sahibi yalnız
// "Yükle"ye basar. Anahtarı CLI saklar ve süresi dolunca kendisi yeniler.
import { spawnSync } from 'node:child_process';
import { SHOPIFY_SCOPES } from './shopify.mjs';

const shell = process.platform === 'win32';

export function shopifyCliVersion() {
  const r = spawnSync('shopify', ['version'], { encoding: 'utf8', shell });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function connectShopify(config) {
  const domain = String(config.store?.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/\.myshopify\.com$/.test(domain)) throw new Error('config.json → store.domain mağazanın xxx.myshopify.com adresi olmalı (Shopify admin → Ayarlar → Alan adları)');
  if (!shopifyCliVersion()) {
    console.log('Shopify CLI kuruluyor (bir kez, 1-2 dakika)...');
    // Sınanan ana sürüm 4; yeni ana sürüm komutları değiştirebilir.
    const r = spawnSync('npm', ['install', '-g', '@shopify/cli@4'], { stdio: 'inherit', shell });
    if (r.status !== 0 || !shopifyCliVersion()) throw new Error('Shopify CLI kurulamadı. Elle kurun: npm install -g @shopify/cli@4');
  }
  console.log('\nTarayıcıda Shopify açılacak. Mağaza sahibi hesabıyla girip "Yükle"ye basın (4 dakika içinde).\n');
  const r = spawnSync('shopify', ['store', 'auth', '--store', domain, '--scopes', SHOPIFY_SCOPES], { stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error('Shopify bağlantısı tamamlanmadı. Komutu tekrar çalıştırın; tarayıcıda mağaza sahibi hesabıyla girdiğinizden emin olun.');
  return 'Shopify bağlantısı kuruldu. Kontrol: node bin/seo-geo.mjs kontrol';
}
