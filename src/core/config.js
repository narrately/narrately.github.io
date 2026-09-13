import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_PATH, ensureHome } from './paths.js';

export const DEFAULT_CONFIG = {
  version: 1,
  profile: {
    work_type: 'software_development',
  },
  collectors: {
    vscode: { enabled: false },
    intellij: { enabled: false },
    shell: { enabled: false, shell: null },
    git: { enabled: true, capture_diffs: false },
  },
  daemon: {
    port: 47821,
    min_focus_seconds: 5,
  },
  project_roots: [],
  privacy: {
    excluded_paths: [],
    excluded_repos: [],
    excluded_patterns: [],
    redact_secrets: true,
    diff_retention_days: null,
  },
  report: {
    mode: 'manual',
    daily_time: '18:00',
    verbosity: 'standard',
    provider: 'claude',
    model: null,
  },
  email: {
    enabled: false,
    to: null,
    from: null,
    smtp: { host: null, port: 587, secure: false, user: null, pass: null },
  },
};

function merge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    out[key] = key in base ? merge(base[key], value) : value;
  }
  return out;
}

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

export function loadConfig() {
  if (!configExists()) return structuredClone(DEFAULT_CONFIG);
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return merge(structuredClone(DEFAULT_CONFIG), YAML.parse(raw) ?? {});
}

export function saveConfig(config) {
  ensureHome();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const header =
    '# Narrately configuration\n' +
    '# Edit by hand or re-run `narrately onboard`.\n' +
    '# Secrets in email.smtp.pass are stored locally and never leave this machine\n' +
    '# except to the SMTP server you configure.\n\n';
  fs.writeFileSync(CONFIG_PATH, header + YAML.stringify(config), { mode: 0o600 });
  return CONFIG_PATH;
}

export function resolveProjectRoot(config, filePath) {
  if (!filePath) return null;
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const root of config.project_roots ?? []) {
    const rootPath = path.resolve(root.path).replace(/\\/g, '/').toLowerCase();
    if (normalized === rootPath || normalized.startsWith(rootPath + '/')) {
      if (rootPath.length > bestLen) {
        best = root;
        bestLen = rootPath.length;
      }
    }
  }
  return best;
}

export function resolveProject(config, filePath) {
  return resolveProjectRoot(config, filePath)?.label ?? null;
}

export function isExcluded(config, { project, detail }) {
  const privacy = config.privacy ?? {};
  const haystack = [project, detail].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return false;

  for (const excluded of privacy.excluded_paths ?? []) {
    const needle = String(excluded).replace(/\\/g, '/').toLowerCase();
    if (needle && haystack.replace(/\\/g, '/').includes(needle)) return true;
  }
  for (const repo of privacy.excluded_repos ?? []) {
    if (repo && String(project ?? '').toLowerCase() === String(repo).toLowerCase()) return true;
  }
  for (const pattern of privacy.excluded_patterns ?? []) {
    if (!pattern) continue;
    try {
      if (new RegExp(pattern, 'i').test(haystack)) return true;
    } catch {
      if (haystack.includes(String(pattern).toLowerCase())) return true;
    }
  }
  return false;
}
