import http from 'node:http';
import fs from 'node:fs';
import { createTwoFilesPatch, diffLines } from 'diff';
import { insertRawEvent, insertDiff, sweepDiffRetention, getDb } from '../core/db.js';
import { loadConfig, isExcluded, resolveProject, resolveProjectRoot } from '../core/config.js';
import { redactSecrets, MAX_DIFF_BYTES } from '../core/redact.js';
import { summarizeDiff } from '../core/summarize-diff.js';
import { PID_PATH, PORT_PATH, DAEMON_LOG, ensureHome } from '../core/paths.js';
import { drainShellLog } from './shell.js';
import { scrapeGit } from './git.js';

const POLL_INTERVAL_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function appendLog(line) {
  try {
    fs.appendFileSync(DAEMON_LOG, `[${nowIso()}] ${line}\n`);
  } catch {
  }
}

class SpanTracker {
  #open = new Map();

  close(source, endedAt) {
    const open = this.#open.get(source);
    if (!open) return null;
    this.#open.delete(source);
    const durationSec = Math.max(
      0,
      Math.round((new Date(endedAt).getTime() - new Date(open.startedAt).getTime()) / 1000),
    );
    return { ...open, endedAt, durationSec };
  }

  open(source, record) {
    this.#open.set(source, record);
  }

  has(source) {
    return this.#open.has(source);
  }

  closeAll(endedAt) {
    const out = [];
    for (const source of [...this.#open.keys()]) {
      const closed = this.close(source, endedAt);
      if (closed) out.push({ source, ...closed });
    }
    return out;
  }
}

export class SnapshotCache {
  #store = new Map();
  #maxEntries;

  constructor(maxEntries = 500) {
    this.#maxEntries = maxEntries;
  }

  get(key) {
    return this.#store.has(key) ? this.#store.get(key) : undefined;
  }

  set(key, value) {
    if (!this.#store.has(key) && this.#store.size >= this.#maxEntries) {
      this.#store.delete(this.#store.keys().next().value);
    }
    this.#store.set(key, value);
  }
}

function diffLineStats(before, after) {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const lines = part.value.split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));
    if (part.added) added += lines.length;
    else if (part.removed) removed += lines.length;
  }
  return { added, removed };
}

const ENRICHER_EVENTS = new Set([
  'edit',
  'idle',
  'diagnostics',
  'file_create',
  'file_delete',
  'file_rename',
]);

const ALLOWED_METRICS = new Set([
  'linesAdded',
  'linesRemoved',
  'charsChanged',
  'errors',
  'warnings',
  'errorsResolved',
]);

function sanitiseMetrics(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_METRICS.has(key)) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) out[key] = Math.round(numeric);
  }
  return Object.keys(out).length ? out : null;
}

export function createIngestHandler({ config, tracker, debugTracker, stats, snapshots }) {
  return function ingest(event) {
    const source = String(event.source ?? 'unknown');
    const timestamp = event.timestamp ? new Date(event.timestamp).toISOString() : nowIso();
    const file = event.file ?? event.detail ?? null;
    const branch = event.branch ?? null;

    const project =
      event.project ?? resolveProject(config, event.absolutePath ?? file) ?? null;

    if (isExcluded(config, { project, detail: event.absolutePath ?? file })) {
      stats.dropped++;
      return 'dropped';
    }

    const kind = event.event ?? 'editor_focus_start';

    if (kind === 'editor_focus_start' || kind === 'editor_focus_end') {
      const closed = tracker.close(source, timestamp);
      if (closed && closed.file) {
        const minimum = config.daemon?.min_focus_seconds ?? 5;
        if (closed.durationSec >= minimum) {
          insertRawEvent({
            timestamp: closed.startedAt,
            source,
            project: closed.project,
            detail: closed.file,
            language: closed.language,
            event: 'editor_focus',
            duration_sec: closed.durationSec,
            branch: closed.branch,
          });
          stats.stored++;
        } else {
          stats.dropped++;
        }
      }
      if (kind === 'editor_focus_start' && file) {
        tracker.open(source, {
          file,
          project,
          language: event.language ?? null,
          branch,
          startedAt: timestamp,
        });
        stats.focusStarts++;
        return 'buffered';
      }
      return 'stored';
    }

    if (kind === 'debug_start' || kind === 'debug_end') {
      const closed = debugTracker.close(source, timestamp);
      if (closed) {
        insertRawEvent({
          timestamp: closed.startedAt,
          source,
          project: closed.project,
          detail: closed.label,
          event: 'debug',
          duration_sec: closed.durationSec,
          branch: closed.branch,
        });
        stats.stored++;
        stats.debugSessions++;
      }
      if (kind === 'debug_start') {
        debugTracker.open(source, {
          project,
          label: event.label ?? file ?? 'debug session',
          branch,
          startedAt: timestamp,
        });
        return 'buffered';
      }
      return 'stored';
    }

    if (kind === 'save') {
      insertRawEvent({
        timestamp,
        source,
        project,
        detail: file,
        language: event.language ?? null,
        event: 'save',
        duration_sec: null,
        branch,
      });
      stats.stored++;
      return 'stored';
    }

    if (kind === 'save_diff') {
      const absolutePath = event.absolutePath ?? file;
      if (!absolutePath || typeof event.content !== 'string') {
        stats.dropped++;
        return 'dropped';
      }

      const root = resolveProjectRoot(config, absolutePath);
      if (!root?.capture_save_diffs) {
        stats.dropped++;
        return 'dropped';
      }

      const previous = snapshots.get(absolutePath);
      snapshots.set(absolutePath, event.content);

      if (previous === undefined) {
        stats.diffBaseline++;
        return 'buffered';
      }
      if (previous === event.content) {
        stats.dropped++;
        return 'dropped';
      }

      const byteSize = Buffer.byteLength(event.content, 'utf8') + Buffer.byteLength(previous, 'utf8');
      const { added, removed } = diffLineStats(previous, event.content);

      let diffText = null;
      let summary = null;
      let redacted = false;
      const patch = createTwoFilesPatch(file ?? absolutePath, file ?? absolutePath, previous, event.content, '', '', {
        context: 3,
      });
      if (Buffer.byteLength(patch, 'utf8') > MAX_DIFF_BYTES || byteSize > MAX_DIFF_BYTES * 4) {
        summary = 'diff omitted: exceeds the capture size limit';
      } else {
        const result = redactSecrets(patch);
        diffText = result.text;
        redacted = result.redacted;
      }

      const inserted = insertDiff({
        source: 'save_point',
        project,
        file: file ?? absolutePath,
        diffText,
        summary,
        linesAdded: added,
        linesRemoved: removed,
        redacted,
      });
      if (inserted !== null) {
        stats.stored++;
        stats.saveDiffs++;
        return 'stored';
      }
      stats.dropped++;
      return 'dropped';
    }

    if (ENRICHER_EVENTS.has(kind)) {
      const metrics = sanitiseMetrics(event.metrics);
      if (kind === 'edit' && !metrics) {
        stats.dropped++;
        return 'dropped';
      }
      insertRawEvent({
        timestamp,
        source,
        project,
        detail: file,
        language: event.language ?? null,
        event: kind,
        duration_sec: event.duration_sec ?? null,
        metrics,
        branch,
      });
      stats.stored++;
      if (kind === 'edit') stats.edits++;
      return 'stored';
    }

    insertRawEvent({
      timestamp,
      source,
      project,
      detail: file,
      language: event.language ?? null,
      event: kind,
      duration_sec: event.duration_sec ?? null,
      branch,
    });
    stats.stored++;
    return 'stored';
  };
}

function readBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRequestHandler({ config, ingest, stats, flushOpenSpans, port }) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, pid: process.pid, ...stats });
      }

      if (req.method === 'GET' && url.pathname === '/capture-config') {
        const roots = (config.project_roots ?? []).map((root) => ({
          path: root.path,
          captureSaveDiffs: Boolean(root.capture_save_diffs),
        }));
        return send(200, { roots });
      }

      if (req.method === 'POST' && url.pathname === '/events') {
        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          return send(400, { ok: false, error: 'invalid JSON' });
        }
        const events = Array.isArray(payload) ? payload : (payload.events ?? [payload]);
        let accepted = 0;
        for (const event of events) {
          if (event && typeof event === 'object') {
            ingest(event);
            accepted++;
          }
        }
        return send(202, { ok: true, accepted });
      }

      if (req.method === 'POST' && url.pathname === '/flush') {
        return send(200, { ok: true, flushed: flushOpenSpans() });
      }

      return send(404, { ok: false, error: 'not found' });
    } catch (error) {
      appendLog(`request error: ${error.message}`);
      return send(500, { ok: false, error: 'internal error' });
    }
  };
}

export async function startDaemon({ port, onListening } = {}) {
  ensureHome();
  const config = loadConfig();
  const listenPort = port ?? config.daemon?.port ?? 47821;
  const tracker = new SpanTracker();
  const debugTracker = new SpanTracker();
  const snapshots = new SnapshotCache();
  const stats = {
    stored: 0,
    dropped: 0,
    focusStarts: 0,
    edits: 0,
    debugSessions: 0,
    saveDiffs: 0,
    diffBaseline: 0,
    startedAt: nowIso(),
  };
  const ingest = createIngestHandler({ config, tracker, debugTracker, stats, snapshots });

  getDb();

  const flushOpenSpans = () => {
    const endedAt = nowIso();
    let flushed = 0;

    for (const record of tracker.closeAll(endedAt)) {
      if ((record.durationSec ?? 0) < (config.daemon?.min_focus_seconds ?? 5)) continue;
      insertRawEvent({
        timestamp: record.startedAt,
        source: record.source,
        project: record.project,
        detail: record.file,
        language: record.language,
        event: 'editor_focus',
        duration_sec: record.durationSec,
        branch: record.branch,
      });
      flushed++;
    }

    for (const record of debugTracker.closeAll(endedAt)) {
      insertRawEvent({
        timestamp: record.startedAt,
        source: record.source,
        project: record.project,
        detail: record.label,
        event: 'debug',
        duration_sec: record.durationSec,
        branch: record.branch,
      });
      flushed++;
    }

    return flushed;
  };

  const server = http.createServer(createRequestHandler({ config, ingest, stats, flushOpenSpans, port: listenPort }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', resolve);
  });
  const boundPort = server.address().port;

  fs.writeFileSync(PID_PATH, String(process.pid));
  fs.writeFileSync(PORT_PATH, String(boundPort));
  appendLog(`daemon listening on 127.0.0.1:${boundPort} (pid ${process.pid})`);
  onListening?.(boundPort);

  const poll = setInterval(() => {
    try {
      const shell = drainShellLog(config);
      const git = scrapeGit(config);
      if (shell || git) appendLog(`poll: +${shell} shell, +${git} git`);
    } catch (error) {
      appendLog(`poll error: ${error.message}`);
    }
    try {
      const swept = sweepDiffRetention({ retentionDays: config.privacy?.diff_retention_days, summarize: summarizeDiff });
      if (swept) appendLog(`poll: summarized ${swept} diff(s) past retention`);
    } catch (error) {
      appendLog(`diff retention sweep error: ${error.message}`);
    }
  }, POLL_INTERVAL_MS);
  poll.unref?.();

  const shutdown = () => {
    clearInterval(poll);
    try {
      flushOpenSpans();
    } catch (error) {
      appendLog(`flush on shutdown failed: ${error.message}`);
    }
    try {
      fs.rmSync(PID_PATH, { force: true });
      fs.rmSync(PORT_PATH, { force: true });
    } catch {
    }
    appendLog('daemon stopped');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, port: boundPort, shutdown };
}

export function readDaemonPort() {
  try {
    return Number(fs.readFileSync(PORT_PATH, 'utf8').trim());
  } catch {
    return loadConfig().daemon?.port ?? 47821;
  }
}

export function readDaemonPid() {
  try {
    const pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
