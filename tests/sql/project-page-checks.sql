-- Checks for the project page (migration 20261025120000_project_page.sql).
--
-- Run as ONE request against the `factory` database (Supabase MCP execute_sql, or psql as postgres).
-- Everything happens inside `begin; ... rollback;`: no data is left behind. Every failure raises an
-- exception; success prints NOTICE "project-page: ok 12 checks" and returns one row with the same
-- text. People are simulated with JWT claims that carry an email and no `sub`, so auth.uid() is null
-- and submit_response never writes a user_id. All names start with pp-check so nothing collides with
-- real data. Inside one transaction now() does not move, so where the order of two rows matters the
-- checks set their timestamps apart by hand. Every draft (piece_drafts, a partial response, the
-- storage of a change request) carries the draft marker, so a result that leaks one is caught.

begin;

do $check$
declare
  v_admin constant text := current_user;
  v_slug constant text := 'pp-check-project';
  v_other_slug constant text := 'pp-check-other';
  v_missing_slug constant text := 'pp-check-missing-project';
  v_olga constant text := 'pp-check-olga@example.invalid';
  v_ana constant text := 'pp-check-ana@example.invalid';
  v_beto constant text := 'pp-check-beto@example.invalid';
  v_pia constant text := 'pp-check-pia@example.invalid';
  v_nobody constant text := 'pp-check-nobody@example.invalid';
  v_idle constant text := 'pp-check-idle@example.invalid';
  v_marker constant text := 'pp-check-draft-marker';
  v_ana_draft constant jsonb := '{"pp-check:answers": {"q1": "pp-check-draft-marker ana"}}';
  v_beto_draft constant jsonb := '{"pp-check:answers": {"f1": "pp-check-draft-marker beto"}}';
  v_olga_draft constant jsonb := '{"pp-check:demo": "pp-check-draft-marker olga"}';
  v_change_storage constant jsonb := '{"pp-check:storage": "pp-check-draft-marker change"}';
  v_late_storage constant jsonb := '{"pp-check:storage": "pp-check-draft-marker late"}';
  v_payload1 constant jsonb := '{"pp-check:answers": {"q1": "sent answer"}}';
  v_storage1 constant jsonb := '{"pp-check:storage": {"q1": "sent answer"}}';
  v_payload2 constant jsonb := '{"pp-check:answers": {"q1": "sent again, without a copy"}}';
  v_late_payload constant jsonb := '{"pp-check:answers": {"q1": "sent after the close"}}';
  v_olga_payload constant jsonb := '{"pp-check:demo": "olga sent"}';
  v_olga_storage constant jsonb := '{"pp-check:storage": "olga sent"}';
  v_checks integer := 0;
  v_role text;
  v_fn text;
  v_status text;
  v_res jsonb;
  v_elem jsonb;
  v_count integer;
  v_updated_at timestamptz;
  v_opened_at timestamptz;
  v_r1_at timestamptz;
  v_project_id uuid;
  v_other_id uuid;
  v_olga_id uuid;
  v_olga_other_id uuid;
  v_ana_id uuid;
  v_beto_id uuid;
  v_pia_id uuid;
  v_idle_id uuid;
  v_qa uuid;
  v_fb uuid;
  v_fb2 uuid;
  v_o1 uuid;
  v_d_olga uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_ana_partial uuid;
  v_beto_partial uuid;
  v_cr1 uuid;
  v_late1 uuid;
  v_ro uuid;
begin
  if exists (select 1 from public.projects where slug in (v_slug, v_other_slug, v_missing_slug)) then
    raise exception 'project-page: project %, % or % already exists; the checks need them absent',
      v_slug, v_other_slug, v_missing_slug;
  end if;

  -- Setup. pp-check-project: QA (questions) goes to Ana, FB (flow review) to Beto, and Olga is its
  -- owner. pp-check-other: O1 goes to Olga and Pía, and Pía is its owner (Olga is a stakeholder).
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PP Check Project', 'questions', 'Questions round 1', '1',
    '<p>qa</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), '{}'::text[]);
  v_qa := (v_res ->> 'piece_id')::uuid;
  v_ana_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  v_res := public.factory_publish(v_slug, 'PP Check Project', 'flow_review', 'Flow review', '1',
    '<p>fb</p>', jsonb_build_array(jsonb_build_object('display_name', 'Beto', 'email', v_beto)), '{}'::text[]);
  v_fb := (v_res ->> 'piece_id')::uuid;
  v_beto_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  v_res := public.factory_set_owner(v_slug, v_olga, 'Olga');
  v_olga_id := (v_res ->> 'member_id')::uuid;
  if v_res -> 'project_exists' is distinct from 'true'::jsonb or v_olga_id is null then
    raise exception 'project-page (setup): factory_set_owner on the project returned %', v_res;
  end if;

  v_res := public.factory_publish(v_other_slug, 'PP Check Other', 'questions', 'Other questions', '1',
    '<p>other</p>', jsonb_build_array(jsonb_build_object('display_name', 'Olga', 'email', v_olga),
                                      jsonb_build_object('display_name', 'Pía', 'email', v_pia)),
    '{}'::text[]);
  v_o1 := (v_res ->> 'piece_id')::uuid;
  v_olga_other_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  v_pia_id := (v_res -> 'people' -> 1 ->> 'member_id')::uuid;
  -- Pía is already a stakeholder there: factory_set_owner upgrades the same member.
  v_res := public.factory_set_owner(v_other_slug, v_pia, null);
  perform set_config('role', v_admin, true);
  if v_res is distinct from jsonb_build_object('project_exists', true, 'member_id', v_pia_id) then
    raise exception 'project-page (setup): factory_set_owner on the other project returned %', v_res;
  end if;
  select id into v_project_id from public.projects where slug = v_slug;
  select id into v_other_id from public.projects where slug = v_other_slug;
  if (select role from public.project_members where id = v_olga_id) is distinct from 'owner'
     or (select role from public.project_members where id = v_olga_other_id) is distinct from 'stakeholder'
     or (select role || '/' || display_name from public.project_members where id = v_pia_id)
        is distinct from 'owner/Pía' then
    raise exception 'project-page (setup): the memberships are not as expected';
  end if;

  -- (1) first_opened_at exists, nullable, and is null on fresh assignments; the status check is
  --     unchanged (the five statuses pass, an unknown one does not).
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'piece_assignments' and column_name = 'first_opened_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'project-page (1): piece_assignments.first_opened_at is missing or not a nullable timestamptz';
  end if;
  if (select count(*) from public.piece_assignments where piece_id in (v_qa, v_fb, v_o1)) <> 4
     or exists (select 1 from public.piece_assignments
                where piece_id in (v_qa, v_fb, v_o1) and first_opened_at is not null) then
    raise exception 'project-page (1): a fresh assignment has first_opened_at set';
  end if;
  foreach v_status in array array['pending', 'in_progress', 'submitted', 'received', 'replaced'] loop
    begin
      update public.piece_assignments set status = v_status where piece_id = v_qa and member_id = v_ana_id;
    exception when check_violation then
      raise exception 'project-page (1): the status check rejects %', v_status;
    end;
  end loop;
  begin
    update public.piece_assignments set status = 'pp-check-unknown' where piece_id = v_qa and member_id = v_ana_id;
    raise exception 'project-page (1): the status check accepts an unknown status';
  exception when check_violation then
    null;
  end;
  update public.piece_assignments set status = 'pending' where piece_id = v_qa and member_id = v_ana_id;
  v_checks := v_checks + 1;

  -- (2) Ana opens her piece: first_opened_at is set; status and updated_at stay as they were (set
  --     apart by hand, so a function that wrote now() into updated_at would be caught).
  update public.piece_assignments set updated_at = now() - interval '1 hour'
  where piece_id = v_qa and member_id = v_ana_id
  returning updated_at into v_updated_at;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.mark_piece_opened(v_qa);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.piece_assignments
    where piece_id = v_qa and member_id = v_ana_id and first_opened_at is not null
      and status = 'pending' and updated_at = v_updated_at
  ) then
    raise exception 'project-page (2): opening did not set first_opened_at, or touched status or updated_at';
  end if;
  if exists (select 1 from public.piece_assignments
             where piece_id in (v_fb, v_o1) and first_opened_at is not null) then
    raise exception 'project-page (2): opening one piece marked another assignment';
  end if;
  v_checks := v_checks + 1;

  -- (3) a second open keeps the first date; Beto opening Ana's piece raises 42501 and changes nothing.
  update public.piece_assignments set first_opened_at = now() - interval '2 hours'
  where piece_id = v_qa and member_id = v_ana_id
  returning first_opened_at into v_opened_at;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.mark_piece_opened(v_qa);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  begin
    perform public.mark_piece_opened(v_qa);
    raise exception 'project-page (3): Beto marked Ana''s piece as opened';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if (select first_opened_at from public.piece_assignments where piece_id = v_qa and member_id = v_ana_id)
     is distinct from v_opened_at then
    raise exception 'project-page (3): a second open changed first_opened_at';
  end if;
  if exists (select 1 from public.piece_assignments where piece_id = v_fb and first_opened_at is not null) then
    raise exception 'project-page (3): Beto''s failed call marked his own assignment';
  end if;
  v_checks := v_checks + 1;

  -- (4) owner_projects as Olga lists pp-check-project only (she is a stakeholder in pp-check-other),
  --     with people = 2: the members with an assignment (Ana and Beto), not Olga (the owner, with none)
  --     nor a stakeholder added without any (Idle, removed again at the end of this check);
  --     last_response_at follows Ana's send. As Ana it is []. As Pía, pp-check-other counts 2: Olga
  --     and Pía herself, the owner, who has an assignment there.
  insert into public.project_members (project_id, email, role, display_name)
  values (v_project_id, v_idle, 'stakeholder', 'Idle')
  returning id into v_idle_id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.save_draft(v_qa, v_ana_draft);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if jsonb_typeof(v_res) is distinct from 'array' or jsonb_array_length(v_res) <> 1 then
    raise exception 'project-page (4): Olga''s projects are %, expected only %', v_res, v_slug;
  end if;
  v_elem := v_res -> 0;
  if (select count(*) from jsonb_object_keys(v_elem)) <> 6
     or not v_elem ?& array['id', 'slug', 'name', 'language', 'people', 'last_response_at']
     or v_elem ->> 'id' is distinct from v_project_id::text
     or v_elem ->> 'slug' is distinct from v_slug
     or v_elem ->> 'name' is distinct from 'PP Check Project'
     or v_elem ->> 'language' is distinct from 'es'
     or v_elem -> 'people' is distinct from '2'::jsonb
     or v_elem -> 'last_response_at' is distinct from 'null'::jsonb then
    raise exception 'project-page (4): before the send, Olga''s project is %', v_elem;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_r1 := public.submit_response(v_qa, v_payload1, v_storage1);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  update public.piece_responses set submitted_at = now() - interval '10 minutes'
  where id = v_r1
  returning submitted_at into v_r1_at;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_projects();
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  if public.owner_projects() is distinct from '[]'::jsonb then
    raise exception 'project-page (4): Ana, who owns nothing, got projects';
  end if;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  v_elem := v_res -> 0;
  if jsonb_array_length(v_res) <> 1
     or v_elem -> 'people' is distinct from '2'::jsonb
     or (v_elem ->> 'last_response_at')::timestamptz is distinct from v_r1_at then
    raise exception 'project-page (4): after Ana''s send, Olga''s project is %', v_elem;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_pia)::text, true);
  v_res := public.owner_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if jsonb_typeof(v_res) is distinct from 'array' or jsonb_array_length(v_res) <> 1
     or v_res -> 0 ->> 'id' is distinct from v_other_id::text
     or v_res -> 0 -> 'people' is distinct from '2'::jsonb then
    raise exception 'project-page (4): Pía''s project should count Olga and Pía (both assigned): %', v_res;
  end if;
  delete from public.project_members where id = v_idle_id;
  v_checks := v_checks + 1;

  -- (5) owner_project as Olga: Ana's assignment shows first_opened_at, sent_at and readable after a
  --     send with storage. Beto's draft, collected as a partial response by a new version with
  --     p_replace_in_progress (and given a storage and the newest date by hand), is never sent_at and
  --     makes nothing readable; neither does a partial on Ana's piece. No draft text comes back.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  perform public.save_draft(v_fb, v_beto_draft);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PP Check Project', 'flow_review', 'Flow review', '2',
    '<p>fb2</p>', jsonb_build_array(jsonb_build_object('display_name', 'Beto', 'email', v_beto)),
    array[v_beto]);
  perform set_config('role', v_admin, true);
  v_fb2 := (v_res ->> 'piece_id')::uuid;
  v_beto_partial := (v_res -> 'people' -> 0 -> 'partials' ->> 0)::uuid;
  if v_beto_partial is null
     or not exists (select 1 from public.piece_responses
                    where id = v_beto_partial and piece_id = v_fb and member_id = v_beto_id and partial)
     or (select status from public.piece_assignments where piece_id = v_fb and member_id = v_beto_id)
        is distinct from 'replaced' then
    raise exception 'project-page (5): Beto''s draft was not collected as a partial response: %', v_res;
  end if;
  update public.piece_responses set storage = v_beto_draft, submitted_at = now() + interval '1 minute'
  where id = v_beto_partial;
  insert into public.piece_responses (piece_id, member_id, payload, storage, partial, submitted_at)
  values (v_qa, v_ana_id, jsonb_build_object('format', 'factory-draft/1', 'storage', v_ana_draft),
          v_ana_draft, true, now() - interval '5 minutes')
  returning id into v_ana_partial;
  -- Newest first is fb2, fb, qa.
  update public.pieces set created_at = now() - interval '3 minutes' where id = v_qa;
  update public.pieces set created_at = now() - interval '2 minutes' where id = v_fb;
  update public.pieces set created_at = now() - interval '1 minute' where id = v_fb2;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_project(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if (select count(*) from jsonb_object_keys(v_res)) <> 4
     or not v_res ?& array['project', 'members', 'pieces', 'change_requests']
     or v_res -> 'project' is distinct from jsonb_build_object(
          'id', v_project_id, 'slug', v_slug, 'name', 'PP Check Project', 'language', 'es') then
    raise exception 'project-page (5): owner_project has other keys or project: %', v_res -> 'project';
  end if;
  if jsonb_array_length(v_res -> 'members') <> 3
     or not (v_res -> 'members') @> jsonb_build_array(
          jsonb_build_object('id', v_olga_id, 'display_name', 'Olga', 'email', v_olga, 'role', 'owner'),
          jsonb_build_object('id', v_ana_id, 'display_name', 'Ana', 'email', v_ana, 'role', 'stakeholder'),
          jsonb_build_object('id', v_beto_id, 'display_name', 'Beto', 'email', v_beto, 'role', 'stakeholder'))
     or exists (select 1 from jsonb_array_elements(v_res -> 'members') as t(e)
                where (select count(*) from jsonb_object_keys(t.e)) <> 4) then
    raise exception 'project-page (5): owner_project members are %', v_res -> 'members';
  end if;
  if jsonb_array_length(v_res -> 'pieces') <> 3
     or v_res -> 'pieces' -> 0 ->> 'id' is distinct from v_fb2::text
     or v_res -> 'pieces' -> 1 ->> 'id' is distinct from v_fb::text
     or v_res -> 'pieces' -> 2 ->> 'id' is distinct from v_qa::text then
    raise exception 'project-page (5): owner_project pieces are not fb2, fb, qa (newest first)';
  end if;
  if exists (select 1 from jsonb_array_elements(v_res -> 'pieces') as t(e)
             where (select count(*) from jsonb_object_keys(t.e)) <> 6
                or not t.e ?& array['id', 'kind', 'title', 'revision', 'created_at', 'assignments'])
     or exists (select 1 from jsonb_array_elements(v_res -> 'pieces') as p(pe)
                cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
                where (select count(*) from jsonb_object_keys(t.ae)) <> 7
                   or not t.ae ?& array['member_id', 'status', 'assigned_at', 'updated_at',
                                        'first_opened_at', 'sent_at', 'readable']) then
    raise exception 'project-page (5): a piece or an assignment of owner_project has other keys';
  end if;

  select t.ae into v_elem
  from jsonb_array_elements(v_res -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_qa::text and t.ae ->> 'member_id' = v_ana_id::text;
  if v_elem ->> 'status' is distinct from 'submitted'
     or (v_elem ->> 'first_opened_at')::timestamptz is distinct from v_opened_at
     or (v_elem ->> 'sent_at')::timestamptz is distinct from v_r1_at
     or v_elem -> 'readable' is distinct from 'true'::jsonb then
    raise exception 'project-page (5): Ana''s assignment in owner_project is %', v_elem;
  end if;

  select t.ae into v_elem
  from jsonb_array_elements(v_res -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_fb::text and t.ae ->> 'member_id' = v_beto_id::text;
  if v_elem ->> 'status' is distinct from 'replaced'
     or v_elem -> 'sent_at' is distinct from 'null'::jsonb
     or v_elem -> 'readable' is distinct from 'false'::jsonb
     or v_elem -> 'first_opened_at' is distinct from 'null'::jsonb then
    raise exception 'project-page (5): Beto''s partial shows as a send: %', v_elem;
  end if;

  select t.ae into v_elem
  from jsonb_array_elements(v_res -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_fb2::text and t.ae ->> 'member_id' = v_beto_id::text;
  if v_elem ->> 'status' is distinct from 'pending'
     or v_elem -> 'sent_at' is distinct from 'null'::jsonb
     or v_elem -> 'readable' is distinct from 'false'::jsonb then
    raise exception 'project-page (5): Beto''s new version in owner_project is %', v_elem;
  end if;
  if position(v_marker in v_res::text) <> 0 then
    raise exception 'project-page (5): owner_project returned draft text';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (v_res -> 0 ->> 'last_response_at')::timestamptz is distinct from v_r1_at then
    raise exception 'project-page (5): a partial response moved last_response_at to %', v_res -> 0 -> 'last_response_at';
  end if;
  v_checks := v_checks + 1;

  -- (6) owner_piece as Olga returns Ana's newest non-partial response with its storage, even with a
  --     newer partial that has a storage. After a newer send without storage, response is null and
  --     readable is false, although an older send had a storage. Opening someone's piece as the owner
  --     never records an opening. An assignment that does not exist gives P0002.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_piece(v_qa, v_ana_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if (select count(*) from jsonb_object_keys(v_res)) <> 4
     or not v_res ?& array['piece', 'member', 'status', 'response']
     or (select count(*) from jsonb_object_keys(v_res -> 'piece')) <> 8
     or v_res -> 'piece' ->> 'id' is distinct from v_qa::text
     or v_res -> 'piece' ->> 'project_id' is distinct from v_project_id::text
     or v_res -> 'piece' ->> 'kind' is distinct from 'questions'
     or v_res -> 'piece' ->> 'title' is distinct from 'Questions round 1'
     or v_res -> 'piece' ->> 'revision' is distinct from '1'
     or v_res -> 'piece' ->> 'language' is distinct from 'es'
     or v_res -> 'piece' ->> 'created_at' is null
     or v_res -> 'piece' ->> 'html' is distinct from '<p>qa</p>'
     or v_res -> 'member' is distinct from jsonb_build_object('id', v_ana_id, 'display_name', 'Ana')
     or v_res ->> 'status' is distinct from 'submitted' then
    raise exception 'project-page (6): owner_piece returned other piece, member or status';
  end if;
  if v_res -> 'response' is distinct from jsonb_build_object('id', v_r1, 'submitted_at', v_r1_at, 'storage', v_storage1) then
    raise exception 'project-page (6): owner_piece response is %, expected the send with storage', v_res -> 'response';
  end if;
  if position(v_marker in v_res::text) <> 0 then
    raise exception 'project-page (6): owner_piece returned draft text';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_r2 := public.submit_response(v_qa, v_payload2);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_piece(v_qa, v_ana_id);
  v_elem := public.owner_project(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (select 1 from public.piece_responses
                 where id = v_r2 and storage is null and not partial and submitted_at = now()) then
    raise exception 'project-page (6): the send without storage was not stored as expected';
  end if;
  if v_res -> 'response' is distinct from 'null'::jsonb or v_res ->> 'status' is distinct from 'submitted' then
    raise exception 'project-page (6): after a send without storage, owner_piece response is %', v_res -> 'response';
  end if;
  if position(v_marker in v_res::text) <> 0 then
    raise exception 'project-page (6): owner_piece returned draft text after the second send';
  end if;
  select t.ae into v_elem
  from jsonb_array_elements(v_elem -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_qa::text and t.ae ->> 'member_id' = v_ana_id::text;
  if (v_elem ->> 'sent_at')::timestamptz is distinct from now()
     or v_elem -> 'readable' is distinct from 'false'::jsonb then
    raise exception 'project-page (6): after a send without storage, Ana''s assignment is %', v_elem;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_piece(v_fb, v_beto_id);
  if v_res -> 'response' is distinct from 'null'::jsonb or v_res ->> 'status' is distinct from 'replaced'
     or position(v_marker in v_res::text) <> 0 then
    raise exception 'project-page (6): owner_piece on Beto''s replaced piece showed his partial: %', v_res -> 'response';
  end if;
  v_res := public.owner_piece(v_fb2, v_beto_id);
  if v_res -> 'response' is distinct from 'null'::jsonb or v_res ->> 'status' is distinct from 'pending' then
    raise exception 'project-page (6): owner_piece on a piece never sent is %', v_res;
  end if;
  foreach v_fn in array array['beto-on-qa', 'pia-on-qa', 'null-member'] loop
    begin
      case v_fn
        when 'beto-on-qa' then perform public.owner_piece(v_qa, v_beto_id);
        when 'pia-on-qa' then perform public.owner_piece(v_qa, v_pia_id);
        when 'null-member' then perform public.owner_piece(v_qa, null);
      end case;
      raise exception 'project-page (6): owner_piece answered for a missing assignment (%)', v_fn;
    exception when sqlstate 'P0002' then
      null;
    end;
  end loop;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.piece_assignments
             where member_id = v_beto_id and first_opened_at is not null)
     or (select first_opened_at from public.piece_assignments where piece_id = v_qa and member_id = v_ana_id)
        is distinct from v_opened_at then
    raise exception 'project-page (6): the owner opening a piece recorded an opening';
  end if;
  v_checks := v_checks + 1;

  -- (7) the owner functions answer only for owned projects: Olga on pp-check-other (where she is a
  --     stakeholder, even on her own assignment there) and Ana on pp-check-project get 42501, and so
  --     does an unknown piece or project. Olga's RLS reads are unchanged: in pp-check-other only her
  --     own membership and assignment; in pp-check-project, where she has no piece yet, nothing.
  perform set_config('role', 'authenticated', true);
  foreach v_fn in array array['olga-project-other', 'olga-piece-other', 'olga-piece-other-pia',
                              'ana-project', 'ana-piece', 'olga-project-unknown', 'olga-project-null',
                              'olga-piece-unknown'] loop
    begin
      perform set_config('request.jwt.claims', jsonb_build_object(
        'role', 'authenticated', 'email', case when v_fn like 'ana-%' then v_ana else v_olga end)::text, true);
      case v_fn
        when 'olga-project-other' then perform public.owner_project(v_other_id);
        when 'olga-piece-other' then perform public.owner_piece(v_o1, v_olga_other_id);
        when 'olga-piece-other-pia' then perform public.owner_piece(v_o1, v_pia_id);
        when 'ana-project' then perform public.owner_project(v_project_id);
        when 'ana-piece' then perform public.owner_piece(v_qa, v_ana_id);
        when 'olga-project-unknown' then perform public.owner_project(gen_random_uuid());
        when 'olga-project-null' then perform public.owner_project(null);
        when 'olga-piece-unknown' then perform public.owner_piece(gen_random_uuid(), v_ana_id);
      end case;
      raise exception 'project-page (7): the owner functions answered for %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  if (select count(*) from public.piece_assignments where piece_id = v_o1) <> 1
     or (select count(*) from public.piece_assignments where piece_id = v_o1 and member_id = v_olga_other_id) <> 1
     or (select count(*) from public.project_members where project_id = v_other_id) <> 1
     or (select count(*) from public.pieces where id = v_o1) <> 1 then
    raise exception 'project-page (7): Olga''s reads in pp-check-other are not only her own';
  end if;
  if (select count(*) from public.piece_assignments where piece_id in (v_qa, v_fb, v_fb2)) <> 0
     or (select count(*) from public.piece_responses where member_id in (v_ana_id, v_beto_id)) <> 0
     or (select count(*) from public.pieces where id in (v_qa, v_fb, v_fb2)) <> 0
     or (select count(*) from public.project_members where project_id = v_project_id) <> 1 then
    raise exception 'project-page (7): being the owner gave Olga direct reads in pp-check-project';
  end if;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- (8) change_requests in owner_project carry text and late and never payload nor storage, even when
  --     the request was made with a storage. Ana's piece is closed first (fetched and received).
  perform set_config('role', 'service_role', true);
  perform public.factory_mark_fetched(array[v_r1, v_r2]);
  v_res := public.factory_mark_received(array[v_r2]);
  perform set_config('role', v_admin, true);
  if v_res is distinct from jsonb_build_array(v_r2) then
    raise exception 'project-page (8): Ana''s piece did not close: %', v_res;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_cr1 := public.request_change(v_qa, 'Quiero cambiar la respuesta 1', v_change_storage);
  v_late1 := public.submit_response(v_qa, v_late_payload, v_late_storage);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.piece_change_requests
      where id in (v_cr1, v_late1) and storage is not null) <> 2 then
    raise exception 'project-page (8): the change requests were not stored with their storage';
  end if;
  update public.piece_change_requests set created_at = now() - interval '1 minute' where id = v_cr1;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_project(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if jsonb_array_length(v_res -> 'change_requests') <> 2
     or v_res -> 'change_requests' -> 0 is distinct from jsonb_build_object(
          'piece_id', v_qa, 'member_id', v_ana_id, 'text', 'Quiero cambiar la respuesta 1', 'late', false,
          'created_at', now() - interval '1 minute')
     or v_res -> 'change_requests' -> 1 is distinct from jsonb_build_object(
          'piece_id', v_qa, 'member_id', v_ana_id, 'text', null, 'late', true, 'created_at', now()) then
    raise exception 'project-page (8): owner_project change_requests are %', v_res -> 'change_requests';
  end if;
  if exists (select 1 from jsonb_array_elements(v_res -> 'change_requests') as t(e)
             where t.e ? 'storage' or t.e ? 'payload')
     or position(v_marker in v_res::text) <> 0
     or position('sent after the close' in v_res::text) <> 0 then
    raise exception 'project-page (8): owner_project returned the payload or storage of a change request';
  end if;
  select t.ae into v_elem
  from jsonb_array_elements(v_res -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_qa::text and t.ae ->> 'member_id' = v_ana_id::text;
  if v_elem ->> 'status' is distinct from 'received'
     or (v_elem ->> 'sent_at')::timestamptz is distinct from now() then
    raise exception 'project-page (8): the late send changed Ana''s assignment: %', v_elem;
  end if;
  v_checks := v_checks + 1;

  -- (9) Olga with her own piece in the project she owns: publishing to her email keeps her owner
  --     (factory_publish does not demote), and her own piece works as any person's: save_draft,
  --     mark_piece_opened and submit_response.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PP Check Project', 'demo_review', 'Demo', '1', '<p>demo</p>',
    jsonb_build_array(jsonb_build_object('display_name', 'Olga', 'email', v_olga)), '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_d_olga := (v_res ->> 'piece_id')::uuid;
  if (v_res -> 'people' -> 0 ->> 'member_id')::uuid is distinct from v_olga_id
     or (select role from public.project_members where id = v_olga_id) is distinct from 'owner' then
    raise exception 'project-page (9): publishing to Olga changed her membership: %', v_res -> 'people';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  perform public.mark_piece_opened(v_d_olga);
  perform public.save_draft(v_d_olga, v_olga_draft);
  v_ro := public.submit_response(v_d_olga, v_olga_payload, v_olga_storage);
  v_res := public.owner_project(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (select 1 from public.piece_assignments
                 where piece_id = v_d_olga and member_id = v_olga_id and status = 'submitted'
                   and first_opened_at is not null)
     or not exists (select 1 from public.piece_drafts
                    where piece_id = v_d_olga and member_id = v_olga_id and storage = v_olga_draft)
     or not exists (select 1 from public.piece_responses
                    where id = v_ro and piece_id = v_d_olga and member_id = v_olga_id
                      and payload = v_olga_payload and storage = v_olga_storage and not partial) then
    raise exception 'project-page (9): Olga''s own piece did not open, save and send as any person''s';
  end if;
  select t.ae into v_elem
  from jsonb_array_elements(v_res -> 'pieces') as p(pe)
  cross join lateral jsonb_array_elements(p.pe -> 'assignments') as t(ae)
  where p.pe ->> 'id' = v_d_olga::text and t.ae ->> 'member_id' = v_olga_id::text;
  if v_elem ->> 'status' is distinct from 'submitted'
     or v_elem ->> 'first_opened_at' is null
     or v_elem -> 'readable' is distinct from 'true'::jsonb
     or position(v_marker in v_res::text) <> 0 then
    raise exception 'project-page (9): Olga''s own assignment in owner_project is %', v_elem;
  end if;
  if (select role from public.project_members where id = v_olga_id) is distinct from 'owner' then
    raise exception 'project-page (9): Olga is no longer the owner';
  end if;
  v_checks := v_checks + 1;

  -- (10) factory_set_owner: an unknown slug returns project_exists = false and writes nothing; an
  --      invalid email gives 22023 before anything is written; on Ana's email (in capitals and with
  --      spaces) it upgrades her to owner and keeps her display_name when the new one is null; a
  --      repeated call returns the same member.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_set_owner(v_missing_slug, v_nobody, 'Nadie');
  if v_res is distinct from '{"project_exists": false, "member_id": null}'::jsonb then
    raise exception 'project-page (10): an unknown slug returned %', v_res;
  end if;
  foreach v_fn in array array['null', '', '   ', 'pp-check-no-at', 'pp check@example.invalid',
                              'pp-check@two@example.invalid'] loop
    begin
      perform public.factory_set_owner(v_slug, case when v_fn = 'null' then null else v_fn end, 'Inválido');
      raise exception 'project-page (10): factory_set_owner accepted the email %', to_jsonb(v_fn);
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  v_res := public.factory_set_owner(v_slug, '  ' || upper(v_ana) || ' ', null);
  if v_res is distinct from jsonb_build_object('project_exists', true, 'member_id', v_ana_id) then
    raise exception 'project-page (10): upgrading Ana returned %', v_res;
  end if;
  v_res := public.factory_set_owner(v_slug, v_olga, '  ');
  if v_res is distinct from jsonb_build_object('project_exists', true, 'member_id', v_olga_id) then
    raise exception 'project-page (10): repeating Olga''s call returned %', v_res;
  end if;
  perform set_config('role', v_admin, true);

  if exists (select 1 from public.projects where slug = v_missing_slug)
     or exists (select 1 from public.project_members where email = v_nobody) then
    raise exception 'project-page (10): an unknown slug wrote something';
  end if;
  if (select count(*) from public.project_members where project_id = v_project_id) <> 3
     or (select role || '/' || display_name from public.project_members where id = v_ana_id)
        is distinct from 'owner/Ana'
     or (select role || '/' || display_name from public.project_members where id = v_olga_id)
        is distinct from 'owner/Olga' then
    raise exception 'project-page (10): the memberships after factory_set_owner are not as expected';
  end if;
  v_checks := v_checks + 1;

  -- (11) isolation unchanged: Beto reads none of Ana's assignments, responses, drafts and change
  --      requests (he still reads his own); Ana, now an owner, still reads only her own rows. No
  --      policy reads through the owner.
  if (select count(*) from public.piece_assignments where member_id = v_ana_id) = 0
     or (select count(*) from public.piece_responses where member_id = v_ana_id) = 0
     or (select count(*) from public.piece_drafts where member_id = v_ana_id) = 0
     or (select count(*) from public.piece_change_requests where member_id = v_ana_id) = 0 then
    raise exception 'project-page (11): Ana has no rows to hide; the check would prove nothing';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  if (select count(*) from public.piece_assignments where member_id = v_ana_id) <> 0
     or (select count(*) from public.piece_responses where member_id = v_ana_id) <> 0
     or (select count(*) from public.piece_drafts where member_id = v_ana_id) <> 0
     or (select count(*) from public.piece_change_requests where member_id = v_ana_id) <> 0 then
    raise exception 'project-page (11): Beto reads rows of Ana';
  end if;
  if (select count(*) from public.piece_assignments where member_id = v_beto_id) <> 2
     or (select count(*) from public.piece_assignments) <> 2 then
    raise exception 'project-page (11): Beto does not read exactly his own assignments';
  end if;
  if public.owner_projects() is distinct from '[]'::jsonb then
    raise exception 'project-page (11): Beto, who owns nothing, got projects';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  if (select count(*) from public.piece_assignments where member_id <> v_ana_id) <> 0
     or (select count(*) from public.piece_responses where member_id <> v_ana_id) <> 0
     or (select count(*) from public.piece_drafts where member_id <> v_ana_id) <> 0
     or (select count(*) from public.piece_change_requests where member_id <> v_ana_id) <> 0
     or (select count(*) from public.project_members where id <> v_ana_id) <> 0 then
    raise exception 'project-page (11): Ana, as an owner, reads rows that are not hers';
  end if;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from pg_policies
             where schemaname = 'public'
               and tablename in ('projects', 'project_members', 'pieces', 'piece_assignments', 'piece_drafts',
                                 'piece_responses', 'piece_change_requests')
               and (coalesce(qual, '') ilike '%owner%' or coalesce(with_check, '') ilike '%owner%')) then
    raise exception 'project-page (11): a row level security policy reads through the owner';
  end if;
  v_checks := v_checks + 1;

  -- (12) grants: authenticated cannot execute factory_set_owner; anon cannot execute any of the five
  --      new functions (each call would succeed with execute, so only the grant stops it); all six
  --      are security definer with an empty search_path and only the expected caller has execute.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
    perform public.factory_set_owner(v_slug, v_olga, 'Olga');
    raise exception 'project-page (12): authenticated can execute factory_set_owner';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_fn in array array['mark_piece_opened', 'owner_projects', 'owner_project', 'owner_piece',
                              'factory_set_owner'] loop
    begin
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'email', v_olga)::text, true);
      case v_fn
        when 'mark_piece_opened' then perform public.mark_piece_opened(v_d_olga);
        when 'owner_projects' then perform public.owner_projects();
        when 'owner_project' then perform public.owner_project(v_project_id);
        when 'owner_piece' then perform public.owner_piece(v_qa, v_ana_id);
        when 'factory_set_owner' then perform public.factory_set_owner(v_slug, v_olga, 'Olga');
      end case;
      raise exception 'project-page (12): anon can execute %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
    perform set_config('role', v_admin, true);
    perform set_config('request.jwt.claims', '', true);
  end loop;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and p.proname in ('mark_piece_opened', 'owner_projects', 'owner_project',
                                                 'owner_piece'))
         or (n.nspname = 'private' and p.proname = 'owned_project_ids'))
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('service_role', p.oid, 'execute');
  if v_count <> 5 then
    raise exception 'project-page (12): expected 5 browser functions with definer, empty search_path and authenticated-only execute, found %', v_count;
  end if;
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'factory_set_owner'
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_count <> 1 then
    raise exception 'project-page (12): factory_set_owner is not definer, empty search_path and service_role-only';
  end if;
  if to_regprocedure('private.owned_project_ids()') is null
     or to_regprocedure('public.mark_piece_opened(uuid)') is null
     or to_regprocedure('public.owner_projects()') is null
     or to_regprocedure('public.owner_project(uuid)') is null
     or to_regprocedure('public.owner_piece(uuid, uuid)') is null
     or to_regprocedure('public.factory_set_owner(text, text, text)') is null then
    raise exception 'project-page (12): a new function has the wrong signature';
  end if;
  v_checks := v_checks + 1;

  if v_checks <> 12 then
    raise exception 'project-page: only % of 12 checks ran', v_checks;
  end if;
  raise notice 'project-page: ok % checks', v_checks;
end
$check$;

select 'project-page: ok 12 checks' as result;

rollback;
