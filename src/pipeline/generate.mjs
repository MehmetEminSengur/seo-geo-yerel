// Planlanmış işler için taslak üretir: istem → metin motoru → sistem bölümleri (bağlantı, SSS,
// şema) → doğrulama. Hatalı taslak bir kez hatalar gösterilerek yeniden istenir; yine hatalıysa
// reddedilir ve önizleme raporunda nedeniyle görünür. Hiçbir şey platforma yazılmaz.
import { claimNext, transition, getJob } from '../core/jobs.mjs';
import { canSpend, record } from '../core/budget.mjs';
import { canonicalHash } from '../core/content-hash.mjs';
import { textEngine } from '../engines/text/index.mjs';
import { buildPagePrompt, buildBlogPrompt } from '../content/build.mjs';
import { productLinks, collectionLinks } from '../content/links.mjs';
import { faqHtml, faqJsonLd } from '../content/schema-jsonld.mjs';
import { validateDraft } from '../content/validate.mjs';
import { productImageFor, enqueueImage, generateViaApi } from '../engines/image/index.mjs';
import { norm } from '../keywords/text.mjs';

const OWNER = `generate-${process.pid}`;

export const slugify = (s) => norm(s).replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80).replace(/^-|-$/g, '');

async function callWithRetry(ctx, { prompt, schema }, check) {
  const engine = textEngine(ctx.config);
  let feedback = '';
  let last;
  for (let round = 0; round < 2; round++) {
    if (!canSpend(ctx.db, 'text', { units: 1 }, ctx.config.limits)) return { budget: true };
    const out = await engine.generate({ prompt: prompt + feedback, schema });
    record(ctx.db, 'text', { units: 1, note: engine.name });
    last = check(out);
    if (last.validation.ok) return last;
    feedback = `\n\n## ÖNCEKİ DENEMEDEKİ HATALAR (bunları düzelt)\n${last.validation.errors.map((e) => `- ${e}`).join('\n')}`;
  }
  return last;
}

async function generatePage(ctx, job) {
  const { db, config } = ctx;
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(job.page_id);
  const built = buildPagePrompt(db, config, page);
  const extras = page.type === 'product' ? productLinks(db, page) : collectionLinks(db, page);
  return callWithRetry(ctx, built, (out) => {
    const faq = (out.faq || []).filter((f) => f.q && f.a);
    const html = [out.html.trim(), extras.html, faqHtml(faq), faqJsonLd(faq, page.url)].filter(Boolean).join('\n');
    const draft = { type: page.type, html, modelHtml: out.html, seoTitle: out.seo_title.trim(), seoDescription: out.seo_description.trim(), faq, links: extras.links, baseHash: page.content_hash };
    const validation = validateDraft(draft, { type: page.type, source: built.source, beforeHtml: built.existing, brandFacts: config.brandFacts, targetKeyword: page.target_keyword });
    return { draft, validation };
  });
}

async function generateArticle(ctx, job) {
  const { db, config } = ctx;
  const related = db.prepare("SELECT keyword FROM keywords WHERE intent = 'informational' AND status = 'accepted' AND keyword != ? LIMIT 40").all(job.target_keyword)
    .map((r) => r.keyword).filter((k) => norm(k).split(' ').some((w) => norm(job.target_keyword).includes(w) && w.length > 3)).slice(0, 6);
  const built = buildBlogPrompt(db, config, { keyword: job.target_keyword, related });
  return callWithRetry(ctx, built, (out) => {
    const faq = (out.faq || []).filter((f) => f.q && f.a);
    const handle = slugify(out.slug || out.title);
    const html = [out.html.trim(), faqHtml(faq), faqJsonLd(faq)].filter(Boolean).join('\n');
    const draft = { type: 'article', handle, title: out.title.trim(), html, modelHtml: out.html, summary: out.summary, seoTitle: out.seo_title.trim(), seoDescription: out.seo_description.trim(),
      faq, imagePrompt: out.image_prompt, imageAlt: out.image_alt, linksUsed: out.links_used, keyword: job.target_keyword };
    const validation = validateDraft(draft, { type: 'article', source: built.source, brandFacts: config.brandFacts, targetKeyword: job.target_keyword, allowedUrls: built.allowedUrls });
    return { draft, validation };
  });
}

// Doğrulanmış taslağın sıradaki durağı: görsel bekleyen blog, onay bekleyen ya da (otomatik modda) onaylı.
async function routeValidated(ctx, job, draft) {
  const { config, db } = ctx;
  if (job.kind === 'create_article' && !draft.imageUrl) {
    const mode = config.engines.image || 'product-image';
    if (mode === 'agent-queue') {
      enqueueImage(config.dataDir, job, { prompt: draft.imagePrompt, alt: draft.imageAlt });
      return transition(db, job.id, 'validated', 'awaiting_image', {}, 'görsel ajan kuyruğunda');
    }
    if (mode === 'api') {
      try {
        const file = await generateViaApi(config, { prompt: draft.imagePrompt, jobId: job.id });
        draft.imageFile = file;
      } catch (err) {
        ctx.log('image_api_failed', { job: job.id, error: String(err.message).slice(0, 200) });
      }
    }
    if (!draft.imageFile) draft.imageUrl = productImageFor(db, draft.keyword);
    db.prepare('UPDATE jobs SET draft_json = ? WHERE id = ?').run(JSON.stringify(draft), job.id);
  }
  return transition(db, job.id, 'validated', config.mode === 'auto' ? 'approved' : 'awaiting_approval');
}

export async function generatePlanned(ctx, { limit = ctx.config.schedule.batchSize } = {}) {
  const { db, log } = ctx;
  const summary = { generated: 0, rejected: 0, budget: false, errors: 0 };
  const seen = [];
  for (let i = 0; i < limit; i++) {
    const job = claimNext(db, { from: 'planned', to: 'generating', owner: OWNER, skip: seen });
    if (!job) break;
    seen.push(job.id);
    try {
      const res = job.kind === 'create_article' ? await generateArticle(ctx, job) : await generatePage(ctx, job);
      if (res.budget) {
        transition(db, job.id, 'generating', 'planned', {}, 'günlük yapay zekâ sınırı doldu');
        summary.budget = true;
        break;
      }
      const { draft, validation } = res;
      draft.validation = validation;
      const intended = canonicalHash(draft);
      transition(db, job.id, 'generating', 'generated', { draft_json: JSON.stringify(draft), draft_hash: intended, intended_hash: intended });
      if (!validation.ok) {
        transition(db, job.id, 'generated', 'rejected', { last_error: validation.errors.join(' | ') });
        summary.rejected++;
        log('draft_rejected', { job: job.id, errors: validation.errors });
        continue;
      }
      transition(db, job.id, 'generated', 'validated');
      await routeValidated(ctx, getJob(db, job.id), draft);
      summary.generated++;
    } catch (err) {
      summary.errors++;
      log('generate_failed', { job: job.id, error: String(err.message).slice(0, 300) });
      const cur = getJob(db, job.id);
      if (cur.state === 'generating') transition(db, job.id, 'generating', 'planned', { last_error: String(err.message).slice(0, 500) });
    }
  }
  return { ...summary, incomplete: summary.budget };
}
