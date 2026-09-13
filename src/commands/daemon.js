import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, pc } from '../core/logger.js';
import {
  startDaemon,
  readDaemonPid,
  readDaemonPort,
  isProcessAlive,
} from '../collectors/daemon.js';
import { PID_PATH, DAEMON_LOG, ensureHome } from '../core/paths.js';
import { loadConfig } from '../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '..', '..', 'bin', 'narrately.js');

async function health(port, timeoutMs = 1500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function start() {
  ensureHome();
  const config = loadConfig();
  const port = config.daemon?.port ?? 47821;

  const existing = readDaemonPid();
  if (isProcessAlive(existing) && (await health(readDaemonPort()))) {
    log.ok(`Daemon already running (pid ${existing})`);
    return;
  }

  const out = fs.openSync(DAEMON_LOG, 'a');
  const child = spawn(process.execPath, [binPath, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, NARRATELY_QUIET: '1' },
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const info = await health(port);
    if (info && info.pid === child.pid) {
      log.ok(`Collector daemon started on 127.0.0.1:${port} ${pc.dim(`(pid ${info.pid})`)}`);
      log.dim(`Logs: ${DAEMON_LOG}`);
      return;
    }
    if (info && info.pid !== child.pid) {
      log.error(
        `Port ${port} is already in use by another process (pid ${info.pid}), not the daemon we just started.`,
      );
      log.dim('Stop that process, or set a different daemon.port in config.yaml, then retry.');
      process.exitCode = 1;
      return;
    }
  }
  log.error('Daemon did not become healthy in time. Check the log:');
  log.dim(DAEMON_LOG);
  process.exitCode = 1;
}

async function stop() {
  const pid = readDaemonPid();
  if (!pid || !isProcessAlive(pid)) {
    log.warn('Daemon is not running.');
    fs.rmSync(PID_PATH, { force: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    log.error(`Could not signal pid ${pid}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isProcessAlive(pid)) break;
  }
  fs.rmSync(PID_PATH, { force: true });
  log.ok('Collector daemon stopped.');
}

async function status() {
  const pid = readDaemonPid();
  const port = readDaemonPort();
  const alive = isProcessAlive(pid);
  const info = alive ? await health(port) : null;

  if (!info) {
    log.info(`${pc.red('●')} Daemon: stopped`);
    log.dim('Start it with: narrately daemon start');
    return;
  }
  const uptimeMs = Date.now() - new Date(info.startedAt).getTime();
  const minutes = Math.floor(uptimeMs / 60_000);
  log.info(`${pc.green('●')} Daemon: running  ${pc.dim(`pid ${info.pid} · port ${port} · up ${minutes}m`)}`);
  log.dim(
    `  events stored: ${info.stored} · dropped (flicker/excluded): ${info.dropped} · focus periods: ${info.focusStarts}`,
  );
}

export default async function daemonCommand({ positionals }) {
  const action = positionals[0] ?? 'status';

  switch (action) {
    case 'start':
      return start();
    case 'stop':
      return stop();
    case 'restart':
      await stop();
      return start();
    case 'status':
      return status();
    case 'run': {
      await startDaemon();
      return new Promise(() => {});
    }
    default:
      log.error(`Unknown daemon action: ${action}`);
      log.dim('Expected: start | stop | restart | status | run');
      process.exitCode = 1;
  }
}
