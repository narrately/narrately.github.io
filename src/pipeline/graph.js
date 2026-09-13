import path from 'node:path';
import { getDb, parseFileStats } from '../core/db.js';

export function upsertNode(type, name, timestamp) {
  if (!name) return null;
  const db = getDb();
  db.prepare(
    `INSERT INTO nodes (type, name, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(type, name) DO UPDATE SET
       last_seen = MAX(excluded.last_seen, nodes.last_seen),
       first_seen = MIN(excluded.first_seen, nodes.first_seen)`,
  ).run(type, name, timestamp, timestamp);
  const row = db.prepare('SELECT id FROM nodes WHERE type = ? AND name = ?').get(type, name);
  return row ? Number(row.id) : null;
}

export function upsertEdge(sourceId, targetId, relation, timestamp, sessionId = null) {
  if (!sourceId || !targetId) return;
  getDb()
    .prepare(
      `INSERT INTO edges (source_id, target_id, relation, timestamp, session_id, weight)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(source_id, target_id, relation, session_id) DO UPDATE SET
         weight = edges.weight + 1,
         timestamp = excluded.timestamp`,
    )
    .run(sourceId, targetId, relation, timestamp, sessionId);
}

const EXTENSION_TECH = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
  '.cs': 'csharp', '.cpp': 'cpp', '.cc': 'cpp', '.c': 'c', '.h': 'c',
  '.php': 'php', '.swift': 'swift', '.sql': 'sql', '.sh': 'shell',
  '.ps1': 'powershell', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.md': 'markdown', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.tf': 'terraform', '.vue': 'vue', '.svelte': 'svelte',
};

export function inferTechnology(file, declaredLanguage) {
  if (declaredLanguage) return String(declaredLanguage).toLowerCase();
  if (!file) return null;
  return EXTENSION_TECH[path.extname(file).toLowerCase()] ?? null;
}

export function updateGraph(sessions, events) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const session of sessions) {
      const sessionNode = upsertNode('session', session.id, session.startedAt);
      const projectNode = upsertNode('project', session.project, session.startedAt);
      upsertEdge(sessionNode, projectNode, 'belongs_to', session.startedAt, session.id);

      for (const file of session.files) {
        const fileNode = upsertNode('file', `${session.project}:${file}`, session.startedAt);
        upsertEdge(sessionNode, fileNode, 'touched', session.startedAt, session.id);
        upsertEdge(projectNode, fileNode, 'contains', session.startedAt, null);

        const tech = inferTechnology(file, null);
        if (tech) {
          const techNode = upsertNode('technology', tech, session.startedAt);
          upsertEdge(fileNode, techNode, 'written_in', session.startedAt, null);
          upsertEdge(projectNode, techNode, 'uses', session.startedAt, null);
        }
      }

      for (const language of session.languages) {
        const techNode = upsertNode('technology', String(language).toLowerCase(), session.startedAt);
        upsertEdge(sessionNode, techNode, 'used', session.startedAt, session.id);
        upsertEdge(projectNode, techNode, 'uses', session.startedAt, null);
      }
    }

    for (const event of events) {
      if (event.event === 'commit' && event.detail) {
        const projectNode = upsertNode('project', event.project ?? '(unlabelled)', event.timestamp);
        const commitNode = upsertNode('commit', `${event.project}:${event.detail}`, event.timestamp);
        upsertEdge(commitNode, projectNode, 'committed_to', event.timestamp, null);
      }
      if (event.event === 'command' && event.detail) {
        const tool = String(event.detail).trim().split(/\s+/)[0];
        if (!tool) continue;
        const toolNode = upsertNode('command', tool, event.timestamp);
        const projectNode = upsertNode('project', event.project ?? '(unlabelled)', event.timestamp);
        upsertEdge(projectNode, toolNode, 'ran', event.timestamp, null);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function syncGraph(sessions, events) {
  const db = getDb();

  let newSessions = sessions;
  if (sessions.length) {
    const ids = sessions.map((session) => session.id);
    const placeholders = ids.map(() => '?').join(',');
    const synced = new Set(
      db
        .prepare(`SELECT id FROM sessions WHERE graph_synced = 1 AND id IN (${placeholders})`)
        .all(...ids)
        .map((row) => row.id),
    );
    newSessions = sessions.filter((session) => !synced.has(session.id));
  }

  const newEvents = events.filter((event) => Number(event.reported ?? 0) === 0);

  updateGraph(newSessions, newEvents);

  if (newSessions.length) {
    const ids = newSessions.map((session) => session.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE sessions SET graph_synced = 1 WHERE id IN (${placeholders})`).run(...ids);
  }

  return { sessionsFolded: newSessions.length, eventsFolded: newEvents.length };
}

export function projectTotals({ since = null } = {}) {
  const params = [];
  let where = '';
  if (since) {
    where = 'WHERE started_at >= ?';
    params.push(new Date(since).toISOString());
  }
  return getDb()
    .prepare(
      `SELECT project,
              SUM(duration_sec) AS duration_sec,
              COUNT(*)          AS sessions,
              MIN(started_at)   AS first_session,
              MAX(ended_at)     AS last_session
       FROM sessions ${where}
       GROUP BY project
       ORDER BY duration_sec DESC`,
    )
    .all(...params);
}

export function technologyTotals({ since = null } = {}) {
  const params = [];
  let where = "WHERE n.type = 'technology'";
  if (since) {
    where += ' AND e.timestamp >= ?';
    params.push(new Date(since).toISOString());
  }
  return getDb()
    .prepare(
      `SELECT n.name AS technology, SUM(e.weight) AS weight, MAX(e.timestamp) AS last_used
       FROM nodes n
       JOIN edges e ON e.target_id = n.id
       ${where}
       GROUP BY n.name
       ORDER BY weight DESC`,
    )
    .all(...params);
}

export function projectNeighbours(project, { limit = 20 } = {}) {
  return getDb()
    .prepare(
      `SELECT target.type AS type, target.name AS name, SUM(e.weight) AS weight
       FROM nodes source
       JOIN edges e     ON e.source_id = source.id
       JOIN nodes target ON target.id = e.target_id
       WHERE source.type = 'project' AND source.name = ?
       GROUP BY target.type, target.name
       ORDER BY weight DESC
       LIMIT ?`,
    )
    .all(project, limit);
}

export function graphStats() {
  const db = getDb();
  const nodes = db
    .prepare('SELECT type, COUNT(*) AS n FROM nodes GROUP BY type ORDER BY n DESC')
    .all();
  const edges = Number(db.prepare('SELECT COUNT(*) AS n FROM edges').get().n);
  return { nodes, edges };
}

export function startOfWeek(date = new Date()) {
  const start = new Date(date);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function startOfDay(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function workSummary({ since, until = null } = {}) {
  const params = [new Date(since).toISOString()];
  let where = 'WHERE started_at >= ?';
  if (until) {
    where += ' AND started_at <= ?';
    params.push(new Date(until).toISOString());
  }

  const projects = getDb()
    .prepare(
      `SELECT project,
              SUM(duration_sec)   AS duration_sec,
              COUNT(*)            AS sessions,
              SUM(saves)          AS saves,
              SUM(edits)          AS edits,
              SUM(lines_added)    AS lines_added,
              SUM(lines_removed)  AS lines_removed,
              SUM(debug_sec)      AS debug_sec,
              SUM(idle_sec)       AS idle_sec,
              SUM(errors_resolved) AS errors_resolved,
              MIN(started_at)     AS first_session,
              MAX(ended_at)       AS last_session,
              COUNT(DISTINCT date(started_at)) AS active_days
       FROM sessions ${where}
       GROUP BY project
       ORDER BY duration_sec DESC`,
    )
    .all(...params);

  const totals = projects.reduce(
    (acc, row) => ({
      durationSec: acc.durationSec + Number(row.duration_sec ?? 0),
      sessions: acc.sessions + Number(row.sessions ?? 0),
      linesAdded: acc.linesAdded + Number(row.lines_added ?? 0),
      linesRemoved: acc.linesRemoved + Number(row.lines_removed ?? 0),
      debugSec: acc.debugSec + Number(row.debug_sec ?? 0),
      errorsResolved: acc.errorsResolved + Number(row.errors_resolved ?? 0),
    }),
    { durationSec: 0, sessions: 0, linesAdded: 0, linesRemoved: 0, debugSec: 0, errorsResolved: 0 },
  );

  return { projects, totals, since: new Date(since).toISOString(), until };
}

export function timeline({ since, until = null } = {}) {
  const params = [new Date(since).toISOString()];
  let where = 'WHERE started_at >= ?';
  if (until) {
    where += ' AND started_at <= ?';
    params.push(new Date(until).toISOString());
  }
  return getDb()
    .prepare(
      `SELECT date(started_at)           AS day,
              SUM(duration_sec)          AS duration_sec,
              COUNT(*)                   AS sessions,
              COUNT(DISTINCT project)    AS projects,
              SUM(lines_added)           AS lines_added,
              SUM(lines_removed)         AS lines_removed
       FROM sessions ${where}
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(...params);
}

export function topFiles({ since = null, project = null, limit = 20 } = {}) {
  const clauses = ["n.type = 'file'"];
  const params = [];
  if (since) {
    clauses.push('e.timestamp >= ?');
    params.push(new Date(since).toISOString());
  }
  if (project) {
    clauses.push('n.name LIKE ?');
    params.push(`${project}:%`);
  }
  params.push(limit);

  return getDb()
    .prepare(
      `SELECT n.name AS name, SUM(e.weight) AS weight, MAX(e.timestamp) AS last_touched
       FROM nodes n
       JOIN edges e ON e.target_id = n.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY n.name
       ORDER BY weight DESC
       LIMIT ?`,
    )
    .all(...params);
}

export function fileChurn({ since = null, until = null, project = null, limit = 20 } = {}) {
  const clauses = [];
  const params = [];
  if (since) {
    clauses.push('started_at >= ?');
    params.push(new Date(since).toISOString());
  }
  if (until) {
    clauses.push('started_at <= ?');
    params.push(new Date(until).toISOString());
  }
  if (project) {
    clauses.push('project = ?');
    params.push(project);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT project, file_stats FROM sessions ${where}`)
    .all(...params);

  const totals = new Map();
  for (const row of rows) {
    const stats = parseFileStats(row);
    for (const [file, s] of Object.entries(stats)) {
      const key = `${row.project ?? '(unlabelled)'}::${file}`;
      const entry = totals.get(key) ?? {
        project: row.project ?? '(unlabelled)',
        file,
        linesAdded: 0,
        linesRemoved: 0,
        edits: 0,
      };
      entry.linesAdded += s.linesAdded ?? 0;
      entry.linesRemoved += s.linesRemoved ?? 0;
      entry.edits += s.edits ?? 0;
      totals.set(key, entry);
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved))
    .slice(0, limit);
}

export function relatedProjects(project, { limit = 10 } = {}) {
  return getDb()
    .prepare(
      `SELECT other.name          AS project,
              COUNT(DISTINCT tech.id) AS shared_technologies,
              GROUP_CONCAT(DISTINCT tech.name) AS technologies
       FROM nodes source
       JOIN edges  e1    ON e1.source_id = source.id AND e1.relation = 'uses'
       JOIN nodes  tech  ON tech.id = e1.target_id AND tech.type = 'technology'
       JOIN edges  e2    ON e2.target_id = tech.id AND e2.relation = 'uses'
       JOIN nodes  other ON other.id = e2.source_id AND other.type = 'project'
       WHERE source.type = 'project' AND source.name = ? AND other.name != source.name
       GROUP BY other.name
       ORDER BY shared_technologies DESC
       LIMIT ?`,
    )
    .all(project, limit);
}

export function search(term, { limit = 30 } = {}) {
  const like = `%${term}%`;
  const db = getDb();

  const nodes = db
    .prepare(
      `SELECT type, name, last_seen
       FROM nodes
       WHERE name LIKE ?
       ORDER BY last_seen DESC
       LIMIT ?`,
    )
    .all(like, limit);

  const events = db
    .prepare(
      `SELECT timestamp, source, project, detail, event
       FROM raw_events
       WHERE detail LIKE ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(like, limit);

  return { nodes, events };
}

export function comparePeriods({ since, until = new Date() } = {}) {
  const currentStart = new Date(since);
  const currentEnd = new Date(until);
  const span = currentEnd.getTime() - currentStart.getTime();
  const previousStart = new Date(currentStart.getTime() - span);

  const current = workSummary({ since: currentStart, until: currentEnd });
  const previous = workSummary({ since: previousStart, until: currentStart });

  const previousByProject = new Map(
    previous.projects.map((row) => [row.project, Number(row.duration_sec ?? 0)]),
  );
  const currentByProject = new Map(
    current.projects.map((row) => [row.project, Number(row.duration_sec ?? 0)]),
  );

  const projects = [...new Set([...currentByProject.keys(), ...previousByProject.keys()])]
    .map((project) => {
      const now = currentByProject.get(project) ?? 0;
      const before = previousByProject.get(project) ?? 0;
      return { project, current: now, previous: before, delta: now - before };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    projects,
    current: current.totals,
    previous: previous.totals,
    window: {
      currentStart: currentStart.toISOString(),
      currentEnd: currentEnd.toISOString(),
      previousStart: previousStart.toISOString(),
    },
  };
}

export function focusAnalysis({ since, until = null } = {}) {
  const params = [new Date(since).toISOString()];
  let where = 'WHERE started_at >= ?';
  if (until) {
    where += ' AND started_at <= ?';
    params.push(new Date(until).toISOString());
  }

  const rows = getDb()
    .prepare(
      `SELECT date(started_at)        AS day,
              COUNT(*)                AS sessions,
              COUNT(DISTINCT project) AS projects,
              SUM(duration_sec)       AS duration_sec,
              MAX(duration_sec)       AS longest_session,
              AVG(duration_sec)       AS mean_session
       FROM sessions ${where}
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(...params);

  return rows.map((row) => {
    const duration = Number(row.duration_sec ?? 0);
    const longest = Number(row.longest_session ?? 0);
    return {
      day: row.day,
      sessions: Number(row.sessions),
      projects: Number(row.projects),
      durationSec: duration,
      longestSessionSec: longest,
      meanSessionSec: Math.round(Number(row.mean_session ?? 0)),
      focusRatio: duration ? Number((longest / duration).toFixed(2)) : 0,
    };
  });
}
