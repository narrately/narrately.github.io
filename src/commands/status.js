import fs from 'node:fs';
import { log, pc } from '../core/logger.js';
import { loadConfig, configExists } from '../core/config.js';
import { CONFIG_PATH, HOME, SHELL_LOG } from '../core/paths.js';
import { getDb, countRawEvents, countDiffs, getMeta } from '../core/db.js';
import { readDaemonPid, readDaemonPort, isProcessAlive } from '../collectors/daemon.js';
import { isHookInstalled, detectShell, checkExecutionPolicy } from '../collectors/shell.js';
import { graphStats } from '../pipeline/graph.js';
import { hasApiKey, resolveProvider } from '../pipeline/providers/index.js';
import { formatDuration } from '../pipeline/aggregator.js';

const dot = (ok) => (ok ? pc.green('●') : pc.red('●'));
const warnDot = () => pc.yellow('●');

export default async function statusCommand() {
  if (!configExists()) {
    log.warn('Narrately is not configured yet.');
    log.dim('Run `narrately onboard` to get started.');
    return;
  }

  const config = loadConfig();
  const db = getDb();

  log.title('Configuration');
  log.info(`  Config: ${pc.dim(CONFIG_PATH)}`);
  log.info(`  Data:   ${pc.dim(HOME)}`);
  log.info(`  Mode:   ${config.report?.mode ?? 'manual'} · verbosity ${config.report?.verbosity ?? 'standard'}`);
  const provider = resolveProvider(config);
  const keyPresent = hasApiKey(config);
  log.info(
    `  ${dot(keyPresent)} LLM narrative — ${provider.label} ` +
      (keyPresent
        ? pc.dim(`(${config.report?.model || provider.defaultModel})`)
        : pc.dim('(no API key set — structured fallback)')),
  );
  log.info(`  ${dot(config.email?.enabled)} Email delivery ${config.email?.enabled ? pc.dim(`→ ${config.email.to}`) : pc.dim('(disabled)')}`);

  log.title('Collectors');
  const pid = readDaemonPid();
  const daemonUp = isProcessAlive(pid);
  log.info(`  ${dot(daemonUp)} Daemon ${daemonUp ? pc.dim(`pid ${pid} · port ${readDaemonPort()}`) : pc.dim('stopped — run `narrately daemon start`')}`);
  log.info(`  ${dot(config.collectors?.vscode?.enabled)} VS Code extension`);
  log.info(`  ${dot(config.collectors?.intellij?.enabled)} IntelliJ plugin`);

  const shell = config.collectors?.shell?.shell ?? detectShell();
  const hookInstalled = isHookInstalled(shell);
  const policy = hookInstalled ? checkExecutionPolicy(shell) : null;
  const policyBlocked = Boolean(policy?.blocked);

  if (policyBlocked) {
    log.info(`  ${warnDot()} Shell hook ${pc.dim(`(${shell})`)} — ${pc.yellow('installed but blocked')}`);
    log.dim(
      `      execution policy "${policy.policy}" prevents the profile from loading — nothing is being ` +
        'recorded, and every new terminal shows an error on startup',
    );
    log.dim('      fix: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned');
  } else {
    log.info(`  ${dot(hookInstalled)} Shell hook ${pc.dim(`(${shell})`)}`);
  }
  if (hookInstalled && fs.existsSync(SHELL_LOG)) {
    const size = fs.statSync(SHELL_LOG).size;
    log.dim(`      log: ${SHELL_LOG} (${(size / 1024).toFixed(1)} KB)`);
  }
  log.info(`  ${dot(config.collectors?.git?.enabled !== false)} Git scraper ${pc.dim(`(${config.project_roots?.length ?? 0} project root(s))`)}`);

  log.title('Project roots');
  if (!config.project_roots?.length) {
    log.dim('  None configured — file paths will not map to project names.');
  } else {
    for (const root of config.project_roots) {
      const exists = fs.existsSync(root.path);
      const captureDiffs = root.capture_diffs ?? config.collectors?.git?.capture_diffs ?? false;
      const captureSaveDiffs = Boolean(root.capture_save_diffs);
      const tags = [];
      if (captureDiffs) tags.push(pc.yellow('[capturing code changes]'));
      if (captureSaveDiffs) tags.push(pc.yellow('[capturing uncommitted changes]'));
      log.info(`  ${dot(exists)} ${pc.bold(root.label)} ${pc.dim(root.path)}${tags.length ? ' ' + tags.join(' ') : ''}`);
    }
  }

  log.title('Data');
  const total = countRawEvents();
  const pending = countRawEvents({ unreportedOnly: true });
  const sessionRow = db.prepare('SELECT COUNT(*) AS n, SUM(duration_sec) AS total FROM sessions').get();
  const reports = Number(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n);
  const graph = graphStats();

  log.info(`  Raw events:  ${total} ${pc.dim(`(${pending} not yet reported)`)}`);
  log.info(`  Sessions:    ${Number(sessionRow.n ?? 0)} ${pc.dim(`· ${formatDuration(Number(sessionRow.total ?? 0))} tracked`)}`);
  log.info(`  Reports:     ${reports}`);
  const diffs = countDiffs();
  const retentionDays = config.privacy?.diff_retention_days;
  if (diffs) {
    log.info(
      `  Code diffs:  ${diffs} ${pc.dim('(narrately graph diffs)')}` +
        (retentionDays ? pc.dim(` · raw text summarized after ${retentionDays}d`) : ''),
    );
  }
  log.info(`  Graph:       ${graph.nodes.reduce((sum, row) => sum + Number(row.n), 0)} nodes / ${graph.edges} edges`);
  if (graph.nodes.length) {
    log.dim('      ' + graph.nodes.map((row) => `${row.type}: ${row.n}`).join(' · '));
  }

  const last = getMeta('last_report_at', null);
  log.info(`  Last report: ${last ? pc.dim(new Date(last).toLocaleString()) : pc.dim('never')}`);
}
