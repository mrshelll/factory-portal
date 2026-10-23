-- Piece closure: when the factory collects a person's complete response, that person's piece closes
-- (status received). What the person sends after the close is never lost: it is kept as a change
-- request. Browser access is unchanged apart from the new request_change.
--
-- Adds: the received assignment status, storage on responses, the piece_change_requests table (read
-- by its own member only), private.assignment_closed, submit_response with an optional storage (a
-- send on a closed piece becomes a late change request), request_change for the person,
-- factory_publish replacing submitted and received assignments too, and the factory-only functions
-- factory_mark_received, factory_reopen, factory_fetch_change_requests and
-- factory_mark_change_requests_fetched (execute for service_role only). Safe to re-run: every step
-- is idempotent.

-- ---------------------------------------------------------------------------------------------
-- Columns and states
-- ---------------------------------------------------------------------------------------------

alter table public.piece_assignments drop constraint if exists piece_assignments_status_check;
alter table public.piece_assignments add constraint piece_assignments_status_check
  check (status in ('pending', 'in_progress', 'submitted', 'received', 'replaced'));

alter table public.piece_responses add column if not exists storage jsonb;
alter table public.piece_responses drop constraint if exists piece_responses_storage_check;
alter table public.piece_responses add constraint piece_responses_storage_check
  check (storage is null or octet_length(storage::text) <= 1048576);

-- ---------------------------------------------------------------------------------------------
-- piece_change_requests: what a person asks to change on a closed piece (text, late = false), or a
-- send that arrived after the close (payload, late = true). Rows are never deleted by the portal.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.piece_change_requests (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null,
  member_id uuid not null,
  text text,
  payload jsonb,
  storage jsonb,
  late boolean not null default false,
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  constraint piece_change_requests_assignment_fkey foreign key (piece_id, member_id)
    references public.piece_assignments (piece_id, member_id) on delete cascade,
  constraint piece_change_requests_text_check
    check (text is null or char_length(btrim(text)) between 1 and 4000),
  constraint piece_change_requests_text_or_late_check check (late or text is not null),
  constraint piece_change_requests_late_payload_check check (not late or payload is not null),
  constraint piece_change_requests_payload_check
    check (payload is null or octet_length(payload::text) <= 1048576),
  constraint piece_change_requests_storage_check
    check (storage is null or octet_length(storage::text) <= 1048576)
);

create index if not exists piece_change_requests_piece_id_member_id_idx
  on public.piece_change_requests (piece_id, member_id);

alter table public.piece_change_requests enable row level security;

drop policy if exists "members read their change requests" on public.piece_change_requests;
create policy "members read their change requests" on public.piece_change_requests
  for select to authenticated
  using (member_id in (select private.current_member_ids()));

-- Same table grants as the other tables: the browser only reads; writes go through the functions.
revoke all on table public.piece_change_requests from anon, authenticated, service_role;
grant select on table public.piece_change_requests to authenticated;
grant references, trigger, truncate on table public.piece_change_requests to service_role;

-- ---------------------------------------------------------------------------------------------
-- assignment_closed: a person's assignment is closed when the factory received it, or when a newer
-- version replaced it after the person sent a response (partial = false). A partial response (a
-- draft collected by factory_publish) does not close it: drafts are never applied, so nothing was
-- used yet. A missing assignment is not closed. Never raises.
-- ---------------------------------------------------------------------------------------------

create or replace function private.assignment_closed(p_piece_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.piece_assignments a
    where a.piece_id = p_piece_id
      and a.member_id = p_member_id
      and (a.status = 'received'
           or (a.status = 'replaced'
               and exists (
                 select 1 from public.piece_responses r
                 where r.piece_id = a.piece_id and r.member_id = a.member_id and not r.partial)))
  );
$function$;

-- ---------------------------------------------------------------------------------------------
-- submit_response: now takes the piece's storage too (optional, so an old piece that sends only the
-- payload keeps working). On a closed assignment the send is kept as a late change request with the
-- full payload and the assignment is not touched; otherwise it is a response, as before.
-- The storage is only a copy for reopening the piece read-only: when it is over 1 MB it is stored as
-- null, so the send itself (the payload) is never refused because of it.
-- The assignment row is locked first, so a send that races with factory_mark_received or
-- factory_publish waits for it and then sees the final status.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.submit_response(uuid, jsonb);

create or replace function public.submit_response(p_piece_id uuid, p_payload jsonb, p_storage jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.assigned_member_id(p_piece_id);
  v_storage jsonb := case when octet_length(p_storage::text) <= 1048576 then p_storage end;
  v_id uuid;
begin
  perform 1
  from public.piece_assignments a
  where a.piece_id = p_piece_id and a.member_id = v_member_id
  for update;

  if private.assignment_closed(p_piece_id, v_member_id) then
    insert into public.piece_change_requests (piece_id, member_id, text, payload, storage, late)
    values (p_piece_id, v_member_id, null, p_payload, v_storage, true)
    returning id into v_id;
  else
    insert into public.piece_responses (piece_id, member_id, payload, storage)
    values (p_piece_id, v_member_id, p_payload, v_storage)
    returning id into v_id;

    update public.piece_assignments
    set status = case when status = 'replaced' then 'replaced' else 'submitted' end, updated_at = now()
    where piece_id = p_piece_id and member_id = v_member_id;
  end if;

  update public.project_members
  set user_id = auth.uid()
  where id = v_member_id and user_id is null;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- request_change: the person asks to change a closed piece of theirs. Only on a closed assignment
-- (55000 otherwise); the text is required (22023 when empty or only spaces) and stored trimmed.
-- ---------------------------------------------------------------------------------------------

create or replace function public.request_change(p_piece_id uuid, p_text text, p_storage jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.assigned_member_id(p_piece_id);
  v_id uuid;
begin
  perform 1
  from public.piece_assignments a
  where a.piece_id = p_piece_id and a.member_id = v_member_id
  for update;

  if not private.assignment_closed(p_piece_id, v_member_id) then
    raise exception 'request_change: the piece is not closed' using errcode = '55000';
  end if;
  if p_text is null or p_text !~ '[^[:space:]]' then
    raise exception 'request_change: the text is required' using errcode = '22023';
  end if;

  insert into public.piece_change_requests (piece_id, member_id, text, storage, late)
  values (p_piece_id, v_member_id, btrim(p_text), p_storage, false)
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_publish: creates or reuses the project and each member, uploads the piece and assigns it.
-- For each person, the not yet replaced assignments of the same kind in the project:
--   pending, submitted, received             -> replaced
--   in_progress, email in p_replace_in_progress -> its draft is stored as a partial response, then replaced
--   in_progress, otherwise                   -> kept as is (reported in kept_in_progress)
-- submitted and received already have a response, so their draft is not collected.
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
        and a.status in ('pending', 'in_progress', 'submitted', 'received')
      order by a.assigned_at, a.piece_id
      for update of a
    loop
      if v_open.status in ('pending', 'submitted', 'received') then
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
-- factory_mark_received: closes the assignments of collected responses. A response closes its
-- assignment only when it is already marked fetched, is not partial, its assignment is submitted and
-- no other response of that assignment is newer by (submitted_at, id). Returns the ids of the
-- responses whose assignment this call closed; anything else is left as it was.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_mark_received(p_response_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids uuid[] := coalesce(p_response_ids, '{}'::uuid[]);
  v_row record;
  v_closed jsonb := '[]'::jsonb;
begin
  -- Lock the assignments first, in a fixed order, so a racing submit_response waits for the close
  -- (and a send already stored is seen as the newest response).
  perform 1
  from public.piece_assignments a
  where (a.piece_id, a.member_id) in (
    select r.piece_id, r.member_id from public.piece_responses r where r.id = any (v_ids))
  order by a.piece_id, a.member_id
  for update;

  for v_row in
    select r.id, r.piece_id, r.member_id
    from public.piece_responses r
    join public.piece_assignments a on a.piece_id = r.piece_id and a.member_id = r.member_id
    where r.id = any (v_ids)
      and r.fetched_at is not null
      and not r.partial
      and a.status = 'submitted'
      and not exists (
        select 1 from public.piece_responses n
        where n.piece_id = r.piece_id
          and n.member_id = r.member_id
          and (n.submitted_at, n.id) > (r.submitted_at, r.id))
    order by r.submitted_at, r.id
  loop
    update public.piece_assignments
    set status = 'received', updated_at = now()
    where piece_id = v_row.piece_id and member_id = v_row.member_id and status = 'submitted';
    if found then
      v_closed := v_closed || to_jsonb(v_row.id);
    end if;
  end loop;

  return v_closed;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_reopen: when the factory rejects a response it already closed, the assignment goes back
-- from received to submitted so the person can correct it. Only for the newest response of its
-- assignment; returns whether this call reopened it.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_reopen(p_response_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_piece_id uuid;
  v_member_id uuid;
  v_submitted_at timestamptz;
begin
  select r.piece_id, r.member_id, r.submitted_at into v_piece_id, v_member_id, v_submitted_at
  from public.piece_responses r
  where r.id = p_response_id;
  if not found then
    return false;
  end if;

  perform 1
  from public.piece_assignments a
  where a.piece_id = v_piece_id and a.member_id = v_member_id
  for update;

  update public.piece_assignments a
  set status = 'submitted', updated_at = now()
  where a.piece_id = v_piece_id
    and a.member_id = v_member_id
    and a.status = 'received'
    and not exists (
      select 1 from public.piece_responses n
      where n.piece_id = v_piece_id
        and n.member_id = v_member_id
        and (n.submitted_at, n.id) > (v_submitted_at, p_response_id));
  return found;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_fetch_change_requests: change requests of a project not yet collected by the factory,
-- oldest first. An unknown slug returns [].
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_fetch_change_requests(p_project_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'request_id', c.id,
           'piece_id', p.id,
           'kind', p.kind,
           'title', p.title,
           'revision', p.revision,
           'email', m.email,
           'display_name', m.display_name,
           'text', c.text,
           'late', c.late,
           'payload', c.payload,
           'storage', c.storage,
           'created_at', c.created_at)
         order by c.created_at, c.id), '[]'::jsonb)
  from public.piece_change_requests c
  join public.pieces p on p.id = c.piece_id
  join public.projects pr on pr.id = p.project_id
  join public.project_members m on m.id = c.member_id
  where pr.slug = p_project_slug
    and c.fetched_at is null;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_mark_change_requests_fetched: marks change requests as collected; only fetched_at
-- changes. Already-marked ids are not touched again, so the count is how many this call marked.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_mark_change_requests_fetched(p_request_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  update public.piece_change_requests
  set fetched_at = now()
  where id = any (coalesce(p_request_ids, '{}'::uuid[]))
    and fetched_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Supabase default privileges give new functions to anon, authenticated and service_role,
-- and Postgres gives them to PUBLIC: revoke first, then grant only what each caller needs.
-- ---------------------------------------------------------------------------------------------

revoke all on function private.assignment_closed(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.submit_response(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.request_change(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.factory_publish(text, text, text, text, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.factory_mark_received(uuid[]) from public, anon, authenticated;
revoke all on function public.factory_reopen(uuid) from public, anon, authenticated;
revoke all on function public.factory_fetch_change_requests(text) from public, anon, authenticated;
revoke all on function public.factory_mark_change_requests_fetched(uuid[]) from public, anon, authenticated;

grant execute on function private.assignment_closed(uuid, uuid) to authenticated;
grant execute on function public.submit_response(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.request_change(uuid, text, jsonb) to authenticated;
grant execute on function public.factory_publish(text, text, text, text, text, text, jsonb, text[]) to service_role;
grant execute on function public.factory_mark_received(uuid[]) to service_role;
grant execute on function public.factory_reopen(uuid) to service_role;
grant execute on function public.factory_fetch_change_requests(text) to service_role;
grant execute on function public.factory_mark_change_requests_fetched(uuid[]) to service_role;

-- PostgREST reads the schema once: reload it so the new functions and signatures are callable at once.
notify pgrst, 'reload schema';
