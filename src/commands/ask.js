import { log, pc } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { formatDuration } from '../pipeline/aggregator.js';
import { answerQuestion, hasApiKey, resolveProvider, PROVIDER_IDS } from '../pipeline/providers/index.js';
import { inferWindow, buildContext } from '../pipeline/assistant.js';

export default async function askCommand({ positionals, flags }) {
  const question = positionals.join(' ').trim();

  if (!question) {
    log.error('Usage: narrately ask "what have I worked on this week across all projects"');
    log.dim('Options: --since <date> | --days <n> | --json | --provider <id> | --model <id>');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();

  if (typeof flags.provider === 'string') {
    if (!PROVIDER_IDS.includes(flags.provider)) {
      log.error(`Unknown provider "${flags.provider}". Expected: ${PROVIDER_IDS.join(' | ')}`);
      process.exitCode = 1;
      return;
    }
    if (flags.provider !== config.report.provider) {
      config.report.provider = flags.provider;
      if (typeof flags.model !== 'string') config.report.model = null;
    }
  }
  if (typeof flags.model === 'string') config.report.model = flags.model;

  const { since, label } = inferWindow(question, flags);
  const context = buildContext(since);

  if (flags.json) {
    console.log(JSON.stringify({ question, window: label, context }, null, 2));
    return;
  }

  if (!context.projects.length) {
    log.warn(`No activity recorded for ${label}.`);
    log.dim('Check `narrately status` — the collector daemon may not be running.');
    return;
  }

  const provider = resolveProvider(config);
  if (!hasApiKey(config)) {
    log.warn(`No API key set for ${provider.label} — showing the underlying data instead of a written answer.`);
    log.title(`Activity — ${label}`);
    log.info(`  ${formatDuration(context.totals.durationSec)} across ${context.projects.length} project(s)`);
    for (const project of context.projects) {
      log.info(`  ${pc.bold(project.project.padEnd(20))} ${project.duration.padStart(8)} ${pc.dim(`${project.activeDays} active day(s)`)}`);
    }
    log.dim(`\nSet an API key for ${provider.label} to get a written answer to your question.`);
    return;
  }

  log.dim(`Answering from ${label} via ${provider.label}…`);
  try {
    const { text } = await answerQuestion(config, question, context);
    console.log('\n' + text + '\n');
  } catch (error) {
    log.error(`Could not answer: ${error.message}`);
    log.dim('Run with --json to inspect the data that would have been used.');
    process.exitCode = 1;
  }
}
