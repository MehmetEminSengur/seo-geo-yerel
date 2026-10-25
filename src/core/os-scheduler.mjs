// İşletim sistemi zamanlayıcısı: bilgisayar açılınca, oturum açılınca, uykudan uyanınca ve saatte
// bir `tick` çağrılır. Kaçırılan saatler üst üste çalışmaz; tick zaten "son başarılı çalışma"ya
// bakarak her görevi bir kez çalıştırır.
//   macOS  : ~/Library/LaunchAgents içine LaunchAgent (RunAtLoad + StartInterval). launchd uykuda
//            kaçırılan aralığı uyanınca bir kez çalıştırır.
//   Windows: Görev Zamanlayıcı (oturum açılışı + saatlik, StartWhenAvailable = kaçırılanı telafi)
//   Linux  : systemd kullanıcı zamanlayıcısı (Persistent=true)
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { ROOT } from './config.mjs';

const LABEL = 'com.seo-geo-yerel.tick';
const BIN = path.join(ROOT, 'bin', 'seo-geo.mjs');
// SEO_GEO_HOME ile ayrı bir ayar klasörü kullanılıyorsa zamanlayıcı da onu kullanır.
const HOME = process.env.SEO_GEO_HOME || ROOT;
const LOGS = path.join(HOME, 'data', 'logs');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Zamanlayıcı çok kısıtlı bir PATH ile çalışır; codex/claude/gemini'nin bulunması için kurulum
// anındaki PATH aynen aktarılır.
const pathNow = () => process.env.PATH || '';

function macPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xmlEsc(process.execPath)}</string><string>${xmlEsc(BIN)}</string><string>tick</string></array>
  <key>WorkingDirectory</key><string>${xmlEsc(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xmlEsc(pathNow())}</string><key>SEO_GEO_HOME</key><string>${xmlEsc(HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>${xmlEsc(path.join(LOGS, 'zamanlayici.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(path.join(LOGS, 'zamanlayici.log'))}</string>
</dict></plist>
`;
}

function windowsXml() {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <TimeTrigger><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT1H</Interval></Repetition></TimeTrigger>
  </Triggers>
  <Settings>
    <StartWhenAvailable>true</StartWhenAvailable>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
  </Settings>
  <Actions><Exec><Command>${xmlEsc(process.execPath)}</Command><Arguments>"${xmlEsc(BIN)}" tick</Arguments><WorkingDirectory>${xmlEsc(ROOT)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

function linuxUnits() {
  const service = `[Unit]\nDescription=seo-geo-yerel tick\n\n[Service]\nType=oneshot\nWorkingDirectory=${ROOT}\nEnvironment=PATH=${pathNow()}\nEnvironment=SEO_GEO_HOME=${HOME}\nExecStart=${process.execPath} ${BIN} tick\n`;
  const timer = `[Unit]\nDescription=seo-geo-yerel saatlik\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
  return { service, timer };
}

export function installScheduler({ dryRun = false } = {}) {
  mkdirSync(LOGS, { recursive: true });
  if (process.platform === 'darwin') {
    const file = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    if (dryRun) return `Kurulacak dosya: ${file}\n\n${macPlist()}`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, macPlist());
    const domain = `gui/${userInfo().uid}`;
    try { execFileSync('launchctl', ['bootout', domain, file], { stdio: 'ignore' }); } catch { /* daha önce yüklenmemiş */ }
    execFileSync('launchctl', ['bootstrap', domain, file]);
    return `Kuruldu (macOS LaunchAgent): ${file}\nBilgisayar açılınca ve saatte bir çalışır. Kayıtlar: ${path.join(LOGS, 'zamanlayici.log')}`;
  }
  if (process.platform === 'win32') {
    const file = path.join(ROOT, 'data', 'seo-geo-gorev.xml');
    if (dryRun) return windowsXml();
    writeFileSync(file, '﻿' + windowsXml(), 'utf16le');
    execFileSync('schtasks', ['/Create', '/TN', 'seo-geo-yerel', '/XML', file, '/F']);
    return 'Kuruldu (Windows Görev Zamanlayıcı: "seo-geo-yerel"). Oturum açılınca ve saatte bir çalışır.';
  }
  const dir = path.join(homedir(), '.config', 'systemd', 'user');
  const { service, timer } = linuxUnits();
  if (dryRun) return `${service}\n---\n${timer}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'seo-geo-yerel.service'), service);
  writeFileSync(path.join(dir, 'seo-geo-yerel.timer'), timer);
  execFileSync('systemctl', ['--user', 'daemon-reload']);
  execFileSync('systemctl', ['--user', 'enable', '--now', 'seo-geo-yerel.timer']);
  return 'Kuruldu (systemd kullanıcı zamanlayıcısı: seo-geo-yerel.timer).';
}

export function removeScheduler() {
  if (process.platform === 'darwin') {
    const file = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    try { execFileSync('launchctl', ['bootout', `gui/${userInfo().uid}`, file], { stdio: 'ignore' }); } catch { /* yüklü değil */ }
    if (existsSync(file)) unlinkSync(file);
    return 'Kaldırıldı.';
  }
  if (process.platform === 'win32') {
    execFileSync('schtasks', ['/Delete', '/TN', 'seo-geo-yerel', '/F']);
    return 'Kaldırıldı.';
  }
  execFileSync('systemctl', ['--user', 'disable', '--now', 'seo-geo-yerel.timer']);
  return 'Kaldırıldı.';
}
