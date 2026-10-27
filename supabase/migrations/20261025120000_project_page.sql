-- Project page: the portal records when a person first opens a piece, and the owner of a project
-- reads how it goes. Browser access for people is unchanged: no policy is added to any table, a
-- person keeps reading only their own rows, and the owner reads through functions that check the
-- ownership first.
--
-- Adds: first_opened_at on assignments, private.owned_project_ids, mark_piece_opened for the person,
-- the owner's read-only functions owner_projects, owner_project and owner_piece (execute for
-- authenticated only), and the factory-only factory_set_owner (execute for service_role only).
-- Drafts never reach the owner: nothing from piece_drafts, no partial response, no storage of a
-- change request. Safe to re-run: every step is idempotent.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------

-- Null for every assignment from before this migration: the portal shows no opening date for them.
alter table public.piece_assignments add column if not exists first_opened_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- owned_project_ids: the projects where the caller (by the email of the session) is the owner.
-- ---------------------------------------------------------------------------------------------

create or replace function private.owned_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select m.project_id
  from public.project_members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and m.role = 'owner'
$function$;

-- ---------------------------------------------------------------------------------------------
-- mark_piece_opened: the assigned person opened the piece in the portal. Only the first time
-- counts; status and updated_at are never touched. 42501 when the piece is not the caller's.
-- ---------------------------------------------------------------------------------------------

create or replace function public.mark_piece_opened(p_piece_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_id uuid := private.assigned_member_id(p_piece_id);
begin
  update public.piece_assignments
  set first_opened_at = now()
  where piece_id = p_piece_id
    and member_id = v_member_id
    and first_opened_at is null;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- owner_projects: the caller's owned projects, by name, each with its people (the distinct members
-- with at least one assignment in it, the owner included when assigned: the ones owner_project lists
-- per piece) and the date of its newest send (partial responses are drafts and do not count). [] when
-- the caller owns none.
-- ---------------------------------------------------------------------------------------------

create or replace function public.owner_projects()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id,
           'slug', pr.slug,
           'name', pr.name,
           'language', pr.language,
           'people', (select count(distinct a.member_id)
                      from public.piece_assignments a
                      join public.pieces p on p.id = a.piece_id
                      where p.project_id = pr.id),
           'last_response_at', (select max(r.submitted_at)
                                from public.piece_responses r
                                join public.pieces p on p.id = r.piece_id
                                where p.project_id = pr.id and not r.partial))
         order by pr.name, pr.slug), '[]'::jsonb)
  from public.projects pr
  where pr.id in (select private.owned_project_ids());
$function$;

-- ---------------------------------------------------------------------------------------------
-- owner_project: one owned project with its members, its pieces (newest first, without the html)
-- and, per piece, every assignment with its dates. sent_at is the date of the assignment's newest
-- send (newest by (submitted_at, id), partial responses excluded) and readable says whether that
-- send kept its storage, so the piece can open read-only with it. change_requests carry the text
-- the person wrote and whether it was a late send, never its payload nor its storage.
-- 42501 when the caller is not the owner of the project.
-- ---------------------------------------------------------------------------------------------

create or replace function public.owner_project(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_project jsonb;
  v_members jsonb;
  v_pieces jsonb;
  v_change_requests jsonb;
begin
  if p_project_id is null or p_project_id not in (select private.owned_project_ids()) then
    raise exception 'owner_project: not the project owner' using errcode = '42501';
  end if;

  select jsonb_build_object('id', pr.id, 'slug', pr.slug, 'name', pr.name, 'language', pr.language)
  into v_project
  from public.projects pr
  where pr.id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'display_name', m.display_name, 'email', m.email, 'role', m.role)
         order by m.created_at, m.id), '[]'::jsonb)
  into v_members
  from public.project_members m
  where m.project_id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'kind', p.kind,
           'title', p.title,
           'revision', p.revision,
           'created_at', p.created_at,
           'assignments', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'member_id', a.member_id,
                      'status', a.status,
                      'assigned_at', a.assigned_at,
                      'updated_at', a.updated_at,
                      'first_opened_at', a.first_opened_at,
                      'sent_at', s.submitted_at,
                      'readable', coalesce(s.readable, false))
                    order by a.assigned_at, a.member_id), '[]'::jsonb)
             from public.piece_assignments a
             left join lateral (
               select r.submitted_at, r.storage is not null as readable
               from public.piece_responses r
               where r.piece_id = a.piece_id and r.member_id = a.member_id and not r.partial
               order by r.submitted_at desc, r.id desc
               limit 1
             ) s on true
             where a.piece_id = p.id))
         order by p.created_at desc, p.id desc), '[]'::jsonb)
  into v_pieces
  from public.pieces p
  where p.project_id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'piece_id', c.piece_id,
           'member_id', c.member_id,
           'text', c.text,
           'late', c.late,
           'created_at', c.created_at)
         order by c.created_at, c.id), '[]'::jsonb)
  into v_change_requests
  from public.piece_change_requests c
  join public.pieces p on p.id = c.piece_id
  where p.project_id = p_project_id;

  return jsonb_build_object(
    'project', v_project,
    'members', v_members,
    'pieces', v_pieces,
    'change_requests', v_change_requests);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- owner_piece: one person's piece in an owned project, to open it read-only. response is the
-- person's newest send (newest by (submitted_at, id), partial responses excluded) when it kept its
-- storage, else null: an older send is never shown in its place, it would pass an outdated send as
-- what the person sent. 42501 when the caller is not the owner of the piece's project (or the
-- piece does not exist); P0002 when that member has no assignment on that piece.
-- ---------------------------------------------------------------------------------------------

create or replace function public.owner_piece(p_piece_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_piece jsonb;
  v_member jsonb;
  v_status text;
  v_response jsonb;
begin
  select p.project_id into v_project_id from public.pieces p where p.id = p_piece_id;
  if v_project_id is null or v_project_id not in (select private.owned_project_ids()) then
    raise exception 'owner_piece: not the project owner' using errcode = '42501';
  end if;

  select a.status, jsonb_build_object('id', m.id, 'display_name', m.display_name)
  into v_status, v_member
  from public.piece_assignments a
  join public.project_members m on m.id = a.member_id and m.project_id = v_project_id
  where a.piece_id = p_piece_id and a.member_id = p_member_id;
  if not found then
    raise exception 'owner_piece: not assigned' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
           'id', p.id, 'project_id', p.project_id, 'kind', p.kind, 'title', p.title,
           'revision', p.revision, 'language', p.language, 'created_at', p.created_at, 'html', p.html)
  into v_piece
  from public.pieces p
  where p.id = p_piece_id;

  select case when r.storage is not null
              then jsonb_build_object('id', r.id, 'submitted_at', r.submitted_at, 'storage', r.storage)
         end
  into v_response
  from public.piece_responses r
  where r.piece_id = p_piece_id and r.member_id = p_member_id and not r.partial
  order by r.submitted_at desc, r.id desc
  limit 1;

  return jsonb_build_object(
    'piece', v_piece,
    'member', v_member,
    'status', v_status,
    'response', v_response);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- factory_set_owner: the factory makes the owner's portal email the owner of a project. The email
-- is trimmed and lowercased and must look like one (22023 otherwise, before anything is written).
-- An unknown slug writes nothing. A member who already exists (a stakeholder who received pieces)
-- becomes the owner, keeping their display_name when none is given.
-- ---------------------------------------------------------------------------------------------

create or replace function public.factory_set_owner(p_project_slug text, p_email text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(p_email));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_project_id uuid;
  v_member_id uuid;
begin
  if coalesce(v_email, '') = '' then
    raise exception 'factory_set_owner: the email is required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'factory_set_owner: the email is not valid' using errcode = '22023';
  end if;

  select pr.id into v_project_id from public.projects pr where pr.slug = p_project_slug;
  if v_project_id is null then
    return jsonb_build_object('project_exists', false, 'member_id', null);
  end if;

  insert into public.project_members as m (project_id, email, role, display_name)
  values (v_project_id, v_email, 'owner', v_display_name)
  on conflict (project_id, email) do update
    set role = 'owner',
        display_name = coalesce(excluded.display_name, m.display_name)
  returning m.id into v_member_id;

  return jsonb_build_object('project_exists', true, 'member_id', v_member_id);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Supabase default privileges give new functions to anon, authenticated and service_role,
-- and Postgres gives them to PUBLIC: revoke first, then grant only what each caller needs.
-- ---------------------------------------------------------------------------------------------

revoke all on function private.owned_project_ids() from public, anon, authenticated, service_role;
revoke all on function public.mark_piece_opened(uuid) from public, anon, authenticated, service_role;
revoke all on function public.owner_projects() from public, anon, authenticated, service_role;
revoke all on function public.owner_project(uuid) from public, anon, authenticated, service_role;
revoke all on function public.owner_piece(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.factory_set_owner(text, text, text) from public, anon, authenticated, service_role;

grant execute on function private.owned_project_ids() to authenticated;
grant execute on function public.mark_piece_opened(uuid) to authenticated;
grant execute on function public.owner_projects() to authenticated;
grant execute on function public.owner_project(uuid) to authenticated;
grant execute on function public.owner_piece(uuid, uuid) to authenticated;
grant execute on function public.factory_set_owner(text, text, text) to service_role;

-- PostgREST reads the schema once: reload it so the new functions are callable at once.
notify pgrst, 'reload schema';
