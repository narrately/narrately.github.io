import { log, pc } from '../core/logger.js';
import { getMeta, setMeta } from '../core/db.js';
import { loadEvents, buildSessions } from '../pipeline/aggregator.js';
import { authedClient, CloudError } from './cloud.js';

export const CURSOR_KEY = 'cloud_sync_cursor';
const FIRST_SYNC_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Metadata only: no file paths, no diffs, no code content leave the machine.
function toCloudRow(session) {
  return {
    id: session.id,
    project: session.project,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    duration_sec: session.durationSec,
    source: session.source,
    languages: JSON.stringify(session.languages),
    saves: session.saves,
    lines_added: session.linesAdded,
    lines_removed: session.linesRemoved,
    edits: session.edits,
    debug_sec: session.debugSec,
    errors_resolved: session.errorsResolved,
  };
}

// Sessions are rebuilt straight from raw events, one local day at a time, so
// sync works without `narrately report` ever having run. Day boundaries never
// move, which keeps each session's id stable across syncs while it grows.
export function buildSyncPayload({ windowStart, windowEnd }) {
  const rows = [];
  for (let dayStart = startOfLocalDay(windowStart); dayStart < windowEnd; dayStart = addDays(dayStart, 1)) {
    const dayEnd = new Date(Math.min(addDays(dayStart, 1).getTime(), windowEnd.getTime()) - 1);
    const events = loadEvents({ since: dayStart.toISOString(), until: dayEnd.toISOString() });
    for (const session of buildSessions(events)) rows.push(toCloudRow(session));
  }
  return rows;
}

// Re-covers the day before the last sync too: a focus span is only written
// when it closes, so one that crossed midnight lands after the cursor moved on.
export function syncWindow({ cursor = null, days = null, now = new Date() } = {}) {
  let from;
  if (days) from = addDays(startOfLocalDay(now), -(days - 1));
  else if (cursor) from = addDays(startOfLocalDay(new Date(cursor)), -1);
  else from = addDays(startOfLocalDay(now), -(FIRST_SYNC_DAYS - 1));
  return { windowStart: from, windowEnd: addDays(startOfLocalDay(now), 1) };
}

async function explainSyncError(supabase, session, error) {
  if (error.code === 'PGRST202') {
    return new CloudError(
      'Sync failed: this Narrately Cloud project is on an older schema.',
      'Re-run cloud/schema.sql in the Supabase SQL editor (safe to re-run), then sync again.',
    );
  }
  if (!error.message?.includes('row-level security')) return new CloudError(`Sync failed: ${error.message}`);

  const { data: org } = await supabase
    .from('orgs')
    .select('name, subscription_status, trial_ends_at')
    .eq('id', session.org_id)
    .maybeSingle();
  if (!org) {
    return new CloudError(
      "Sync blocked — you're no longer a member of this team.",
      'Ask the owner for a new invite (`narrately cloud join <code>`), or pick another team with `narrately cloud org`.',
    );
  }
  if (org.subscription_status === 'trialing' && new Date(org.trial_ends_at) <= new Date()) {
    return new CloudError(
      `Sync paused — the free trial for ${org.name} ended on ${org.trial_ends_at.slice(0, 10)}.`,
      'Upgrade from the team dashboard to resume syncing. Your local data is unaffected.',
    );
  }
  if (!['trialing', 'active', 'past_due'].includes(org.subscription_status)) {
    return new CloudError(
      `Sync blocked — the ${org.name} subscription is ${org.subscription_status}.`,
      'Upgrade from the team dashboard to resume syncing. Your local data is unaffected.',
    );
  }
  return new CloudError(`Sync failed: ${error.message}`);
}

export async function runSync({ days = null, now = new Date() } = {}) {
  const { supabase, session } = await authedClient();
  if (!session.org_id) {
    throw new CloudError(
      'No team selected.',
      'Create one with `narrately cloud create-org <name>` or join with `narrately cloud join <code>`.',
    );
  }

  const { windowStart, windowEnd } = syncWindow({ cursor: getMeta(CURSOR_KEY, null), days, now });
  const rows = buildSyncPayload({ windowStart, windowEnd });

  const { data, error } = await supabase.rpc('sync_sessions', {
    for_org_id: session.org_id,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    session_rows: rows,
  });
  if (error) throw await explainSyncError(supabase, session, error);

  setMeta(CURSOR_KEY, now.toISOString());
  return {
    sessions: Number(data ?? rows.length),
    windowStart,
    windowEnd,
    orgName: session.org_name ?? session.org_id,
  };
}

export default async function syncCommand({ flags }) {
  let days = null;
  if (flags.days !== undefined) {
    days = Number(flags.days);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      log.error('--days must be a whole number between 1 and 366.');
      process.exitCode = 1;
      return;
    }
  }

  try {
    const result = await runSync({ days });
    const span = Math.round((result.windowEnd - result.windowStart) / DAY_MS);
    log.ok(
      `Synced ${pc.bold(String(result.sessions))} session(s) to ${pc.bold(result.orgName)} ` +
        pc.dim(`(last ${span} day${span === 1 ? '' : 's'})`),
    );
    if (!result.sessions) {
      log.dim('No editor activity in that window yet — check the collectors with `narrately status`.');
    }
    log.dim('Metadata only — no file paths, diffs, or code content were sent.');
  } catch (error) {
    if (!(error instanceof CloudError)) throw error;
    log.error(error.message);
    if (error.hint) log.dim(error.hint);
    process.exitCode = 1;
  }
}
