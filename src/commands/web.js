import { spawn } from 'node:child_process';
import { log, pc } from '../core/logger.js';
import { startWebServer } from '../web/server.js';
import { configExists } from '../core/config.js';

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
  }
}

export default async function webCommand({ flags }) {
  if (!configExists()) {
    log.warn('Narrately is not configured yet.');
    log.dim('Run `narrately onboard` to get started.');
    process.exitCode = 1;
    return;
  }

  const port = Number(flags.port ?? 47830);

  let started;
  try {
    started = await startWebServer({ port });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      log.error(`Port ${port} is already in use — another dashboard instance may already be running.`);
      log.dim(`Open it directly: http://127.0.0.1:${port}`);
      log.dim('Or pick a different port: narrately web --port 47831');
    } else {
      log.error(`Could not start the dashboard: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  log.ok(`Dashboard running at ${pc.bold(started.url)}`);
  log.dim('Local only — bound to 127.0.0.1, never reachable off this machine. Press Ctrl+C to stop.');

  if (flags['no-open'] !== true) openBrowser(started.url);

  const shutdown = () => {
    started.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return new Promise(() => {});
}
