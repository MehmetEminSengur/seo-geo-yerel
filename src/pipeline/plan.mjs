// Hangi sayfalar yazılacak? İş açar ama hiçbir şey üretmez; tamamen yerel ve ücretsiz.
import { createJob } from '../core/jobs.mjs';
import { pagesInScope } from './scope.mjs';
import { cooldownOk, optimizedBySystem, needScore } from '../guards/page-cooldown.mjs';
import { blogBlocked } from '../guards/blog-cluster.mjs';
import { norm } from '../keywords/text.mjs';

const ACTIVE = "('planned','paused_budget','generating','generated','validated','awaiting_image','awaiting_approval','approved','backing_up','backed_up','applying','applied','verifying','conflict')";

export function planPages(ctx, { limit, force = [] } = {}) {
  const { db, config } = ctx;
  const max = limit ?? config.schedule.batchSize;
  const busy = new Set(db.prepare(`SELECT page_id FROM jobs WHERE state IN ${ACTIVE} AND page_id IS NOT NULL`).all().map((r) => r.page_id));
  const candidates = pagesInScope(db, config)
    .filter((p) => !busy.has(p.id) && !JSON.parse(p.raw_json || '{}')?.bodyUnknown)
    .map((p) => ({ p, forced: force.includes(p.handle), score: needScore(p) }))
    .filter(({ p, forced, score }) => forced || (cooldownOk(p, config.cooldownDays) && !optimizedBySystem(p) && score >= 2))
    .sort((a, b) => Number(b.forced) - Number(a.forced) || b.score - a.score || (a.p.type === 'collection' ? -1 : 1));
  const created = [];
  for (const { p } of candidates.slice(0, max)) {
    const job = createJob(db, { kind: 'update_page', pageId: p.id, targetKeyword: p.target_keyword, idempotencyKey: `page:${p.id}:${p.content_hash}` });
    created.push({ id: job.id, page: p.handle, type: p.type });
  }
  return created;
}

export function planBlogs(ctx, { now = Date.now() } = {}) {
  const { db, config } = ctx;
  if (!config.blog?.enabled) return [];
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const thisWeek = db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'create_article' AND created_at >= ?").get(weekAgo).n;
  let room = Math.max(0, (config.blog.perWeek ?? 2) - thisWeek);
  if (!room) return [];
  const used = new Set(db.prepare("SELECT target_keyword FROM jobs WHERE kind = 'create_article'").all().map((r) => norm(r.target_keyword)));
  const pool = db.prepare("SELECT * FROM keywords WHERE status = 'accepted' AND intent = 'informational' ORDER BY coalesce(volume,0) DESC, length(keyword)").all();
  const created = [];
  for (const k of pool) {
    if (!room) break;
    if (used.has(norm(k.keyword))) continue;
    const blocked = blogBlocked(db, k.keyword, { clusterCooldownDays: config.blog.clusterCooldownDays, now });
    if (blocked) continue;
    const job = createJob(db, { kind: 'create_article', targetKeyword: k.keyword, idempotencyKey: `blog:${norm(k.keyword)}` });
    created.push({ id: job.id, keyword: k.keyword });
    room--;
  }
  return created;
}
