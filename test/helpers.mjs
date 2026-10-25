import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db/db.mjs';

export function tempData() {
  const dir = mkdtempSync(path.join(tmpdir(), 'seo-geo-test-'));
  return { dir, db: openDb(dir) };
}

// Bellekte bir "mağaza": readLive/write çağrılarını kaydeder, elle düzenleme taklit edilebilir.
export function fakeStore(initial = {}) {
  const pages = new Map(Object.entries(initial));
  return {
    pages,
    writes: 0,
    async readLive(_db, job) {
      return pages.get(job.page_id) ?? null;
    },
    async write(pageId, content) {
      this.writes++;
      pages.set(pageId, { ...content });
    },
  };
}
