import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';

// A context doc the developer drops in a project root is picked up with no
// command at all; an explicit `narrately context set` always wins over it.
export const AUTO_CONTEXT_FILES = ['.narrately.md', 'NARRATELY.md'];

export const MAX_SOURCE_BYTES = 200 * 1024;
export const MAX_PROMPT_CHARS_PER_PROJECT = 6000;
export const MAX_PROMPT_CHARS_TOTAL = 20000;

export const CONTEXT_TEMPLATE = (project) => `# ${project}

## What it is
<!-- One or two sentences: what this project does and who uses it. -->

## Current goals
<!-- What you're working towards right now — milestones, deadlines, the big rocks. -->

## Key areas
<!-- Map folders/modules to what they mean, e.g. "src/billing — Stripe webhooks and invoicing". -->

## Glossary
<!-- Internal names, acronyms, and codenames the reports should use correctly. -->
`;

export function readContextFile(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`${resolved} is not a file`);
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`${resolved} is ${Math.round(stat.size / 1024)}KB — context files are capped at ${MAX_SOURCE_BYTES / 1024}KB`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

// Strips HTML comments (the template's hints) and treats a doc that is only
// headings as empty, so an untouched template never reaches a prompt.
export function meaningfulText(text) {
  const stripped = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const hasContent = stripped.split('\n').some((line) => line.trim() && !line.trim().startsWith('#'));
  return hasContent ? stripped : '';
}

export function setContext(project, { body, sourcePath = null }) {
  getDb()
    .prepare(
      `INSERT INTO project_context (project, body, source_path, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project) DO UPDATE SET body = excluded.body, source_path = excluded.source_path, updated_at = excluded.updated_at`,
    )
    .run(project, body, sourcePath ? path.resolve(sourcePath) : null, new Date().toISOString());
}

export function removeContext(project) {
  return Number(getDb().prepare('DELETE FROM project_context WHERE project = ?').run(project).changes) > 0;
}

function autoContextFor(config, project) {
  const root = (config.project_roots ?? []).find((entry) => entry.label === project);
  if (!root) return null;
  for (const name of AUTO_CONTEXT_FILES) {
    const candidate = path.join(root.path, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Resolves the context for one project: explicit entry (linked file re-read
// fresh, falling back to its last snapshot) first, then an auto file.
export function getContext(config, project) {
  const row = getDb().prepare('SELECT * FROM project_context WHERE project = ?').get(project);
  if (row) {
    if (row.source_path) {
      try {
        const fresh = readContextFile(row.source_path);
        if (fresh !== row.body) setContext(project, { body: fresh, sourcePath: row.source_path });
        return { project, text: fresh, source: 'linked', path: row.source_path, updatedAt: row.updated_at };
      } catch {
        return { project, text: row.body, source: 'linked', path: row.source_path, stale: true, updatedAt: row.updated_at };
      }
    }
    return { project, text: row.body, source: 'text', path: null, updatedAt: row.updated_at };
  }

  const autoPath = autoContextFor(config, project);
  if (autoPath) {
    try {
      return { project, text: readContextFile(autoPath), source: 'auto', path: autoPath, updatedAt: null };
    } catch {
      return null;
    }
  }
  return null;
}

// Every project Narrately knows about, with whatever context it has.
export function listContexts(config) {
  const projects = new Set((config.project_roots ?? []).map((root) => root.label));
  for (const row of getDb().prepare('SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL').all()) {
    if (row.project !== '(unlabelled)') projects.add(row.project);
  }
  for (const row of getDb().prepare('SELECT project FROM project_context').all()) projects.add(row.project);

  return [...projects].sort((a, b) => a.localeCompare(b)).map((project) => {
    const context = getContext(config, project);
    return {
      project,
      source: context && meaningfulText(context.text) ? context.source : null,
      path: context?.path ?? null,
      chars: context ? meaningfulText(context.text).length : 0,
      stale: Boolean(context?.stale),
      updatedAt: context?.updatedAt ?? null,
    };
  });
}

// Context for the projects in a prompt, trimmed so one huge doc can't crowd
// out the activity data the model is actually reporting on.
export function contextsFor(config, projects) {
  const out = {};
  let budget = MAX_PROMPT_CHARS_TOTAL;
  for (const project of projects) {
    if (budget <= 0) break;
    const context = getContext(config, project);
    const text = context ? meaningfulText(context.text) : '';
    if (!text) continue;
    const limit = Math.min(MAX_PROMPT_CHARS_PER_PROJECT, budget);
    out[project] = text.length > limit ? text.slice(0, limit) + '\n… (context truncated)' : text;
    budget -= out[project].length;
  }
  return out;
}
