-- Baseline: snapshot of the live Supabase project `factory` as of 2026-10-16.
--
-- This file is NOT applied to `factory` (it already has this schema). It exists so that an empty
-- Supabase project can reproduce the portal schema from the repository: tables, checks, keys,
-- indexes, the `private` helper schema, row level security policies, grants and the two browser RPCs.
-- Definitions come from pg_get_functiondef, pg_policies and information_schema.role_table_grants
-- (controller query of 2026-10-20). No data. The Supabase-managed public.rls_auto_enable() is excluded.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  language text not null default 'es',
  created_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(email)),
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('owner', 'client', 'stakeholder')),
  created_at timestamptz not null default now(),
  constraint project_members_project_id_email_key unique (project_id, email)
);

create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null,
  title text not null,
  revision text,
  language text not null,
  html text not null,
  created_at timestamptz not null default now(),
  constraint pieces_kind_check check (kind in ('questions', 'flow_review'))
);

create table public.piece_assignments (
  piece_id uuid not null references public.pieces (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  status text not null default 'pending',
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (piece_id, member_id),
  constraint piece_assignments_status_check check (status in ('pending', 'in_progress', 'submitted'))
);

create table public.piece_drafts (
  piece_id uuid not null,
  member_id uuid not null,
  storage jsonb not null default '{}'::jsonb check (octet_length(storage::text) <= 1048576),
  updated_at timestamptz not null default now(),
  primary key (piece_id, member_id),
  foreign key (piece_id, member_id)
    references public.piece_assignments (piece_id, member_id) on delete cascade
);

create table public.piece_responses (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null,
  member_id uuid not null,
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  submitted_at timestamptz not null default now(),
  foreign key (piece_id, member_id)
    references public.piece_assignments (piece_id, member_id) on delete cascade
);

create index project_members_email_idx on public.project_members (email);
create index project_members_user_id_idx on public.project_members (user_id);
create index piece_assignments_member_id_idx on public.piece_assignments (member_id);
create index piece_responses_piece_id_member_id_idx on public.piece_responses (piece_id, member_id);
create index pieces_project_id_idx on public.pieces (project_id);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.pieces enable row level security;
alter table public.piece_assignments enable row level security;
alter table public.piece_drafts enable row level security;
alter table public.piece_responses enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Table grants: the browser (authenticated) only reads; writes go through the RPCs below.
-- Supabase default privileges grant everything to anon/authenticated/service_role, so start clean.
-- service_role keeps only what the live project shows (REFERENCES, TRIGGER, TRUNCATE).
-- ---------------------------------------------------------------------------------------------

revoke all on table
  public.projects, public.project_members, public.pieces,
  public.piece_assignments, public.piece_drafts, public.piece_responses
from anon, authenticated, service_role;

grant select on table
  public.projects, public.project_members, public.pieces,
  public.piece_assignments, public.piece_drafts, public.piece_responses
to authenticated;

grant references, trigger, truncate on table
  public.projects, public.project_members, public.pieces,
  public.piece_assignments, public.piece_drafts, public.piece_responses
to service_role;

-- ---------------------------------------------------------------------------------------------
-- Private helpers (not exposed through the Data API)
-- ---------------------------------------------------------------------------------------------

create schema private;
grant usage on schema private to authenticated;

CREATE OR REPLACE FUNCTION private.current_member_ids()
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select m.id
  from public.project_members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$function$;

CREATE OR REPLACE FUNCTION private.assigned_member_id(p_piece_id uuid)
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_member_id uuid;
begin
  select a.member_id into v_member_id
  from public.piece_assignments a
  where a.piece_id = p_piece_id
    and a.member_id in (select private.current_member_ids())
  limit 1;
  if v_member_id is null then
    raise exception 'piece not assigned to caller' using errcode = '42501';
  end if;
  return v_member_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Browser RPCs
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_draft(p_piece_id uuid, p_storage jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_member_id uuid := private.assigned_member_id(p_piece_id);
begin
  insert into public.piece_drafts (piece_id, member_id, storage, updated_at)
  values (p_piece_id, v_member_id, p_storage, now())
  on conflict (piece_id, member_id)
  do update set storage = excluded.storage, updated_at = now();

  update public.piece_assignments
  set status = 'in_progress', updated_at = now()
  where piece_id = p_piece_id and member_id = v_member_id and status = 'pending';
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_response(p_piece_id uuid, p_payload jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_member_id uuid := private.assigned_member_id(p_piece_id);
  v_response_id uuid;
begin
  insert into public.piece_responses (piece_id, member_id, payload)
  values (p_piece_id, v_member_id, p_payload)
  returning id into v_response_id;

  update public.piece_assignments
  set status = 'submitted', updated_at = now()
  where piece_id = p_piece_id and member_id = v_member_id;

  update public.project_members
  set user_id = auth.uid()
  where id = v_member_id and user_id is null;

  return v_response_id;
end;
$function$;

-- Function grants: execute only for postgres (owner) and authenticated, never PUBLIC or anon.
revoke all on function private.current_member_ids() from public, anon, authenticated, service_role;
revoke all on function private.assigned_member_id(uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_draft(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.submit_response(uuid, jsonb) from public, anon, authenticated, service_role;

grant execute on function private.current_member_ids() to authenticated;
grant execute on function private.assigned_member_id(uuid) to authenticated;
grant execute on function public.save_draft(uuid, jsonb) to authenticated;
grant execute on function public.submit_response(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security: every policy is SELECT for authenticated, scoped to the caller's email.
-- ---------------------------------------------------------------------------------------------

create policy "members read their projects" on public.projects
  for select to authenticated
  using (id in (
    select m.project_id from public.project_members m
    where m.id in (select private.current_member_ids())
  ));

create policy "members read their own membership" on public.project_members
  for select to authenticated
  using (id in (select private.current_member_ids()));

create policy "members read assigned pieces" on public.pieces
  for select to authenticated
  using (id in (
    select a.piece_id from public.piece_assignments a
    where a.member_id in (select private.current_member_ids())
  ));

create policy "members read their assignments" on public.piece_assignments
  for select to authenticated
  using (member_id in (select private.current_member_ids()));

create policy "members read their drafts" on public.piece_drafts
  for select to authenticated
  using (member_id in (select private.current_member_ids()));

create policy "members read their responses" on public.piece_responses
  for select to authenticated
  using (member_id in (select private.current_member_ids()));
