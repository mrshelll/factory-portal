-- Factory connection: the factory (with the service_role secret key, only on the owner's computer)
-- publishes pieces to people and collects their responses. Browser access is unchanged.
--
-- Adds: the demo_review kind, members' display_name, the replaced assignment status, partial and
-- fetched_at on responses, and the factory-only functions factory_preview, factory_publish,
-- factory_fetch and factory_mark_fetched (execute for service_role only), plus keep_alive() for the
-- scheduled ping with the publishable key. Safe to re-run: every step is idempotent.

-- ---------------------------------------------------------------------------------------------
-- Columns and states
-- ---------------------------------------------------------------------------------------------

alter table public.pieces drop constraint if exists pieces_kind_check;
alter table public.pieces add constraint pieces_kind_check
  check (kind in ('questions', 'flow_review', 'demo_review'));

alter table public.project_members add column if not exists display_name text;
-- unique (project_id, email) already exists as project_members_project_id_email_key.

alter table public.piece_assignments drop constraint if exists piece_assignments_status_check;
alter table public.piece_assignments add constraint piece_assignments_status_check
  check (status in ('pending', 'in_progress', 'submitted', 'replaced'));

alter table public.piece_responses add column if not exists partial boolean not null default false;
alter table public.piece_responses add column if not exists fetched_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- submit_response: a tab still open on a replaced version can send; the row is stored and the
-- assignment stays replaced. Only the status update changes.
-- ---------------------------------------------------------------------------------------------

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
  set status = case when status = 'replaced' then 'replaced' else 'submitted' end, updated_at = now()
  where piece_id = p_piece_id and member_id = v_member_id;

  update public.project_members
  set user_id = auth.uid()
  where id = v_member_id and user_id is null;

  return v_response_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_preview: read-only summary before publishing. For each person: the known email (given,
-- or found by display_name, case-insensitive), whether they are already a member, and their open
-- (pending or in_progress) assignments of the same kind in that project.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_preview(p_project_slug text, p_kind text, p_people jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_person jsonb;
  v_email text;
  v_display_name text;
  v_member_id uuid;
  v_member_email text;
  v_member_display_name text;
  v_matches integer;
  v_open jsonb;
  v_people jsonb := '[]'::jsonb;
begin
  if p_kind is null or p_kind not in ('questions', 'flow_review', 'demo_review') then
    raise exception 'factory_preview: unknown kind %', coalesce(p_kind, '(null)') using errcode = '22023';
  end if;
  if p_people is not null and jsonb_typeof(p_people) <> 'array' then
    raise exception 'factory_preview: people must be a JSON array' using errcode = '22023';
  end if;

  select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug;

  for v_person in
    select t.e from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) with ordinality as t(e, n) order by t.n
  loop
    if jsonb_typeof(v_person) <> 'object' then
      raise exception 'factory_preview: each person must be a JSON object' using errcode = '22023';
    end if;
    v_email := nullif(lower(btrim(v_person ->> 'email')), '');
    v_display_name := nullif(btrim(v_person ->> 'display_name'), '');
    v_member_id := null;
    v_member_email := null;
    v_member_display_name := null;

    if v_project_id is not null then
      if v_email is not null then
        select m.id, m.email, m.display_name into v_member_id, v_member_email, v_member_display_name
        from public.project_members m
        where m.project_id = v_project_id and m.email = v_email;
      elsif v_display_name is not null then
        -- Only an unambiguous match counts: two members with the same name means "unknown".
        select count(*), (array_agg(m.id))[1], (array_agg(m.email))[1], (array_agg(m.display_name))[1]
        into v_matches, v_member_id, v_member_email, v_member_display_name
        from public.project_members m
        where m.project_id = v_project_id and lower(btrim(m.display_name)) = lower(v_display_name);
        if v_matches <> 1 then
          v_member_id := null;
          v_member_email := null;
          v_member_display_name := null;
        end if;
      end if;
    end if;

    v_open := '[]'::jsonb;
    if v_member_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'piece_id', p.id, 'title', p.title, 'revision', p.revision, 'status', a.status)
             order by a.assigned_at, p.id), '[]'::jsonb)
      into v_open
      from public.piece_assignments a
      join public.pieces p on p.id = a.piece_id
      where a.member_id = v_member_id
        and p.project_id = v_project_id
        and p.kind = p_kind
        and a.status in ('pending', 'in_progress');
    end if;

    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'display_name', coalesce(v_display_name, v_member_display_name),
      'email', coalesce(v_email, v_member_email),
      'member_exists', v_member_id is not null,
      'open', v_open));
  end loop;

  return jsonb_build_object('project_exists', v_project_id is not null, 'people', v_people);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_publish: creates or reuses the project and each member, uploads the piece and assigns it.
-- For each person, open assignments of the same kind in the project:
--   pending                                  -> replaced
--   in_progress, email in p_replace_in_progress -> its draft is stored as a partial response, then replaced
--   in_progress, otherwise                   -> kept as is (reported in kept_in_progress)
-- Everything runs in one transaction: any error leaves nothing behind.
-- Concurrency: the project row is locked (two publishes of one project run one after the other), and
-- the open assignments and the draft being collected are locked, so a save_draft or submit_response
-- that races with the publish waits for it and then sees the final status.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_publish(
  p_project_slug text,
  p_project_name text,
  p_kind text,
  p_title text,
  p_revision text,
  p_html text,
  p_people jsonb,
  p_replace_in_progress text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_piece_id uuid;
  v_replace text[];
  v_person jsonb;
  v_email text;
  v_display_name text;
  v_member_id uuid;
  v_member_display_name text;
  v_open record;
  v_storage jsonb;
  v_response_id uuid;
  v_replaced jsonb;
  v_partials jsonb;
  v_kept jsonb;
  v_people jsonb := '[]'::jsonb;
begin
  -- Validate everything before the first write.
  if p_project_slug is null or btrim(p_project_slug) = '' then
    raise exception 'factory_publish: project slug is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('questions', 'flow_review', 'demo_review') then
    raise exception 'factory_publish: unknown kind %', coalesce(p_kind, '(null)') using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'factory_publish: title is required' using errcode = '22023';
  end if;
  if p_html is null or btrim(p_html) = '' then
    raise exception 'factory_publish: html is required' using errcode = '22023';
  end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception 'factory_publish: people must be a non-empty JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_people) as t(e)
    where jsonb_typeof(t.e) <> 'object' or coalesce(btrim(t.e ->> 'email'), '') = ''
  ) then
    raise exception 'factory_publish: every person needs an email' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_people) as t(e)
    where lower(btrim(t.e ->> 'email')) !~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ) then
    raise exception 'factory_publish: an email is not valid' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct lower(btrim(t.e ->> 'email')))
      from jsonb_array_elements(p_people) as t(e)) then
    raise exception 'factory_publish: the same email appears twice' using errcode = '22023';
  end if;

  select coalesce(array_agg(lower(btrim(x))), '{}'::text[]) into v_replace
  from unnest(coalesce(p_replace_in_progress, '{}'::text[])) as x
  where x is not null;

  -- Project: reuse (and lock) it, or create it.
  select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug for update;
  if v_project_id is null then
    if p_project_name is null or btrim(p_project_name) = '' then
      raise exception 'factory_publish: project name is required to create project %', p_project_slug
        using errcode = '22023';
    end if;
    insert into public.projects (slug, name, language)
    values (p_project_slug, btrim(p_project_name), 'es')
    on conflict (slug) do nothing
    returning id into v_project_id;
    if v_project_id is null then
      -- Created by a concurrent publish in the meantime.
      select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug for update;
    end if;
  end if;

  insert into public.pieces (project_id, kind, title, revision, language, html)
  values (v_project_id, p_kind, p_title, p_revision, 'es', p_html)
  returning id into v_piece_id;

  for v_person in
    select t.e from jsonb_array_elements(p_people) with ordinality as t(e, n) order by t.n
  loop
    v_email := lower(btrim(v_person ->> 'email'));
    v_display_name := nullif(btrim(v_person ->> 'display_name'), '');

    insert into public.project_members as m (project_id, email, role, display_name)
    values (v_project_id, v_email, 'stakeholder', v_display_name)
    on conflict (project_id, email) do update
      set display_name = coalesce(excluded.display_name, m.display_name)
    returning m.id, m.display_name into v_member_id, v_member_display_name;

    v_replaced := '[]'::jsonb;
    v_partials := '[]'::jsonb;
    v_kept := '[]'::jsonb;

    for v_open in
      select a.piece_id, a.status
      from public.piece_assignments a
      join public.pieces p on p.id = a.piece_id
      where a.member_id = v_member_id
        and p.project_id = v_project_id
        and p.kind = p_kind
        and p.id <> v_piece_id
        and a.status in ('pending', 'in_progress')
      order by a.assigned_at, a.piece_id
      for update of a
    loop
      if v_open.status = 'pending' then
        update public.piece_assignments
        set status = 'replaced', updated_at = now()
        where piece_id = v_open.piece_id and member_id = v_member_id;
        v_replaced := v_replaced || to_jsonb(v_open.piece_id);
      elsif v_email = any (v_replace) then
        select d.storage into v_storage
        from public.piece_drafts d
        where d.piece_id = v_open.piece_id and d.member_id = v_member_id
        for update;
        if found then
          insert into public.piece_responses (piece_id, member_id, payload, partial)
          values (v_open.piece_id, v_member_id,
                  jsonb_build_object('format', 'factory-draft/1', 'storage', v_storage), true)
          returning id into v_response_id;
          v_partials := v_partials || to_jsonb(v_response_id);
        end if;
        update public.piece_assignments
        set status = 'replaced', updated_at = now()
        where piece_id = v_open.piece_id and member_id = v_member_id;
        v_replaced := v_replaced || to_jsonb(v_open.piece_id);
      else
        v_kept := v_kept || to_jsonb(v_open.piece_id);
      end if;
    end loop;

    insert into public.piece_assignments (piece_id, member_id, status)
    values (v_piece_id, v_member_id, 'pending');

    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'email', v_email,
      'display_name', v_member_display_name,
      'member_id', v_member_id,
      'replaced', v_replaced,
      'partials', v_partials,
      'kept_in_progress', v_kept));
  end loop;

  return jsonb_build_object('piece_id', v_piece_id, 'people', v_people);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_fetch: responses of a project not yet collected by the factory, oldest first.
-- An unknown slug returns [].
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_fetch(p_project_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'response_id', r.id,
           'piece_id', p.id,
           'kind', p.kind,
           'title', p.title,
           'revision', p.revision,
           'email', m.email,
           'display_name', m.display_name,
           'payload', r.payload,
           'partial', r.partial,
           'submitted_at', r.submitted_at)
         order by r.submitted_at, r.id), '[]'::jsonb)
  from public.piece_responses r
  join public.pieces p on p.id = r.piece_id
  join public.projects pr on pr.id = p.project_id
  join public.project_members m on m.id = r.member_id
  where pr.slug = p_project_slug
    and r.fetched_at is null;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_mark_fetched: marks responses as collected; only fetched_at changes, never the payload.
-- Already-marked ids are not touched again, so the count is how many this call marked.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_mark_fetched(p_response_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  update public.piece_responses
  set fetched_at = now()
  where id = any (coalesce(p_response_ids, '{}'::uuid[]))
    and fetched_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- keep_alive: a trivial query so the scheduled ping keeps the project awake. It reads nothing, so
-- it runs with the caller's rights (security invoker) and is safe to expose to anon.
-- ---------------------------------------------------------------------------------------------

create or replace function public.keep_alive()
returns integer
language sql
stable
security invoker
set search_path = ''
as $function$
  select 1;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Supabase default privileges give new functions to anon, authenticated and service_role,
-- and Postgres gives them to PUBLIC: revoke first, then grant only what each caller needs.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.factory_preview(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.factory_publish(text, text, text, text, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.factory_fetch(text) from public, anon, authenticated;
revoke all on function public.factory_mark_fetched(uuid[]) from public, anon, authenticated;

grant execute on function public.factory_preview(text, text, jsonb) to service_role;
grant execute on function public.factory_publish(text, text, text, text, text, text, jsonb, text[]) to service_role;
grant execute on function public.factory_fetch(text) to service_role;
grant execute on function public.factory_mark_fetched(uuid[]) to service_role;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
