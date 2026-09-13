import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { select, confirm, input, checkbox, password } from '@inquirer/prompts';
import { log, pc } from '../core/logger.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../core/config.js';
import { CONFIG_PATH, ensureHome } from '../core/paths.js';
import { detectVsCode, detectJetBrains } from '../collectors/ide.js';
import { detectShell, shellConfigPath, isHookInstalled, checkExecutionPolicy } from '../collectors/shell.js';
import { discoverRepos, isGitRepo } from '../collectors/git.js';
import { installVsCode, installIntelliJ, installShell } from './install.js';
import { installSchedule, schedulerName } from '../scheduler/index.js';
import { hasApiKey, PROVIDERS, PROVIDER_IDS } from '../pipeline/providers/index.js';
import { verifyEmail } from '../pipeline/email.js';

const SHELL_LABELS = { bash: 'bash', zsh: 'zsh', fish: 'fish', powershell: 'PowerShell' };

async function stepWorkProfile(config) {
  log.title('1. Work profile');
  const answer = await select({
    message: 'What do you primarily do on this PC?',
    choices: [
      { name: 'Software development', value: 'software_development' },
      { name: 'Design', value: 'design', description: 'Not supported in this release — recorded for roadmap' },
      { name: 'Writing / research', value: 'writing', description: 'Not supported in this release — recorded for roadmap' },
      { name: 'Something else', value: 'other', description: 'Not supported in this release — recorded for roadmap' },
    ],
    default: config.profile?.work_type ?? 'software_development',
  });

  config.profile.work_type = answer;
  if (answer !== 'software_development') {
    log.warn('Only software development is fully supported right now.');
    log.dim('  Your answer is recorded so we can prioritise it. Continuing with the developer setup.');
  }
}

async function stepIdeDetection(config) {
  log.title('2. IDE detection');
  const vscode = detectVsCode();
  const jetbrains = detectJetBrains();

  if (!vscode.length && !jetbrains.length) {
    log.warn('No VS Code or JetBrains IDE detected.');
    log.dim('  Launch your IDE once so it creates its config directory, then re-run `narrately onboard`.');
    return { vscode: [], jetbrains: [] };
  }

  const choices = [
    ...vscode.map((variant) => ({ name: `${variant.label} ${pc.dim('(VS Code family)')}`, value: `vscode:${variant.id}`, checked: true })),
    ...jetbrains.map((ide) => ({ name: `${ide.label} ${pc.dim('(JetBrains)')}`, value: `intellij:${ide.id}`, checked: jetbrains.indexOf(ide) === 0 })),
  ];

  log.dim(`  Found ${choices.length} installation(s).`);
  const selected = await checkbox({
    message: 'Which IDEs should Narrately collect from?',
    choices,
  });

  return {
    vscode: selected.filter((entry) => entry.startsWith('vscode:')).map((entry) => entry.slice(7)),
    jetbrains: selected.filter((entry) => entry.startsWith('intellij:')).map((entry) => entry.slice(9)),
  };
}

async function stepPluginInstall(config, chosen) {
  log.title('3. Collector install');

  if (!chosen.vscode.length && !chosen.jetbrains.length) {
    log.dim('  No IDEs selected — skipping.');
    return;
  }

  for (const variantId of chosen.vscode) {
    try {
      const installed = installVsCode(config, { variantId });
      for (const entry of installed) log.ok(`${entry.label}: collector extension installed`);
    } catch (error) {
      log.warn(`VS Code install failed: ${error.message}`);
    }
  }

  if (chosen.jetbrains.length) {
    try {
      const result = installIntelliJ(config, { ideId: chosen.jetbrains[0] });
      if (result.built) {
        for (const entry of result.installed) log.ok(`${entry.label}: collector plugin installed`);
      } else {
        log.warn('IntelliJ plugin is not built yet (separate Kotlin/Gradle toolchain).');
        for (const line of result.instructions) log.dim(`    ${line}`);
      }
    } catch (error) {
      log.warn(`IntelliJ install failed: ${error.message}`);
    }
  }
}

function warnIfExecutionPolicyBlocks(detected) {
  const policy = checkExecutionPolicy(detected);
  if (!policy?.blocked) return;
  log.warn(
    `PowerShell's execution policy is "${policy.policy}" — it refuses to load any profile script, ` +
      'including this hook. Every new PowerShell terminal (standalone, VS Code, WebStorm, IntelliJ) will ' +
      'show a red error on startup, and no terminal activity will be recorded, until this changes.',
  );
  log.info(`  Fix (per-user, no admin rights needed): ${pc.cyan('Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned')}`);
}

async function stepShell(config) {
  log.title('4. Shell integration');
  const detected = detectShell();
  log.dim(`  Detected shell: ${SHELL_LABELS[detected] ?? detected}`);

  if (isHookInstalled(detected)) {
    log.ok('Hook already installed.');
    config.collectors.shell = { enabled: true, shell: detected };
    warnIfExecutionPolicyBlocks(detected);
    return;
  }

  const target = shellConfigPath(detected);
  log.dim(`  This appends a timestamped-history hook to ${target}`);
  log.dim('  It logs command text and timestamps only — never command output.');

  const wanted = await confirm({ message: 'Install the shell history hook?', default: true });
  if (!wanted) {
    config.collectors.shell = { enabled: false, shell: detected };
    log.dim('  Skipped. Terminal work will not appear in reports.');
    return;
  }

  try {
    const result = installShell(config, { shell: detected });
    log.ok(`Hook written to ${result.path}`);
    log.dim('  Open a new terminal for it to take effect.');
    warnIfExecutionPolicyBlocks(detected);
  } catch (error) {
    log.warn(`Could not install the hook: ${error.message}`);
    config.collectors.shell = { enabled: false, shell: detected };
  }
}

function suggestRoots() {
  const home = os.homedir();
  const candidates = ['code', 'Code', 'src', 'dev', 'Development', 'projects', 'Projects', 'repos', 'workspace', 'git'];
  return candidates
    .map((name) => path.join(home, name))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

async function stepProjectRoots(config) {
  log.title('5. Project roots & labels');
  log.dim('  Raw file paths get mapped to these labels in reports and the graph.');

  const defaultCaptureDiffs = await confirm({
    message: 'Default: capture actual code diffs from commits for new projects (Tier 1)? Off is safer — you can still turn this on per project below, and it never applies retroactively to commits already scraped.',
    default: config.collectors?.git?.capture_diffs ?? false,
  });
  config.collectors.git.capture_diffs = defaultCaptureDiffs;

  const existing = new Set((config.project_roots ?? []).map((root) => path.resolve(root.path)));
  const roots = [...(config.project_roots ?? [])];
  const suggestions = suggestRoots().filter((dir) => !existing.has(path.resolve(dir)));

  let toScan = [];
  if (suggestions.length) {
    toScan = await checkbox({
      message: 'Found these code directories — scan them for repositories?',
      choices: suggestions.map((dir) => ({ name: dir, value: dir, checked: true })),
    });
  }

  while (true) {
    const more = await input({
      message: 'Add another code directory (blank to finish):',
      default: '',
    });
    if (!more.trim()) break;
    const resolved = path.resolve(more.trim().replace(/^~(?=$|[/\\])/, os.homedir()));
    if (!fs.existsSync(resolved)) {
      log.warn(`  ${resolved} does not exist.`);
      continue;
    }
    toScan.push(resolved);
  }

  for (const dir of toScan) {
    const repos = isGitRepo(dir) ? [dir] : discoverRepos(dir);
    if (!repos.length) {
      const label = await input({ message: `Label for ${pc.bold(dir)}:`, default: path.basename(dir) });
      if (!existing.has(path.resolve(dir))) {
        roots.push({ path: dir, label: label.trim() || path.basename(dir) });
        existing.add(path.resolve(dir));
      }
      continue;
    }

    log.dim(`  ${dir}: found ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}`);
    const chosen = await checkbox({
      message: `Track which repositories under ${path.basename(dir)}?`,
      choices: repos.map((repo) => ({
        name: path.relative(dir, repo) || path.basename(repo),
        value: repo,
        checked: true,
      })),
      pageSize: 15,
    });

    for (const repo of chosen) {
      if (existing.has(path.resolve(repo))) continue;
      const suggested = path.basename(repo);
      const label = await input({ message: `  Label for ${pc.dim(repo)}:`, default: suggested });
      const finalLabel = label.trim() || suggested;
      const captureDiffs = await confirm({
        message: `  Track actual code changes for ${pc.bold(finalLabel)}? Stores real diff text locally (redacted for common secret patterns) instead of just line counts.`,
        default: defaultCaptureDiffs,
      });
      let captureSaveDiffs = false;
      if (captureDiffs) {
        captureSaveDiffs = await confirm({
          message: `  Also track uncommitted, in-progress changes for ${pc.bold(finalLabel)}? Higher exposure — this captures a diff on every save, before you've reviewed or committed anything.`,
          default: false,
        });
      }
      roots.push({ path: repo, label: finalLabel, capture_diffs: captureDiffs, capture_save_diffs: captureSaveDiffs });
      existing.add(path.resolve(repo));
    }
  }

  config.project_roots = roots;
  log.ok(`${roots.length} project root(s) configured.`);
  const diffCount = roots.filter((root) => root.capture_diffs).length;
  const saveDiffCount = roots.filter((root) => root.capture_save_diffs).length;
  if (diffCount) log.dim(`  Code-change capture is on for ${diffCount} project(s) — visible any time in \`narrately status\`.`);
  if (saveDiffCount) log.dim(`  Uncommitted-work capture is also on for ${saveDiffCount} project(s).`);
}

async function stepPrivacy(config) {
  log.title('6. Privacy & retention');
  log.dim('  Anything matching these exclusions is never written to disk at all.');

  const wanted = await confirm({
    message: 'Add exclusions now (folders, repos, or patterns that should never be logged)?',
    default: false,
  });

  if (wanted) {
    const paths = await input({
      message: 'Folder paths to exclude (comma-separated):',
      default: (config.privacy?.excluded_paths ?? []).join(', '),
    });
    const repos = await input({
      message: 'Project labels to exclude (comma-separated):',
      default: (config.privacy?.excluded_repos ?? []).join(', '),
    });
    const patterns = await input({
      message: 'Regex patterns to exclude (comma-separated, e.g. secret|\\.env|password):',
      default: (config.privacy?.excluded_patterns ?? []).join(', '),
    });

    const split = (value) => value.split(',').map((entry) => entry.trim()).filter(Boolean);
    config.privacy.excluded_paths = split(paths);
    config.privacy.excluded_repos = split(repos);
    config.privacy.excluded_patterns = split(patterns);
    log.ok('Exclusions saved.');
  }

  config.privacy.redact_secrets = await confirm({
    message: 'Redact secret-shaped strings (API keys, JWTs, PEM blocks, KEY=value assignments) out of any captured diff before it touches disk?',
    default: config.privacy?.redact_secrets ?? true,
  });
  if (!config.privacy.redact_secrets) {
    log.warn('  Redaction is off — if diff capture is enabled for a project, its diffs are stored exactly as written, secrets included.');
  }

  const wantsRetention = await confirm({
    message: 'Automatically summarize old captured diffs instead of keeping the raw code forever?',
    default: Boolean(config.privacy?.diff_retention_days),
  });
  if (wantsRetention) {
    const days = await input({
      message: 'Summarize diffs older than how many days?',
      default: String(config.privacy?.diff_retention_days ?? 30),
      validate: (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? true : 'Enter a whole number of days'),
    });
    config.privacy.diff_retention_days = Number(days);
  } else {
    config.privacy.diff_retention_days = null;
  }
}

const PROVIDER_KEY_HINT = {
  claude: 'ANTHROPIC_API_KEY (or run `ant auth login`)',
  gemini: 'GEMINI_API_KEY',
};

async function stepReportPreferences(config) {
  log.title('7. Report preferences');

  const providerId = await select({
    message: 'Which LLM should write the narrative?',
    choices: PROVIDER_IDS.map((candidateId) => {
      const provider = PROVIDERS[candidateId];
      return { name: provider.label, value: candidateId, description: `default model: ${provider.defaultModel}` };
    }),
    default: config.report?.provider ?? 'claude',
  });
  const providerChanged = providerId !== config.report?.provider;
  config.report.provider = providerId;
  if (providerChanged) config.report.model = null;

  const wantsModelPin = await confirm({
    message: `Pin a specific ${PROVIDERS[providerId].label} model instead of the default (${PROVIDERS[providerId].defaultModel})?`,
    default: Boolean(config.report.model),
  });
  if (wantsModelPin) {
    const model = await input({
      message: 'Model id:',
      default: config.report.model ?? PROVIDERS[providerId].defaultModel,
    });
    config.report.model = model.trim() || null;
  } else {
    config.report.model = null;
  }

  const mode = await select({
    message: 'How should reports be generated?',
    choices: [
      { name: 'Manual only — I run `narrately report` when I want one', value: 'manual' },
      { name: `Scheduled daily — via ${schedulerName}`, value: 'scheduled' },
    ],
    default: config.report?.mode ?? 'manual',
  });
  config.report.mode = mode;

  if (mode === 'scheduled') {
    const time = await input({
      message: 'What time each day? (HH:MM, 24-hour)',
      default: config.report?.daily_time ?? '18:00',
      validate: (value) => (/^\d{1,2}:\d{2}$/.test(value.trim()) ? true : 'Use HH:MM, e.g. 18:30'),
    });
    config.report.daily_time = time.trim();
  }

  config.report.verbosity = await select({
    message: 'How detailed should the narrative be?',
    choices: [
      { name: 'Brief — a few sentences', value: 'brief' },
      { name: 'Standard — a short paragraph plus breakdowns', value: 'standard' },
      { name: 'Detailed — full narrative with file-level detail', value: 'detailed' },
    ],
    default: config.report?.verbosity ?? 'standard',
  });

  if (!hasApiKey(config)) {
    log.warn(`No API key found for ${PROVIDERS[providerId].label} in the environment.`);
    log.dim('  Reports still work — they just come out structured rather than narrated.');
    log.dim(`  Set ${PROVIDER_KEY_HINT[providerId] ?? 'the provider API key'} to enable the written summary.`);
  }

  const wantsEmail = await confirm({
    message: 'Email the report to yourself as well?',
    default: config.email?.enabled ?? false,
  });

  if (!wantsEmail) {
    config.email.enabled = false;
    return;
  }

  log.dim('  SMTP credentials are stored locally in the config file (chmod 600).');
  const to = await input({ message: 'Send reports to:', default: config.email?.to ?? '' });
  const host = await input({ message: 'SMTP host:', default: config.email?.smtp?.host ?? 'smtp.gmail.com' });
  const port = await input({ message: 'SMTP port:', default: String(config.email?.smtp?.port ?? 587) });
  const user = await input({ message: 'SMTP username:', default: config.email?.smtp?.user ?? to });
  const pass = await password({ message: 'SMTP password / app password:', mask: '•' });

  config.email = {
    enabled: true,
    to: to.trim(),
    from: config.email?.from ?? user.trim(),
    smtp: {
      host: host.trim(),
      port: Number(port) || 587,
      secure: Number(port) === 465,
      user: user.trim(),
      pass,
    },
  };

  const shouldVerify = await confirm({ message: 'Test the SMTP connection now?', default: true });
  if (shouldVerify) {
    try {
      await verifyEmail(config);
      log.ok('SMTP connection verified.');
    } catch (error) {
      log.warn(`SMTP verification failed: ${error.message}`);
      log.dim('  Saved anyway — fix it in the config file and re-test with `narrately report --email`.');
    }
  }
}

async function stepAdvanced(config) {
  log.title('8. Advanced (optional)');

  const wanted = await confirm({
    message: 'Configure advanced settings (daemon port, focus threshold, git collector)? Skip if the defaults are fine.',
    default: false,
  });
  if (!wanted) return;

  const port = await input({
    message: 'Daemon port — the VS Code/IntelliJ collectors must be told to use the same one:',
    default: String(config.daemon?.port ?? 47821),
    validate: (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 && n < 65536 ? true : 'Enter a port number between 1 and 65535';
    },
  });
  const newPort = Number(port);
  const portChanged = newPort !== (config.daemon?.port ?? 47821);
  config.daemon.port = newPort;

  const minFocus = await input({
    message: 'Minimum focus duration to count, in seconds (shorter periods are treated as flicker and dropped):',
    default: String(config.daemon?.min_focus_seconds ?? 5),
    validate: (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? true : 'Enter a whole number of seconds'),
  });
  config.daemon.min_focus_seconds = Number(minFocus);

  config.collectors.git.enabled = await confirm({
    message: 'Enable the git collector (commit history and branch context)?',
    default: config.collectors?.git?.enabled ?? true,
  });

  if (portChanged) {
    log.warn(
      `  Port changed to ${newPort} — update "narrately.port" in VS Code's settings (and the IntelliJ ` +
        'plugin, which reads the same daemon), or those collectors won\'t be able to reach it.',
    );
  }
}

export default async function onboardCommand() {
  ensureHome();
  const config = loadConfig();

  console.log(`
${pc.bold('Narrately setup')}
${pc.dim('Eight quick steps (the last is optional). Everything is stored locally in ' + CONFIG_PATH)}`);

  try {
    await stepWorkProfile(config);
    const chosen = await stepIdeDetection(config);
    await stepPluginInstall(config, chosen);
    await stepShell(config);
    await stepProjectRoots(config);
    await stepPrivacy(config);
    await stepReportPreferences(config);
    await stepAdvanced(config);
  } catch (error) {
    if (error?.name === 'ExitPromptError') {
      log.warn('\nSetup cancelled. Nothing was saved.');
      return;
    }
    throw error;
  }

  saveConfig(config);
  log.title('Done');
  log.ok(`Configuration written to ${CONFIG_PATH}`);

  if (config.report.mode === 'scheduled') {
    try {
      const detail = installSchedule(config.report.daily_time);
      log.ok(`Daily report scheduled — ${detail}`);
    } catch (error) {
      log.warn(`Could not register the scheduled task: ${error.message}`);
      log.dim('  Run `narrately schedule enable` later to retry.');
    }
  }

  console.log(`
${pc.bold('Next steps')}
  ${pc.cyan('narrately daemon start')}   Start background collection
  ${pc.cyan('narrately status')}         Check that collectors are reporting
  ${pc.cyan('narrately report')}         Generate a report on demand
  ${pc.cyan('narrately config list')}    Review every setting, including ones this wizard skipped
`);
}
