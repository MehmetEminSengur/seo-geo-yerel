// config.json (ayarlar), brand-facts.json (marka bilgisi) ve .env (gizli anahtarlar) okunur.
// .env için harici paket yok: KEY=değer satırları, # yorum, tırnaklar soyulur.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export const DEFAULTS = {
  mode: 'approval', // approval: her değişiklik önizleme + onay ister; auto: doğrulamayı geçen uygulanır
  engines: { text: 'codex', image: 'product-image' },
  keywords: { source: 'free', language: 'tr', location: 'Turkey', autocompleteDepth: 1 },
  limits: {
    dataforseo: { totalUsd: 1, dailyUsd: 0.25 },
    text: { dailyCalls: 40 },
  },
  schedule: { syncEveryHours: 168, keywordsEveryHours: 168, generateEveryHours: 24, batchSize: 5 },
  cooldownDays: 42,
  blog: { enabled: true, perWeek: 2, clusterCooldownDays: 14 },
  scope: { collections: 'all', products: 'all' },
};

function merge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base?.[k], v);
  return out;
}

export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

// SEO_GEO_HOME: ayar ve veri klasörünü repodan ayırmak için (ör. birden fazla mağaza, testler).
export function loadConfig(root = process.env.SEO_GEO_HOME || ROOT) {
  const cfgPath = path.join(root, 'config.json');
  const user = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const envPath = path.join(root, '.env');
  const env = { ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}), ...process.env };
  const factsPath = path.join(root, 'brand-facts.json');
  const brandFacts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, 'utf8')) : null;
  return {
    ...merge(DEFAULTS, user),
    root,
    dataDir: path.join(root, 'data'),
    configured: existsSync(cfgPath),
    env,
    brandFacts,
  };
}
