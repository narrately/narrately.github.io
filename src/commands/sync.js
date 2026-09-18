import { log, pc } from '../core/logger.js';
import { getDb, getMeta, setMeta } from '../core/db.js';
import { cloudEnv, loadCloudSession } from './cloud.js';

const LAST_SYNC_KEY = 'cloud_last_synced_at';

export default async function syncCommand() {
  const env = cloudEnv();
  if (!env) {
    log.error('Narrately Cloud is not configured.');
    log.dim('Set NARRATELY_CLOUD_URL and NARRATELY_CLOUD_ANON_KEY (see cloud/README.md).');
    process.exitCode = 1;
    return;
  }

  const session = loadCloudSession();
  if (!session) {
    log.error('Not logged in. Run `narrately cloud login` first.');
    process.exitCode = 1;
    return;
  }
  if (!session.org_id) {
    log.error('No org set. Run `narrately cloud org <org-id>` first.');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const since = getMeta(LAST_SYNC_KEY, '1970-01-01T00:00:00.000Z');
  const rows = db
    .prepare('SELECT * FROM sessions WHERE started_at > ? ORDER BY started_at ASC')
    .all(since);

  if (!rows.length) {
    log.dim('Nothing new to sync.');
    return;
  }

  // Metadata only: no file paths, no diffs, no code content leave the machine.
  const payload = rows.map((row) => ({
    id: row.id,
    user_id: session.user_id,
    org_id: session.org_id,
    project: row.project,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_sec: row.duration_sec,
    source: row.source,
    languages: row.languages,
    saves: row.saves,
    lines_added: row.lines_added,
    lines_removed: row.lines_removed,
    edits: row.edits,
    debug_sec: row.debug_sec,
    errors_resolved: row.errors_resolved,
  }));

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  const { error } = await supabase.from('synced_sessions').upsert(payload, { onConflict: 'id,user_id' });
  if (error) {
    if (error.message.includes('row-level security')) {
      const { data: org } = await supabase.from('orgs').select('subscription_status').eq('id', session.org_id).single();
      if (org && org.subscription_status !== 'trialing' && org.subscription_status !== 'active') {
        log.error(`Sync blocked — team subscription is ${org.subscription_status}.`);
        log.dim('Upgrade from the team dashboard to resume syncing.');
        process.exitCode = 1;
        return;
      }
    }
    log.error(`Sync failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  setMeta(LAST_SYNC_KEY, rows[rows.length - 1].started_at);
  log.ok(`Synced ${pc.bold(String(rows.length))} session(s) to Narrately Cloud.`);
  log.dim('Metadata only — no file paths, diffs, or code content were sent.');
}
