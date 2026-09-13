import { log, pc } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { generateReport } from '../pipeline/report.js';
import { formatDuration } from '../pipeline/aggregator.js';
import { hasApiKey, resolveProvider, PROVIDER_IDS } from '../pipeline/providers/index.js';

export default async function reportCommand({ flags }) {
  const emailFlag = flags.email === true ? true : flags['no-email'] ? false : null;
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

  if (!hasApiKey(config) && !flags.quiet && !flags.json) {
    log.dim(`No API key set for ${resolveProvider(config).label} — generating a structured report without the narrative.`);
  }

  const result = await generateReport({
    since: typeof flags.since === 'string' ? flags.since : null,
    until: typeof flags.until === 'string' ? flags.until : null,
    day: typeof flags.day === 'string' ? flags.day : null,
    week: Boolean(flags.week),
    mode: flags.scheduled ? 'scheduled' : 'manual',
    email: emailFlag,
    collect: flags['no-collect'] !== true,
    config,
  });

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          period: result.period,
          generator: result.generator,
          filePath: result.filePath,
          summary: result.summary,
          markdown: result.markdown,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('\n' + result.markdown + '\n');

  if (result.llmError) {
    log.warn(`LLM narrative unavailable (${result.llmError.message}) — used the structured fallback.`);
  }

  log.dim(
    `Period: ${result.period.label} · ` +
      `${result.summary.totalSessions} session(s) · ${formatDuration(result.summary.totalSeconds)} tracked`,
  );
  log.dim(`Saved to ${result.filePath}`);

  if (result.collected?.shell || result.collected?.git) {
    log.dim(`Collected before reporting: ${result.collected.shell} shell, ${result.collected.git} git`);
  }

  if (result.emailResult) {
    if (result.emailResult.ok) log.ok(`Emailed to ${pc.bold(result.emailResult.accepted?.join(', ') ?? 'recipient')}`);
    else log.warn(`Email not sent: ${result.emailResult.error}`);
  }
}
