import { log, pc } from '../core/logger.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { installSchedule, removeSchedule, scheduleStatus, schedulerName } from '../scheduler/index.js';

export default async function scheduleCommand({ positionals, flags }) {
  const action = positionals[0] ?? 'status';
  const config = loadConfig();

  if (action === 'enable') {
    const time = typeof flags.at === 'string' ? flags.at : (config.report?.daily_time ?? '18:00');
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      log.error(`Invalid time "${time}". Expected HH:MM, e.g. --at 18:30`);
      process.exitCode = 1;
      return;
    }
    try {
      const detail = installSchedule(time);
      config.report.mode = 'scheduled';
      config.report.daily_time = time;
      saveConfig(config);
      log.ok(`Scheduled daily reports via ${schedulerName}.`);
      log.dim(`  ${detail}`);
    } catch (error) {
      log.error(`Could not register the scheduled task: ${error.message}`);
      log.dim('On Linux this needs a systemd user session; on Windows it may need an elevated shell.');
      process.exitCode = 1;
    }
    return;
  }

  if (action === 'disable') {
    try {
      removeSchedule();
      config.report.mode = 'manual';
      saveConfig(config);
      log.ok('Scheduled reports disabled. Manual `narrately report` still works.');
    } catch (error) {
      log.error(`Could not remove the scheduled task: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === 'status') {
    const status = scheduleStatus();
    log.info(
      `${status.installed ? pc.green('●') : pc.red('●')} Scheduled reports ` +
        `${status.installed ? pc.dim(`(${schedulerName})`) : pc.dim('disabled')}`,
    );
    log.dim(`  ${status.detail}`);
    log.dim(`  Configured time: ${config.report?.daily_time ?? '18:00'}`);
    return;
  }

  log.error(`Unknown schedule action: ${action}`);
  log.dim('Expected: enable [--at HH:MM] | disable | status');
  process.exitCode = 1;
}
