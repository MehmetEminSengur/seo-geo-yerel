// Shopify Admin GraphQL adaptörü.
// Kimlik doğrulama üç yoldan biri (config.json → store.auth):
//   cli (varsayılan): mağaza sahibi bir kez `node bin/seo-geo.mjs shopify-baglan` ile tarayıcıda
//      onay verir. Anahtarı Shopify CLI saklar ve 24 saatte bir süresi dolunca tarayıcı açmadan
//      kendisi yeniler; istekler `shopify store execute` ile gider. .env'de anahtar gerekmez.
//   app: .env'de aşağıdaki anahtarlardan biri. Hiç tarayıcı istemez; 7/24 için en sağlam yol.
//   1. SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard uygulaması, 2026 sonrası standart):
//      client_credentials ile ~24 saatlik token alınır, tokens tablosunda saklanır, süresi
//      dolmadan 5 dk önce yenilenir. Dönen refresh token yok; bilgisayar kapansa da sorun olmaz.
//   2. SHOPIFY_ADMIN_TOKEN (1 Ocak 2026 öncesi açılmış eski özel uygulamalar): sabit token.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchJson } from './http.mjs';
import { nowIso } from '../db/db.mjs';
import { runCli } from '../engines/text/run-cli.mjs';

const PAGE = 100;

// shopify-baglan bu izinleri ister; yazma izni okumayı da kapsar.
export const SHOPIFY_SCOPES = 'read_products,write_products,read_content,write_content,read_files,write_files,read_online_store_navigation';

// store.auth yazılmamışsa: .env'de uygulama anahtarı varsa onu, yoksa Shopify CLI'ı kullan.
export function shopifyAuthMode(config) {
  if (config.store?.auth) return config.store.auth;
  const env = config.env || {};
  return env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_CLIENT_ID ? 'app' : 'cli';
}

const clean = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ').trim();
// "Loading stored store auth" her çalıştırmada yazılır; yalnız gerçek giriş hatalarına bakılır.
const NEEDS_LOGIN = /No stored app authentication|Token refresh failed|missing required scopes|Run `shopify store auth`/i;

export function createShopify(config, db, log = () => {}) {
  const env = config.env;
  const domain = String(config.store.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const version = config.store.apiVersion || '2026-07';
  const publicBase = String(config.store.publicUrl || `https://${domain}`).replace(/\/$/, '');
  // adminBaseUrl yalnız testler içindir (sahte Shopify sunucusu); normalde https://<domain>.
  const adminBase = String(config.store.adminBaseUrl || `https://${domain}`).replace(/\/$/, '');
  if (!domain) throw new Error('config.json → store.domain eksik (ör. magazam.myshopify.com)');

  async function accessToken() {
    if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
    if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) throw new Error('.env içinde SHOPIFY_CLIENT_ID ve SHOPIFY_CLIENT_SECRET (ya da SHOPIFY_ADMIN_TOKEN) yok');
    const row = db.prepare("SELECT * FROM tokens WHERE provider = 'shopify'").get();
    if (row?.access_token && Date.parse(row.expires_at) - Date.now() > 5 * 60_000) return row.access_token;
    const res = await fetchJson(`${adminBase}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }).toString(),
    });
    const expiresAt = nowIso(Date.now() + (Number(res.expires_in) || 86_399) * 1000);
    db.prepare(`INSERT INTO tokens(provider, access_token, expires_at, updated_at) VALUES ('shopify', ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
      .run(res.access_token, expiresAt, nowIso());
    log('shopify_token_refreshed', { expires_at: expiresAt });
    return res.access_token;
  }

  // CLI yolu: sorgu ve değişkenler dosyaya yazılır (uzun ürün açıklamaları komut satırına sığmaz).
  async function gqlCli(query, variables) {
    const dir = mkdtempSync(path.join(tmpdir(), 'seo-geo-shopify-'));
    try {
      writeFileSync(path.join(dir, 'q.graphql'), query);
      writeFileSync(path.join(dir, 'v.json'), JSON.stringify(variables));
      const out = path.join(dir, 'out.json');
      await runCli('shopify', ['store', 'execute', '--store', domain, '--version', version, '--json', '--no-color',
        '--query-file', path.join(dir, 'q.graphql'), '--variable-file', path.join(dir, 'v.json'), '--output-file', out,
        ...(/^\s*mutation\b/.test(query) ? ['--allow-mutations'] : [])], { timeoutMs: 120_000 });
      return { data: JSON.parse(readFileSync(out, 'utf8')) };
    } catch (err) {
      const msg = clean(err.message);
      if (/THROTTLED/.test(msg)) return { errors: [{ extensions: { code: 'THROTTLED' } }] };
      if (/bulunamadı/.test(msg)) throw new Error('Shopify CLI kurulu değil. Kurulum: npm install -g @shopify/cli');
      if (NEEDS_LOGIN.test(msg)) throw new Error('Shopify bağlantısı yenilenmeli: node bin/seo-geo.mjs shopify-baglan (tarayıcıda bir kez onay)');
      throw new Error(`shopify: ${msg.slice(-400)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const viaCli = shopifyAuthMode(config) === 'cli';

  async function gql(query, variables = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (viaCli) {
        const res = await gqlCli(query, variables);
        if (res.errors) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        return res.data;
      }
      const token = await accessToken();
      const res = await fetchJson(`${adminBase}/admin/api/${version}/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token },
        body: { query, variables },
      });
      const throttled = res.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (res.errors?.length) throw new Error(`shopify: ${JSON.stringify(res.errors).slice(0, 400)}`);
      return res.data;
    }
    throw new Error('shopify: istek sınırı aşıldı, sonra tekrar denenecek');
  }

  function userErrors(payload, op) {
    const errs = payload?.userErrors || [];
    if (errs.length) throw new Error(`${op}: ${errs.map((e) => e.message).join('; ')}`);
  }

  async function paginate(field, nodeFields, extraArgs = '') {
    const out = [];
    let after = null;
    do {
      const data = await gql(`query($after: String) { ${field}(first: ${PAGE}, after: $after ${extraArgs}) {
        pageInfo { hasNextPage endCursor } nodes { ${nodeFields} } } }`, { after });
      out.push(...data[field].nodes);
      after = data[field].pageInfo.hasNextPage ? data[field].pageInfo.endCursor : null;
    } while (after);
    return out;
  }

  const PRODUCT = 'id handle title descriptionHtml seo { title description } productType vendor tags status onlineStoreUrl updatedAt featuredMedia { preview { image { url } } } collections(first: 5) { nodes { handle title } }';
  const COLLECTION = 'id handle title descriptionHtml seo { title description } updatedAt image { url }';
  const ARTICLE = 'id handle title body summary tags isPublished publishedAt updatedAt blog { id handle } image { url altText } seoTitle: metafield(namespace: "global", key: "title_tag") { value } seoDesc: metafield(namespace: "global", key: "description_tag") { value }';

  function menuPaths(menus) {
    // "/collections/folyolar" → "Mutfak > Folyolar" gibi yollar; eşleme kapısı sayfanın menüdeki yerine bakar.
    const byHandle = new Map();
    const walk = (items, trail) => {
      for (const it of items || []) {
        const p = [...trail, it.title];
        const m = String(it.url || '').match(/\/collections\/([^/?#]+)/);
        if (m && !byHandle.has(m[1])) byHandle.set(m[1], { path: p.join(' > '), parent: trail.length ? trail[trail.length - 1] : null });
        walk(it.items, p);
      }
    };
    for (const menu of menus) walk(menu.items, []);
    return byHandle;
  }

  return {
    name: 'shopify',
    publicBase,
    capabilities: () => ({ product: { body: true, seo: true }, collection: { body: true, seo: true }, article: { create: true, update: true, seo: true }, imageUpload: true }),

    publicUrl(type, handle, blogHandle) {
      if (type === 'product') return `${publicBase}/products/${handle}`;
      if (type === 'collection') return `${publicBase}/collections/${handle}`;
      return `${publicBase}/blogs/${blogHandle || 'news'}/${handle}`;
    },

    async listAll() {
      const [products, collections, articles] = [await paginate('products', PRODUCT, ', query: "status:active"'), await paginate('collections', COLLECTION), await paginate('articles', ARTICLE)];
      let menus = [];
      try {
        const sub = 'title url';
        menus = (await gql(`{ menus(first: 10) { nodes { handle items { ${sub} items { ${sub} items { ${sub} } } } } } }`)).menus.nodes;
      } catch (err) {
        log('shopify_menus_unavailable', { error: String(err.message).slice(0, 200) }); // read_online_store_navigation izni yoksa menüsüz devam
      }
      const menu = menuPaths(menus);
      const pages = [];
      for (const c of collections) {
        pages.push({ type: 'collection', externalId: c.id, handle: c.handle, title: c.title, url: this.publicUrl('collection', c.handle),
          bodyHtml: c.descriptionHtml, seoTitle: c.seo?.title, seoDescription: c.seo?.description, imageUrl: c.image?.url,
          menuPath: menu.get(c.handle)?.path ?? null, parentHandle: null, updatedAt: c.updatedAt, raw: c });
      }
      for (const p of products) {
        const primary = p.collections.nodes.find((c) => menu.has(c.handle)) || p.collections.nodes[0];
        pages.push({ type: 'product', externalId: p.id, handle: p.handle, title: p.title, url: this.publicUrl('product', p.handle),
          bodyHtml: p.descriptionHtml, seoTitle: p.seo?.title, seoDescription: p.seo?.description, imageUrl: p.featuredMedia?.preview?.image?.url,
          parentHandle: primary?.handle ?? null, menuPath: primary ? menu.get(primary.handle)?.path ?? primary.title : null, updatedAt: p.updatedAt, raw: p });
      }
      for (const a of articles) {
        pages.push({ type: 'article', externalId: a.id, handle: a.handle, title: a.title, url: this.publicUrl('article', a.handle, a.blog?.handle),
          bodyHtml: a.body, seoTitle: a.seoTitle?.value ?? null, seoDescription: a.seoDesc?.value ?? null, imageUrl: a.image?.url,
          parentHandle: a.blog?.handle, menuPath: null, updatedAt: a.updatedAt, raw: a });
      }
      return pages;
    },

    async readPage(type, externalId) {
      if (type === 'product') {
        const d = await gql('query($id: ID!) { product(id: $id) { descriptionHtml seo { title description } } }', { id: externalId });
        return d.product && { html: d.product.descriptionHtml, seoTitle: d.product.seo?.title, seoDescription: d.product.seo?.description };
      }
      if (type === 'collection') {
        const d = await gql('query($id: ID!) { collection(id: $id) { descriptionHtml seo { title description } } }', { id: externalId });
        return d.collection && { html: d.collection.descriptionHtml, seoTitle: d.collection.seo?.title, seoDescription: d.collection.seo?.description };
      }
      const d = await gql(`query($id: ID!) { article(id: $id) { ${ARTICLE} } }`, { id: externalId });
      return d.article && { html: d.article.body, seoTitle: d.article.seoTitle?.value ?? null, seoDescription: d.article.seoDesc?.value ?? null };
    },

    async writePage(type, externalId, { html, seoTitle, seoDescription }) {
      if (type === 'product') {
        const d = await gql(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id } userErrors { field message } } }`,
          { p: { id: externalId, descriptionHtml: html, seo: { title: seoTitle, description: seoDescription } } });
        userErrors(d.productUpdate, 'productUpdate');
      } else if (type === 'collection') {
        const d = await gql(`mutation($c: CollectionInput!) { collectionUpdate(input: $c) { collection { id } userErrors { field message } } }`,
          { c: { id: externalId, descriptionHtml: html, seo: { title: seoTitle, description: seoDescription } } });
        userErrors(d.collectionUpdate, 'collectionUpdate');
      } else {
        const d = await gql(`mutation($id: ID!, $a: ArticleUpdateInput!) { articleUpdate(id: $id, article: $a) { article { id } userErrors { field message } } }`,
          { id: externalId, a: { body: html } });
        userErrors(d.articleUpdate, 'articleUpdate');
        await this.setArticleSeo(externalId, seoTitle, seoDescription);
      }
    },

    async setArticleSeo(articleId, title, description) {
      const m = [
        title && { ownerId: articleId, namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: String(title).slice(0, 255) },
        description && { ownerId: articleId, namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: String(description).slice(0, 320) },
      ].filter(Boolean);
      if (!m.length) return;
      const d = await gql('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', { m });
      userErrors(d.metafieldsSet, 'metafieldsSet');
    },

    // Çökme sonrası "bu yazı zaten açıldı mı?" sorusunun cevabı buradan gelir; yanlış "yok" cevabı
    // aynı yazının iki kez açılması demektir. Filtre sonuç vermezse tüm yazılar taranır.
    async findArticle(handle) {
      const d = await gql(`query($q: String) { articles(first: 5, query: $q) { nodes { ${ARTICLE} } } }`, { q: `handle:${handle}` });
      const a = d.articles.nodes.find((x) => x.handle === handle) || (await paginate('articles', ARTICLE)).find((x) => x.handle === handle);
      return a ? { ref: { externalId: a.id, url: this.publicUrl('article', a.handle, a.blog?.handle) }, html: a.body, seoTitle: a.seoTitle?.value ?? null, seoDescription: a.seoDesc?.value ?? null } : null;
    },

    async createArticle({ title, handle, html, summary, seoTitle, seoDescription, imageUrl, imageAlt, tags = [], author }) {
      const blogs = (await gql('{ blogs(first: 10) { nodes { id handle } } }')).blogs.nodes;
      const blog = blogs.find((b) => b.handle === config.store.blogHandle) || blogs[0];
      if (!blog) throw new Error('mağazada blog yok; Shopify admin → Online Mağaza → Blog yazıları altından bir blog açın');
      const article = { blogId: blog.id, title, handle, body: html, summary, tags, isPublished: true, author: { name: author || config.store.brandName || 'Editör' } };
      if (imageUrl) article.image = { url: imageUrl, altText: imageAlt || title };
      const d = await gql('mutation($a: ArticleCreateInput!) { articleCreate(article: $a) { article { id handle } userErrors { field message } } }', { a: article });
      userErrors(d.articleCreate, 'articleCreate');
      await this.setArticleSeo(d.articleCreate.article.id, seoTitle, seoDescription);
      return { externalId: d.articleCreate.article.id, url: this.publicUrl('article', handle, blog.handle) };
    },

    // Yerelde üretilen görseli Shopify Files'a yükler, herkese açık CDN adresini döner.
    async uploadImage(filePath, alt) {
      const bytes = readFileSync(filePath);
      const filename = path.basename(filePath);
      const mimeType = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'image/jpeg' : filename.endsWith('.webp') ? 'image/webp' : 'image/png';
      const s = await gql('mutation($i: [StagedUploadInput!]!) { stagedUploadsCreate(input: $i) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }',
        { i: [{ resource: 'IMAGE', filename, mimeType, httpMethod: 'POST', fileSize: String(bytes.length) }] });
      userErrors(s.stagedUploadsCreate, 'stagedUploadsCreate');
      const target = s.stagedUploadsCreate.stagedTargets[0];
      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append('file', new Blob([bytes], { type: mimeType }), filename);
      const up = await fetch(target.url, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`görsel yükleme HTTP ${up.status}`);
      const c = await gql('mutation($f: [FileCreateInput!]!) { fileCreate(files: $f) { files { id } userErrors { field message } } }',
        { f: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: String(alt || '').slice(0, 500) }] });
      userErrors(c.fileCreate, 'fileCreate');
      const id = c.fileCreate.files[0].id;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const n = await gql('query($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } } } }', { id });
        if (n.node?.fileStatus === 'READY' && n.node.image?.url) return n.node.image.url;
        if (n.node?.fileStatus === 'FAILED') throw new Error('Shopify görseli işleyemedi');
      }
      throw new Error('görsel zamanında hazır olmadı');
    },
  };
}
