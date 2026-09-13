import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = process.env.NARRATELY_HOME
  ? path.resolve(process.env.NARRATELY_HOME)
  : path.join(os.homedir(), '.narrately');

export const CONFIG_PATH = path.join(HOME, 'config.yaml');
export const DB_PATH = path.join(HOME, 'narrately.db');
export const LOG_DIR = path.join(HOME, 'logs');
export const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');
export const PID_PATH = path.join(HOME, 'daemon.pid');
export const PORT_PATH = path.join(HOME, 'daemon.port');
export const REPORTS_DIR = path.join(HOME, 'reports');

export const SHELL_LOG = path.join(HOME, 'shell-history.log');

export function ensureHome() {
  for (const dir of [HOME, LOG_DIR, REPORTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return HOME;
}
