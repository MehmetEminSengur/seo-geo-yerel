// Tek örnek kilidi. Zamanlayıcı saatlik tetiklerken önceki çalışma sürüyorsa ikincisi beklemeden
// çıkar. Bilgisayar çalışma ortasında kapanırsa kilit dosyası kalır; sahibi ölmüşse ya da nabzı
// STALE_MS'ten eskiyse bayat sayılır ve devralınır.
import { openSync, writeSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export const STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // yarım yazılmış ya da bozuk kilit = bayat
  }
}

export function isStale(info, now = Date.now()) {
  if (!info) return true;
  if (info.host === hostname() && !pidAlive(info.pid)) return true;
  return now - Date.parse(info.heartbeatAt) > STALE_MS;
}

export function acquireLock(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, '.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = { pid: process.pid, host: hostname(), startedAt: new Date(now()).toISOString(), heartbeatAt: new Date(now()).toISOString() };
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      const timer = setInterval(() => {
        info.heartbeatAt = new Date(now()).toISOString();
        try { writeFileSync(file, JSON.stringify(info)); } catch { /* kilit elden gittiyse release zaten bırakır */ }
      }, HEARTBEAT_MS);
      timer.unref();
      return {
        file,
        release() {
          clearInterval(timer);
          const cur = readLock(file);
          if (cur && cur.pid === info.pid && cur.host === info.host) {
            try { unlinkSync(file); } catch { /* zaten silinmiş */ }
          }
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const existing = readLock(file);
      if (!isStale(existing, now())) return null;
      // Bayat kilidi rename ile kenara al: iki süreç aynı anda devralmaya kalkarsa yalnız biri başarır.
      try {
        renameSync(file, `${file}.stale-${process.pid}`);
        unlinkSync(`${file}.stale-${process.pid}`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  return null;
}
