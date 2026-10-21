-- Checks for the factory connection (migration 20261021000000_factory_connection.sql).
--
-- Run as ONE request against the `factory` database (Supabase MCP execute_sql, or psql as postgres).
-- Everything happens inside `begin; ... rollback;`: no data is left behind. Every failure raises an
-- exception; success prints NOTICE "factory-connection: ok 9 checks" and returns one row with the
-- same text. People are simulated with JWT claims that carry an email and no `sub`, so auth.uid() is
-- null and submit_response never writes a user_id. All names start with fc-check so nothing collides
-- with real data.

begin;

do $check$
declare
  v_admin constant text := current_user;
  v_slug constant text := 'fc-check-project';
  v_ana constant text := 'fc-check-ana@example.invalid';
  v_beto constant text := 'fc-check-beto@example.invalid';
  v_carla constant text := 'fc-check-carla@example.invalid';
  v_draft constant jsonb := '{"fc-check:answers": {"q1": "draft answer"}}';
  v_final constant jsonb := '{"fc-check:answers": {"q1": "final answer"}}';
  v_checks integer := 0;
  v_role text;
  v_fn text;
  v_res jsonb;
  v_person jsonb;
  v_elem jsonb;
  v_count integer;
  v_project_id uuid;
  v_ana_id uuid;
  v_beto_id uuid;
  v_carla_id uuid;
  v_piece1 uuid;
  v_piece2 uuid;
  v_piece3 uuid;
  v_piece4 uuid;
  v_demo1 uuid;
  v_demo2 uuid;
  v_beto_piece uuid;
  v_partial_id uuid;
  v_submitted_id uuid;
  v_status text;
begin
  if exists (select 1 from public.projects where slug = v_slug) then
    raise exception 'factory-connection: project % already exists; the checks need it absent', v_slug;
  end if;

  -- (a) anon and authenticated get 42501 on every factory_* function; service_role may execute them;
  --     all are security definer with an empty search_path; keep_alive() answers 1 to anon.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['factory_preview', 'factory_publish', 'factory_fetch', 'factory_mark_fetched'] loop
      begin
        perform set_config('role', v_role, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('role', v_role, 'email', v_ana)::text, true);
        case v_fn
          when 'factory_preview' then
            perform public.factory_preview(v_slug, 'questions', '[]'::jsonb);
          when 'factory_publish' then
            perform public.factory_publish(v_slug, 'FC Check Project', 'questions', 'x', null, '<p>x</p>',
              jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), '{}'::text[]);
          when 'factory_fetch' then
            perform public.factory_fetch(v_slug);
          when 'factory_mark_fetched' then
            perform public.factory_mark_fetched('{}'::uuid[]);
        end case;
        raise exception 'factory-connection (a): % can execute %', v_role, v_fn;
      exception when insufficient_privilege then
        null;
      end;
      perform set_config('role', v_admin, true);
      perform set_config('request.jwt.claims', '', true);
    end loop;
  end loop;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('factory_preview', 'factory_publish', 'factory_fetch', 'factory_mark_fetched')
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_count <> 4 then
    raise exception 'factory-connection (a): expected 4 factory_* functions with definer, empty search_path and service_role-only execute, found %', v_count;
  end if;

  perform set_config('role', 'anon', true);
  if public.keep_alive() is distinct from 1 then
    raise exception 'factory-connection (a): keep_alive() did not return 1 to anon';
  end if;
  perform set_config('role', v_admin, true);
  v_checks := v_checks + 1;

  -- (b) publish on a new slug creates the project, the member with display_name, the piece and a
  --     pending assignment.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'questions', 'Questions round 1', '1',
    '<p>round 1</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_piece1 := (v_res ->> 'piece_id')::uuid;

  select id into v_project_id from public.projects
  where slug = v_slug and name = 'FC Check Project' and language = 'es';
  if v_project_id is null then
    raise exception 'factory-connection (b): project not created with language es';
  end if;
  select id into v_ana_id from public.project_members
  where project_id = v_project_id and email = v_ana and display_name = 'Ana' and role = 'stakeholder';
  if v_ana_id is null then
    raise exception 'factory-connection (b): member not created with display_name and stakeholder role';
  end if;
  if not exists (
    select 1 from public.pieces
    where id = v_piece1 and project_id = v_project_id and kind = 'questions' and language = 'es'
      and title = 'Questions round 1' and revision = '1' and html = '<p>round 1</p>'
  ) then
    raise exception 'factory-connection (b): piece not created as given';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_piece1 and member_id = v_ana_id;
  if v_status is distinct from 'pending' then
    raise exception 'factory-connection (b): assignment status is %, expected pending', v_status;
  end if;
  if v_res -> 'people' is distinct from jsonb_build_array(jsonb_build_object(
      'email', v_ana, 'display_name', 'Ana', 'member_id', v_ana_id,
      'replaced', '[]'::jsonb, 'partials', '[]'::jsonb, 'kept_in_progress', '[]'::jsonb)) then
    raise exception 'factory-connection (b): unexpected people result %', v_res -> 'people';
  end if;
  v_checks := v_checks + 1;

  -- (c) a second publish of the same kind to the same person replaces the untouched first one.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'questions', 'Questions round 2', '2',
    '<p>round 2</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_piece2 := (v_res ->> 'piece_id')::uuid;

  select status into v_status from public.piece_assignments where piece_id = v_piece1 and member_id = v_ana_id;
  if v_status is distinct from 'replaced' then
    raise exception 'factory-connection (c): first assignment is %, expected replaced', v_status;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_piece2 and member_id = v_ana_id;
  if v_status is distinct from 'pending' then
    raise exception 'factory-connection (c): second assignment is %, expected pending', v_status;
  end if;
  if v_res -> 'people' -> 0 -> 'replaced' is distinct from jsonb_build_array(v_piece1)
     or v_res -> 'people' -> 0 -> 'member_id' is distinct from to_jsonb(v_ana_id) then
    raise exception 'factory-connection (c): unexpected people result %', v_res -> 'people';
  end if;
  v_checks := v_checks + 1;

  -- (d) an in-progress assignment is kept unless the person's email is in p_replace_in_progress;
  --     when replaced, its draft becomes a partial response.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.save_draft(v_piece2, v_draft);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.piece_assignments where piece_id = v_piece2 and member_id = v_ana_id;
  if v_status is distinct from 'in_progress' then
    raise exception 'factory-connection (d): save_draft left status %, expected in_progress', v_status;
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'questions', 'Questions round 3', '3',
    '<p>round 3</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)),
    array['fc-check-nobody@example.invalid']);
  perform set_config('role', v_admin, true);
  v_piece3 := (v_res ->> 'piece_id')::uuid;
  v_person := v_res -> 'people' -> 0;

  if v_person -> 'kept_in_progress' is distinct from jsonb_build_array(v_piece2)
     or v_person -> 'replaced' is distinct from '[]'::jsonb
     or v_person -> 'partials' is distinct from '[]'::jsonb then
    raise exception 'factory-connection (d): without the email, unexpected result %', v_person;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_piece2 and member_id = v_ana_id;
  if v_status is distinct from 'in_progress' then
    raise exception 'factory-connection (d): kept assignment is %, expected in_progress', v_status;
  end if;
  if exists (select 1 from public.piece_responses where piece_id = v_piece2) then
    raise exception 'factory-connection (d): a response was created for a kept assignment';
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'questions', 'Questions round 4', '4',
    '<p>round 4</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)),
    array[' FC-Check-Ana@Example.Invalid ']);
  perform set_config('role', v_admin, true);
  v_piece4 := (v_res ->> 'piece_id')::uuid;
  v_person := v_res -> 'people' -> 0;

  if jsonb_array_length(v_person -> 'replaced') <> 2
     or not (v_person -> 'replaced') @> jsonb_build_array(v_piece2, v_piece3)
     or jsonb_array_length(v_person -> 'partials') <> 1
     or v_person -> 'kept_in_progress' is distinct from '[]'::jsonb then
    raise exception 'factory-connection (d): with the email, unexpected result %', v_person;
  end if;
  v_partial_id := (v_person -> 'partials' ->> 0)::uuid;
  if not exists (
    select 1 from public.piece_responses
    where id = v_partial_id and piece_id = v_piece2 and member_id = v_ana_id and partial
      and fetched_at is null
      and payload = jsonb_build_object('format', 'factory-draft/1', 'storage', v_draft)
  ) then
    raise exception 'factory-connection (d): partial response missing or with a different payload';
  end if;
  if (select count(*) from public.piece_assignments
      where member_id = v_ana_id and piece_id in (v_piece2, v_piece3) and status = 'replaced') <> 2 then
    raise exception 'factory-connection (d): rounds 2 and 3 were not both replaced';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_piece4 and member_id = v_ana_id;
  if v_status is distinct from 'pending' then
    raise exception 'factory-connection (d): round 4 assignment is %, expected pending', v_status;
  end if;
  if not exists (select 1 from public.piece_drafts
                 where piece_id = v_piece2 and member_id = v_ana_id and storage = v_draft) then
    raise exception 'factory-connection (d): the draft was discarded';
  end if;
  v_checks := v_checks + 1;

  -- (e) an open tab of a replaced version still submits: the row is stored, the status stays replaced.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_submitted_id := public.submit_response(v_piece2, v_final);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.piece_responses
    where id = v_submitted_id and piece_id = v_piece2 and member_id = v_ana_id
      and not partial and payload = v_final and fetched_at is null
  ) then
    raise exception 'factory-connection (e): submitted response not stored as sent';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_piece2 and member_id = v_ana_id;
  if v_status is distinct from 'replaced' then
    raise exception 'factory-connection (e): status became %, expected replaced', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (f) factory_fetch lists the responses not yet fetched; after factory_mark_fetched they are gone
  --     and their payloads are untouched.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_fetch(v_slug);
  perform set_config('role', v_admin, true);

  if jsonb_typeof(v_res) is distinct from 'array' or jsonb_array_length(v_res) <> 2 then
    raise exception 'factory-connection (f): expected 2 unfetched responses, got %', v_res;
  end if;
  if (v_res -> 0 ->> 'submitted_at')::timestamptz > (v_res -> 1 ->> 'submitted_at')::timestamptz then
    raise exception 'factory-connection (f): responses not ordered by submitted_at';
  end if;
  for v_elem in select e from jsonb_array_elements(v_res) as t(e) loop
    if (select count(*) from jsonb_object_keys(v_elem)) <> 10
       or not v_elem ?& array['response_id', 'piece_id', 'kind', 'title', 'revision', 'email',
                              'display_name', 'payload', 'partial', 'submitted_at'] then
      raise exception 'factory-connection (f): unexpected keys in %', v_elem;
    end if;
  end loop;
  select e into v_elem from jsonb_array_elements(v_res) as t(e) where e ->> 'response_id' = v_partial_id::text;
  if v_elem is null
     or v_elem ->> 'piece_id' is distinct from v_piece2::text
     or v_elem ->> 'kind' is distinct from 'questions'
     or v_elem ->> 'title' is distinct from 'Questions round 2'
     or v_elem ->> 'revision' is distinct from '2'
     or v_elem ->> 'email' is distinct from v_ana
     or v_elem ->> 'display_name' is distinct from 'Ana'
     or v_elem -> 'payload' is distinct from jsonb_build_object('format', 'factory-draft/1', 'storage', v_draft)
     or v_elem -> 'partial' is distinct from 'true'::jsonb
     or v_elem ->> 'submitted_at' is null then
    raise exception 'factory-connection (f): partial response fetched as %', v_elem;
  end if;
  v_elem := null;
  select e into v_elem from jsonb_array_elements(v_res) as t(e) where e ->> 'response_id' = v_submitted_id::text;
  if v_elem is null
     or v_elem -> 'payload' is distinct from v_final
     or v_elem -> 'partial' is distinct from 'false'::jsonb then
    raise exception 'factory-connection (f): submitted response fetched as %', v_elem;
  end if;

  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_fetched(array[v_partial_id, v_submitted_id]);
  perform set_config('role', v_admin, true);
  if v_count <> 2 then
    raise exception 'factory-connection (f): factory_mark_fetched marked %, expected 2', v_count;
  end if;
  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_fetched(array[v_partial_id, v_submitted_id]);
  v_res := public.factory_fetch(v_slug);
  perform set_config('role', v_admin, true);
  if v_count <> 0 then
    raise exception 'factory-connection (f): a second factory_mark_fetched marked %, expected 0', v_count;
  end if;
  if v_res is distinct from '[]'::jsonb then
    raise exception 'factory-connection (f): fetched responses still listed: %', v_res;
  end if;
  if (select count(*) from public.piece_responses
      where fetched_at is not null
        and ((id = v_partial_id and partial
              and payload = jsonb_build_object('format', 'factory-draft/1', 'storage', v_draft))
          or (id = v_submitted_id and not partial and payload = v_final))) <> 2 then
    raise exception 'factory-connection (f): payloads changed or fetched_at not set';
  end if;
  v_checks := v_checks + 1;

  -- (g) an email with capitals and spaces is normalized, and the normalized form reuses the member.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'demo_review', 'Demo', '1', '<p>demo 1</p>',
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', ' FC-Check-Carla@Example.INVALID ')),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_demo1 := (v_res ->> 'piece_id')::uuid;
  v_carla_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  if v_res -> 'people' -> 0 ->> 'email' is distinct from v_carla
     or not exists (select 1 from public.project_members
                    where id = v_carla_id and project_id = v_project_id and email = v_carla) then
    raise exception 'factory-connection (g): email not normalized: %', v_res -> 'people';
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'demo_review', 'Demo', '2', '<p>demo 2</p>',
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla)), '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_demo2 := (v_res ->> 'piece_id')::uuid;
  if (v_res -> 'people' -> 0 ->> 'member_id')::uuid is distinct from v_carla_id
     or (select count(*) from public.project_members
         where project_id = v_project_id and email like 'fc-check-carla%') <> 1
     or v_res -> 'people' -> 0 -> 'replaced' is distinct from jsonb_build_array(v_demo1) then
    raise exception 'factory-connection (g): member not reused: %', v_res -> 'people';
  end if;
  v_checks := v_checks + 1;

  -- (h) person A cannot see person B's assignments, drafts or responses, nor write B's draft.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'FC Check Project', 'flow_review', 'Flow review', '1',
    '<p>flow 1</p>', jsonb_build_array(jsonb_build_object('display_name', 'Beto', 'email', v_beto)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_beto_piece := (v_res ->> 'piece_id')::uuid;
  v_beto_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  perform public.save_draft(v_beto_piece, '{"fc-check:beto": "draft"}'::jsonb);
  perform public.submit_response(v_beto_piece, '{"fc-check:beto": "final"}'::jsonb);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.piece_assignments where piece_id = v_beto_piece and member_id = v_beto_id;
  if v_status is distinct from 'submitted' then
    raise exception 'factory-connection (h): a normal submit left status %, expected submitted', v_status;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  if (select count(*) from public.piece_assignments where member_id = v_beto_id) <> 0
     or (select count(*) from public.piece_drafts where member_id = v_beto_id) <> 0
     or (select count(*) from public.piece_responses where member_id = v_beto_id) <> 0
     or (select count(*) from public.piece_assignments where member_id <> v_ana_id) <> 0
     or (select count(*) from public.piece_responses where member_id <> v_ana_id) <> 0
     or (select count(*) from public.pieces where id = v_beto_piece) <> 0 then
    raise exception 'factory-connection (h): Ana can see rows that belong to someone else';
  end if;
  if (select count(*) from public.piece_assignments where member_id = v_ana_id) <> 4
     or (select count(*) from public.piece_responses where member_id = v_ana_id) <> 2 then
    raise exception 'factory-connection (h): Ana cannot see her own rows';
  end if;
  begin
    perform public.save_draft(v_beto_piece, '{"fc-check:intruder": true}'::jsonb);
    raise exception 'factory-connection (h): Ana wrote a draft on Beto''s piece';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- (i) factory_preview finds a member's email by display_name regardless of case.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_preview(v_slug, 'questions', jsonb_build_array(
    jsonb_build_object('display_name', 'aNA', 'email', null),
    jsonb_build_object('display_name', 'Nobody Here'),
    jsonb_build_object('display_name', 'Dora', 'email', ' FC-Check-Dora@Example.Invalid ')));
  perform set_config('role', v_admin, true);

  if v_res -> 'project_exists' is distinct from 'true'::jsonb
     or jsonb_array_length(v_res -> 'people') <> 3 then
    raise exception 'factory-connection (i): unexpected preview %', v_res;
  end if;
  v_person := v_res -> 'people' -> 0;
  if v_person ->> 'email' is distinct from v_ana
     or v_person -> 'member_exists' is distinct from 'true'::jsonb
     or v_person -> 'open' is distinct from jsonb_build_array(jsonb_build_object(
          'piece_id', v_piece4, 'title', 'Questions round 4', 'revision', '4', 'status', 'pending')) then
    raise exception 'factory-connection (i): Ana not found by display_name: %', v_person;
  end if;
  v_person := v_res -> 'people' -> 1;
  if v_person -> 'email' is distinct from 'null'::jsonb
     or v_person -> 'member_exists' is distinct from 'false'::jsonb
     or v_person -> 'open' is distinct from '[]'::jsonb then
    raise exception 'factory-connection (i): unknown person reported as %', v_person;
  end if;
  v_person := v_res -> 'people' -> 2;
  if v_person ->> 'email' is distinct from 'fc-check-dora@example.invalid'
     or v_person -> 'member_exists' is distinct from 'false'::jsonb then
    raise exception 'factory-connection (i): given email not normalized: %', v_person;
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_preview('fc-check-missing-project', 'questions',
    jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', null)));
  perform set_config('role', v_admin, true);
  if v_res -> 'project_exists' is distinct from 'false'::jsonb
     or v_res -> 'people' -> 0 -> 'email' is distinct from 'null'::jsonb
     or v_res -> 'people' -> 0 -> 'member_exists' is distinct from 'false'::jsonb then
    raise exception 'factory-connection (i): missing project reported as %', v_res;
  end if;
  v_checks := v_checks + 1;

  if v_checks <> 9 then
    raise exception 'factory-connection: only % of 9 checks ran', v_checks;
  end if;
  raise notice 'factory-connection: ok % checks', v_checks;
end
$check$;

select 'factory-connection: ok 9 checks' as result;

rollback;
