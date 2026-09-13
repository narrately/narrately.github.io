import { log, pc } from './core/logger.js';

const COMMANDS = {
  onboard: {
    summary: 'Interactive setup wizard (run this first)',
    load: () => import('./commands/onboard.js'),
  },
  install: {
    summary: 'Install a collector: narrately install <vscode|intellij|shell>',
    load: () => import('./commands/install.js'),
  },
  daemon: {
    summary: 'Control the collector daemon: start | stop | status | run',
    load: () => import('./commands/daemon.js'),
  },
  report: {
    summary: 'Generate an activity report from accumulated events',
    load: () => import('./commands/report.js'),
  },
  schedule: {
    summary: 'Manage scheduled reports: enable | disable | status',
    load: () => import('./commands/schedule.js'),
  },
  status: {
    summary: 'Show collector, data, and configuration status',
    load: () => import('./commands/status.js'),
  },
  config: {
    summary: 'View or edit configuration: list | get <key> | set <key> <value> | path',
    load: () => import('./commands/config.js'),
  },
  graph: {
    summary: 'Query the local knowledge graph',
    load: () => import('./commands/graph.js'),
  },
  ask: {
    summary: 'Ask a one-off natural-language question about your recorded activity',
    load: () => import('./commands/ask.js'),
  },
  chat: {
    summary: 'Interactive chat about your recorded activity and notes',
    load: () => import('./commands/chat.js'),
  },
  ingest: {
    summary: 'Force a collection pass (shell history + git commits)',
    load: () => import('./commands/ingest.js'),
  },
  web: {
    summary: 'Open the local detail dashboard: projects, files, notes, reports',
    load: () => import('./commands/web.js'),
  },
};

function printHelp() {
  console.log(`
${pc.bold('Narrately')} ${pc.dim('— your daily developer activity report, written for you')}

${pc.bold('Usage')}
  narrately <command> [options]

${pc.bold('Commands')}`);
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, { summary }] of Object.entries(COMMANDS)) {
    console.log(`  ${pc.cyan(name.padEnd(width))}  ${summary}`);
  }
  console.log(`
${pc.bold('Getting started')}
  narrately onboard          Configure collectors and project labels
  narrately daemon start     Start background collection
  narrately report           Generate a report on demand

${pc.dim('All data stays on this machine unless you enable email delivery.')}
`);
}

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags[body] = argv[++i];
    } else {
      flags[body] = true;
    }
  }
  return { flags, positionals };
}

export async function run(argv) {
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    printHelp();
    return;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
    console.log(pkg.version);
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    log.error(`Unknown command: ${name}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const module = await command.load();
  const { flags, positionals } = parseArgs(rest);
  await module.default({ flags, positionals, argv: rest });
}
