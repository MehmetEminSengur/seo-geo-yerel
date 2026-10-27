// Shopify seçilince varsayılan bağlantı Shopify CLI; .env'de uygulama anahtarı olan eski kurulumlar bozulmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopifyAuthMode } from '../src/platforms/shopify.mjs';

test('anahtar yoksa Shopify CLI ile bağlanılır', () => {
  assert.equal(shopifyAuthMode({ store: { platform: 'shopify' }, env: {} }), 'cli');
});

test('.env\'de uygulama anahtarı varsa onu kullanır', () => {
  assert.equal(shopifyAuthMode({ store: {}, env: { SHOPIFY_CLIENT_ID: 'x' } }), 'app');
  assert.equal(shopifyAuthMode({ store: {}, env: { SHOPIFY_ADMIN_TOKEN: 'x' } }), 'app');
});

test('config.json → store.auth her zaman önceliklidir', () => {
  assert.equal(shopifyAuthMode({ store: { auth: 'cli' }, env: { SHOPIFY_CLIENT_ID: 'x' } }), 'cli');
  assert.equal(shopifyAuthMode({ store: { auth: 'app' }, env: {} }), 'app');
});
