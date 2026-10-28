-- Decisiones: the factory publishes a few points (what was decided in a project) to a list of people;
-- each person in the list says, point by point, yes / change / no / unsure, or proposes something
-- missing, and the owner of the project reads how everyone answered. The factory collects answers
-- and proposals as it collects pieces.
--
-- Adds five tables (decision_points, decision_audience, decision_answers, decision_proposals,
-- decision_opens) with row level security on, no policy and no table privilege for anon or
-- authenticated: the browser reaches them only through the functions below. Answers are a history:
-- every answer is a new row and no function updates or deletes one, so the factory never finds
-- changed something it already collected. Silence is never stored: a person without an answer simply
-- has no row.
-- Functions for people (execute for authenticated only): private.audience_member_id,
-- decision_projects, my_decisions, answer_decision, propose_decision, mark_decisions_opened, and the
-- owner's read-only owner_decisions. Factory-only (execute for service_role only):
-- factory_publish_decisions, factory_fetch_decisions, factory_mark_decisions_fetched.
-- factory_publish, owner_project and save_draft are not touched. Safe to re-run: every step is
-- idempotent.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- The published points of each project. key: the point's identity (from the record entries it
-- covers); version: its content. A point that is no longer published stays with active = false, so
-- its answers keep their point. first_published_at: when the point last entered the section (a
-- point published again after it was removed enters again); version_published_at: when its current
-- version was published.
create table if not exists public.decision_points (
  project_id uuid not null references public.projects (id) on delete cascade,
  key text not null,
  version text not null,
  position integer not null,
  title text not null,
  decided text not null,
  basis jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  first_published_at timestamptz not null default now(),
  version_published_at timestamptz not null default now(),
  primary key (project_id, key),
  constraint decision_points_key_check check (key ~ '^[0-9a-f]{12}$'),
  constraint decision_points_version_check check (version ~ '^[0-9a-f]{12}$'),
  constraint decision_points_position_check check (position >= 1),
  constraint decision_points_basis_check
    check (jsonb_typeof(basis) = 'array' and octet_length(basis::text) <= 1048576)
);

-- Who the section goes to. Replaced by every publish; a person removed from the list keeps their
-- membership and their answers.
create table if not exists public.decision_audience (
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, member_id)
);

create index if not exists decision_audience_member_id_idx on public.decision_audience (member_id);

-- The history of answers. Insert-only: the person's current answer to a point is their newest row.
create table if not exists public.decision_answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  point_key text not null,
  point_version text not null,
  value text not null,
  comment text,
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  constraint decision_answers_point_fkey foreign key (project_id, point_key)
    references public.decision_points (project_id, key) on delete cascade,
  constraint decision_answers_point_version_check check (point_version ~ '^[0-9a-f]{12}$'),
  constraint decision_answers_value_check check (value in ('yes', 'change', 'no', 'unsure')),
  constraint decision_answers_comment_check check (char_length(comment) <= 4000),
  constraint decision_answers_comment_required_check
    check (value = 'yes' or char_length(btrim(coalesce(comment, ''))) > 0)
);

create index if not exists decision_answers_project_id_member_id_point_key_idx
  on public.decision_answers (project_id, member_id, point_key);

-- What a person says is missing from the section.
create table if not exists public.decision_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  constraint decision_proposals_text_check check (char_length(btrim(text)) between 1 and 4000)
);

create index if not exists decision_proposals_project_id_idx on public.decision_proposals (project_id);

-- When each person last opened the section (the owner's «la abrió», applied to the section).
create table if not exists public.decision_opens (
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  last_opened_at timestamptz not null default now(),
  primary key (project_id, member_id)
);

alter table public.decision_points enable row level security;
alter table public.decision_audience enable row level security;
alter table public.decision_answers enable row level security;
alter table public.decision_proposals enable row level security;
alter table public.decision_opens enable row level security;

-- No policy and no table privilege for the browser: every read and write goes through the
-- functions. service_role keeps what it has on the other tables (REFERENCES, TRIGGER, TRUNCATE).
revoke all on table
  public.decision_points, public.decision_audience, public.decision_answers,
  public.decision_proposals, public.decision_opens
from anon, authenticated, service_role;

grant references, trigger, truncate on table
  public.decision_points, public.decision_audience, public.decision_answers,
  public.decision_proposals, public.decision_opens
to service_role;

-- ---------------------------------------------------------------------------------------------
-- audience_member_id: the caller's member id in the project's list (by the email of the session).
-- 42501 when the caller is not in the list (not a member, removed, or the owner, who is never in it).
-- ---------------------------------------------------------------------------------------------

create or replace function private.audience_member_id(p_project_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid;
begin
  select a.member_id into v_member_id
  from public.decision_audience a
  where a.project_id = p_project_id
    and a.member_id in (select private.current_member_ids())
  limit 1;
  if v_member_id is null then
    raise exception 'decisions: not in the list of this project' using errcode = '42501';
  end if;
  return v_member_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- decision_projects: the projects whose list has the caller and that have at least one active
-- point, by name. [] otherwise.
-- ---------------------------------------------------------------------------------------------

create or replace function public.decision_projects()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id', pr.id,
           'slug', pr.slug,
           'name', pr.name)
         order by pr.name, pr.slug), '[]'::jsonb)
  from public.projects pr
  where exists (select 1 from public.decision_audience a
                where a.project_id = pr.id
                  and a.member_id in (select private.current_member_ids()))
    and exists (select 1 from public.decision_points p
                where p.project_id = pr.id and p.active);
$function$;

-- ---------------------------------------------------------------------------------------------
-- my_decisions: the active points of the project, in display order, each with the caller's own
-- newest answer (any version; newest by (created_at, id)) and its mark:
--   confirmed  the newest answer is yes, on the current version;
--   changed    the newest answer (any value) is on another version: the point changed since;
--   new        no answer, and the point entered the section after the caller last opened it (or
--              the caller never opened it);
--   none       otherwise.
-- Only the caller's answers: never anybody else's. 42501 when the caller is not in the list.
-- ---------------------------------------------------------------------------------------------

create or replace function public.my_decisions(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.audience_member_id(p_project_id);
  v_last_opened_at timestamptz;
  v_points jsonb;
begin
  select o.last_opened_at into v_last_opened_at
  from public.decision_opens o
  where o.project_id = p_project_id and o.member_id = v_member_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', p.key,
           'version', p.version,
           'position', p.position,
           'title', p.title,
           'decided', p.decided,
           'basis', p.basis,
           'mark', case
                     when la.value is null then
                       case when v_last_opened_at is null or p.first_published_at > v_last_opened_at
                            then 'new' else 'none' end
                     when la.point_version <> p.version then 'changed'
                     when la.value = 'yes' then 'confirmed'
                     else 'none'
                   end,
           'answer', case when la.value is null then null
                          else jsonb_build_object(
                                 'value', la.value,
                                 'comment', la.comment,
                                 'version', la.point_version,
                                 'created_at', la.created_at)
                     end)
         order by p.position, p.key), '[]'::jsonb)
  into v_points
  from public.decision_points p
  left join lateral (
    select d.value, d.comment, d.point_version, d.created_at
    from public.decision_answers d
    where d.project_id = p.project_id and d.member_id = v_member_id and d.point_key = p.key
    order by d.created_at desc, d.id desc
    limit 1
  ) la on true
  where p.project_id = p_project_id and p.active;

  return jsonb_build_object('last_opened_at', v_last_opened_at, 'points', v_points);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- answer_decision: the caller answers one point, on the version the page showed. Always a new row.
-- 42501 when the caller is not in the list; 22023 when the value is not yes, change, no or unsure,
-- when a value other than yes comes without a comment, or when the comment is over 4000 characters;
-- P0002 when the point is unknown or no longer published; PT409 when p_version is not the point's
-- current version (it changed while the person was reading: the page reloads the section). The
-- comment is stored trimmed, and one that is empty or only spaces as null.
-- The project row is locked for share first, so an answer that races with a publish waits for it and
-- then sees the new list and the new version (factory_publish_decisions locks it for update).
-- ---------------------------------------------------------------------------------------------

create or replace function public.answer_decision(
  p_project_id uuid,
  p_key text,
  p_version text,
  p_value text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid;
  v_comment text := case when p_comment ~ '[^[:space:]]' then btrim(p_comment) end;
  v_version text;
  v_active boolean;
  v_id uuid;
  v_created_at timestamptz;
begin
  perform 1 from public.projects pr where pr.id = p_project_id for share;
  v_member_id := private.audience_member_id(p_project_id);

  if p_value is null or p_value not in ('yes', 'change', 'no', 'unsure') then
    raise exception 'answer_decision: unknown value %', coalesce(p_value, '(null)') using errcode = '22023';
  end if;
  if p_value <> 'yes' and v_comment is null then
    raise exception 'answer_decision: a comment is required unless the answer is yes' using errcode = '22023';
  end if;
  if char_length(v_comment) > 4000 then
    raise exception 'answer_decision: the comment is over 4000 characters' using errcode = '22023';
  end if;

  select p.version, p.active into v_version, v_active
  from public.decision_points p
  where p.project_id = p_project_id and p.key = p_key;
  if not found or not v_active then
    raise exception 'answer_decision: the point is not published' using errcode = 'P0002';
  end if;
  if p_version is distinct from v_version then
    raise exception 'answer_decision: the point changed' using errcode = 'PT409';
  end if;

  insert into public.decision_answers (project_id, member_id, point_key, point_version, value, comment)
  values (p_project_id, v_member_id, p_key, v_version, p_value, v_comment)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object('id', v_id, 'created_at', v_created_at);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- propose_decision: the caller writes something that is missing from the section. The text is
-- required (22023 when empty or only spaces, or over 4000 characters) and stored trimmed. 42501 when
-- the caller is not in the list.
-- ---------------------------------------------------------------------------------------------

create or replace function public.propose_decision(p_project_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.audience_member_id(p_project_id);
  v_text text := btrim(p_text);
  v_id uuid;
begin
  if v_text is null or v_text !~ '[^[:space:]]' then
    raise exception 'propose_decision: the text is required' using errcode = '22023';
  end if;
  if char_length(v_text) > 4000 then
    raise exception 'propose_decision: the text is over 4000 characters' using errcode = '22023';
  end if;

  insert into public.decision_proposals (project_id, member_id, text)
  values (p_project_id, v_member_id, v_text)
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- mark_decisions_opened: the caller opened the section; every opening moves the date. 42501 when the
-- caller is not in the list.
-- ---------------------------------------------------------------------------------------------

create or replace function public.mark_decisions_opened(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.audience_member_id(p_project_id);
begin
  insert into public.decision_opens (project_id, member_id, last_opened_at)
  values (p_project_id, v_member_id, now())
  on conflict (project_id, member_id) do update set last_opened_at = excluded.last_opened_at;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- owner_decisions: how everyone answered, for the owner of the project. Read-only.
-- points: every point (the active ones in display order, then the removed ones), each with
--   counts   over the current list, by each person's newest answer on the current version; a person
--            with no answer on it counts as none (silence is never yes);
--   people   the people in the list and anyone who answered the point, each with their newest answer
--            on it (any version; current says whether it is on the current version) or null, and
--            their whole history on it, oldest first.
-- people: the list and anyone who answered, with in_audience and when they last opened the section.
-- proposals: every proposal, oldest first. No email anywhere.
-- 42501 when the caller is not the owner of the project.
-- ---------------------------------------------------------------------------------------------

create or replace function public.owner_decisions(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_points jsonb;
  v_people jsonb;
  v_proposals jsonb;
begin
  if p_project_id is null or p_project_id not in (select private.owned_project_ids()) then
    raise exception 'owner_decisions: not the project owner' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', p.key,
           'version', p.version,
           'title', p.title,
           'decided', p.decided,
           'active', p.active,
           'counts', (
             select jsonb_build_object(
                      'yes', count(*) filter (where c.value = 'yes'),
                      'change', count(*) filter (where c.value = 'change'),
                      'no', count(*) filter (where c.value = 'no'),
                      'unsure', count(*) filter (where c.value = 'unsure'),
                      'none', count(*) filter (where c.value is null))
             from public.decision_audience a
             left join lateral (
               select d.value
               from public.decision_answers d
               where d.project_id = p.project_id and d.member_id = a.member_id
                 and d.point_key = p.key and d.point_version = p.version
               order by d.created_at desc, d.id desc
               limit 1
             ) c on true
             where a.project_id = p.project_id),
           'people', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'member_id', m.id,
                      'display_name', m.display_name,
                      'in_audience', a.member_id is not null,
                      'latest', (
                        select jsonb_build_object(
                                 'value', d.value,
                                 'comment', d.comment,
                                 'version', d.point_version,
                                 'created_at', d.created_at,
                                 'current', d.point_version = p.version)
                        from public.decision_answers d
                        where d.project_id = p.project_id and d.member_id = m.id and d.point_key = p.key
                        order by d.created_at desc, d.id desc
                        limit 1),
                      'history', (
                        select coalesce(jsonb_agg(jsonb_build_object(
                                 'value', d.value,
                                 'comment', d.comment,
                                 'version', d.point_version,
                                 'created_at', d.created_at)
                               order by d.created_at, d.id), '[]'::jsonb)
                        from public.decision_answers d
                        where d.project_id = p.project_id and d.member_id = m.id and d.point_key = p.key))
                    order by m.created_at, m.id), '[]'::jsonb)
             from public.project_members m
             left join public.decision_audience a on a.project_id = m.project_id and a.member_id = m.id
             where m.project_id = p.project_id
               and (a.member_id is not null
                    or exists (select 1 from public.decision_answers d
                               where d.project_id = p.project_id and d.member_id = m.id
                                 and d.point_key = p.key))))
         order by p.active desc, p.position, p.key), '[]'::jsonb)
  into v_points
  from public.decision_points p
  where p.project_id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', m.id,
           'display_name', m.display_name,
           'in_audience', a.member_id is not null,
           'last_opened_at', o.last_opened_at)
         order by m.created_at, m.id), '[]'::jsonb)
  into v_people
  from public.project_members m
  left join public.decision_audience a on a.project_id = m.project_id and a.member_id = m.id
  left join public.decision_opens o on o.project_id = m.project_id and o.member_id = m.id
  where m.project_id = p_project_id
    and (a.member_id is not null
         or exists (select 1 from public.decision_answers d
                    where d.project_id = p_project_id and d.member_id = m.id));

  select coalesce(jsonb_agg(jsonb_build_object(
           'display_name', m.display_name,
           'text', x.text,
           'created_at', x.created_at)
         order by x.created_at, x.id), '[]'::jsonb)
  into v_proposals
  from public.decision_proposals x
  join public.project_members m on m.id = x.member_id
  where x.project_id = p_project_id;

  return jsonb_build_object('points', v_points, 'people', v_people, 'proposals', v_proposals);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_publish_decisions: publishes a version of the section, or with p_dry_run only says what it
-- would do and writes nothing (the same result either way).
-- p_points: [{key, version, title, decided, basis}] in display order (key and version: 12 hex
-- digits; title and decided: text that is not blank; basis: a JSON array; keys unique).
-- p_people: [{display_name, email}], validated as factory_publish does, and never with an owner of the
-- project (the owner reads the section and never answers it). Every error is 22023, comes before the
-- first write and never echoes an address.
-- Writes, when not a dry run: the project (created when missing, as factory_publish); each person as
-- a stakeholder member, an existing member (a client) keeping their role (only display_name is
-- updated, when given); the list replaced by p_people (a removed person keeps membership and answers); the points
-- upserted in order (version_published_at moves only when the version changes; a point that was
-- removed and comes back enters again: active and first_published_at now()); every active point
-- missing from p_points becomes inactive.
-- Result: project_id (null on a dry run for a project that does not exist yet); points: the keys
-- that are new (never published, or coming back after being removed), changed, same and removed;
-- people, in order: display_name, email, member_id (null on a dry run for a member that does not exist
-- yet), added (not in the list before), and reasons, one per point the person should be told about:
--   added    the person was not in the list: every point;
--   new      a new point;
--   changed  a changed point whose newest answer by that person is on another version (what
--            my_decisions marks changed).
-- notify is true when there is at least one reason.
-- Concurrency: a real publish locks the project row, so two publishes of one project run one after the
-- other and an answer waits for the publish (answer_decision locks the same row for share).
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_publish_decisions(
  p_project_slug text,
  p_project_name text,
  p_points jsonb,
  p_people jsonb,
  p_dry_run boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_new jsonb;
  v_changed jsonb;
  v_same jsonb;
  v_removed jsonb;
  v_person jsonb;
  v_email text;
  v_display_name text;
  v_member_id uuid;
  v_member_display_name text;
  v_added boolean;
  v_reasons jsonb;
  v_member_ids uuid[] := '{}'::uuid[];
  v_people jsonb := '[]'::jsonb;
begin
  -- Validate everything before the first write.
  if p_dry_run is null then
    raise exception 'factory_publish_decisions: dry run must be true or false' using errcode = '22023';
  end if;
  if p_project_slug is null or btrim(p_project_slug) = '' then
    raise exception 'factory_publish_decisions: project slug is required' using errcode = '22023';
  end if;
  if p_project_slug !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'factory_publish_decisions: project slug is not valid' using errcode = '22023';
  end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) = 0 then
    raise exception 'factory_publish_decisions: points must be a non-empty JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_points) as t(e)
    where jsonb_typeof(t.e) <> 'object'
       or jsonb_typeof(t.e -> 'key') is distinct from 'string'
       or (t.e ->> 'key') !~ '^[0-9a-f]{12}$'
       or jsonb_typeof(t.e -> 'version') is distinct from 'string'
       or (t.e ->> 'version') !~ '^[0-9a-f]{12}$'
       or jsonb_typeof(t.e -> 'title') is distinct from 'string'
       or (t.e ->> 'title') !~ '[^[:space:]]'
       or jsonb_typeof(t.e -> 'decided') is distinct from 'string'
       or (t.e ->> 'decided') !~ '[^[:space:]]'
       or jsonb_typeof(t.e -> 'basis') is distinct from 'array'
       or octet_length((t.e -> 'basis')::text) > 1048576
  ) then
    raise exception 'factory_publish_decisions: every point needs a key, a version, a title, what was decided and a basis array'
      using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct t.e ->> 'key') from jsonb_array_elements(p_points) as t(e)) then
    raise exception 'factory_publish_decisions: the same key appears twice' using errcode = '22023';
  end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception 'factory_publish_decisions: people must be a non-empty JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_people) as t(e)
    where jsonb_typeof(t.e) <> 'object' or coalesce(btrim(t.e ->> 'email'), '') = ''
  ) then
    raise exception 'factory_publish_decisions: every person needs an email' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_people) as t(e)
    where lower(btrim(t.e ->> 'email')) !~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ) then
    raise exception 'factory_publish_decisions: an email is not valid' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct lower(btrim(t.e ->> 'email')))
      from jsonb_array_elements(p_people) as t(e)) then
    raise exception 'factory_publish_decisions: the same email appears twice' using errcode = '22023';
  end if;

  -- Project: reuse it (locked on a real publish), or create it; a dry run never creates it.
  if p_dry_run then
    select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug;
  else
    select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug for update;
  end if;
  -- The owner never answers: an owner of the project in the list stops the publish.
  if v_project_id is not null and exists (
    select 1
    from jsonb_array_elements(p_people) as t(e)
    join public.project_members m
      on m.project_id = v_project_id and m.email = lower(btrim(t.e ->> 'email'))
    where m.role = 'owner'
  ) then
    raise exception 'factory_publish_decisions: the owner of the project cannot be in the list'
      using errcode = '22023';
  end if;
  if v_project_id is null then
    if p_project_name is null or btrim(p_project_name) = '' then
      raise exception 'factory_publish_decisions: project name is required to create project %', p_project_slug
        using errcode = '22023';
    end if;
    if not p_dry_run then
      insert into public.projects (slug, name, language)
      values (p_project_slug, btrim(p_project_name), 'es')
      on conflict (slug) do nothing
      returning id into v_project_id;
      if v_project_id is null then
        -- Created by a concurrent publish in the meantime.
        select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug for update;
      end if;
    end if;
  end if;

  -- The points against what is published now (nothing is published when there is no project yet).
  select coalesce(jsonb_agg(t.e -> 'key' order by t.n) filter (where s.key is null or not s.active), '[]'::jsonb),
         coalesce(jsonb_agg(t.e -> 'key' order by t.n)
                    filter (where s.active and s.version <> t.e ->> 'version'), '[]'::jsonb),
         coalesce(jsonb_agg(t.e -> 'key' order by t.n)
                    filter (where s.active and s.version = t.e ->> 'version'), '[]'::jsonb)
  into v_new, v_changed, v_same
  from jsonb_array_elements(p_points) with ordinality as t(e, n)
  left join public.decision_points s on s.project_id = v_project_id and s.key = t.e ->> 'key';

  select coalesce(jsonb_agg(to_jsonb(s.key) order by s.position, s.key), '[]'::jsonb)
  into v_removed
  from public.decision_points s
  where s.project_id = v_project_id
    and s.active
    and s.key not in (select t.e ->> 'key' from jsonb_array_elements(p_points) as t(e));

  -- The people, in order: what each one is told, then (on a real publish) their membership.
  for v_person in
    select t.e from jsonb_array_elements(p_people) with ordinality as t(e, n) order by t.n
  loop
    v_email := lower(btrim(v_person ->> 'email'));
    v_display_name := nullif(btrim(v_person ->> 'display_name'), '');
    v_member_id := null;
    v_member_display_name := null;
    if v_project_id is not null then
      select m.id, m.display_name into v_member_id, v_member_display_name
      from public.project_members m
      where m.project_id = v_project_id and m.email = v_email;
    end if;
    v_added := v_member_id is null
               or not exists (select 1 from public.decision_audience a
                              where a.project_id = v_project_id and a.member_id = v_member_id);

    if v_added then
      select coalesce(jsonb_agg(jsonb_build_object('key', t.e -> 'key', 'why', 'added') order by t.n), '[]'::jsonb)
      into v_reasons
      from jsonb_array_elements(p_points) with ordinality as t(e, n);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
                        'key', t.e -> 'key',
                        'why', case when s.key is null or not s.active then 'new' else 'changed' end)
                      order by t.n), '[]'::jsonb)
      into v_reasons
      from jsonb_array_elements(p_points) with ordinality as t(e, n)
      left join public.decision_points s on s.project_id = v_project_id and s.key = t.e ->> 'key'
      where s.key is null
         or not s.active
         or (s.version <> t.e ->> 'version'
             and (select d.point_version
                  from public.decision_answers d
                  where d.project_id = v_project_id and d.member_id = v_member_id and d.point_key = s.key
                  order by d.created_at desc, d.id desc
                  limit 1) <> t.e ->> 'version');
    end if;

    if not p_dry_run then
      insert into public.project_members as m (project_id, email, role, display_name)
      values (v_project_id, v_email, 'stakeholder', v_display_name)
      on conflict (project_id, email) do update
        set display_name = coalesce(excluded.display_name, m.display_name)
      returning m.id, m.display_name into v_member_id, v_member_display_name;
      v_member_ids := v_member_ids || v_member_id;
    else
      v_member_display_name := coalesce(v_display_name, v_member_display_name);
    end if;

    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'display_name', v_member_display_name,
      'email', v_email,
      'member_id', v_member_id,
      'added', v_added,
      'notify', jsonb_array_length(v_reasons) > 0,
      'reasons', v_reasons));
  end loop;

  if not p_dry_run then
    -- The list: removed people leave it first, then the new ones join.
    delete from public.decision_audience a
    where a.project_id = v_project_id and a.member_id <> all (v_member_ids);
    insert into public.decision_audience (project_id, member_id)
    select v_project_id, x.id from unnest(v_member_ids) as x(id)
    on conflict (project_id, member_id) do nothing;

    insert into public.decision_points as s
      (project_id, key, version, position, title, decided, basis, active, first_published_at, version_published_at)
    select v_project_id, t.e ->> 'key', t.e ->> 'version', t.n::integer, t.e ->> 'title', t.e ->> 'decided',
           t.e -> 'basis', true, now(), now()
    from jsonb_array_elements(p_points) with ordinality as t(e, n)
    on conflict (project_id, key) do update
      set version = excluded.version,
          position = excluded.position,
          title = excluded.title,
          decided = excluded.decided,
          basis = excluded.basis,
          active = true,
          first_published_at = case when s.active then s.first_published_at else excluded.first_published_at end,
          version_published_at = case when s.version = excluded.version then s.version_published_at
                                      else excluded.version_published_at end;

    update public.decision_points s
    set active = false
    where s.project_id = v_project_id
      and s.active
      and s.key not in (select t.e ->> 'key' from jsonb_array_elements(p_points) as t(e));
  end if;

  return jsonb_build_object(
    'project_id', v_project_id,
    'points', jsonb_build_object('new', v_new, 'changed', v_changed, 'same', v_same, 'removed', v_removed),
    'people', v_people);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_fetch_decisions: the answers and proposals of a project not yet collected by the factory,
-- oldest first, with the person's member id and display name and never their email. An unknown slug
-- returns two empty lists.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_fetch_decisions(p_project_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'member_id', d.member_id,
               'display_name', m.display_name,
               'point_key', d.point_key,
               'point_version', d.point_version,
               'value', d.value,
               'comment', d.comment,
               'created_at', d.created_at)
             order by d.created_at, d.id), '[]'::jsonb)
      from public.decision_answers d
      join public.projects pr on pr.id = d.project_id
      join public.project_members m on m.id = d.member_id
      where pr.slug = p_project_slug
        and d.fetched_at is null),
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id,
               'member_id', x.member_id,
               'display_name', m.display_name,
               'text', x.text,
               'created_at', x.created_at)
             order by x.created_at, x.id), '[]'::jsonb)
      from public.decision_proposals x
      join public.projects pr on pr.id = x.project_id
      join public.project_members m on m.id = x.member_id
      where pr.slug = p_project_slug
        and x.fetched_at is null));
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_mark_decisions_fetched: marks answers and proposals as collected; only fetched_at changes.
-- Already-marked ids are not touched again, so the count is how many rows this call marked.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_mark_decisions_fetched(p_answer_ids uuid[], p_proposal_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_answers integer;
  v_proposals integer;
begin
  update public.decision_answers
  set fetched_at = now()
  where id = any (coalesce(p_answer_ids, '{}'::uuid[]))
    and fetched_at is null;
  get diagnostics v_answers = row_count;

  update public.decision_proposals
  set fetched_at = now()
  where id = any (coalesce(p_proposal_ids, '{}'::uuid[]))
    and fetched_at is null;
  get diagnostics v_proposals = row_count;

  return v_answers + v_proposals;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Supabase default privileges give new functions to anon, authenticated and service_role,
-- and Postgres gives them to PUBLIC: revoke first, then grant only what each caller needs.
-- ---------------------------------------------------------------------------------------------

revoke all on function private.audience_member_id(uuid) from public, anon, authenticated, service_role;
revoke all on function public.decision_projects() from public, anon, authenticated, service_role;
revoke all on function public.my_decisions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.answer_decision(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.propose_decision(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_decisions_opened(uuid) from public, anon, authenticated, service_role;
revoke all on function public.owner_decisions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.factory_publish_decisions(text, text, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.factory_fetch_decisions(text) from public, anon, authenticated, service_role;
revoke all on function public.factory_mark_decisions_fetched(uuid[], uuid[]) from public, anon, authenticated, service_role;

grant execute on function private.audience_member_id(uuid) to authenticated;
grant execute on function public.decision_projects() to authenticated;
grant execute on function public.my_decisions(uuid) to authenticated;
grant execute on function public.answer_decision(uuid, text, text, text, text) to authenticated;
grant execute on function public.propose_decision(uuid, text) to authenticated;
grant execute on function public.mark_decisions_opened(uuid) to authenticated;
grant execute on function public.owner_decisions(uuid) to authenticated;
grant execute on function public.factory_publish_decisions(text, text, jsonb, jsonb, boolean) to service_role;
grant execute on function public.factory_fetch_decisions(text) to service_role;
grant execute on function public.factory_mark_decisions_fetched(uuid[], uuid[]) to service_role;

-- PostgREST reads the schema once: reload it so the new functions are callable at once.
notify pgrst, 'reload schema';
