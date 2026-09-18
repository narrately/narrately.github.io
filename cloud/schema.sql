-- Narrately Cloud schema (Supabase / Postgres)
-- Paste into the Supabase SQL editor for a new project.
--
-- Privacy note: synced_sessions mirrors the local `sessions` table minus
-- `files` (file paths). Diffs and raw_events never leave the machine.
-- Team sync stays metadata-only, same as the local product.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

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

alter table orgs enable row level security;
alter table memberships enable row level security;
alter table synced_sessions enable row level security;

drop policy if exists "orgs: member read" on orgs;
create policy "orgs: member read" on orgs for select
  using (is_org_member(id));

drop policy if exists "memberships: self read" on memberships;
create policy "memberships: self read" on memberships for select
  using (user_id = auth.uid() or is_org_owner(org_id));

drop policy if exists "memberships: self insert" on memberships;
create policy "memberships: self insert" on memberships for insert
  with check (user_id = auth.uid());

drop policy if exists "sessions: self insert" on synced_sessions;
create policy "sessions: self insert" on synced_sessions for insert
  with check (user_id = auth.uid() and is_org_member(org_id));

drop policy if exists "sessions: self upsert" on synced_sessions;
create policy "sessions: self upsert" on synced_sessions for update
  using (user_id = auth.uid());

drop policy if exists "sessions: org read" on synced_sessions;
create policy "sessions: org read" on synced_sessions for select
  using (is_org_member(org_id));

-- Billing (Stripe). New orgs default to 'trialing' so nothing breaks before
-- Stripe is wired up. Only writes (sync) are gated on an active subscription —
-- a team that lapses keeps read access to past rollups, just can't push more.
alter table orgs add column if not exists stripe_customer_id text;
alter table orgs add column if not exists subscription_status text not null default 'trialing';

create or replace function is_org_active(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from orgs
    where id = check_org_id and subscription_status in ('trialing', 'active')
  );
$$;

drop policy if exists "sessions: self insert" on synced_sessions;
create policy "sessions: self insert" on synced_sessions for insert
  with check (user_id = auth.uid() and is_org_member(org_id) and is_org_active(org_id));

-- No update/delete policy on orgs for the anon role on purpose: only the
-- service-role key (used inside the edge functions below, never shipped to
-- the browser or CLI) may write stripe_customer_id / subscription_status.
