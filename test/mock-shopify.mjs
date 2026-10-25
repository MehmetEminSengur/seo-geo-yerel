// Çökme tatbikatı için sahte Shopify: Admin GraphQL'in kullandığımız kısmını ve herkese açık ürün
// sayfasını taklit eder. writeDelayMs > 0 iken productUpdate isteği MAĞAZAYA YAZILIR ama cevap
// gecikir; tam bu arada istemci öldürülürse "yazıldı ama cevap gelmedi" anı oluşur.
import http from 'node:http';

export function startMockShopify() {
  const product = {
    id: 'gid://shopify/Product/1', handle: 'folyo-30', title: 'Folyo 30 cm', status: 'ACTIVE', productType: '', vendor: '', tags: [],
    descriptionHtml: '<p>Eski açıklama. 1998den beri.</p>', seo: { title: 'Eski başlık', description: 'Eski meta açıklama' },
    updatedAt: '2026-10-01T00:00:00Z', onlineStoreUrl: null, featuredMedia: null, collections: { nodes: [{ handle: 'folyo', title: 'Folyo' }] },
  };
  const collection = { id: 'gid://shopify/Collection/9', handle: 'folyo', title: 'Folyo', descriptionHtml: '<p>Folyolar</p>', seo: { title: null, description: null }, updatedAt: '2026-10-01T00:00:00Z', image: null };
  const state = { writes: 0, writeDelayMs: 0, product };
  const page = (nodes) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      if (req.method === 'GET' && req.url.startsWith('/products/')) {
        res.setHeader('content-type', 'text/html');
        return res.end(`<html><head><title>${product.seo.title}</title><meta name="description" content="${product.seo.description}"></head><body>${product.descriptionHtml}</body></html>`);
      }
      const send = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data })); };
      const { query = '', variables = {} } = body ? JSON.parse(body) : {};
      if (query.includes('productUpdate')) {
        const p = variables.p;
        product.descriptionHtml = p.descriptionHtml;
        product.seo = { ...p.seo };
        state.writes++;
        if (state.writeDelayMs) await new Promise((r) => setTimeout(r, state.writeDelayMs));
        return send({ productUpdate: { product: { id: p.id }, userErrors: [] } });
      }
      if (query.includes('product(id')) return send({ product: { descriptionHtml: product.descriptionHtml, seo: product.seo } });
      if (query.includes('products(first')) return send({ products: page([product]) });
      if (query.includes('collections(first')) return send({ collections: page([collection]) });
      if (query.includes('articles(first')) return send({ articles: page([]) });
      if (query.includes('menus(first')) return send({ menus: { nodes: [] } });
      send({});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
