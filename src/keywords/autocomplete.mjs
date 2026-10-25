// Ücretsiz kaynak: Google arama kutusunun önerileri. Anahtar gerekmez. Resmî bir API değildir;
// nazik olmak için istekler arasında bekler ve tohum başına sınırlı sayıda istek atar.
import { norm } from './text.mjs';

const LETTERS = 'abcdefghijklmnoprstuvyz'.split('');
const QUESTIONS = ['nedir', 'nasil', 'neden', 'fiyat', 'toptan', 'en iyi', 'hangi'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function suggest(query, { hl = 'tr', gl = 'tr', fetchImpl = fetch } = {}) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&ie=utf-8&oe=utf-8&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 seo-geo-yerel' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`öneri servisi ${res.status}`);
  const data = JSON.parse(await res.text());
  return Array.isArray(data?.[1]) ? data[1] : [];
}

// Bir tohum için: kendisi + soru kalıpları (+ istenirse harf genişletmesi).
export async function expandSeed(seed, { depth = 1, delayMs = 350, ...opts } = {}) {
  const queries = [seed, ...QUESTIONS.map((q) => (q === 'nedir' || q === 'fiyat' || q === 'toptan' ? `${seed} ${q}` : `${q} ${seed}`))];
  if (depth > 1) queries.push(...LETTERS.map((l) => `${seed} ${l}`));
  const out = new Set();
  for (const q of queries) {
    try {
      for (const s of await suggest(q, opts)) out.add(s.trim());
    } catch {
      break; // servis reddediyorsa bu tohumu bırak, sonraki tick tekrar dener
    }
    await sleep(delayMs);
  }
  const seedNorm = norm(seed);
  return [...out].filter((k) => norm(k) !== seedNorm || k === seed);
}
