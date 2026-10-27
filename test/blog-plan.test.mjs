// Kurulumda sorulan "günde kaç blog" (blog.perDay) aynı gün aşılmamalı, ertesi gün yeniden açılmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';
import { planBlogs } from '../src/pipeline/plan.mjs';

const KEYWORDS = ['yağlı kağıt nasıl kullanılır', 'streç film nasıl kesilir', 'alüminyum folyo zararlı mı', 'karton bardak geri dönüşür mü', 'z peçete nedir'];

function ctxWith(blog) {
  const { db } = tempData();
  const ins = db.prepare("INSERT INTO keywords(keyword, source, intent, status, fetched_at) VALUES (?, 'autocomplete', 'informational', 'accepted', ?)");
  for (const k of KEYWORDS) ins.run(k, new Date().toISOString());
  return { db, config: { blog: { enabled: true, clusterCooldownDays: 14, ...blog } } };
}

test('günde 2 blog: aynı gün ikinci planlama yeni yazı açmaz, ertesi gün 2 yazı daha açar', () => {
  const ctx = ctxWith({ perDay: 2 });
  assert.equal(planBlogs(ctx).length, 2);
  assert.equal(planBlogs(ctx).length, 0);
  assert.equal(planBlogs(ctx, { now: Date.now() + 25 * 3_600_000 }).length, 2);
});

test('günde 0 blog: hiç yazı açılmaz', () => {
  assert.equal(planBlogs(ctxWith({ perDay: 0 })).length, 0);
});

test('eski kurulum (yalnız perWeek): haftalık sınır geçerli kalır', () => {
  const ctx = ctxWith({ perWeek: 1 });
  assert.equal(planBlogs(ctx).length, 1);
  assert.equal(planBlogs(ctx, { now: Date.now() + 2 * 86_400_000 }).length, 0);
});
