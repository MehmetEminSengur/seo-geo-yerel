// Kapanmaya dayanıklı dosya yazımı: geçici dosya → fsync → rename → klasör fsync.
// Yarım yazılmış bir yedek ya da token dosyası hiçbir zaman asıl adla görünmez.
import { openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function atomicWrite(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
  try {
    const dirFd = openSync(path.dirname(filePath), 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch {
    // Windows klasör fsync'i desteklemez; rename orada zaten atomik.
  }
}

export function readJsonIfComplete(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');
