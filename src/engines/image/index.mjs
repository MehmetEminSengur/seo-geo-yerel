// Blog kapak görseli. Üç yol:
//   product-image (varsayılan): konuya en yakın ürünün mağazadaki mevcut görseli. Ücretsiz, anında.
//   agent-queue: Codex / Antigravity kullananlar için. Görsel isteği data/images/queue/ altına yazılır;
//                ajan bir sonraki oturumda kendi aboneliğiyle üretip data/images/done/ altına koyar
//                (bkz. AGENTS.md → "Görsel kuyruğu"). Yazı o sırada awaiting_image durumunda bekler.
//   api: OPENAI_API_KEY ya da GEMINI_API_KEY ile doğrudan üretim (Claude kullananlar için).
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { atomicWrite } from '../../core/fsutil.mjs';
import { overlap } from '../../keywords/text.mjs';
import { fetchJson } from '../../platforms/http.mjs';

export function productImageFor(db, keyword) {
  const rows = db.prepare("SELECT title, image_url FROM pages WHERE type IN ('product','collection') AND image_url IS NOT NULL AND lifecycle = 'active'").all();
  const best = rows.map((r) => ({ r, s: overlap(r.title, keyword) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0 ? best.r.image_url : rows[0]?.image_url ?? null;
}

const queueDir = (dataDir) => path.join(dataDir, 'images', 'queue');
const doneDir = (dataDir) => path.join(dataDir, 'images', 'done');

export function enqueueImage(dataDir, job, { prompt, alt }) {
  const outFile = path.join(doneDir(dataDir), `job-${job.id}.png`);
  atomicWrite(path.join(queueDir(dataDir), `job-${job.id}.json`), JSON.stringify({ jobId: job.id, prompt, alt, outFile, size: '1536x1024' }, null, 1));
  return outFile;
}

export function listQueue(dataDir) {
  const dir = queueDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
}

export const doneFileFor = (dataDir, jobId) => {
  const dir = doneDir(dataDir);
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.startsWith(`job-${jobId}.`) && /\.(png|jpe?g|webp)$/i.test(x));
  return f ? path.join(dir, f) : null;
};

// Doğrudan API ile üretir, dosya yolunu döner.
export async function generateViaApi(config, { prompt, jobId }) {
  const out = path.join(doneDir(config.dataDir), `job-${jobId}.png`);
  if (config.env.OPENAI_API_KEY) {
    const res = await fetchJson('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { authorization: `Bearer ${config.env.OPENAI_API_KEY}` }, timeoutMs: 180_000,
      body: { model: config.engines.imageModel || 'gpt-image-1', prompt, size: '1536x1024', n: 1 },
    });
    atomicWrite(out, Buffer.from(res.data[0].b64_json, 'base64'));
    return out;
  }
  if (config.env.GEMINI_API_KEY) {
    const model = config.engines.imageModel || 'gemini-2.5-flash-image';
    const res = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': config.env.GEMINI_API_KEY }, timeoutMs: 180_000,
      body: { contents: [{ parts: [{ text: prompt }] }] },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Gemini görsel döndürmedi');
    atomicWrite(out, Buffer.from(part.inlineData.data, 'base64'));
    return out;
  }
  throw new Error('görsel için .env içinde OPENAI_API_KEY ya da GEMINI_API_KEY yok');
}
