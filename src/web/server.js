import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, createNote, listNotes, updateNote, deleteNote, listDiffs } from '../core/db.js';
import { loadConfig, configExists } from '../core/config.js';
import { readDaemonPid, readDaemonPort, isProcessAlive } from '../collectors/daemon.js';
import { hasApiKey, resolveProvider, answerQuestion } from '../pipeline/providers/index.js';
import {
  workSummary,
  timeline,
  fileChurn,
  focusAnalysis,
  comparePeriods,
  startOfWeek,
  startOfDay,
} from '../pipeline/graph.js';
import { inferWindow, buildContext, trimHistory } from '../pipeline/assistant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = path.join(__dirname, 'dashboard.html');

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limitBytes = 200_000) {
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

function resolveSince(url) {
  const since = url.searchParams.get('since');
  if (since) return new Date(since);
  const preset = url.searchParams.get('range') ?? 'week';
  if (preset === 'today') return startOfDay();
  if (preset === 'week') return startOfWeek();
  if (preset === 'month') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (preset === 'all') return new Date(0);
  return startOfWeek();
}

function resolveUntil(url) {
  const until = url.searchParams.get('until');
  return until ? new Date(until) : new Date();
}

export function createRequestHandler() {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, payload) => sendJson(res, status, payload);

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = fs.readFileSync(DASHBOARD_HTML, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      if (!url.pathname.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }

      const config = configExists() ? loadConfig() : null;

      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!config) return send(200, { configured: false });
        const pid = readDaemonPid();
        const provider = resolveProvider(config);
        return send(200, {
          configured: true,
          daemon: { running: isProcessAlive(pid), pid, port: pid ? readDaemonPort() : null },
          provider: { id: provider.id, label: provider.label, hasApiKey: hasApiKey(config) },
          email: { enabled: Boolean(config.email?.enabled) },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/overview') {
        const since = resolveSince(url);
        const until = resolveUntil(url);
        const summary = workSummary({ since, until });
        return send(200, { since: since.toISOString(), until: until.toISOString(), ...summary });
      }

      if (req.method === 'GET' && url.pathname === '/api/timeline') {
        const since = resolveSince(url);
        const until = resolveUntil(url);
        return send(200, { rows: timeline({ since, until }) });
      }

      if (req.method === 'GET' && url.pathname === '/api/files') {
        const since = resolveSince(url);
        const until = resolveUntil(url);
        const project = url.searchParams.get('project') || null;
        const limit = Number(url.searchParams.get('limit') ?? 25);
        return send(200, { rows: fileChurn({ since, until, project, limit }) });
      }

      if (req.method === 'GET' && url.pathname === '/api/focus') {
        const since = resolveSince(url);
        const until = resolveUntil(url);
        return send(200, { rows: focusAnalysis({ since, until }) });
      }

      if (req.method === 'GET' && url.pathname === '/api/compare') {
        const since = resolveSince(url);
        const until = resolveUntil(url);
        return send(200, comparePeriods({ since, until }));
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!config) return send(400, { error: 'Narrately is not configured yet — run `narrately onboard` first.' });

        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
        const question = typeof payload.question === 'string' ? payload.question.trim() : '';
        if (!question) return send(400, { error: 'question must not be empty' });

        const provider = resolveProvider(config);
        if (!hasApiKey(config)) {
          return send(400, { error: `No API key set for ${provider.label}.` });
        }

        const history = trimHistory(
          Array.isArray(payload.history)
            ? payload.history.filter(
                (turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string',
              )
            : [],
        );

        const { since, label } = inferWindow(question, {
          since: typeof payload.since === 'string' ? payload.since : undefined,
          days: typeof payload.days === 'number' ? payload.days : undefined,
        });
        const context = buildContext(since);

        try {
          const { text } = await answerQuestion(config, question, context, { history });
          return send(200, { text, window: label, provider: provider.id });
        } catch (error) {
          return send(502, { error: error.message });
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/diffs') {
        const since = resolveSince(url);
        const project = url.searchParams.get('project') || null;
        const limit = Number(url.searchParams.get('limit') ?? 30);
        const rows = listDiffs({ since, project, limit }).map(
          ({ diff_text, ...rest }) => rest,
        );
        return send(200, { rows });
      }

      const diffMatch = url.pathname.match(/^\/api\/diffs\/(\d+)$/);
      if (req.method === 'GET' && diffMatch) {
        const row = getDb().prepare('SELECT * FROM diffs WHERE id = ?').get(Number(diffMatch[1]));
        if (!row) return send(404, { error: 'not found' });
        return send(200, row);
      }

      if (req.method === 'GET' && url.pathname === '/api/reports') {
        const limit = Number(url.searchParams.get('limit') ?? 30);
        const rows = getDb()
          .prepare(
            `SELECT id, generated_at, period_start, period_end, mode, generator
             FROM reports ORDER BY generated_at DESC LIMIT ?`,
          )
          .all(limit);
        return send(200, { rows });
      }

      const reportMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
      if (req.method === 'GET' && reportMatch) {
        const row = getDb().prepare('SELECT * FROM reports WHERE id = ?').get(Number(reportMatch[1]));
        if (!row) return send(404, { error: 'not found' });
        return send(200, row);
      }

      if (req.method === 'GET' && url.pathname === '/api/notes') {
        const date = url.searchParams.get('date') || null;
        const since = url.searchParams.get('since') || null;
        const until = url.searchParams.get('until') || null;
        const project = url.searchParams.get('project') || null;
        return send(200, { rows: listNotes({ date, since, until, project }) });
      }

      if (req.method === 'POST' && url.pathname === '/api/notes') {
        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
        const date = typeof payload.date === 'string' ? payload.date : null;
        const body = typeof payload.body === 'string' ? payload.body.trim() : '';
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(400, { error: 'date must be YYYY-MM-DD' });
        if (!body) return send(400, { error: 'body must not be empty' });
        const project = typeof payload.project === 'string' && payload.project ? payload.project : null;
        const id = createNote({ date, project, body });
        return send(201, { id });
      }

      const noteMatch = url.pathname.match(/^\/api\/notes\/(\d+)$/);
      if (req.method === 'PUT' && noteMatch) {
        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
        const body = typeof payload.body === 'string' ? payload.body.trim() : undefined;
        if (body !== undefined && !body) return send(400, { error: 'body must not be empty' });
        const ok = updateNote(Number(noteMatch[1]), { body, project: payload.project });
        return send(ok ? 200 : 404, { ok });
      }

      if (req.method === 'DELETE' && noteMatch) {
        const ok = deleteNote(Number(noteMatch[1]));
        return send(ok ? 200 : 404, { ok });
      }

      return send(404, { error: 'not found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  };
}

export async function startWebServer({ port = 47830 } = {}) {
  const server = http.createServer(createRequestHandler());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const boundPort = server.address().port;
  return { server, port: boundPort, url: `http://127.0.0.1:${boundPort}` };
}
