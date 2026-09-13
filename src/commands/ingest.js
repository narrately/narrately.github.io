import { log } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { drainShellLog } from '../collectors/shell.js';
import { scrapeGit } from '../collectors/git.js';

export default async function ingestCommand({ flags }) {
  const config = loadConfig();
  const since = typeof flags.since === 'string' ? flags.since : '3 days ago';

  const shell = drainShellLog(config);
  log.ok(`Shell: ${shell} new command(s)`);

  const git = scrapeGit(config, { since });
  log.ok(`Git:   ${git} new commit(s)`);

  if (!shell && !git) {
    log.dim('Nothing new. Editor activity arrives via the daemon, not this command.');
  }
}
