import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { insertRawEvent, getMeta, setMeta } from '../core/db.js';
import { isExcluded, resolveProject } from '../core/config.js';
import { SHELL_LOG } from '../core/paths.js';

const OFFSET_KEY = 'shell_log_offset';
const MARKER_BEGIN = '# >>> narrately shell hook >>>';
const MARKER_END = '# <<< narrately shell hook <<<';

export const SHELL_HOOKS = {
  bash: (logPath) => `${MARKER_BEGIN}
__narrately_log() {
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^ *[0-9]* *//')
  [ -n "$cmd" ] && [ "$cmd" != "$__NARRATELY_LAST" ] && {
    __NARRATELY_LAST="$cmd"
    printf '%s\\t%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PWD" "$cmd" >> "${logPath}" 2>/dev/null
  }
}
case "$PROMPT_COMMAND" in
  *__narrately_log*) ;;
  *) PROMPT_COMMAND="__narrately_log\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
${MARKER_END}`,

  zsh: (logPath) => `${MARKER_BEGIN}
__narrately_preexec() {
  printf '%s\\t%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PWD" "$1" >> "${logPath}" 2>/dev/null
}
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook preexec __narrately_preexec
${MARKER_END}`,

  fish: (logPath) => `${MARKER_BEGIN}
function __narrately_preexec --on-event fish_preexec
    printf '%s\\t%s\\t%s\\n' (date -u +%Y-%m-%dT%H:%M:%SZ) $PWD "$argv[1]" >> "${logPath}" 2>/dev/null
end
${MARKER_END}`,

  powershell: (logPath) => `${MARKER_BEGIN}
function __Narrately-Log {
    $last = Get-History -Count 1 -ErrorAction SilentlyContinue
    if ($null -eq $last) { return }
    if ($global:__NarratelyLastId -eq $last.Id) { return }
    $global:__NarratelyLastId = $last.Id
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "$stamp\`t$($PWD.Path)\`t$($last.CommandLine)"
    Add-Content -LiteralPath '${logPath.replace(/\\/g, '\\\\')}' -Value $line -Encoding utf8 -ErrorAction SilentlyContinue
}
if (-not (Test-Path Function:\\__Narrately-OriginalPrompt)) {
    if (Test-Path Function:\\prompt) {
        Rename-Item Function:\\prompt Function:\\__Narrately-OriginalPrompt -ErrorAction SilentlyContinue
    }
}
function prompt {
    __Narrately-Log
    if (Test-Path Function:\\__Narrately-OriginalPrompt) { __Narrately-OriginalPrompt } else { "PS $($PWD.Path)> " }
}
${MARKER_END}`,
};

export function detectShell() {
  if (process.platform === 'win32') return 'powershell';
  const shell = process.env.SHELL ?? '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  return 'bash';
}

export function shellConfigPath(shell) {
  const home = os.homedir();
  switch (shell) {
    case 'zsh':
      return path.join(home, '.zshrc');
    case 'fish':
      return path.join(home, '.config', 'fish', 'config.fish');
    case 'powershell': {
      const documents = path.join(home, 'Documents');
      const pwsh7 = path.join(documents, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
      const pwsh5 = path.join(documents, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
      return fs.existsSync(path.dirname(pwsh7)) ? pwsh7 : pwsh5;
    }
    default:
      return path.join(home, '.bashrc');
  }
}

export function isHookInstalled(shell) {
  const target = shellConfigPath(shell);
  if (!fs.existsSync(target)) return false;
  return fs.readFileSync(target, 'utf8').includes(MARKER_BEGIN);
}

const BLOCKING_POLICIES = new Set(['Restricted', 'AllSigned']);

export function checkExecutionPolicy(shell) {
  if (shell !== 'powershell') return null;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-ExecutionPolicy'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    return { blocked: BLOCKING_POLICIES.has(output), policy: output };
  } catch {
    return null;
  }
}

export function installShellHook(shell, { logPath = SHELL_LOG } = {}) {
  const builder = SHELL_HOOKS[shell];
  if (!builder) throw new Error(`Unsupported shell: ${shell}`);
  const target = shellConfigPath(shell);

  if (isHookInstalled(shell)) return null;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const posixLogPath = shell === 'powershell' ? logPath : logPath.replace(/\\/g, '/');
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const separator = existing.length && !existing.endsWith('\n') ? '\n\n' : '\n';
  fs.appendFileSync(target, separator + builder(posixLogPath) + '\n');
  return target;
}

export function uninstallShellHook(shell) {
  const target = shellConfigPath(shell);
  if (!fs.existsSync(target)) return false;
  const content = fs.readFileSync(target, 'utf8');
  const start = content.indexOf(MARKER_BEGIN);
  const end = content.indexOf(MARKER_END);
  if (start === -1 || end === -1) return false;
  const next = content.slice(0, start) + content.slice(end + MARKER_END.length);
  fs.writeFileSync(target, next.replace(/\n{3,}/g, '\n\n'));
  return true;
}

export function drainShellLog(config, { logPath = SHELL_LOG } = {}) {
  if (!fs.existsSync(logPath)) return 0;

  const size = fs.statSync(logPath).size;
  let offset = Number(getMeta(OFFSET_KEY, '0'));
  if (offset > size) offset = 0;
  if (offset === size) return 0;

  const fd = fs.openSync(logPath, 'r');
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);

  const text = buffer.toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return 0;
  const complete = text.slice(0, lastNewline);
  const consumed = Buffer.byteLength(complete, 'utf8') + 1;

  let inserted = 0;
  for (const line of complete.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [stamp, cwd, ...commandParts] = trimmed.split('\t');
    const command = commandParts.join('\t').trim();
    if (!command) continue;

    const project = resolveProject(config, cwd) ?? null;
    if (isExcluded(config, { project, detail: `${cwd} ${command}` })) continue;

    const timestamp = Number.isNaN(Date.parse(stamp))
      ? new Date().toISOString()
      : new Date(stamp).toISOString();

    insertRawEvent({
      timestamp,
      source: 'shell',
      project,
      detail: command,
      event: 'command',
    });
    inserted++;
  }

  setMeta(OFFSET_KEY, String(offset + consumed));
  return inserted;
}
