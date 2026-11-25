import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { log, pc } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import {
  AUTO_CONTEXT_FILES,
  CONTEXT_TEMPLATE,
  getContext,
  listContexts,
  meaningfulText,
  readContextFile,
  removeContext,
  setContext,
} from '../core/context.js';

const USAGE = [
  'narrately context                              list projects and their context',
  'narrately context edit <project>               write it in your editor (starts from a template)',
  'narrately context set <project> --file doc.md  copy a Markdown/text file in',
  'narrately context set <project> --link doc.md  use a file and re-read it every time',
  'narrately context set <project> "text…"        set it inline',
  'narrately context show <project>               print what the AI will see',
  'narrately context rm <project>                 remove it',
];

function usage() {
  log.info(pc.bold('Usage'));
  for (const line of USAGE) log.info('  ' + line);
  log.dim(`\nOr drop ${AUTO_CONTEXT_FILES[0]} in a project root — it's picked up automatically.`);
}

function knownProject(config, project) {
  return listContexts(config).some((entry) => entry.project === project);
}

// Call before saving: once saved, the project is "known" by definition.
function warnIfUnknown(known, project) {
  if (known) return;
  log.warn(`"${project}" isn't a project label Narrately has seen yet.`);
  log.dim('  It must match the label in `narrately status` / your reports exactly, or it will never be used.');
}

function sourceLabel(entry) {
  if (!entry.source) return pc.dim('none');
  if (entry.source === 'linked') return pc.green('linked file') + (entry.stale ? pc.yellow(' (file missing — using last copy)') : '');
  if (entry.source === 'auto') return pc.green(path.basename(entry.path)) + pc.dim(' in project root');
  return pc.green('text');
}

function list(config) {
  const entries = listContexts(config);
  if (!entries.length) {
    log.dim('No projects yet. Run `narrately onboard` to add project roots.');
    return;
  }
  const width = Math.max(...entries.map((entry) => entry.project.length));
  log.title('Project context');
  for (const entry of entries) {
    const dot = entry.source ? pc.green('●') : pc.dim('○');
    const size = entry.chars ? pc.dim(` · ${entry.chars.toLocaleString()} chars`) : '';
    log.info(`  ${dot} ${entry.project.padEnd(width)}  ${sourceLabel(entry)}${size}`);
  }
  const missing = entries.filter((entry) => !entry.source);
  if (missing.length) {
    log.dim(`\nAdd context with: narrately context edit ${missing[0].project.includes(' ') ? `"${missing[0].project}"` : missing[0].project}`);
  }
}

function show(config, project) {
  const context = getContext(config, project);
  const text = context ? meaningfulText(context.text) : '';
  if (!text) {
    log.dim(`No context for ${project}. Add some with \`narrately context edit ${project}\`.`);
    return;
  }
  log.dim(`${project} — ${context.source}${context.path ? ` (${context.path})` : ''}`);
  console.log('\n' + text + '\n');
}

function set(config, project, rest, flags) {
  const known = knownProject(config, project);
  if (typeof flags.link === 'string') {
    const body = readContextFile(flags.link);
    setContext(project, { body, sourcePath: flags.link });
    log.ok(`Linked ${pc.bold(project)} to ${path.resolve(flags.link)}`);
    log.dim('  Re-read on every report and question, so edits to the file flow in automatically.');
  } else if (typeof flags.file === 'string') {
    setContext(project, { body: readContextFile(flags.file) });
    log.ok(`Copied ${path.basename(flags.file)} into ${pc.bold(project)}'s context.`);
    log.dim('  Use --link instead if you want later edits to the file picked up.');
  } else {
    const text = rest.join(' ').trim();
    if (!text) {
      log.error('Give the context inline, or use --file <path> / --link <path>.');
      process.exitCode = 1;
      return;
    }
    setContext(project, { body: text });
    log.ok(`Saved context for ${pc.bold(project)}.`);
  }
  warnIfUnknown(known, project);
}

function editorCommand() {
  return process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
}

// EDITOR may carry its own flags ("code --wait"), so it goes through a shell;
// the file path is quoted so folders with spaces survive.
function openInEditor(file) {
  return spawnSync(`${editorCommand()} "${file}"`, { stdio: 'inherit', shell: true });
}

function edit(config, project) {
  const known = knownProject(config, project);
  const existing = getContext(config, project);
  if (existing?.source === 'linked' || existing?.source === 'auto') {
    const target = existing.path;
    log.dim(`${project}'s context lives in ${target} — opening that file.`);
    openInEditor(target);
    log.ok('Saved — it is re-read on every report.');
    return;
  }

  const tmp = path.join(os.tmpdir(), `narrately-context-${project.replace(/[^\w.-]+/g, '_')}.md`);
  fs.writeFileSync(tmp, existing ? existing.text : CONTEXT_TEMPLATE(project));
  log.dim(`Opening ${editorCommand()} — save and close the editor when you're done.`);
  const result = openInEditor(tmp);
  if (result.error || result.status !== 0) {
    log.error(`Could not open an editor (${editorCommand()}): ${result.error?.message ?? `exit code ${result.status}`}`);
    log.dim('Set EDITOR, or use `narrately context set <project> --file <path>`.');
    process.exitCode = 1;
    return;
  }
  const body = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp, { force: true });
  if (!meaningfulText(body)) {
    log.dim('Nothing written — context unchanged.');
    return;
  }
  setContext(project, { body });
  log.ok(`Saved context for ${pc.bold(project)} ${pc.dim(`(${meaningfulText(body).length.toLocaleString()} chars)`)}.`);
  warnIfUnknown(known, project);
}

export default async function contextCommand({ positionals, flags }) {
  const [action = 'list', project, ...rest] = positionals;
  const config = loadConfig();

  if (action === 'list' || action === 'ls') return list(config);
  if (action === 'help') return usage();

  if (!project) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    if (action === 'show') return show(config, project);
    if (action === 'set') return set(config, project, rest, flags);
    if (action === 'edit') return edit(config, project);
    if (action === 'rm' || action === 'remove') {
      if (removeContext(project)) log.ok(`Removed ${project}'s context.`);
      else log.dim(`No saved context for ${project}${getContext(config, project)?.source === 'auto' ? ' (it comes from a file in the project root — delete that file instead)' : ''}.`);
      return;
    }
  } catch (error) {
    log.error(error.code === 'ENOENT' ? `File not found: ${error.path}` : error.message);
    process.exitCode = 1;
    return;
  }

  log.error(`Unknown context action: ${action}`);
  usage();
  process.exitCode = 1;
}
