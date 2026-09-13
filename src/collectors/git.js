import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { insertRawEvent, insertDiff, getMeta, setMeta, getDb } from '../core/db.js';
import { isExcluded } from '../core/config.js';
import { redactSecrets, MAX_DIFF_BYTES } from '../core/redact.js';

const FIELD = '';
const RECORD = '';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20_000,
    windowsHide: true,
  });
}

export function isGitRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

export function discoverRepos(root, { maxDepth = 3 } = {}) {
  const found = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.venv', 'venv', '__pycache__']);

  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    if (isGitRepo(dir)) {
      found.push(dir);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || skip.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(path.resolve(root), 0);
  return found;
}

export function currentBranch(repoDir) {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).trim();
  } catch {
    return null;
  }
}

export function gitIdentity(repoDir) {
  try {
    return git(['config', 'user.email'], repoDir).trim() || null;
  } catch {
    return null;
  }
}

function splitDiffByFile(rawDiff) {
  const parts = rawDiff.split(/(?=^diff --git )/m).filter((part) => part.trim());
  return parts
    .map((block) => {
      const header = block.match(/^diff --git a\/(.+?) b\/(.+?)\r?\n/);
      if (!header) return null;
      let added = 0;
      let removed = 0;
      for (const line of block.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
      }
      return { file: header[2], block, added, removed };
    })
    .filter(Boolean);
}

export function captureCommitDiff(config, repoDir, label, hash) {
  let raw;
  try {
    raw = git(['show', '--format=', '--unified=3', '--no-color', hash], repoDir);
  } catch {
    return 0;
  }
  if (!raw.trim()) return 0;

  let captured = 0;
  for (const { file, block, added, removed } of splitDiffByFile(raw)) {
    if (isExcluded(config, { project: label, detail: file })) continue;

    const byteSize = Buffer.byteLength(block, 'utf8');
    let diffText = null;
    let summary = null;
    let redacted = false;
    if (byteSize > MAX_DIFF_BYTES) {
      summary = `diff omitted: ${Math.round(byteSize / 1024)}KB exceeds the ${Math.round(MAX_DIFF_BYTES / 1024)}KB capture limit`;
    } else {
      const result = redactSecrets(block);
      diffText = result.text;
      redacted = result.redacted;
    }

    const inserted = insertDiff({
      source: 'git_commit',
      project: label,
      file,
      commitHash: hash,
      diffText,
      summary,
      linesAdded: added,
      linesRemoved: removed,
      redacted,
    });
    if (inserted !== null) captured++;
  }
  return captured;
}

export function scrapeRepo(config, repoDir, label, { since, captureDiffs = false }) {
  if (!isGitRepo(repoDir)) return 0;

  const author = gitIdentity(repoDir);
  const args = [
    'log',
    `--since=${since}`,
    `--pretty=format:%H${FIELD}%aI${FIELD}%s${FIELD}%an${RECORD}`,
    '--no-merges',
  ];
  if (author) args.push(`--author=${author}`);

  let output;
  try {
    output = git(args, repoDir);
  } catch {
    return 0;
  }

  const branch = currentBranch(repoDir);
  const seenKey = `git_seen:${path.resolve(repoDir)}`;
  const seen = new Set(JSON.parse(getMeta(seenKey, '[]')));

  let inserted = 0;
  for (const record of output.split(RECORD)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [hash, isoDate, subject] = trimmed.split(FIELD);
    if (!hash || seen.has(hash)) continue;

    if (isExcluded(config, { project: label, detail: subject })) {
      seen.add(hash);
      continue;
    }

    insertRawEvent({
      timestamp: new Date(isoDate).toISOString(),
      source: 'git',
      project: label,
      detail: branch ? `${subject}  [${branch}]` : subject,
      event: 'commit',
    });
    if (captureDiffs) captureCommitDiff(config, repoDir, label, hash);
    seen.add(hash);
    inserted++;
  }

  const trimmedSeen = [...seen].slice(-500);
  setMeta(seenKey, JSON.stringify(trimmedSeen));
  return inserted;
}

export function scrapeGit(config, { since = '3 days ago' } = {}) {
  if (config.collectors?.git?.enabled === false) return 0;
  const roots = config.project_roots ?? [];
  if (!roots.length) return 0;

  const db = getDb();
  let total = 0;
  db.exec('BEGIN');
  try {
    for (const root of roots) {
      const dir = path.resolve(root.path);
      if (!fs.existsSync(dir)) continue;
      if (config.privacy?.excluded_repos?.includes(root.label)) continue;

      const captureDiffs = root.capture_diffs ?? config.collectors?.git?.capture_diffs ?? false;

      if (isGitRepo(dir)) {
        total += scrapeRepo(config, dir, root.label, { since, captureDiffs });
      } else {
        for (const repo of discoverRepos(dir)) {
          const label = repo === dir ? root.label : `${root.label}/${path.basename(repo)}`;
          total += scrapeRepo(config, repo, label, { since, captureDiffs });
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return total;
}
