import * as readline from 'node:readline/promises';
import { log, pc } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { answerQuestion, hasApiKey, resolveProvider, PROVIDER_IDS } from '../pipeline/providers/index.js';
import { inferWindow, buildContext, trimHistory } from '../pipeline/assistant.js';

const EXIT_WORDS = new Set(['exit', 'quit', ':q', '/exit', '/quit']);

export default async function chatCommand({ flags }) {
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

  const provider = resolveProvider(config);

  log.title(`Narrately chat — ${provider.label}`);
  log.dim('Ask about your tracked activity or your own notes. Type "exit" or Ctrl+C to leave.');
  if (!hasApiKey(config)) {
    log.warn(`No API key set for ${provider.label} — chat needs one to answer questions.`);
    log.dim(`Set the provider's API key, or pass --provider <id> to use a different one, then retry.`);
    process.exitCode = 1;
    return;
  }
  log.info('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const onSigint = () => {
    console.log('\n' + pc.dim('Goodbye.'));
    process.exit(0);
  };
  process.on('SIGINT', onSigint);

  let history = [];
  try {
    while (true) {
      let question;
      try {
        question = (await rl.question(pc.bold('you> '))).trim();
      } catch {
        break;
      }
      if (!question) continue;
      if (EXIT_WORDS.has(question.toLowerCase())) break;

      const { since, label } = inferWindow(question, {});
      const context = buildContext(since);

      try {
        const { text } = await answerQuestion(config, question, context, { history });
        console.log(pc.cyan('narrately> ') + text + '\n');
        history = trimHistory([...history, { role: 'user', content: question }, { role: 'assistant', content: text }]);
      } catch (error) {
        log.error(`Could not answer (grounded in ${label}): ${error.message}`);
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    rl.close();
    log.dim('Goodbye.');
  }
}
