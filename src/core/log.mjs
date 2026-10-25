// Satır başına bir JSON olayı: hem ekrana hem data/logs/<gün>.log dosyasına.
// Gizli bilgi (token, anahtar) asla loglanmaz; çağıranlar yalnız kimlik ve sayı geçer.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function createLogger(dataDir, { quiet = false } = {}) {
  const dir = path.join(dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  return (event, fields = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
    try { appendFileSync(path.join(dir, `${line.slice(7, 17)}.log`), line + '\n'); } catch { /* log yazılamaması işi durdurmaz */ }
    if (!quiet) console.log(line);
  };
}
