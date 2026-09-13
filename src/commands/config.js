import YAML from 'yaml';
import { log, pc } from '../core/logger.js';
import { loadConfig, saveConfig, configExists } from '../core/config.js';
import { CONFIG_PATH } from '../core/paths.js';

const SECRET_PATHS = new Set(['email.smtp.pass']);
const MASK = '••••••••';

const COMMA_LIST_PATHS = new Set(['privacy.excluded_paths', 'privacy.excluded_repos', 'privacy.excluded_patterns']);

const ENUM_VALUES = {
  'report.mode': ['manual', 'scheduled'],
  'report.verbosity': ['brief', 'standard', 'detailed'],
  'report.provider': ['claude', 'gemini'],
};

export function getPath(obj, keyPath) {
  return keyPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

export function setPath(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

export function parseValue(keyPath, raw) {
  const trimmed = raw.trim();
  if (COMMA_LIST_PATHS.has(keyPath) && !/^[[{]/.test(trimmed)) {
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
    }
  }
  return raw;
}

function redacted(config) {
  const clone = structuredClone(config);
  for (const keyPath of SECRET_PATHS) {
    if (getPath(clone, keyPath)) setPath(clone, keyPath, MASK);
  }
  return clone;
}

function printList(config) {
  console.log(YAML.stringify(redacted(config)).trimEnd());
  log.dim(`\n(${configExists() ? CONFIG_PATH : `no config file yet — showing defaults; run \`narrately onboard\` or \`narrately config set\` to create ${CONFIG_PATH}`})`);
  if ([...SECRET_PATHS].some((keyPath) => getPath(config, keyPath))) {
    log.dim(`Hidden: ${[...SECRET_PATHS].join(', ')} — \`narrately config get <key> --reveal\` prints the real value.`);
  }
}

function printGet(config, keyPath, reveal) {
  const value = getPath(config, keyPath);
  if (SECRET_PATHS.has(keyPath) && !reveal) {
    console.log(value ? MASK : '(not set)');
    log.dim('Pass --reveal to print the real value.');
    return;
  }
  if (value === undefined) {
    console.log('(not set)');
    return;
  }
  console.log(typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value));
}

export default async function configCommand({ positionals, flags }) {
  const action = positionals[0] ?? 'list';

  if (action === 'path') {
    console.log(CONFIG_PATH);
    return;
  }

  const config = loadConfig();

  if (action === 'list' || action === 'show') {
    printList(config);
    return;
  }

  if (action === 'get') {
    const keyPath = positionals[1];
    if (!keyPath) {
      log.error('Usage: narrately config get <key> [--reveal]');
      process.exitCode = 1;
      return;
    }
    printGet(config, keyPath, Boolean(flags.reveal));
    return;
  }

  if (action === 'set') {
    const keyPath = positionals[1];
    const rawValue = positionals.slice(2).join(' ');
    if (!keyPath || !rawValue) {
      log.error('Usage: narrately config set <key> <value>');
      process.exitCode = 1;
      return;
    }

    const allowed = ENUM_VALUES[keyPath];
    if (allowed && !allowed.includes(rawValue)) {
      log.error(`"${keyPath}" must be one of: ${allowed.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const value = parseValue(keyPath, rawValue);
    setPath(config, keyPath, value);
    saveConfig(config);
    log.ok(`${keyPath} = ${SECRET_PATHS.has(keyPath) ? MASK : JSON.stringify(value)}`);
    return;
  }

  log.error(`Unknown config action: ${action}`);
  log.dim('Expected: list | get <key> | set <key> <value> | path');
  process.exitCode = 1;
}
