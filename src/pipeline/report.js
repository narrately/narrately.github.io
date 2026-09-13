import fs from 'node:fs';
import path from 'node:path';
import { getDb, getMeta, setMeta, listDiffs, sweepDiffRetention } from '../core/db.js';
import { loadConfig } from '../core/config.js';
import { REPORTS_DIR, ensureHome } from '../core/paths.js';
import { drainShellLog } from '../collectors/shell.js';
import { scrapeGit } from '../collectors/git.js';
import { summarizeDiff } from '../core/summarize-diff.js';
import {
  loadEvents,
  buildSessions,
  persistSessions,
  markReported,
  summarise,
} from './aggregator.js';
import { syncGraph, startOfWeek } from './graph.js';
import { generateNarrative, hasApiKey } from './providers/index.js';
import { renderFallbackMarkdown, renderEmailHtml } from './render.js';
import { sendReportEmail } from './email.js';

const LAST_REPORT_KEY = 'last_report_at';

function diffsByProjectFor(start) {
  const rows = listDiffs({ since: start.toISOString(), limit: 200 });
  const grouped = {};
  for (const row of rows) {
    const key = row.project ?? '(unlabelled)';
    (grouped[key] ??= []).push(row);
  }
  return grouped;
}

function resolveWindow({ since, until, day, week }) {
  const end = until ? new Date(until) : new Date();

  if (day) {
    const start = new Date(`${day}T00:00:00`);
    const dayEnd = new Date(`${day}T23:59:59.999`);
    return { start, end: dayEnd, label: day, period: 'day' };
  }
  if (week) {
    const start = startOfWeek();
    return { start, end, label: 'this week', period: 'week' };
  }
  if (since) return { start: new Date(since), end, label: `${since} → now`, period: 'custom' };

  const last = getMeta(LAST_REPORT_KEY, null);
  if (last) return { start: new Date(last), end, label: 'since last report', period: 'day' };
  return {
    start: new Date(end.getTime() - 24 * 60 * 60 * 1000),
    end,
    label: 'last 24 hours',
    period: 'day',
  };
}

export async function generateReport({
  since = null,
  until = null,
  day = null,
  week = false,
  mode = 'manual',
  email = null,
  collect = true,
  config = loadConfig(),
} = {}) {
  ensureHome();
  const { start, end, label, period } = resolveWindow({ since, until, day, week });

  let collected = { shell: 0, git: 0 };
  if (collect) {
    try {
      collected = {
        shell: drainShellLog(config),
        git: scrapeGit(config, { since: start.toISOString() }),
      };
    } catch {
    }
    try {
      sweepDiffRetention({ retentionDays: config.privacy?.diff_retention_days, summarize: summarizeDiff });
    } catch {
    }
  }

  const events = loadEvents({ since: start.toISOString(), until: end.toISOString() });
  const sessions = buildSessions(events);
  persistSessions(sessions);

  syncGraph(sessions, events);

  const summary = summarise(events, sessions);
  const verbosity = config.report?.verbosity ?? 'standard';
  const diffsByProject = diffsByProjectFor(start);

  let markdown;
  let generator = 'fallback';
  let llmError = null;

  const hasContent = summary.projects.length > 0;

  if (hasContent && hasApiKey(config)) {
    try {
      const result = await generateNarrative(config, summary, {
        verbosity,
        periodLabel: label,
        period,
        diffsByProject,
      });
      markdown = result.markdown;
      generator = 'llm';
    } catch (error) {
      llmError = error;
      markdown = renderFallbackMarkdown(summary, {
        periodLabel: label,
        periodEnd: end.toISOString(),
        period,
        periodStart: start.toISOString(),
        diffsByProject,
      });
    }
  } else {
    markdown = renderFallbackMarkdown(summary, {
      periodLabel: label,
      periodEnd: end.toISOString(),
      period,
      periodStart: start.toISOString(),
      diffsByProject,
    });
  }

  const generatedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO reports (generated_at, period_start, period_end, mode, markdown, generator)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(generatedAt, start.toISOString(), end.toISOString(), mode, markdown, generator);

  const fileName = `${generatedAt.slice(0, 10)}-${generatedAt.slice(11, 19).replaceAll(':', '')}.md`;
  const filePath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(filePath, markdown);

  markReported(events);
  setMeta(LAST_REPORT_KEY, end.toISOString());

  const shouldEmail = email ?? (mode === 'scheduled' && config.email?.enabled);
  let emailResult = null;
  if (shouldEmail && hasContent) {
    try {
      emailResult = await sendReportEmail(config, {
        markdown,
        html: renderEmailHtml(markdown, { title: `Narrately — ${generatedAt.slice(0, 10)}` }),
        subject: `Narrately — ${generatedAt.slice(0, 10)}`,
      });
    } catch (error) {
      emailResult = { ok: false, error: error.message };
    }
  }

  return {
    markdown,
    filePath,
    summary,
    sessions,
    generator,
    llmError,
    collected,
    emailResult,
    period: { start: start.toISOString(), end: end.toISOString(), label, kind: period },
  };
}
