import crypto from 'node:crypto';
import { getDb, parseMetrics } from '../core/db.js';

const SESSION_GAP_SECONDS = 15 * 60;

const MIN_FOCUS_SECONDS = 5;

function toEpoch(iso) {
  return new Date(iso).getTime();
}

export function buildSessions(events, { gapSeconds = SESSION_GAP_SECONDS } = {}) {
  const focus = events
    .filter((event) => event.event === 'editor_focus' && (event.duration_sec ?? 0) >= MIN_FOCUS_SECONDS)
    .sort((a, b) => toEpoch(a.timestamp) - toEpoch(b.timestamp));

  const byProject = new Map();
  for (const event of focus) {
    const key = event.project ?? '(unlabelled)';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(event);
  }

  const sessions = [];
  for (const [project, projectEvents] of byProject) {
    let current = null;

    const flush = () => {
      if (!current) return;
      if (current.durationSec >= MIN_FOCUS_SECONDS) sessions.push(current);
      current = null;
    };

    for (const event of projectEvents) {
      const start = toEpoch(event.timestamp);
      const end = start + (event.duration_sec ?? 0) * 1000;

      if (current && start - current.endEpoch > gapSeconds * 1000) flush();

      if (!current) {
        current = {
          id: crypto.createHash('sha1').update(`${project}|${event.timestamp}`).digest('hex'),
          project,
          startedAt: event.timestamp,
          endedAt: new Date(end).toISOString(),
          startEpoch: start,
          endEpoch: end,
          durationSec: event.duration_sec ?? 0,
          sources: new Set([event.source]),
          files: new Set(),
          languages: new Set(),
          branches: new Set(),
          saves: 0,
          edits: 0,
          linesAdded: 0,
          linesRemoved: 0,
          charsChanged: 0,
          debugSec: 0,
          idleSec: 0,
          errorsResolved: 0,
          fileOps: [],
          fileStats: new Map(),
        };
      } else {
        current.durationSec += event.duration_sec ?? 0;
        current.endEpoch = Math.max(current.endEpoch, end);
        current.endedAt = new Date(current.endEpoch).toISOString();
        current.sources.add(event.source);
      }

      if (event.detail) current.files.add(event.detail);
      if (event.language) current.languages.add(event.language);
      if (event.branch) current.branches.add(event.branch);
    }
    flush();
  }

  const findSession = (event) => {
    const at = toEpoch(event.timestamp);
    const project = event.project ?? '(unlabelled)';
    return sessions.find(
      (session) =>
        session.project === project &&
        at >= session.startEpoch &&
        at <= session.endEpoch + gapSeconds * 1000,
    );
  };

  for (const event of events) {
    const session = findSession(event);
    if (!session) continue;

    switch (event.event) {
      case 'save':
        session.saves++;
        if (event.detail) session.files.add(event.detail);
        break;

      case 'edit': {
        const metrics = parseMetrics(event);
        session.edits++;
        session.linesAdded += metrics.linesAdded ?? 0;
        session.linesRemoved += metrics.linesRemoved ?? 0;
        session.charsChanged += metrics.charsChanged ?? 0;
        if (event.detail) {
          session.files.add(event.detail);
          const perFile = session.fileStats.get(event.detail) ?? { linesAdded: 0, linesRemoved: 0, edits: 0 };
          perFile.linesAdded += metrics.linesAdded ?? 0;
          perFile.linesRemoved += metrics.linesRemoved ?? 0;
          perFile.edits += 1;
          session.fileStats.set(event.detail, perFile);
        }
        break;
      }

      case 'debug':
        session.debugSec += event.duration_sec ?? 0;
        break;

      case 'idle':
        session.idleSec += event.duration_sec ?? 0;
        break;

      case 'diagnostics': {
        const metrics = parseMetrics(event);
        session.errorsResolved += metrics.errorsResolved ?? 0;
        break;
      }

      case 'file_create':
      case 'file_delete':
      case 'file_rename':
        session.fileOps.push({ kind: event.event, detail: event.detail });
        break;

      default:
        break;
    }
    if (event.branch) session.branches.add(event.branch);
  }

  return sessions
    .map((session) => ({
      id: session.id,
      project: session.project,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSec: session.durationSec,
      source: [...session.sources].sort().join(','),
      files: [...session.files],
      languages: [...session.languages],
      branches: [...session.branches],
      saves: session.saves,
      edits: session.edits,
      linesAdded: session.linesAdded,
      linesRemoved: session.linesRemoved,
      charsChanged: session.charsChanged,
      debugSec: session.debugSec,
      idleSec: session.idleSec,
      errorsResolved: session.errorsResolved,
      fileOps: session.fileOps,
      fileStats: Object.fromEntries(session.fileStats),
    }))
    .sort((a, b) => toEpoch(a.startedAt) - toEpoch(b.startedAt));
}

export function loadEvents({ since = null, until = null, unreportedOnly = false } = {}) {
  const clauses = [];
  const params = [];
  if (since) {
    clauses.push('timestamp >= ?');
    params.push(new Date(since).toISOString());
  }
  if (until) {
    clauses.push('timestamp <= ?');
    params.push(new Date(until).toISOString());
  }
  if (unreportedOnly) clauses.push('reported = 0');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM raw_events ${where} ORDER BY timestamp ASC`)
    .all(...params);
}

export function persistSessions(sessions) {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO sessions
       (id, project, started_at, ended_at, duration_sec, source, files, languages, saves,
        created_at, lines_added, lines_removed, edits, debug_sec, idle_sec,
        errors_resolved, branches, file_stats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project = excluded.project,
       started_at = excluded.started_at,
       ended_at = excluded.ended_at,
       duration_sec = excluded.duration_sec,
       source = excluded.source,
       files = excluded.files,
       languages = excluded.languages,
       saves = excluded.saves,
       lines_added = excluded.lines_added,
       lines_removed = excluded.lines_removed,
       edits = excluded.edits,
       debug_sec = excluded.debug_sec,
       idle_sec = excluded.idle_sec,
       errors_resolved = excluded.errors_resolved,
       branches = excluded.branches,
       file_stats = excluded.file_stats`,
  );
  const createdAt = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const session of sessions) {
      statement.run(
        session.id,
        session.project,
        session.startedAt,
        session.endedAt,
        session.durationSec,
        session.source,
        JSON.stringify(session.files),
        JSON.stringify(session.languages),
        session.saves,
        createdAt,
        session.linesAdded ?? 0,
        session.linesRemoved ?? 0,
        session.edits ?? 0,
        session.debugSec ?? 0,
        session.idleSec ?? 0,
        session.errorsResolved ?? 0,
        JSON.stringify(session.branches ?? []),
        JSON.stringify(session.fileStats ?? {}),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return sessions.length;
}

export function markReported(events) {
  if (!events.length) return 0;
  const db = getDb();
  const statement = db.prepare('UPDATE raw_events SET reported = 1 WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const event of events) statement.run(event.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return events.length;
}

export function summarise(events, sessions) {
  const commits = events.filter((event) => event.event === 'commit');
  const commands = events.filter((event) => event.event === 'command');

  const byProject = new Map();
  const touch = (project) => {
    const key = project ?? '(unlabelled)';
    if (!byProject.has(key)) {
      byProject.set(key, {
        project: key,
        durationSec: 0,
        sessions: 0,
        files: new Set(),
        languages: new Set(),
        branches: new Set(),
        saves: 0,
        edits: 0,
        linesAdded: 0,
        linesRemoved: 0,
        debugSec: 0,
        idleSec: 0,
        errorsResolved: 0,
        fileOps: [],
        commits: [],
        commands: [],
        fileStats: new Map(),
      });
    }
    return byProject.get(key);
  };

  for (const session of sessions) {
    const entry = touch(session.project);
    entry.durationSec += session.durationSec;
    entry.sessions++;
    entry.saves += session.saves;
    entry.edits += session.edits ?? 0;
    entry.linesAdded += session.linesAdded ?? 0;
    entry.linesRemoved += session.linesRemoved ?? 0;
    entry.debugSec += session.debugSec ?? 0;
    entry.idleSec += session.idleSec ?? 0;
    entry.errorsResolved += session.errorsResolved ?? 0;
    entry.fileOps.push(...(session.fileOps ?? []));
    session.files.forEach((file) => entry.files.add(file));
    session.languages.forEach((language) => entry.languages.add(language));
    (session.branches ?? []).forEach((branch) => entry.branches.add(branch));
    for (const [file, stats] of Object.entries(session.fileStats ?? {})) {
      const perFile = entry.fileStats.get(file) ?? { linesAdded: 0, linesRemoved: 0, edits: 0 };
      perFile.linesAdded += stats.linesAdded ?? 0;
      perFile.linesRemoved += stats.linesRemoved ?? 0;
      perFile.edits += stats.edits ?? 0;
      entry.fileStats.set(file, perFile);
    }
  }
  for (const commit of commits) touch(commit.project).commits.push(commit.detail);
  for (const command of commands) touch(command.project).commands.push(command.detail);

  const projects = [...byProject.values()]
    .map((entry) => ({
      project: entry.project,
      durationSec: entry.durationSec,
      sessions: entry.sessions,
      saves: entry.saves,
      edits: entry.edits,
      linesAdded: entry.linesAdded,
      linesRemoved: entry.linesRemoved,
      debugSec: entry.debugSec,
      idleSec: entry.idleSec,
      errorsResolved: entry.errorsResolved,
      fileOps: entry.fileOps,
      files: [...entry.files],
      languages: [...entry.languages],
      branches: [...entry.branches],
      commits: entry.commits,
      commands: entry.commands,
      topFiles: [...entry.fileStats.entries()]
        .map(([file, stats]) => ({ file, ...stats }))
        .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved)),
    }))
    .sort((a, b) => b.durationSec - a.durationSec);

  const totalSeconds = projects.reduce((sum, entry) => sum + entry.durationSec, 0);
  const timestamps = events.map((event) => toEpoch(event.timestamp)).filter(Number.isFinite);
  const sum = (field) => projects.reduce((total, entry) => total + (entry[field] ?? 0), 0);

  return {
    totalSeconds,
    totalSessions: sessions.length,
    totalCommits: commits.length,
    totalCommands: commands.length,
    totalLinesAdded: sum('linesAdded'),
    totalLinesRemoved: sum('linesRemoved'),
    totalEdits: sum('edits'),
    totalDebugSec: sum('debugSec'),
    totalErrorsResolved: sum('errorsResolved'),
    firstActivity: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    lastActivity: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    projects,
  };
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 60) return `${Math.round(seconds ?? 0)}s`;
  let hours = Math.floor(seconds / 3600);
  let minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
