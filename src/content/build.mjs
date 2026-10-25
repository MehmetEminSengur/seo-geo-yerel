// İstemleri prompts/*.md şablonlarından kurar. Mevcut metin modele KESİLMEDEN verilir.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripHtml } from '../keywords/text.mjs';
import { brandFactsText } from '../guards/brand-facts.mjs';
import { stripSystemSections } from './schema-jsonld.mjs';
import { relatedCollections, blogAllowlist } from './links.mjs';

const tpl = (name) => readFileSync(path.join(import.meta.dirname, 'prompts', `${name}.md`), 'utf8');
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());

const FAQ = { type: 'array', items: { type: 'object', additionalProperties: false, properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] } };
export const PAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { seo_title: { type: 'string' }, seo_description: { type: 'string' }, html: { type: 'string' }, faq: FAQ },
  required: ['seo_title', 'seo_description', 'html', 'faq'],
};
export const BLOG_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, slug: { type: 'string' }, seo_title: { type: 'string' }, seo_description: { type: 'string' }, summary: { type: 'string' },
    html: { type: 'string' }, faq: FAQ, image_prompt: { type: 'string' }, image_alt: { type: 'string' }, links_used: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'slug', 'seo_title', 'seo_description', 'summary', 'html', 'faq', 'image_prompt', 'image_alt', 'links_used'],
};

function common(config) {
  const bf = config.brandFacts || {};
  const brandName = bf.brandName || config.store?.brandName || 'Mağaza';
  return { brand_name: brandName, brand_voice: bf.voice || 'samimi, uzman, sade; satış baskısı yapmayan', brand_facts: brandFactsText(bf) };
}

export function buildPagePrompt(db, config, page) {
  const base = common(config);
  const existing = stripSystemSections(page.body_html);
  const text = stripHtml(existing);
  const secondary = db.prepare("SELECT keyword FROM keywords WHERE page_id = ? AND status = 'accepted' AND keyword != coalesce(?, '') ORDER BY coalesce(volume,0) DESC LIMIT 6")
    .all(page.id, page.target_keyword).map((r) => r.keyword);
  const modeRule = text.length < 300
    ? 'Mevcut metin zayıf ya da boş. Kaynak veriye dayanarak sıfırdan yaz.'
    : 'Mevcut metin ana kaynaktır. İçindeki teknik bilgileri, ölçüleri, paket adetlerini, kullanım alanlarını, uzman açıklamaları ve marka bilgilerini KORU; yalnızca yapıyı, okunabilirliği ve arama dilini iyileştir. Yeni teknik iddia ekleme.';
  const vars = {
    ...base,
    common: fill(tpl('ortak'), base),
    mode_rule: modeRule,
    target_keyword: page.target_keyword || `(yok; "${page.title}" ana ifade olsun)`,
    secondary_keywords: secondary.join(', ') || '(yok)',
    title: page.title,
    menu_path: page.menu_path || '(bilinmiyor)',
    seo_title: page.seo_title || '(boş)',
    seo_description: page.seo_description || '(boş)',
    body_text: text || '(boş)',
  };
  let source = `${page.title}\n${text}`;
  if (page.type === 'product') {
    const col = page.parent_handle ? db.prepare("SELECT title FROM pages WHERE type='collection' AND handle = ?").get(page.parent_handle) : null;
    vars.collection = col?.title || '(bilinmiyor)';
    return { prompt: fill(tpl('urun'), vars), schema: PAGE_SCHEMA, source, existing };
  }
  const products = db.prepare("SELECT title FROM pages WHERE type='product' AND parent_handle = ? AND lifecycle='active' ORDER BY title LIMIT 40").all(page.handle).map((r) => r.title);
  vars.product_titles = products.map((t) => `- ${t}`).join('\n') || '(ürün listesi yok)';
  vars.related_collections = relatedCollections(db, page).map((c) => c.title).join(', ') || '(yok)';
  source += `\n${products.join('\n')}`;
  return { prompt: fill(tpl('kategori'), vars), schema: PAGE_SCHEMA, source, existing };
}

export function buildBlogPrompt(db, config, { keyword, related = [] }) {
  const base = common(config);
  const allow = blogAllowlist(db, keyword);
  const catalog = db.prepare("SELECT title FROM pages WHERE type='product' AND lifecycle='active'").all().map((r) => r.title);
  const vars = {
    ...base,
    common: fill(tpl('ortak'), base),
    keyword,
    related_keywords: related.join(', ') || '(yok)',
    category_links: allow.collections.map((c) => `- ${c.title}: ${c.url}`).join('\n') || '(yok — kategori bağlantısı verme)',
    article_links: allow.articles.map((p) => `- ${p.title}: ${p.url}`).join('\n') || '(yok)',
    catalog_titles: catalog.slice(0, 120).map((t) => `- ${t}`).join('\n') || '(yok)',
  };
  return { prompt: fill(tpl('blog'), vars), schema: BLOG_SCHEMA, source: `${keyword}\n${catalog.join('\n')}`, allowedUrls: allow.urls };
}
