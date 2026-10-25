#!/usr/bin/env node
// seo-geo — e-ticaret sayfalarını Google ve yapay zekâ aramalarına hazırlayan yerel araç.
// Komutların listesi için: node bin/seo-geo.mjs yardim
import { createContext, sync, keywords, planAndGenerate, tick } from '../src/app.mjs';
import { acquireLock } from '../src/core/lock.mjs';
import { countByState } from '../src/core/jobs.mjs';
import { recover } from '../src/core/recover.mjs';
import { applyApproved } from '../src/pipeline/apply.mjs';
import { planPages, planBlogs } from '../src/pipeline/plan.mjs';
import { generatePlanned } from '../src/pipeline/generate.mjs';
import { writeReport, approve, reject, collectImages } from '../src/pipeline/review.mjs';
import { restoreJob } from '../src/pipeline/restore.mjs';
import { runSetup } from '../src/setup.mjs';
import { installScheduler, removeScheduler } from '../src/core/os-scheduler.mjs';
import { connectIdeasoft } from '../src/platforms/ideasoft-connect.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { openDb } from '../src/db/db.mjs';

const HELP = `Kullanım: node bin/seo-geo.mjs <komut> [seçenekler]

Kurulum
  kontrol                 Ayarları, anahtarları, yapay zekâ motorunu ve mağaza bağlantısını sınar
  zamanlayici-kur         Bilgisayar açılınca ve saatte bir otomatik çalışmayı kurar
  zamanlayici-kaldir      Otomatik çalışmayı kaldırır
  ideasoft-baglan         IdeaSoft'a ilk bağlantı (tarayıcıda izin; bir kez)

Günlük kullanım
  preview                 Mağazayı okur, kelimeleri toplar, taslakları üretir, önizleme raporunu açar.
                          Mağazaya HİÇBİR ŞEY yazmaz.
  approve <no...>         Taslakları onaylar  (approve --hepsi: hepsini)
  reject <no...>          Taslakları reddeder
  apply                   Onaylananları yedekler, mağazaya yazar ve doğrular
  status                  Durum özeti
  restore <no> [--zorla]  Bir değişikliği yedekteki eski haline döndürür
  images                  Ajanın üreteceği blog görsellerini listeler / hazır olanları toplar

Tek tek adımlar (preview bunları sırayla yapar)
  sync | keywords | plan [--zorla handle1,handle2] [--limit N] | generate [--limit N] | review
Zamanlayıcının çağırdığı
  tick                    Kurtarma + uygulama + vadesi gelen görevler (kaçırılanlar bir kez)
  recover                 Yalnızca yarıda kalan işleri toparlar
`;

const [cmd = 'yardim', ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
const opt = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
const ids = rest.filter((x) => /^\d+$/.test(x));

// Onay/ret/rapor yalnız veritabanı transaction'ı kullanır; uzun süren bir tick sürerken de çalışabilmeli.
const READ_ONLY = new Set(['yardim', 'help', 'status', 'kontrol', 'zamanlayici-kur', 'zamanlayici-kaldir', 'approve', 'reject', 'review', 'images']);

async function main() {
  if (cmd === 'yardim' || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'kontrol') return runSetup();
  if (cmd === 'zamanlayici-kur') return console.log(installScheduler({ dryRun: flag('--goster') }));
  if (cmd === 'zamanlayici-kaldir') return console.log(removeScheduler());
  if (cmd === 'ideasoft-baglan') {
    const config = loadConfig();
    return console.log(await connectIdeasoft(config, openDb(config.dataDir)));
  }

  const ctx = createContext({ quiet: cmd === 'tick', needAdapter: !['status', 'review', 'approve', 'reject', 'images'].includes(cmd) });
  if (cmd === 'status') {
    const s = countByState(ctx.db);
    const sched = ctx.db.prepare('SELECT task, last_success_at, last_error FROM schedule_state').all();
    const pages = ctx.db.prepare("SELECT type, count(*) n FROM pages WHERE lifecycle = 'active' GROUP BY type").all();
    return console.log(JSON.stringify({ isler: s, sayfalar: Object.fromEntries(pages.map((p) => [p.type, p.n])), zamanlayici: sched }, null, 2));
  }

  const lock = READ_ONLY.has(cmd) ? null : acquireLock(ctx.config.dataDir);
  if (!READ_ONLY.has(cmd) && !lock) {
    console.log('Başka bir seo-geo çalışması sürüyor; bu çağrı atlandı.');
    return;
  }
  try {
    let out;
    switch (cmd) {
      case 'tick': out = await tick(ctx); break;
      case 'recover': out = await recover(ctx.db, { adapter: ctx.adapter, log: ctx.log }); break;
      case 'sync': out = await sync(ctx); break;
      case 'keywords': out = await keywords(ctx); break;
      case 'plan': out = { pages: planPages(ctx, { limit: opt('--limit') && Number(opt('--limit')), force: (opt('--zorla') || '').split(',').filter(Boolean) }), blogs: planBlogs(ctx) }; break;
      case 'generate': out = await generatePlanned(ctx, { limit: Number(opt('--limit') || ctx.config.schedule.batchSize) }); break;
      case 'review': out = writeReport(ctx); break;
      case 'preview': {
        await recover(ctx.db, { adapter: ctx.adapter, log: ctx.log });
        const s = await sync(ctx);
        const k = await keywords(ctx);
        const g = await planAndGenerate(ctx, { limit: opt('--limit') && Number(opt('--limit')), force: (opt('--zorla') || '').split(',').filter(Boolean) });
        out = { sync: s, keywords: k, ...g };
        console.log(`\nÖnizleme raporu: ${g.report}\nMağazaya henüz hiçbir şey yazılmadı. Onay için: node bin/seo-geo.mjs approve <no> | approve --hepsi`);
        break;
      }
      case 'approve': out = { onaylanan: approve(ctx, ids, { all: flag('--hepsi') }) }; break;
      case 'reject': out = { reddedilen: reject(ctx, ids) }; break;
      case 'apply': out = await applyApproved(ctx); break;
      case 'restore': out = await restoreJob(ctx, Number(ids[0]), { force: flag('--zorla') }); break;
      case 'images': out = collectImages(ctx); break;
      default:
        console.log(HELP);
        process.exitCode = 2;
        return;
    }
    if (cmd !== 'tick') console.log(JSON.stringify(out, null, 2));
  } finally {
    lock?.release();
  }
}

main().catch((err) => {
  console.error(`Hata: ${err.message}`);
  process.exitCode = 1;
});
