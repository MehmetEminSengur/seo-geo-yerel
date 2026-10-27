// Uygulama bağlamı ve zamanlayıcı görevleri. `tick` her çağrıldığında:
//   1. recover: yarıda kalmış işleri toparla (kapanma, uyku, elektrik kesintisi)
//   2. hazır görselleri topla, onaylı işleri uygula (bunlar beklemez)
//   3. süresi gelen periyodik görevleri BİR KEZ çalıştır (kaçırılanlar üst üste çalışmaz)
import { openDb } from './db/db.mjs';
import { loadConfig } from './core/config.mjs';
import { createLogger } from './core/log.mjs';
import { createAdapter, upsertPages } from './platforms/adapter.mjs';
import { recover } from './core/recover.mjs';
import { runDue, HOUR } from './core/scheduler.mjs';
import { applyApproved } from './pipeline/apply.mjs';
import { collectKeywords, mapKeywords } from './pipeline/keywords.mjs';
import { planPages, planBlogs } from './pipeline/plan.mjs';
import { generatePlanned } from './pipeline/generate.mjs';
import { writeReport, collectImages } from './pipeline/review.mjs';

export function createContext({ quiet = false, needAdapter = true } = {}) {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  const log = createLogger(config.dataDir, { quiet });
  let adapter = null;
  if (needAdapter) {
    if (!config.configured) throw new Error('config.json yok. Önce kurulum: AGENTS.md / README.md → "Kurulum"');
    adapter = createAdapter(config, db, log);
  }
  return { config, db, log, adapter };
}

export async function sync(ctx) {
  const pages = await ctx.adapter.listAll();
  const res = upsertPages(ctx.db, ctx.adapter.name, pages);
  ctx.log('sync', res);
  return res;
}

export async function keywords(ctx) {
  const collected = await collectKeywords(ctx);
  const mapped = await mapKeywords(ctx);
  return { ...collected, ...mapped, incomplete: collected.incomplete };
}

export async function planAndGenerate(ctx, opts = {}) {
  const pages = planPages(ctx, opts);
  const blogs = planBlogs(ctx);
  // Sayfa partisi ve o günün blogları aynı çalıştırmada üretilir; bloglar sayfa kotasını yemez.
  const gen = await generatePlanned(ctx, { limit: (opts.limit ?? ctx.config.schedule.batchSize) + blogs.length });
  const report = writeReport(ctx);
  ctx.log('plan_generate', { planned_pages: pages.length, planned_blogs: blogs.length, ...gen, report: report.file });
  return { pages, blogs, ...gen, report: report.file };
}

export async function tick(ctx) {
  const { config } = ctx;
  const rec = await recover(ctx.db, { adapter: ctx.adapter, log: ctx.log });
  const images = collectImages(ctx);
  const applied = await applyApproved(ctx);
  const tasks = [
    { name: 'sync', everyMs: config.schedule.syncEveryHours * HOUR, run: () => sync(ctx) },
    { name: 'keywords', everyMs: config.schedule.keywordsEveryHours * HOUR, run: () => keywords(ctx) },
    { name: 'generate', everyMs: config.schedule.generateEveryHours * HOUR, run: () => planAndGenerate(ctx) },
  ];
  const periodic = await runDue(ctx.db, tasks, { log: ctx.log });
  // Otomatik modda yeni üretilen taslaklar aynı tick içinde uygulanır.
  const appliedAfter = config.mode === 'auto' ? await applyApproved(ctx) : null;
  return { recover: rec, images: images.moved, applied, periodic, appliedAfter };
}
