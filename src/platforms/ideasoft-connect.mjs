// IdeaSoft ilk bağlantısı (bir kez): yerelde küçük bir sunucu açılır, kullanıcı tarayıcıda
// IdeaSoft izin ekranını onaylar, dönen kod token'a çevrilir ve kaydedilir. TEST EDİLMEDİ.
// IdeaSoft API ayarlarında yönlendirme adresi olarak REDIRECT kayıtlı olmalı.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { unlinkSync } from 'node:fs';
import { fetchJson } from './http.mjs';
import { atomicWrite } from '../core/fsutil.mjs';
import { nowIso } from '../db/db.mjs';
import { replayTokenJournal } from './ideasoft.mjs';

export const REDIRECT = 'http://127.0.0.1:8787/callback';

export function connectIdeasoft(config, db) {
  const base = `https://${String(config.store.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const { IDEASOFT_CLIENT_ID: id, IDEASOFT_CLIENT_SECRET: secret } = config.env;
  if (!id || !secret) throw new Error('.env içinde IDEASOFT_CLIENT_ID ve IDEASOFT_CLIENT_SECRET yok');
  const state = randomBytes(12).toString('hex');
  const url = `${base}/panel/auth?${new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, state })}`;
  console.log(`\nTarayıcıda şu adresi açın ve izin verin:\n\n${url}\n\n(Bekleniyor... İptal: Ctrl+C)`);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') return res.end();
      try {
        if (u.searchParams.get('state') !== state) throw new Error('güvenlik kodu (state) uyuşmadı');
        const code = u.searchParams.get('code');
        if (!code) throw new Error('IdeaSoft kod göndermedi');
        const t = await fetchJson(`${base}/oauth/v2/token`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, retries: 0,
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: id, client_secret: secret, code, redirect_uri: REDIRECT }).toString(),
        });
        const journal = path.join(config.dataDir, 'journal', 'ideasoft-token.json');
        atomicWrite(journal, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: nowIso(Date.now() + (Number(t.expires_in) || 3600) * 1000) }));
        replayTokenJournal(db, config.dataDir);
        try { unlinkSync(journal); } catch { /* replay zaten sildi */ }
        res.end('IdeaSoft bağlantısı kuruldu. Bu pencereyi kapatabilirsiniz.');
        server.close();
        resolve('IdeaSoft bağlantısı kaydedildi.');
      } catch (err) {
        res.end(`Hata: ${err.message}`);
        server.close();
        reject(err);
      }
    });
    server.listen(8787, '127.0.0.1');
  });
}
