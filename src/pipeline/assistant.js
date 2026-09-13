import { formatDuration } from './aggregator.js';
import { listNotes } from '../core/db.js';
import {
  workSummary,
  timeline,
  topFiles,
  technologyTotals,
  focusAnalysis,
  comparePeriods,
  startOfWeek,
} from './graph.js';

export function inferWindow(question, flags = {}) {
  if (typeof flags.since === 'string') {
    return { since: new Date(flags.since), label: `since ${flags.since}` };
  }
  if (flags.days) {
    const days = Number(flags.days);
    return { since: new Date(Date.now() - days * 86_400_000), label: `last ${days} days` };
  }

  const text = question.toLowerCase();
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

  if (/\btoday\b/.test(text)) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { since: start, label: 'today' };
  }
  if (/\byesterday\b/.test(text)) return { since: daysAgo(2), label: 'the last two days' };
  if (/\b(this|last)\s+month\b|\bmonth\b/.test(text)) return { since: daysAgo(30), label: 'the last 30 days' };
  if (/\blast\s+week\b/.test(text)) return { since: daysAgo(14), label: 'the last two weeks' };
  if (/\bweek\b/.test(text)) return { since: startOfWeek(), label: 'this week' };

  return { since: daysAgo(30), label: 'the last 30 days' };
}

export function buildContext(since, until = new Date()) {
  const summary = workSummary({ since, until });

  return {
    window: { since: since.toISOString(), until: until.toISOString() },
    totals: {
      ...summary.totals,
      durationHuman: formatDuration(summary.totals.durationSec),
    },
    projects: summary.projects.map((row) => ({
      project: row.project,
      duration: formatDuration(Number(row.duration_sec ?? 0)),
      durationSec: Number(row.duration_sec ?? 0),
      sessions: Number(row.sessions ?? 0),
      activeDays: Number(row.active_days ?? 0),
      linesAdded: Number(row.lines_added ?? 0),
      linesRemoved: Number(row.lines_removed ?? 0),
      debugTime: formatDuration(Number(row.debug_sec ?? 0)),
      firstSession: row.first_session,
      lastSession: row.last_session,
    })),
    dailyTimeline: timeline({ since, until }).map((row) => ({
      day: row.day,
      duration: formatDuration(Number(row.duration_sec ?? 0)),
      sessions: Number(row.sessions ?? 0),
      projects: Number(row.projects ?? 0),
    })),
    technologies: technologyTotals({ since: since.toISOString() })
      .slice(0, 15)
      .map((row) => ({ technology: row.technology, weight: Number(row.weight) })),
    topFiles: topFiles({ since: since.toISOString(), limit: 20 }).map((row) => ({
      file: row.name,
      touches: Number(row.weight),
    })),
    focusByDay: focusAnalysis({ since, until }).map((row) => ({
      day: row.day,
      focusRatio: row.focusRatio,
      sessions: row.sessions,
      projects: row.projects,
    })),
    versusPreviousPeriod: comparePeriods({ since, until }).projects.slice(0, 10),
    notes: listNotes({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }).map(
      (note) => ({ date: note.date, project: note.project, body: note.body }),
    ),
  };
}

export const MAX_HISTORY_TURNS = 12;

export function trimHistory(history) {
  return history.slice(-MAX_HISTORY_TURNS);
}
