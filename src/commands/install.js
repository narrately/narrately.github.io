import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { log, pc } from '../core/logger.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { detectVsCode, detectJetBrains } from '../collectors/ide.js';
import {
  installShellHook,
  detectShell,
  shellConfigPath,
  isHookInstalled,
  checkExecutionPolicy,
} from '../collectors/shell.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATIONS = path.resolve(here, '..', '..', 'integrations');

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

export function installVsCode(config, { variantId = null } = {}) {
  const variants = detectVsCode();
  if (!variants.length) {
    throw new Error('No VS Code installation detected. Is VS Code installed and has it been launched once?');
  }

  const targets = variantId ? variants.filter((variant) => variant.id === variantId) : variants;
  if (!targets.length) throw new Error(`No VS Code variant matching "${variantId}".`);

  const source = path.join(INTEGRATIONS, 'vscode');
  const { name, publisher, version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const installed = [];

  for (const variant of targets) {
    for (const entry of fs.existsSync(variant.extensionsDir) ? fs.readdirSync(variant.extensionsDir) : []) {
      if (entry.startsWith(`${publisher}.${name}-`)) {
        fs.rmSync(path.join(variant.extensionsDir, entry), { recursive: true, force: true });
      }
    }
    const destination = path.join(variant.extensionsDir, `${publisher}.${name}-${version}`);
    copyDir(source, destination);
    installed.push({ label: variant.label, path: destination });
  }

  config.collectors.vscode.enabled = true;
  return installed;
}

export function installIntelliJ(config, { ideId = null } = {}) {
  const ides = detectJetBrains();
  if (!ides.length) {
    throw new Error(
      'No JetBrains IDE configuration directory found. Launch your IDE once, then re-run this.',
    );
  }

  const distributions = path.join(INTEGRATIONS, 'intellij', 'build', 'distributions');
  const artifact = fs.existsSync(distributions)
    ? fs.readdirSync(distributions).find((name) => name.endsWith('.zip'))
    : null;

  const targets = ideId ? ides.filter((ide) => ide.id === ideId) : [ides[0]];
  if (!targets.length) throw new Error(`No JetBrains IDE matching "${ideId}".`);

  if (!artifact) {
    config.collectors.intellij.enabled = false;
    return {
      built: false,
      targets,
      instructions: [
        `cd "${path.join(INTEGRATIONS, 'intellij')}"`,
        './gradlew buildPlugin',
        'narrately install intellij',
      ],
    };
  }

  const zip = new AdmZip(path.join(distributions, artifact));
  const pluginDirName = zip.getEntries()[0]?.entryName.split('/')[0];
  if (!pluginDirName) {
    throw new Error(`Could not determine the plugin directory name inside ${artifact}.`);
  }

  const installed = [];
  for (const ide of targets) {
    fs.mkdirSync(ide.pluginsDir, { recursive: true });
    fs.rmSync(path.join(ide.pluginsDir, pluginDirName), { recursive: true, force: true });
    zip.extractAllTo(ide.pluginsDir, true);
    installed.push({ label: ide.label, path: path.join(ide.pluginsDir, pluginDirName) });
  }

  config.collectors.intellij.enabled = true;
  return { built: true, installed, targets };
}

export function installShell(config, { shell = null } = {}) {
  const chosen = shell ?? detectShell();
  const policy = checkExecutionPolicy(chosen);

  if (isHookInstalled(chosen)) {
    config.collectors.shell = { enabled: true, shell: chosen };
    return { alreadyInstalled: true, shell: chosen, path: shellConfigPath(chosen), policy };
  }
  const target = installShellHook(chosen);
  config.collectors.shell = { enabled: true, shell: chosen };
  return { alreadyInstalled: false, shell: chosen, path: target, policy };
}

export default async function installCommand({ positionals, flags }) {
  const target = positionals[0];
  const config = loadConfig();

  if (!target) {
    log.error('Usage: narrately install <vscode|intellij|shell>');
    process.exitCode = 1;
    return;
  }

  if (target === 'vscode') {
    const installed = installVsCode(config, { variantId: flags.variant ?? null });
    saveConfig(config);
    for (const entry of installed) {
      log.ok(`Installed the Narrately collector into ${pc.bold(entry.label)}`);
      log.dim(`  ${entry.path}`);
    }
    log.dim('Reload the window (Developer: Reload Window) to activate it.');
    return;
  }

  if (target === 'intellij') {
    const result = installIntelliJ(config, {
      ideId: typeof flags.ide === 'string' ? flags.ide : null,
    });
    saveConfig(config);

    if (!result.built) {
      log.warn('The IntelliJ plugin has not been built yet.');
      log.info('  It is a separate Kotlin/Gradle codebase, so build it once with:');
      for (const line of result.instructions) log.info(`    ${pc.cyan(line)}`);
      log.dim(`  Detected IDE: ${result.targets.map((ide) => ide.label).join(', ')}`);
      return;
    }
    for (const entry of result.installed) {
      log.ok(`Installed the Narrately plugin into ${pc.bold(entry.label)}`);
      log.dim(`  ${entry.path}`);
    }
    log.dim('Restart the IDE to activate it.');
    return;
  }

  if (target === 'shell') {
    const result = installShell(config, { shell: typeof flags.shell === 'string' ? flags.shell : null });
    saveConfig(config);
    if (result.alreadyInstalled) log.ok(`Shell hook already present in ${result.path}`);
    else {
      log.ok(`Installed the ${pc.bold(result.shell)} history hook.`);
      log.dim(`  ${result.path}`);
      log.dim('  Open a new terminal (or source the file) for it to take effect.');
    }
    log.dim('  Only command text and timestamps are logged — never command output.');

    if (result.policy?.blocked) {
      log.warn(
        `PowerShell's execution policy is "${result.policy.policy}" — it will refuse to load this hook ` +
          'at all, and will print that error in every new PowerShell terminal (standalone, VS Code, ' +
          'WebStorm, IntelliJ — anywhere your profile loads) until the policy is changed.',
      );
      log.info(`  Fix (per-user, no admin rights needed): ${pc.cyan('Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned')}`);
    }
    return;
  }

  log.error(`Unknown install target: ${target}`);
  log.dim('Expected: vscode | intellij | shell');
  process.exitCode = 1;
}
