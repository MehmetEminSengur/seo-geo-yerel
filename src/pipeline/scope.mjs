// Hangi sayfalarla çalışılacak? config.scope: "all" ya da handle listesi. Ürünler, kapsamdaki
// kategorilere bağlıysa (parent_handle) kapsama girer.
export function pagesInScope(db, config, types = ['product', 'collection']) {
  const rows = db.prepare(`SELECT * FROM pages WHERE lifecycle = 'active' AND type IN (${types.map(() => '?').join(',')})`).all(...types);
  const cols = config.scope?.collections;
  const prods = config.scope?.products;
  return rows.filter((p) => {
    if (p.type === 'collection') return cols === 'all' || !cols || cols.includes(p.handle);
    if (p.type === 'product') {
      if (Array.isArray(prods)) return prods.includes(p.handle);
      return cols === 'all' || !cols || cols.includes(p.parent_handle);
    }
    return true;
  });
}
