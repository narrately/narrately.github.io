import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

function appDataRoot() {
  if (process.platform === 'win32') return process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
}

const VSCODE_VARIANTS = [
  { id: 'code', label: 'VS Code', userDir: 'Code', extensions: '.vscode' },
  { id: 'code-insiders', label: 'VS Code Insiders', userDir: 'Code - Insiders', extensions: '.vscode-insiders' },
  { id: 'vscodium', label: 'VSCodium', userDir: 'VSCodium', extensions: '.vscode-oss' },
  { id: 'cursor', label: 'Cursor', userDir: 'Cursor', extensions: '.cursor' },
];

export function detectVsCode() {
  const root = appDataRoot();
  const found = [];
  for (const variant of VSCODE_VARIANTS) {
    const userDir = path.join(root, variant.userDir, 'User');
    const extensionsDir = path.join(home, variant.extensions, 'extensions');
    if (fs.existsSync(userDir) || fs.existsSync(extensionsDir)) {
      found.push({ ...variant, userDir, extensionsDir });
    }
  }
  return found;
}

const JETBRAINS_PRODUCTS = [
  'IntelliJIdea', 'IdeaIC', 'PyCharm', 'PyCharmCE', 'WebStorm',
  'GoLand', 'RubyMine', 'CLion', 'PhpStorm', 'Rider', 'DataGrip', 'RustRover',
];

export function detectJetBrains() {
  const root = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'JetBrains')
    : path.join(appDataRoot(), 'JetBrains');

  if (!fs.existsSync(root)) return [];

  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const product = JETBRAINS_PRODUCTS.find((candidate) => entry.name.startsWith(candidate));
    if (!product) continue;
    const configDir = path.join(root, entry.name);
    const pluginsDir =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'JetBrains', entry.name, 'plugins')
        : path.join(configDir, 'plugins');
    found.push({
      id: entry.name,
      label: entry.name.replace(/(\d{4}\.\d)$/, ' $1'),
      product,
      configDir,
      pluginsDir,
    });
  }

  return found.sort((a, b) => b.id.localeCompare(a.id));
}

export function detectAll() {
  return { vscode: detectVsCode(), jetbrains: detectJetBrains() };
}
