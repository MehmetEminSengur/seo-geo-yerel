// Metin motoru seçimi. Hepsi aynı sözleşmeyi uygular:
//   generate({ prompt, schema }) → JSON nesnesi
// Motor, izleyicinin kendi aboneliğiyle oturum açtığı CLI'dir; ek API anahtarı gerekmez.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, extractJson } from './run-cli.mjs';

const SYSTEM = 'Sen bir e-ticaret içerik yazarısın. Yalnızca istenen JSON nesnesini döndür; araç kullanma, dosya okuma ya da yazma.';

const engines = {
  // Codex CLI (ChatGPT aboneliği). Boş bir geçici klasörde, salt-okunur sandbox ile çalışır.
  async codex({ prompt, schema, model }) {
    const dir = mkdtempSync(path.join(tmpdir(), 'seo-geo-codex-'));
    try {
      const schemaFile = path.join(dir, 'schema.json');
      const outFile = path.join(dir, 'out.txt');
      writeFileSync(schemaFile, JSON.stringify(schema));
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', dir, '--output-schema', schemaFile, '-o', outFile];
      if (model) args.push('-m', model);
      args.push('-');
      await runCli('codex', args, { input: `${SYSTEM}\n\n${prompt}` });
      return extractJson(readFileSync(outFile, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // Claude Code (Claude aboneliği). Araçlar kapalı, oturum kaydedilmez.
  async claude({ prompt, schema, model }) {
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence', '--tools', '', '--append-system-prompt', SYSTEM];
    if (model) args.push('--model', model);
    const { stdout } = await runCli('claude', args, { input: prompt });
    const res = JSON.parse(stdout);
    if (res.is_error) throw new Error(`claude hata döndü: ${String(res.result).slice(0, 300)}`);
    return res.structured_output ?? extractJson(res.result);
  },

  // Gemini CLI (Google hesabı; Antigravity kullananlar için). Şema desteği yok, istemde tarif edilir.
  async gemini({ prompt, schema, model }) {
    const args = ['-p', '', '--output-format', 'json'];
    if (model) args.push('-m', model);
    const full = `${SYSTEM}\n\nCevabın şu JSON şemasına uymalı:\n${JSON.stringify(schema)}\n\n${prompt}`;
    const { stdout } = await runCli('gemini', args, { input: full });
    const res = JSON.parse(stdout);
    return extractJson(res.response ?? stdout);
  },
};

export function textEngine(config) {
  const name = config.engines?.text || 'codex';
  const impl = engines[name];
  if (!impl) throw new Error(`bilinmeyen metin motoru: ${name} (codex | claude | gemini)`);
  return { name, generate: (req) => impl({ model: config.engines?.textModel, ...req }) };
}

export async function probeEngines() {
  const out = {};
  for (const [name, args] of Object.entries({ codex: ['--version'], claude: ['--version'], gemini: ['--version'] })) {
    try {
      const { stdout } = await runCli(name, args, { timeoutMs: 15_000 });
      out[name] = stdout.trim().split('\n')[0];
    } catch {
      out[name] = null;
    }
  }
  return out;
}
