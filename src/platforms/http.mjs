// Ortak HTTP yardımcısı: zaman aşımı, 429/5xx için üstel bekleme. Ağ yoksa (bilgisayar yeni
// uyandı, Wi-Fi bağlanmadı) birkaç kez dener, sonra hata verir; iş güvenli durumda bekler.
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30_000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: 'application/json', ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
        lastErr = new Error(`${res.status} ${url}`);
        await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`${res.status} ${new URL(url).pathname}: ${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      return json;
    } catch (err) {
      if (err.status) throw err; // 4xx: tekrar denemek düzeltmez
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Herkese açık sayfalar için. Mağaza "çok hızlı istek" (429) derse bekleyip yeniden dener.
export async function fetchText(url, { timeoutMs = 30_000, headers = {}, retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'seo-geo-yerel/0.1 (+dogrulama)', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const limited = res.status === 429 || (res.status === 430) || /^local_rate_limited/.test(text);
    if (limited && attempt < retries) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000));
      continue;
    }
    return { status: limited ? 429 : res.status, text, url: res.url };
  }
}
