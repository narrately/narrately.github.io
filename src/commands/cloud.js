import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { input, password } from '@inquirer/prompts';
import { log, pc } from '../core/logger.js';
import { CLOUD_PATH, ensureHome } from '../core/paths.js';
import { openBrowser } from '../core/open.js';

const DASHBOARD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cloud', 'dashboard');
const DASHBOARD_TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

export class CloudError extends Error {
  constructor(message, hint = null) {
    super(message);
    this.name = 'CloudError';
    this.hint = hint;
  }
}

export function loadCloudSession() {
  if (!fs.existsSync(CLOUD_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CLOUD_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCloudSession(session) {
  ensureHome();
  fs.writeFileSync(CLOUD_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
}

// Env vars win so a team can point the CLI at a different project; otherwise
// fall back to the project saved at login, which is what lets the daemon and
// scheduled tasks sync without the env vars in their environment.
export function cloudEnv() {
  const url = process.env.NARRATELY_CLOUD_URL;
  const anonKey = process.env.NARRATELY_CLOUD_ANON_KEY;
  if (url && anonKey) return { url, anonKey };
  const session = loadCloudSession();
  if (session?.url && session?.anon_key) return { url: session.url, anonKey: session.anon_key };
  return null;
}

function requireEnv() {
  const env = cloudEnv();
  if (!env) {
    throw new CloudError(
      'Narrately Cloud is not configured.',
      'Set NARRATELY_CLOUD_URL and NARRATELY_CLOUD_ANON_KEY (see cloud/README.md).',
    );
  }
  return env;
}

async function client(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Access tokens last about an hour. setSession() swaps an expired one for a
// fresh pair using the refresh token; the rotated pair is saved right away
// because Supabase refresh tokens are single-use.
export async function authedClient() {
  const env = requireEnv();
  const session = loadCloudSession();
  if (!session?.access_token) {
    throw new CloudError('Not logged in to Narrately Cloud.', 'Run `narrately cloud login` first.');
  }

  const supabase = await client(env);
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error || !data.session) {
    throw new CloudError('Your Narrately Cloud login has expired.', 'Run `narrately cloud login` again.');
  }

  let current = session;
  if (data.session.access_token !== session.access_token) {
    current = { ...session, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    saveCloudSession(current);
  }
  return { supabase, session: current };
}

function requireOrg(session) {
  if (!session.org_id) {
    throw new CloudError(
      'No team selected.',
      'Create one with `narrately cloud create-org <name>` or join with `narrately cloud join <code>`.',
    );
  }
  return session.org_id;
}

function selectOrg(session, org) {
  saveCloudSession({ ...session, org_id: org.id, org_name: org.name });
}

async function signup() {
  const env = requireEnv();
  const supabase = await client(env);

  const email = await input({ message: 'Email:' });
  const pass = await password({ message: 'Password (min 8 chars):' });

  const { error } = await supabase.auth.signUp({ email, password: pass });
  if (error) throw new CloudError(`Sign up failed: ${error.message}`);
  log.ok('Account created.');
  log.dim('Check your email to confirm it, then run `narrately cloud login`.');
}

async function login() {
  const env = requireEnv();
  const supabase = await client(env);

  const email = await input({ message: 'Email:' });
  const pass = await password({ message: 'Password:' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) throw new CloudError(`Login failed: ${error.message}`);

  const previous = loadCloudSession();
  const sameUser = previous?.user_id === data.user.id;
  const session = {
    email,
    user_id: data.user.id,
    url: env.url,
    anon_key: env.anonKey,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    org_id: sameUser ? (previous.org_id ?? null) : null,
    org_name: sameUser ? (previous.org_name ?? null) : null,
  };
  saveCloudSession(session);
  log.ok(`Logged in as ${pc.bold(email)}.`);

  if (session.org_id) {
    log.dim(`Team: ${session.org_name ?? session.org_id}. Run \`narrately sync\` to push activity.`);
    return;
  }

  const { data: orgs } = await supabase
    .from('memberships')
    .select('orgs(id, name)')
    .eq('user_id', data.user.id);
  const teams = (orgs ?? []).map((row) => row.orgs).filter(Boolean);
  if (teams.length === 1) {
    selectOrg(session, teams[0]);
    log.ok(`Team set to ${pc.bold(teams[0].name)}. Run \`narrately sync\` to push activity.`);
  } else if (teams.length > 1) {
    log.dim(`You're in ${teams.length} teams — pick one with \`narrately cloud org <org-id>\`:`);
    for (const team of teams) log.dim(`  ${team.id}  ${team.name}`);
  } else {
    log.dim('Next: `narrately cloud create-org <name>` to start a team, or `narrately cloud join <code>` to join one.');
  }
}

function logout() {
  if (fs.existsSync(CLOUD_PATH)) fs.rmSync(CLOUD_PATH);
  log.ok('Logged out. Local data is untouched.');
}

function status() {
  const session = loadCloudSession();
  if (!session) {
    log.dim('Not logged in. Run `narrately cloud login` or `narrately cloud signup`.');
    return;
  }
  log.ok(`Logged in as ${pc.bold(session.email)}`);
  log.dim(`user_id: ${session.user_id}`);
  log.dim(
    session.org_id
      ? `Team: ${session.org_name ?? '(unnamed)'} (${session.org_id})`
      : 'Team: none — `narrately cloud create-org <name>` or `narrately cloud join <code>`',
  );
}

async function setOrg(positionals) {
  const orgId = positionals[1];
  const { supabase, session } = await authedClient();

  const { data, error } = await supabase
    .from('memberships')
    .select('orgs(id, name)')
    .eq('user_id', session.user_id);
  if (error) throw new CloudError(`Could not list your teams: ${error.message}`);
  const teams = (data ?? []).map((row) => row.orgs).filter(Boolean);

  if (!orgId) {
    if (!teams.length) {
      log.dim('You are not in any team yet. `narrately cloud create-org <name>` or `narrately cloud join <code>`.');
      return;
    }
    for (const team of teams) {
      const marker = team.id === session.org_id ? pc.green('●') : ' ';
      log.info(`${marker} ${team.id}  ${team.name}`);
    }
    log.dim('Switch with `narrately cloud org <org-id>`.');
    return;
  }

  const team = teams.find((candidate) => candidate.id === orgId);
  if (!team) {
    throw new CloudError(`You are not a member of ${orgId}.`, 'Ask the team owner for an invite code, then `narrately cloud join <code>`.');
  }
  selectOrg(session, team);
  log.ok(`Team set to ${pc.bold(team.name)}. Run \`narrately sync\` to push activity.`);
}

async function createOrg(positionals) {
  const name = positionals.slice(1).join(' ').trim();
  if (!name) throw new CloudError('Usage: narrately cloud create-org <team name>');

  const { supabase, session } = await authedClient();
  const { data: orgId, error } = await supabase.rpc('create_org', { org_name: name });
  if (error) throw rpcError('Could not create the team', error);

  selectOrg(session, { id: orgId, name });
  log.ok(`Created ${pc.bold(name)} — you're the owner. Free trial: 14 days.`);
  log.dim('Invite teammates with `narrately cloud invite`, then run `narrately sync`.');
}

async function invite() {
  const { supabase, session } = await authedClient();
  const orgId = requireOrg(session);
  const { data: code, error } = await supabase.rpc('create_invite', { for_org_id: orgId });
  if (error) throw rpcError('Could not create an invite', error);

  log.ok(`Invite code for ${pc.bold(session.org_name ?? orgId)}: ${pc.bold(pc.cyan(code))}`);
  log.dim('Valid for 7 days, any number of teammates. Each teammate runs:');
  log.info(`  ${pc.cyan('narrately cloud signup')}   ${pc.dim('(once, then confirm the email)')}`);
  log.info(`  ${pc.cyan('narrately cloud login')}`);
  log.info(`  ${pc.cyan(`narrately cloud join ${code}`)}`);
}

async function join(positionals) {
  const code = positionals[1];
  if (!code) throw new CloudError('Usage: narrately cloud join <invite-code>');

  const { supabase, session } = await authedClient();
  const { data, error } = await supabase.rpc('accept_invite', { invite_code: code });
  if (error) throw rpcError('Could not join', error);
  const team = data?.[0];
  if (!team) throw new CloudError('Could not join: the invite did not resolve to a team.');

  selectOrg(session, { id: team.joined_org_id, name: team.joined_org_name });
  log.ok(`Joined ${pc.bold(team.joined_org_name)}.`);
  log.dim('The daemon pushes session metadata every 15 minutes while it runs; `narrately sync` pushes now.');
  log.dim('Turn auto-sync off any time: narrately config set cloud.auto_sync false');
}

async function members() {
  const { supabase, session } = await authedClient();
  const orgId = requireOrg(session);
  const { data, error } = await supabase.rpc('org_members', { for_org_id: orgId });
  if (error) throw rpcError('Could not list members', error);

  log.title(session.org_name ?? orgId);
  for (const member of data ?? []) {
    const you = member.member_id === session.user_id ? pc.dim(' (you)') : '';
    log.info(`  ${member.email}${you}  ${pc.dim(`${member.role} · joined ${member.joined_at.slice(0, 10)}`)}`);
  }
}

// Serves the team portal locally, with config.js generated from the project
// this CLI is logged in to — no file to copy, no static server to install.
// Port 5544 matches the checkout function's default NARRATELY_DASHBOARD_URL.
async function dashboard(flags) {
  const env = requireEnv();
  const port = Number(flags.port ?? 5544);
  const configJs =
    `window.NARRATELY_CLOUD_URL = ${JSON.stringify(env.url)};\n` +
    `window.NARRATELY_CLOUD_ANON_KEY = ${JSON.stringify(env.anonKey)};\n`;

  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(configJs);
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(DASHBOARD_DIR, rel);
    const allowed = rel === 'index.html' || /^assets\/[a-z0-9-]+\.(woff2|svg|png)$/.test(rel);
    if (!allowed || !file.startsWith(DASHBOARD_DIR + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': DASHBOARD_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new CloudError(`Port ${port} is already in use.`, `Open http://127.0.0.1:${port} if it's already running, or pass --port 5545.`);
    }
    throw error;
  }

  const url = `http://127.0.0.1:${port}`;
  log.ok(`Team dashboard running at ${pc.bold(url)}`);
  log.dim(`Connected to ${env.url}. Press Ctrl+C to stop.`);
  if (flags['no-open'] !== true) openBrowser(url);
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return new Promise(() => {});
}

// PGRST202 = PostgREST can't find the function: the project still runs an
// older cloud/schema.sql, which is the one fix the user can't guess.
function rpcError(prefix, error) {
  if (error.code === 'PGRST202') {
    return new CloudError(
      `${prefix}: this Narrately Cloud project is on an older schema.`,
      'Re-run cloud/schema.sql in the Supabase SQL editor (safe to re-run), then try again.',
    );
  }
  return new CloudError(`${prefix}: ${error.message}`);
}

const ACTIONS = {
  signup: () => signup(),
  login: () => login(),
  logout: () => logout(),
  status: () => status(),
  org: (positionals) => setOrg(positionals),
  'create-org': (positionals) => createOrg(positionals),
  invite: () => invite(),
  join: (positionals) => join(positionals),
  members: () => members(),
  dashboard: (positionals, flags) => dashboard(flags),
};

export const CLOUD_ACTIONS_HELP =
  'signup | login | create-org <name> | invite | join <code> | members | org [org-id] | dashboard | status | logout';

export default async function cloudCommand({ positionals, flags }) {
  const name = positionals[0] ?? 'status';
  const action = ACTIONS[name];
  if (!action) {
    log.error(`Unknown cloud action: ${name}`);
    log.dim(`Actions: ${CLOUD_ACTIONS_HELP}`);
    process.exitCode = 1;
    return;
  }
  try {
    await action(positionals, flags);
  } catch (error) {
    if (!(error instanceof CloudError)) throw error;
    log.error(error.message);
    if (error.hint) log.dim(error.hint);
    process.exitCode = 1;
  }
}
