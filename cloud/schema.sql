-- Narrately Cloud schema (Supabase / Postgres)
-- Paste the whole file into the Supabase SQL editor and run it. Safe to re-run:
-- every statement is idempotent, so re-running also upgrades an older install.
--
-- Privacy note: synced_sessions mirrors the local `sessions` table minus
-- `files` (file paths). Diffs and raw_events never leave the machine.
-- Team sync stays metadata-only, same as the local product.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Billing (Stripe). New orgs start a 14-day trial so nothing breaks before
-- Stripe is wired up. Only writes (sync) are gated on an active subscription —
-- a team that lapses keeps read access to past rollups, just can't push more.
alter table orgs add column if not exists stripe_customer_id text;
alter table orgs add column if not exists subscription_status text not null default 'trialing';
alter table orgs add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days');

create table if not exists memberships (
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references orgs(id) on delete cascade,
  role text not null default 'member', -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table if not exists synced_sessions (
  id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  org_id uuid references orgs(id) on delete cascade not null,
  project text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_sec integer not null,
  source text,
  languages text,
  saves integer not null default 0,
  lines_added integer not null default 0,
  lines_removed integer not null default 0,
  edits integer not null default 0,
  debug_sec integer not null default 0,
  errors_resolved integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (id, user_id)
);
create index if not exists idx_synced_sessions_org on synced_sessions(org_id, started_at);

-- Multi-use join codes, valid for 7 days. No RLS policies on purpose: they are
-- only ever read or written through create_invite() / accept_invite() below.
create table if not exists invites (
  code text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  uses integer not null default 0
);

-- Security-definer helpers so membership checks don't re-trigger RLS on
-- `memberships` from inside its own policy (that causes infinite recursion
-- in Postgres — these functions run with elevated privilege and bypass it).
create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

create or replace function is_org_owner(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships
    where org_id = check_org_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- 'past_due' still counts as active: Stripe retries failed payments for a
-- while, and a declined card shouldn't cut a team off mid-week.
create or replace function is_org_active(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from orgs
    where id = check_org_id
      and (subscription_status in ('active', 'past_due')
           or (subscription_status = 'trialing' and trial_ends_at > now()))
  );
$$;

alter table orgs enable row level security;
alter table memberships enable row level security;
alter table synced_sessions enable row level security;
alter table invites enable row level security;

drop policy if exists "orgs: member read" on orgs;
create policy "orgs: member read" on orgs for select
  using (is_org_member(id));

drop policy if exists "memberships: self read" on memberships;
create policy "memberships: self read" on memberships for select
  using (user_id = auth.uid() or is_org_owner(org_id));

-- Joining an org only happens through create_org() / accept_invite(). The old
-- self-insert policy let any signed-in user add themselves to any org — as
-- owner, even — just by knowing its id.
drop policy if exists "memberships: self insert" on memberships;

drop policy if exists "sessions: self insert" on synced_sessions;
create policy "sessions: self insert" on synced_sessions for insert
  with check (user_id = auth.uid() and is_org_member(org_id) and is_org_active(org_id));

-- The with-check matters: without it an update could move a row into an org
-- the user isn't in, or slip past the billing gate that inserts go through.
drop policy if exists "sessions: self upsert" on synced_sessions;
drop policy if exists "sessions: self update" on synced_sessions;
create policy "sessions: self update" on synced_sessions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_org_member(org_id) and is_org_active(org_id));

drop policy if exists "sessions: self delete" on synced_sessions;
create policy "sessions: self delete" on synced_sessions for delete
  using (user_id = auth.uid());

drop policy if exists "sessions: org read" on synced_sessions;
create policy "sessions: org read" on synced_sessions for select
  using (is_org_member(org_id));

-- No update/delete policy on orgs for the anon role on purpose: only the
-- service-role key (used inside the edge functions, never shipped to the
-- browser or CLI) may write stripe_customer_id / subscription_status.

create or replace function create_org(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if coalesce(trim(org_name), '') = '' then
    raise exception 'org name must not be empty';
  end if;
  insert into orgs (name) values (trim(org_name)) returning id into new_org_id;
  insert into memberships (user_id, org_id, role) values (auth.uid(), new_org_id, 'owner');
  return new_org_id;
end;
$$;

create or replace function create_invite(for_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not is_org_owner(for_org_id) then
    raise exception 'only an org owner can create invites';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into invites (code, org_id, created_by) values (new_code, for_org_id, auth.uid());
  return new_code;
end;
$$;

create or replace function accept_invite(invite_code text)
returns table (joined_org_id uuid, joined_org_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into invite from invites
    where code = upper(trim(invite_code)) and expires_at > now();
  if not found then
    raise exception 'invite code is invalid or has expired';
  end if;
  insert into memberships (user_id, org_id, role)
    values (auth.uid(), invite.org_id, 'member')
    on conflict do nothing;
  update invites set uses = uses + 1 where code = invite.code;
  return query select o.id, o.name from orgs o where o.id = invite.org_id;
end;
$$;

-- Resolves member emails for the dashboard. auth.users isn't readable through
-- the API, so this runs as definer and only answers for orgs the caller is in.
create or replace function org_members(for_org_id uuid)
returns table (member_id uuid, email text, role text, joined_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, u.email::text, m.role, m.joined_at
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = for_org_id and is_org_member(for_org_id)
  order by m.joined_at;
$$;

create or replace function remove_member(from_org_id uuid, member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_owner(from_org_id) then
    raise exception 'only an org owner can remove members';
  end if;
  if member_id = auth.uid() then
    raise exception 'owners cannot remove themselves';
  end if;
  delete from memberships where org_id = from_org_id and user_id = member_id;
end;
$$;

-- Replaces the caller's sessions inside [window_start, window_end) in one
-- transaction. Sessions are rebuilt from raw events on every sync, so a
-- session can grow, merge with a neighbour, or disappear — replacing the
-- window keeps the cloud copy exact instead of leaving stale fragments.
-- Security invoker: the RLS policies above (membership, billing gate) apply.
create or replace function sync_sessions(
  for_org_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  session_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  written integer;
begin
  delete from synced_sessions
    where user_id = auth.uid()
      and org_id = for_org_id
      and started_at >= window_start
      and started_at < window_end;

  insert into synced_sessions (
    id, user_id, org_id, project, started_at, ended_at, duration_sec, source, languages,
    saves, lines_added, lines_removed, edits, debug_sec, errors_resolved
  )
  select
    s.id, auth.uid(), for_org_id, s.project, s.started_at, s.ended_at, s.duration_sec, s.source, s.languages,
    coalesce(s.saves, 0), coalesce(s.lines_added, 0), coalesce(s.lines_removed, 0),
    coalesce(s.edits, 0), coalesce(s.debug_sec, 0), coalesce(s.errors_resolved, 0)
  from jsonb_to_recordset(session_rows) as s(
    id text, project text, started_at timestamptz, ended_at timestamptz, duration_sec integer,
    source text, languages text, saves integer, lines_added integer, lines_removed integer,
    edits integer, debug_sec integer, errors_resolved integer
  )
  where s.started_at >= window_start and s.started_at < window_end;

  get diagnostics written = row_count;
  return written;
end;
$$;
