import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, LOG_DIR, ensureHome } from '../core/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '..', '..', 'bin', 'narrately.js');
const TASK_NAME = 'Narrately-DailyReport';
const LAUNCHD_LABEL = 'ai.narrately.dailyreport';

function parseTime(daily) {
  const [hour, minute] = String(daily ?? '18:00').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Invalid daily_time: ${daily} (expected HH:MM)`);
  }
  return { hour, minute };
}

function windowsInstall(time) {
  const { hour, minute } = parseTime(time);
  const stamp = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const action = `"${process.execPath}" "${BIN}" report --scheduled`;
  execFileSync(
    'schtasks',
    ['/Create', '/TN', TASK_NAME, '/TR', action, '/SC', 'DAILY', '/ST', stamp, '/F'],
    { stdio: 'pipe', encoding: 'utf8', windowsHide: true },
  );
  return `Windows Task Scheduler task "${TASK_NAME}" at ${stamp} daily`;
}

function windowsRemove() {
  execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { stdio: 'pipe', windowsHide: true });
}

function windowsStatus() {
  try {
    const out = execFileSync('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST'], {
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true,
    });
    const next = out.match(/Next Run Time:\s*(.+)/)?.[1]?.trim();
    return { installed: true, detail: next ? `next run ${next}` : 'installed' };
  } catch {
    return { installed: false, detail: 'not installed' };
  }
}

function launchdPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function macInstall(time) {
  const { hour, minute } = parseTime(time);
  const target = launchdPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BIN}</string>
    <string>report</string>
    <string>--scheduled</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key><string>${path.join(LOG_DIR, 'scheduled.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(LOG_DIR, 'scheduled.log')}</string>
  <key>EnvironmentVariables</key>
  <dict><key>NARRATELY_HOME</key><string>${HOME}</string></dict>
</dict>
</plist>`;

  fs.writeFileSync(target, plist);
  try {
    execFileSync('launchctl', ['unload', target], { stdio: 'ignore' });
  } catch {
  }
  execFileSync('launchctl', ['load', target], { stdio: 'pipe' });
  return `launchd agent ${LAUNCHD_LABEL} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} daily`;
}

function macRemove() {
  const target = launchdPath();
  try {
    execFileSync('launchctl', ['unload', target], { stdio: 'ignore' });
  } catch {
  }
  fs.rmSync(target, { force: true });
}

function macStatus() {
  const installed = fs.existsSync(launchdPath());
  return { installed, detail: installed ? launchdPath() : 'not installed' };
}

function systemdDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function linuxInstall(time) {
  const { hour, minute } = parseTime(time);
  const dir = systemdDir();
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'narrately-report.service'),
    `[Unit]
Description=Narrately daily report

[Service]
Type=oneshot
Environment=NARRATELY_HOME=${HOME}
ExecStart=${process.execPath} ${BIN} report --scheduled
`,
  );

  const stamp = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  fs.writeFileSync(
    path.join(dir, 'narrately-report.timer'),
    `[Unit]
Description=Narrately daily report timer

[Timer]
OnCalendar=*-*-* ${stamp}
Persistent=true

[Install]
WantedBy=timers.target
`,
  );

  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  execFileSync('systemctl', ['--user', 'enable', '--now', 'narrately-report.timer'], { stdio: 'pipe' });
  return `systemd user timer narrately-report.timer at ${stamp} daily`;
}

function linuxRemove() {
  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', 'narrately-report.timer'], { stdio: 'ignore' });
  } catch {
  }
  const dir = systemdDir();
  fs.rmSync(path.join(dir, 'narrately-report.timer'), { force: true });
  fs.rmSync(path.join(dir, 'narrately-report.service'), { force: true });
  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  } catch {
  }
}

function linuxStatus() {
  try {
    const out = execFileSync('systemctl', ['--user', 'list-timers', 'narrately-report.timer', '--no-pager'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const installed = out.includes('narrately-report.timer');
    return { installed, detail: installed ? out.trim().split('\n')[1] ?? 'installed' : 'not installed' };
  } catch {
    return { installed: false, detail: 'not installed' };
  }
}

export function installSchedule(dailyTime) {
  ensureHome();
  switch (process.platform) {
    case 'win32':
      return windowsInstall(dailyTime);
    case 'darwin':
      return macInstall(dailyTime);
    default:
      return linuxInstall(dailyTime);
  }
}

export function removeSchedule() {
  switch (process.platform) {
    case 'win32':
      return windowsRemove();
    case 'darwin':
      return macRemove();
    default:
      return linuxRemove();
  }
}

export function scheduleStatus() {
  switch (process.platform) {
    case 'win32':
      return windowsStatus();
    case 'darwin':
      return macStatus();
    default:
      return linuxStatus();
  }
}

export const schedulerName =
  process.platform === 'win32'
    ? 'Windows Task Scheduler'
    : process.platform === 'darwin'
      ? 'launchd'
      : 'systemd user timer';
