import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ensureHome } from './paths.js';

let handle = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Raw event store. Every collector writes the same shape here.
CREATE TABLE IF NOT EXISTS raw_events (
  id           INTEGER PRIMARY KEY,
  timestamp    TEXT NOT NULL,          -- ISO-8601 UTC
  source       TEXT NOT NULL,          -- 'vscode' | 'intellij' | 'shell' | 'git'
  project      TEXT,                   -- human-readable project label
  detail       TEXT,                   -- file path / command / commit message
  language     TEXT,                   -- language id, when the producer knows it
  event        TEXT,                   -- editor_focus_start | editor_focus_end | save | command | commit
  duration_sec INTEGER,                -- NULL for discrete events
  reported     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_raw_events_ts       ON raw_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_raw_events_reported ON raw_events(reported);

-- Aggregated work sessions produced from raw events.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  project      TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  source       TEXT,
  files        TEXT,                   -- JSON array of relative paths
  languages    TEXT,                   -- JSON array of language ids
  saves        INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

-- Lightweight knowledge graph. Nodes are deduped on (type, name).
CREATE TABLE IF NOT EXISTS nodes (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,            -- project | file | technology | session | commit | command
  name       TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  UNIQUE(type, name)
);

CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  session_id TEXT,
  weight     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_id, target_id, relation, session_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_source  ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target  ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id);

-- Generated reports, kept so "since last run" is well defined.
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY,
  generated_at TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  mode         TEXT NOT NULL,          -- 'manual' | 'scheduled'
  markdown     TEXT NOT NULL,
  generator    TEXT NOT NULL           -- 'llm' | 'fallback'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- User-authored notes, scoped to a day and optionally a project. These are
-- the one place Narrately stores free text the user typed on purpose (not
-- captured activity), so they carry whatever detail the automated collectors
-- deliberately never do.
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,           -- YYYY-MM-DD, local date the note is about
  project    TEXT,                    -- NULL = applies to the whole day
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);

-- Real code content — the one deliberate exception to "counts only, never
-- content" everywhere else in this file. Off by default (collectors.git.
-- capture_diffs / project_roots[].capture_diffs), redacted before insert,
-- and every row here is something the developer explicitly opted into.
CREATE TABLE IF NOT EXISTS diffs (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,        -- 'git_commit' | 'save_point'
  project       TEXT,
  file          TEXT NOT NULL,
  commit_hash   TEXT,                 -- set for source = 'git_commit'
  session_id    TEXT,                 -- set for source = 'save_point'
  diff_text     TEXT,                 -- unified diff, redacted; NULL if dropped (size cap) or summary-only
  summary       TEXT,
  lines_added   INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  redacted      INTEGER NOT NULL DEFAULT 0,  -- true if a secret-shaped string was caught and stripped
  captured_at   TEXT NOT NULL,
  UNIQUE(commit_hash, file)
);
CREATE INDEX IF NOT EXISTS idx_diffs_project ON diffs(project);
CREATE INDEX IF NOT EXISTS idx_diffs_commit  ON diffs(commit_hash);
CREATE INDEX IF NOT EXISTS idx_diffs_captured ON diffs(captured_at);
`;

const MIGRATIONS = [
  (db) => {
    const columns = (table) =>
      new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));

    const rawColumns = columns('raw_events');
    if (!rawColumns.has('metrics')) db.exec('ALTER TABLE raw_events ADD COLUMN metrics TEXT');
    if (!rawColumns.has('branch')) db.exec('ALTER TABLE raw_events ADD COLUMN branch TEXT');

    const sessionColumns = columns('sessions');
    const additions = {
      lines_added: 'INTEGER NOT NULL DEFAULT 0',
      lines_removed: 'INTEGER NOT NULL DEFAULT 0',
      edits: 'INTEGER NOT NULL DEFAULT 0',
      debug_sec: 'INTEGER NOT NULL DEFAULT 0',
      idle_sec: 'INTEGER NOT NULL DEFAULT 0',
      errors_resolved: 'INTEGER NOT NULL DEFAULT 0',
      branches: 'TEXT',
    };
    for (const [name, type] of Object.entries(additions)) {
      if (!sessionColumns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_raw_events_event ON raw_events(event)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project)');
  },

  (db) => {
    const sessionColumns = new Set(
      db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name),
    );
    if (!sessionColumns.has('graph_synced')) {
      db.exec('ALTER TABLE sessions ADD COLUMN graph_synced INTEGER NOT NULL DEFAULT 0');
    }
  },

  (db) => {
    const sessionColumns = new Set(
      db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name),
    );
    if (!sessionColumns.has('file_stats')) {
      db.exec('ALTER TABLE sessions ADD COLUMN file_stats TEXT');
    }
  },
];

function migrate(db) {
  const start = Number(db.prepare('PRAGMA user_version').get().user_version ?? 0);
  for (let version = start; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[version](db);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration to schema v${version + 1} failed: ${error.message}`);
    }
    db.exec(`PRAGMA user_version = ${version + 1}`);
  }
  return { from: start, to: MIGRATIONS.length };
}

export function getDb() {
  if (handle) return handle;
  ensureHome();
  handle = new DatabaseSync(DB_PATH);
  handle.exec(SCHEMA);
  migrate(handle);
  return handle;
}

export function schemaVersion() {
  return Number(getDb().prepare('PRAGMA user_version').get().user_version ?? 0);
}

export function closeDb() {
  if (handle) {
    handle.close();
    handle = null;
  }
}

export function getMeta(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

export function setMeta(key, value) {
  getDb()
    .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function insertRawEvent({
  timestamp,
  source,
  project = null,
  detail = null,
  language = null,
  event = null,
  duration_sec = null,
  metrics = null,
  branch = null,
}) {
  const result = getDb()
    .prepare(
      `INSERT INTO raw_events
         (timestamp, source, project, detail, language, event, duration_sec, metrics, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      timestamp,
      source,
      project,
      detail,
      language,
      event,
      duration_sec,
      metrics ? JSON.stringify(metrics) : null,
      branch,
    );
  return Number(result.lastInsertRowid);
}

export function parseMetrics(row) {
  if (!row?.metrics) return {};
  try {
    return JSON.parse(row.metrics) ?? {};
  } catch {
    return {};
  }
}

export function parseFileStats(row) {
  if (!row?.file_stats) return {};
  try {
    return JSON.parse(row.file_stats) ?? {};
  } catch {
    return {};
  }
}

export function countRawEvents({ unreportedOnly = false } = {}) {
  const sql = unreportedOnly
    ? 'SELECT COUNT(*) AS n FROM raw_events WHERE reported = 0'
    : 'SELECT COUNT(*) AS n FROM raw_events';
  return Number(getDb().prepare(sql).get().n);
}

export function createNote({ date, project = null, body }) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO notes (date, project, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(date, project, body, now, now);
  return Number(result.lastInsertRowid);
}

export function listNotes({ date = null, since = null, until = null, project = null } = {}) {
  const clauses = [];
  const params = [];
  if (date) {
    clauses.push('date = ?');
    params.push(date);
  }
  if (since) {
    clauses.push('date >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('date <= ?');
    params.push(until);
  }
  if (project) {
    clauses.push('project = ?');
    params.push(project);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM notes ${where} ORDER BY date DESC, id DESC`)
    .all(...params);
}

export function getNote(id) {
  return getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) ?? null;
}

export function updateNote(id, { body, project }) {
  const existing = getNote(id);
  if (!existing) return false;
  getDb()
    .prepare('UPDATE notes SET body = ?, project = ?, updated_at = ? WHERE id = ?')
    .run(body ?? existing.body, project === undefined ? existing.project : project, new Date().toISOString(), id);
  return true;
}

export function deleteNote(id) {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function insertDiff({
  source,
  project = null,
  file,
  commitHash = null,
  sessionId = null,
  diffText = null,
  summary = null,
  linesAdded = 0,
  linesRemoved = 0,
  redacted = false,
}) {
  const result = getDb()
    .prepare(
      `INSERT INTO diffs
         (source, project, file, commit_hash, session_id, diff_text, summary,
          lines_added, lines_removed, redacted, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(commit_hash, file) DO NOTHING`,
    )
    .run(
      source,
      project,
      file,
      commitHash,
      sessionId,
      diffText,
      summary,
      linesAdded,
      linesRemoved,
      redacted ? 1 : 0,
      new Date().toISOString(),
    );
  return result.changes ? Number(result.lastInsertRowid) : null;
}

export function listDiffs({ since = null, until = null, project = null, commitHash = null, limit = 50 } = {}) {
  const clauses = [];
  const params = [];
  if (since) {
    clauses.push('captured_at >= ?');
    params.push(new Date(since).toISOString());
  }
  if (until) {
    clauses.push('captured_at <= ?');
    params.push(new Date(until).toISOString());
  }
  if (project) {
    clauses.push('project = ?');
    params.push(project);
  }
  if (commitHash) {
    clauses.push('commit_hash = ?');
    params.push(commitHash);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return getDb()
    .prepare(`SELECT * FROM diffs ${where} ORDER BY captured_at DESC LIMIT ?`)
    .all(...params);
}

export function countDiffs({ project = null } = {}) {
  const where = project ? 'WHERE project = ?' : '';
  const params = project ? [project] : [];
  return Number(getDb().prepare(`SELECT COUNT(*) AS n FROM diffs ${where}`).get(...params).n);
}

export function sweepDiffRetention({ retentionDays, summarize, now = new Date() } = {}) {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const db = getDb();
  const rows = db
    .prepare('SELECT id, diff_text, summary FROM diffs WHERE diff_text IS NOT NULL AND captured_at < ?')
    .all(cutoff);
  if (!rows.length) return 0;

  const update = db.prepare('UPDATE diffs SET diff_text = NULL, summary = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const summary = row.summary ?? summarize(row.diff_text) ?? 'diff aged out of retention (no summary available)';
      update.run(summary, row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return rows.length;
}
