import { log, pc } from '../core/logger.js';
import { formatDuration } from '../pipeline/aggregator.js';
import { listDiffs } from '../core/db.js';
import {
  projectTotals,
  technologyTotals,
  projectNeighbours,
  graphStats,
  workSummary,
  timeline,
  topFiles,
  fileChurn,
  relatedProjects,
  search,
  comparePeriods,
  focusAnalysis,
  startOfWeek,
} from '../pipeline/graph.js';

function bar(value, max, width = 24) {
  if (!max) return '';
  const filled = Math.max(1, Math.round((value / max) * width));
  return pc.cyan('█'.repeat(filled)) + pc.dim('░'.repeat(Math.max(0, width - filled)));
}

function resolveSince(flags) {
  if (typeof flags.since === 'string') return new Date(flags.since).toISOString();
  if (flags.week) return startOfWeek().toISOString();
  const days = flags.month ? 30 : flags.days ? Number(flags.days) : null;
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function requireSince(flags, fallbackDays = 7) {
  return (
    resolveSince(flags) ??
    new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000).toISOString()
  );
}

function windowLabel(since) {
  return since ? `since ${new Date(since).toLocaleDateString()}` : 'all time';
}

function showProjects(flags) {
  const since = resolveSince(flags);
  const rows = projectTotals({ since });
  log.title(`Time by project — ${windowLabel(since)}`);
  if (!rows.length) return log.dim('  No sessions recorded yet.');

  const max = Math.max(...rows.map((row) => Number(row.duration_sec)));
  const width = Math.max(...rows.map((row) => String(row.project).length));
  for (const row of rows) {
    const seconds = Number(row.duration_sec);
    log.info(
      `  ${String(row.project).padEnd(width)}  ${bar(seconds, max)}  ` +
        `${formatDuration(seconds).padStart(7)} ${pc.dim(`${row.sessions} session(s)`)}`,
    );
  }
}

function showTech(flags) {
  const since = resolveSince(flags);
  const rows = technologyTotals({ since });
  log.title(`Technologies — ${windowLabel(since)}`);
  if (!rows.length) return log.dim('  Nothing recorded yet.');

  const max = Math.max(...rows.map((row) => Number(row.weight)));
  const width = Math.max(...rows.map((row) => String(row.technology).length));
  for (const row of rows.slice(0, 20)) {
    log.info(`  ${String(row.technology).padEnd(width)}  ${bar(Number(row.weight), max)}  ${pc.dim(String(row.weight))}`);
  }
}

function showWeek(flags) {
  const explicitWindow = resolveSince(flags);
  const since = explicitWindow ?? startOfWeek().toISOString();
  const summary = workSummary({ since });

  log.title(`Work summary — ${windowLabel(since)}`);
  if (!summary.projects.length) return log.dim('  No sessions in this window.');

  const t = summary.totals;
  log.info(
    `  ${pc.bold(formatDuration(t.durationSec))} across ${pc.bold(String(summary.projects.length))} project(s) ` +
      `in ${t.sessions} session(s)`,
  );
  if (t.linesAdded || t.linesRemoved) {
    log.info(`  ${pc.green('+' + t.linesAdded)}/${pc.red('-' + t.linesRemoved)} lines`);
  }
  if (t.debugSec) log.info(`  ${formatDuration(t.debugSec)} debugging`);
  if (t.errorsResolved) log.info(`  ${t.errorsResolved} error(s) resolved`);
  log.info('');

  const max = Math.max(...summary.projects.map((row) => Number(row.duration_sec)));
  const width = Math.max(...summary.projects.map((row) => String(row.project).length));
  for (const row of summary.projects) {
    const seconds = Number(row.duration_sec);
    const churn =
      Number(row.lines_added) || Number(row.lines_removed)
        ? pc.dim(` +${row.lines_added}/-${row.lines_removed}`)
        : '';
    log.info(
      `  ${String(row.project).padEnd(width)}  ${bar(seconds, max)}  ` +
        `${formatDuration(seconds).padStart(7)} ${pc.dim(`${row.active_days}d · ${row.sessions} session(s)`)}${churn}`,
    );
  }
}

function showTimeline(flags) {
  const since = requireSince(flags, 14);
  const rows = timeline({ since });
  log.title(`Daily timeline — ${windowLabel(since)}`);
  if (!rows.length) return log.dim('  No sessions in this window.');

  const max = Math.max(...rows.map((row) => Number(row.duration_sec)));
  for (const row of rows) {
    const seconds = Number(row.duration_sec);
    const weekday = new Date(`${row.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    log.info(
      `  ${row.day} ${pc.dim(weekday)}  ${bar(seconds, max)}  ${formatDuration(seconds).padStart(7)} ` +
        pc.dim(`${row.projects} project(s)`),
    );
  }
}

function showFiles(flags) {
  const since = resolveSince(flags);
  const project = typeof flags.project === 'string' ? flags.project : null;

  if (flags.churn) {
    const rows = fileChurn({ since, project, limit: Number(flags.limit ?? 20) });
    log.title(`Files by churn${project ? ` in ${project}` : ''} — ${windowLabel(since)}`);
    if (!rows.length) return log.dim('  No edit activity recorded yet.');
    const max = Math.max(...rows.map((row) => row.linesAdded + row.linesRemoved));
    for (const row of rows) {
      log.info(
        `  ${bar(row.linesAdded + row.linesRemoved, max, 12)}  ${row.file} ` +
          pc.dim(`(${project ? '' : row.project + ', '}+${row.linesAdded}/-${row.linesRemoved}, ${row.edits} edits)`),
      );
    }
    return;
  }

  const rows = topFiles({ since, project, limit: Number(flags.limit ?? 20) });

  log.title(`Most-touched files${project ? ` in ${project}` : ''} — ${windowLabel(since)}`);
  if (!rows.length) return log.dim('  Nothing recorded yet.');

  const max = Math.max(...rows.map((row) => Number(row.weight)));
  for (const row of rows) {
    const [proj, ...rest] = String(row.name).split(':');
    const file = rest.join(':') || proj;
    log.info(`  ${bar(Number(row.weight), max, 12)}  ${file} ${pc.dim(project ? '' : `(${proj})`)}`);
  }
}

function showRelated(positionals, flags) {
  const project = positionals[1];
  if (!project) {
    log.error('Usage: narrately graph related <project>');
    process.exitCode = 1;
    return;
  }
  const rows = relatedProjects(project, { limit: Number(flags.limit ?? 10) });
  log.title(`Projects related to ${project}`);
  if (!rows.length) {
    return log.dim('  No other project shares a technology with this one yet.');
  }
  for (const row of rows) {
    log.info(
      `  ${pc.bold(row.project)} ${pc.dim(`— ${row.shared_technologies} shared: ${row.technologies}`)}`,
    );
  }
}

function showSearch(positionals) {
  const term = positionals.slice(1).join(' ');
  if (!term) {
    log.error('Usage: narrately graph search <term>');
    process.exitCode = 1;
    return;
  }
  const { nodes, events } = search(term);
  log.title(`Search — "${term}"`);

  if (nodes.length) {
    log.info(`  ${pc.bold('Graph nodes')}`);
    for (const node of nodes.slice(0, 15)) {
      log.info(`    ${pc.dim(String(node.type).padEnd(11))} ${node.name}`);
    }
  }
  if (events.length) {
    log.info(`  ${pc.bold('Events')}`);
    for (const event of events.slice(0, 15)) {
      const when = new Date(event.timestamp).toLocaleString();
      log.info(`    ${pc.dim(when)}  ${pc.dim(String(event.event).padEnd(13))} ${event.detail}`);
    }
  }
  if (!nodes.length && !events.length) log.dim('  No matches.');
}

function showCompare(flags) {
  const since = requireSince(flags);
  const result = comparePeriods({ since });
  log.title('Period comparison');
  log.dim(
    `  ${new Date(result.window.currentStart).toLocaleDateString()} → now ` +
      `vs the preceding equal-length window`,
  );
  log.info('');

  const delta = result.current.durationSec - result.previous.durationSec;
  const sign = delta >= 0 ? '+' : '';
  const colour = delta >= 0 ? pc.green : pc.red;
  log.info(
    `  Total: ${formatDuration(result.current.durationSec)} ` +
      `${pc.dim(`(was ${formatDuration(result.previous.durationSec)})`)} ` +
      colour(`${sign}${formatDuration(Math.abs(delta))}`),
  );
  log.info('');

  if (!result.projects.length) return log.dim('  No sessions in either window.');
  const width = Math.max(...result.projects.map((row) => row.project.length));
  for (const row of result.projects) {
    const arrow = row.delta > 0 ? pc.green('▲') : row.delta < 0 ? pc.red('▼') : pc.dim('=');
    log.info(
      `  ${arrow} ${row.project.padEnd(width)}  ${formatDuration(row.current).padStart(7)} ` +
        pc.dim(`(was ${formatDuration(row.previous)})`),
    );
  }
}

function showFocus(flags) {
  const since = requireSince(flags);
  const rows = focusAnalysis({ since });
  log.title(`Focus analysis — ${windowLabel(since)}`);
  if (!rows.length) return log.dim('  No sessions in this window.');

  log.dim('  focus = share of the day spent in its single longest stretch');
  log.info('');
  for (const row of rows) {
    const pct = Math.round(row.focusRatio * 100);
    const label = pct >= 60 ? pc.green('focused') : pct >= 35 ? pc.yellow('mixed') : pc.red('fragmented');
    log.info(
      `  ${row.day}  ${formatDuration(row.durationSec).padStart(7)}  ` +
        `${String(pct).padStart(3)}% ${label.padEnd(20)} ` +
        pc.dim(`${row.sessions} session(s) · ${row.projects} project(s) · longest ${formatDuration(row.longestSessionSec)}`),
    );
  }
}

function showProject(positionals, flags) {
  const name = positionals[1];
  if (!name) {
    log.error('Usage: narrately graph project <name>');
    process.exitCode = 1;
    return;
  }
  const rows = projectNeighbours(name, { limit: Number(flags.limit ?? 25) });
  log.title(`Graph neighbourhood — ${name}`);
  if (!rows.length) return log.dim('  No connections recorded for that project.');

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.type)) grouped.set(row.type, []);
    grouped.get(row.type).push(row);
  }
  for (const [type, entries] of grouped) {
    log.info(`  ${pc.bold(type)}`);
    for (const entry of entries) log.info(`    ${entry.name} ${pc.dim(`(${entry.weight})`)}`);
  }
}

function showDiffs(flags) {
  const since = resolveSince(flags);
  const project = typeof flags.project === 'string' ? flags.project : null;
  const rows = listDiffs({ since, project, limit: Number(flags.limit ?? 20) });

  log.title(`Captured diffs${project ? ` in ${project}` : ''} — ${windowLabel(since)}`);
  if (!rows.length) {
    log.dim('  Nothing captured yet.');
    log.dim('  This is opt-in and off by default — see collectors.git.capture_diffs in config.yaml.');
    return;
  }

  for (const row of rows) {
    const ref = row.commit_hash ? row.commit_hash.slice(0, 8) : (row.session_id ?? '');
    const churn = `${pc.green('+' + row.lines_added)}/${pc.red('-' + row.lines_removed)}`;
    const redactedFlag = row.redacted ? pc.yellow(' [redacted]') : '';
    log.info(`  ${pc.bold(row.file)} ${pc.dim(`(${row.project ?? '?'} · ${ref})`)} ${churn}${redactedFlag}`);
    if (flags.full && row.diff_text) {
      for (const line of row.diff_text.split('\n')) log.dim(`    ${line}`);
    } else if (!row.diff_text && row.summary) {
      log.dim(`    ${row.summary}`);
    }
  }
  if (!flags.full) log.dim('\n  Pass --full to print the diff text for each entry.');
}

function showStats() {
  const stats = graphStats();
  log.title('Knowledge graph');
  for (const row of stats.nodes) log.info(`  ${String(row.type).padEnd(12)} ${row.n}`);
  log.info(`  ${'edges'.padEnd(12)} ${stats.edges}`);
}

const QUERIES = {
  projects: (p, f) => showProjects(f),
  tech: (p, f) => showTech(f),
  technologies: (p, f) => showTech(f),
  week: (p, f) => showWeek(f),
  summary: (p, f) => showWeek(f),
  timeline: (p, f) => showTimeline(f),
  files: (p, f) => showFiles(f),
  diffs: (p, f) => showDiffs(f),
  related: (p, f) => showRelated(p, f),
  search: (p) => showSearch(p),
  compare: (p, f) => showCompare(f),
  focus: (p, f) => showFocus(f),
  project: (p, f) => showProject(p, f),
  stats: () => showStats(),
};

export default async function graphCommand({ positionals, flags }) {
  const subject = positionals[0] ?? 'projects';
  const handler = QUERIES[subject];

  if (!handler) {
    log.error(`Unknown graph query: ${subject}`);
    log.dim('Queries: ' + Object.keys(QUERIES).join(' | '));
    log.dim('Windows: --week | --month | --days <n> | --since <date>');
    process.exitCode = 1;
    return;
  }

  handler(positionals, flags);
}
