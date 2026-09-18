import fs from 'node:fs';
import { input, password } from '@inquirer/prompts';
import { log, pc } from '../core/logger.js';
import { CLOUD_PATH, ensureHome } from '../core/paths.js';

export function cloudEnv() {
  const url = process.env.NARRATELY_CLOUD_URL;
  const anonKey = process.env.NARRATELY_CLOUD_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
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

function requireEnv() {
  const env = cloudEnv();
  if (!env) {
    log.error('Narrately Cloud is not configured.');
    log.dim('Set NARRATELY_CLOUD_URL and NARRATELY_CLOUD_ANON_KEY (see cloud/README.md).');
    process.exitCode = 1;
    return null;
  }
  return env;
}

async function client(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.url, env.anonKey);
}

async function signup() {
  const env = requireEnv();
  if (!env) return;
  const supabase = await client(env);

  const email = await input({ message: 'Email:' });
  const pass = await password({ message: 'Password (min 8 chars):' });

  const { error } = await supabase.auth.signUp({ email, password: pass });
  if (error) {
    log.error(`Sign up failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  log.ok('Account created.');
  log.dim('Check your email to confirm it, then run `narrately cloud login`.');
}

async function login() {
  const env = requireEnv();
  if (!env) return;
  const supabase = await client(env);

  const email = await input({ message: 'Email:' });
  const pass = await password({ message: 'Password:' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    log.error(`Login failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  saveCloudSession({
    email,
    user_id: data.user.id,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  log.ok(`Logged in as ${pc.bold(email)}.`);
  log.dim('Next: `narrately cloud org <org-id>` to set your team, then `narrately sync`.');
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
  log.dim(`Org: ${session.org_id ?? '(none set — run `narrately cloud org <org-id>`)'}`);
}

function setOrg(positionals) {
  const orgId = positionals[1];
  if (!orgId) {
    log.error('Usage: narrately cloud org <org-id>');
    process.exitCode = 1;
    return;
  }
  const session = loadCloudSession();
  if (!session) {
    log.error('Not logged in. Run `narrately cloud login` first.');
    process.exitCode = 1;
    return;
  }
  session.org_id = orgId;
  saveCloudSession(session);
  log.ok(`Org set to ${pc.bold(orgId)}. Run \`narrately sync\` to push activity.`);
}

const ACTIONS = {
  signup: () => signup(),
  login: () => login(),
  logout: () => logout(),
  status: () => status(),
  org: (positionals) => setOrg(positionals),
};

export default async function cloudCommand({ positionals }) {
  const name = positionals[0] ?? 'status';
  const action = ACTIONS[name];
  if (!action) {
    log.error(`Unknown cloud action: ${name}`);
    log.dim('Actions: signup | login | logout | status | org <org-id>');
    process.exitCode = 1;
    return;
  }
  await action(positionals);
}
