// Platform seçimi ve platformdan bağımsız ortak işler. Her platform adaptörü şunları sağlar:
//   name, capabilities(), publicUrl(type, handle, blogHandle)
//   listAll() → normalize sayfa listesi
//   readPage(type, externalId) → { html, seoTitle, seoDescription }
//   writePage(type, externalId, { html, seoTitle, seoDescription })
//   findArticle(handle), createArticle({...}), uploadImage(file, alt)   (destekliyorsa)
import { createShopify } from './shopify.mjs';
import { createIdeasoft } from './ideasoft.mjs';
import { createIkas } from './ikas.mjs';
import { createShopifyPublic } from './shopify-public.mjs';
import { canonicalHash } from '../core/content-hash.mjs';
import { nowIso, tx } from '../db/db.mjs';

const FACTORIES = { shopify: createShopify, 'shopify-public': createShopifyPublic, ideasoft: createIdeasoft, ikas: createIkas };

export function createAdapter(config, db, log) {
  const factory = FACTORIES[config.store?.platform];
  if (!factory) throw new Error(`config.json → store.platform şunlardan biri olmalı: ${Object.keys(FACTORIES).join(', ')}`);
  const a = factory(config, db, log);

  // recover.mjs bunu çağırır: işin dokunduğu sayfanın platformdaki CANLI halini döner.
  a.readLive = async (db_, job) => {
    if (job.kind === 'create_article') {
      const draft = JSON.parse(job.draft_json || '{}');
      return draft.handle ? a.findArticle(draft.handle) : null;
    }
    const page = db_.prepare('SELECT type, external_id FROM pages WHERE id = ?').get(job.page_id);
    return page ? a.readPage(page.type, page.external_id) : null;
  };
  return a;
}

export const pageId = (platform, type, externalId) => `${platform}:${type}:${externalId}`;

// Platformdaki sayfaları yerel veritabanına yazar. Silinen/yayından kalkan sayfalar "gone" olur.
export function upsertPages(db, platform, pages) {
  return tx(db, () => {
    const now = nowIso();
    const stmt = db.prepare(`INSERT INTO pages(id, platform, type, external_id, handle, title, url, parent_handle, menu_path, body_html, seo_title,
        seo_description, content_hash, image_url, raw_json, platform_updated_at, synced_at, lifecycle)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')
      ON CONFLICT(id) DO UPDATE SET handle=excluded.handle, title=excluded.title, url=excluded.url, parent_handle=excluded.parent_handle,
        menu_path=excluded.menu_path, body_html=excluded.body_html, seo_title=excluded.seo_title, seo_description=excluded.seo_description,
        content_hash=excluded.content_hash, image_url=excluded.image_url, raw_json=excluded.raw_json,
        platform_updated_at=excluded.platform_updated_at, synced_at=excluded.synced_at, lifecycle='active'`);
    for (const p of pages) {
      stmt.run(pageId(platform, p.type, p.externalId), platform, p.type, String(p.externalId), p.handle, p.title, p.url, p.parentHandle ?? null,
        p.menuPath ?? null, p.bodyHtml ?? '', p.seoTitle ?? null, p.seoDescription ?? null,
        canonicalHash({ html: p.bodyHtml, seoTitle: p.seoTitle, seoDescription: p.seoDescription }), p.imageUrl ?? null,
        JSON.stringify(p.raw ?? null), p.updatedAt ?? null, now);
    }
    const gone = db.prepare("UPDATE pages SET lifecycle = 'gone' WHERE platform = ? AND synced_at < ? AND lifecycle = 'active'").run(platform, now);
    return { upserted: pages.length, gone: Number(gone.changes) };
  });
}
