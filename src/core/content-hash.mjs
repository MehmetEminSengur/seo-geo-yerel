// Platformlar HTML'i kaydederken biçimini değiştirir (boşluk, öznitelik sırası, <br/>).
// Mutabakatta "bu içerik bizim yazdığımız mı?" sorusunu biçimden bağımsız sormak için
// metin ve SEO alanları normalize edilip özetlenir.
import { sha256 } from './fsutil.mjs';

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

// Etiket adı küçük harfe, öznitelikler alfabetik sıraya ve çift tırnağa çevrilir; değerleri
// (href, src) korunur ki elle değiştirilmiş bir bağlantı "bizim içerik" sanılmasın.
function normalizeTag(_, slash, tag, attrs = '') {
  const parts = [...attrs.matchAll(ATTR)]
    .map((m) => (m[2] ?? m[3] ?? m[4]) === undefined ? m[1].toLowerCase() : `${m[1].toLowerCase()}="${m[2] ?? m[3] ?? m[4]}"`)
    .sort();
  return `<${slash}${tag.toLowerCase()}${parts.length ? ' ' + parts.join(' ') : ''}>`;
}

export function normalizeHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Şema kodunu sistem üretir ve bazı temalar/platformlar <script> etiketini yeniden biçimler ya da
    // atar; içerik kimliği metin ve görünen HTML üzerinden kurulur.
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(\/?)([a-zA-Z0-9]+)((?:\s[^>]*?)?)\s*\/?>/g, normalizeTag)
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

export function canonicalHash({ html, seoTitle, seoDescription }) {
  return sha256([normalizeHtml(html), String(seoTitle || '').trim(), String(seoDescription || '').trim()].join('\n'));
}
