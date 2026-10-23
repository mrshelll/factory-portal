-- Checks for the piece closure (migration 20261023120000_piece_closure.sql).
--
-- Run as ONE request against the `factory` database (Supabase MCP execute_sql, or psql as postgres).
-- Everything happens inside `begin; ... rollback;`: no data is left behind. Every failure raises an
-- exception; success prints NOTICE "piece-closure: ok 12 checks" and returns one row with the same
-- text. People are simulated with JWT claims that carry an email and no `sub`, so auth.uid() is null
-- and submit_response never writes a user_id. All names start with pc-check so nothing collides with
-- real data. Inside one transaction now() does not move, so where the order of two rows matters the
-- checks set their timestamps apart by hand.

begin;

do $check$
declare
  v_admin constant text := current_user;
  v_slug constant text := 'pc-check-project';
  v_other_slug constant text := 'pc-check-other';
  v_ana constant text := 'pc-check-ana@example.invalid';
  v_beto constant text := 'pc-check-beto@example.invalid';
  v_carla constant text := 'pc-check-carla@example.invalid';
  v_dora constant text := 'pc-check-dora@example.invalid';
  v_eva constant text := 'pc-check-eva@example.invalid';
  v_draft constant jsonb := '{"pc-check:answers": {"q1": "draft answer"}}';
  v_draft2 constant jsonb := '{"pc-check:answers": {"q1": "draft after the close"}}';
  v_payload1 constant jsonb := '{"pc-check:answers": {"q1": "sent answer"}}';
  v_storage1 constant jsonb := '{"pc-check:storage": {"q1": "sent answer"}}';
  v_payload_a constant jsonb := '{"pc-check:demo": "send A"}';
  v_storage_a constant jsonb := '{"pc-check:storage": "send A"}';
  v_payload_b constant jsonb := '{"pc-check:demo": "send B"}';
  v_change_storage constant jsonb := '{"pc-check:storage": "starting point of the request"}';
  v_late_payload constant jsonb := '{"pc-check:answers": {"q1": "sent after the close"}}';
  v_late_storage constant jsonb := '{"pc-check:storage": {"q1": "sent after the close"}}';
  v_payload_q1b constant jsonb := '{"pc-check:answers": {"q1": "round 1b"}}';
  v_payload_q1b_late constant jsonb := '{"pc-check:answers": {"q1": "round 1b after the new version"}}';
  v_carla_draft constant jsonb := '{"pc-check:answers": {"q1": "carla draft"}}';
  v_payload_carla constant jsonb := '{"pc-check:answers": {"q1": "carla on the old version"}}';
  v_payload_eva constant jsonb := '{"pc-check:answers": {"q1": "eva on the old version"}}';
  v_payload_dora constant jsonb := '{"pc-check:answers": {"q1": "dora"}}';
  v_checks integer := 0;
  v_role text;
  v_fn text;
  v_res jsonb;
  v_person jsonb;
  v_elem jsonb;
  v_count integer;
  v_bool boolean;
  v_status text;
  v_old_status text;
  v_ana_id uuid;
  v_beto_id uuid;
  v_carla_id uuid;
  v_dora_id uuid;
  v_eva_id uuid;
  v_q1 uuid;
  v_q1b uuid;
  v_q2 uuid;
  v_d1 uuid;
  v_f1 uuid;
  v_o1 uuid;
  v_r1 uuid;
  v_ra uuid;
  v_rb uuid;
  v_rq1b uuid;
  v_rc uuid;
  v_re uuid;
  v_carla_partial uuid;
  v_ro uuid;
  v_cr1 uuid;
  v_late1 uuid;
  v_late2 uuid;
  v_cr_other uuid;
begin
  if exists (select 1 from public.projects where slug in (v_slug, v_other_slug)) then
    raise exception 'piece-closure: project % or % already exists; the checks need them absent',
      v_slug, v_other_slug;
  end if;

  -- Setup. Q1 goes to Ana, Carla and Eva. Ana starts Q1, so publishing Q1b to her keeps Q1 in progress
  -- (two questions pieces of the same person are open at once). D1 (demo) goes to Ana, F1 (flow) to
  -- Beto.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PC Check Project', 'questions', 'Questions round 1', '1',
    '<p>q1</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                                   jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                                   jsonb_build_object('display_name', 'Eva', 'email', v_eva)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_q1 := (v_res ->> 'piece_id')::uuid;
  v_ana_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  v_carla_id := (v_res -> 'people' -> 1 ->> 'member_id')::uuid;
  v_eva_id := (v_res -> 'people' -> 2 ->> 'member_id')::uuid;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.save_draft(v_q1, v_draft);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PC Check Project', 'questions', 'Questions round 1b', '1b',
    '<p>q1b</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_q1b := (v_res ->> 'piece_id')::uuid;
  if v_res -> 'people' -> 0 -> 'kept_in_progress' is distinct from jsonb_build_array(v_q1) then
    raise exception 'piece-closure (setup): Q1 was not kept in progress: %', v_res -> 'people';
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PC Check Project', 'demo_review', 'Demo', '1', '<p>demo 1</p>',
    jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), '{}'::text[]);
  v_d1 := (v_res ->> 'piece_id')::uuid;
  v_res := public.factory_publish(v_slug, 'PC Check Project', 'flow_review', 'Flow review', '1',
    '<p>flow 1</p>', jsonb_build_array(jsonb_build_object('display_name', 'Beto', 'email', v_beto)),
    '{}'::text[]);
  v_f1 := (v_res ->> 'piece_id')::uuid;
  v_beto_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  perform set_config('role', v_admin, true);

  -- (1) the status check accepts received and rejects an unknown status.
  select status into v_old_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_old_status is distinct from 'in_progress' then
    raise exception 'piece-closure (1): Q1 is %, expected in_progress', v_old_status;
  end if;
  begin
    update public.piece_assignments set status = 'received' where piece_id = v_q1 and member_id = v_ana_id;
    if not found then
      raise exception 'piece-closure (1): Ana''s Q1 assignment is missing';
    end if;
  exception when check_violation then
    raise exception 'piece-closure (1): the status check rejects received';
  end;
  update public.piece_assignments set status = v_old_status where piece_id = v_q1 and member_id = v_ana_id;
  begin
    update public.piece_assignments set status = 'pc-check-unknown' where piece_id = v_q1 and member_id = v_ana_id;
    raise exception 'piece-closure (1): the status check accepts an unknown status';
  exception when check_violation then
    null;
  end;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'in_progress' then
    raise exception 'piece-closure (1): Q1 was left %, expected in_progress', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (2) a send stores its storage and the assignment becomes submitted.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_r1 := public.submit_response(v_q1, v_payload1, v_storage1);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.piece_responses
    where id = v_r1 and piece_id = v_q1 and member_id = v_ana_id and payload = v_payload1
      and storage = v_storage1 and not partial and fetched_at is null
  ) then
    raise exception 'piece-closure (2): response not stored with its storage';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'submitted' then
    raise exception 'piece-closure (2): status is %, expected submitted', v_status;
  end if;
  if exists (select 1 from public.piece_change_requests where piece_id = v_q1) then
    raise exception 'piece-closure (2): a send on an open piece made a change request';
  end if;
  v_checks := v_checks + 1;

  -- (3) factory_mark_received closes nothing until the response is fetched; then it closes it,
  --     once.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_mark_received(array[v_r1]);
  perform set_config('role', v_admin, true);
  if v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (3): an unfetched response closed: %', v_res;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'submitted' then
    raise exception 'piece-closure (3): unfetched, status became %, expected submitted', v_status;
  end if;

  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_fetched(array[v_r1]);
  v_res := public.factory_mark_received(array[v_r1]);
  perform set_config('role', v_admin, true);
  if v_count <> 1 or v_res is distinct from jsonb_build_array(v_r1) then
    raise exception 'piece-closure (3): after fetching, marked % and closed %, expected 1 and [r1]', v_count, v_res;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (3): status is %, expected received', v_status;
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_mark_received(array[v_r1]);
  perform set_config('role', v_admin, true);
  if v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (3): a second call closed again: %', v_res;
  end if;
  perform set_config('role', 'service_role', true);
  v_res := public.factory_mark_received(null);
  perform set_config('role', v_admin, true);
  if v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (3): a null list closed %', v_res;
  end if;
  v_checks := v_checks + 1;

  -- (4) complete send A, then send B (old-piece form, without storage) before any mark: marking A
  --     closes nothing because B is newer; in one batch with both, only the newest (B) closes.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_ra := public.submit_response(v_d1, v_payload_a, v_storage_a);
  v_rb := public.submit_response(v_d1, v_payload_b);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  update public.piece_responses set submitted_at = submitted_at - interval '1 minute' where id = v_ra;

  if not exists (select 1 from public.piece_responses
                 where id = v_rb and payload = v_payload_b and storage is null and not partial) then
    raise exception 'piece-closure (4): the send without storage was not stored';
  end if;

  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_fetched(array[v_ra]);
  v_res := public.factory_mark_received(array[v_ra]);
  perform set_config('role', v_admin, true);
  if v_count <> 1 or v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (4): marking A closed % (marked %), expected nothing', v_res, v_count;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_d1 and member_id = v_ana_id;
  if v_status is distinct from 'submitted' then
    raise exception 'piece-closure (4): with B newer, status is %, expected submitted', v_status;
  end if;

  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_fetched(array[v_rb]);
  v_res := public.factory_mark_received(array[v_ra, v_rb]);
  perform set_config('role', v_admin, true);
  if v_count <> 1 or v_res is distinct from jsonb_build_array(v_rb) then
    raise exception 'piece-closure (4): the batch closed %, expected only B', v_res;
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_d1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (4): after the batch, status is %, expected received', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (5) request_change: 55000 on an open (submitted) piece; on a received piece it stores the
  --     trimmed text with late = false; empty text gives 22023.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_rq1b := public.submit_response(v_q1b, v_payload_q1b);
  begin
    perform public.request_change(v_q1b, 'Quiero cambiar algo');
    raise exception 'piece-closure (5): request_change accepted on a submitted piece';
  exception when sqlstate '55000' then
    null;
  end;
  v_cr1 := public.request_change(v_q1, '  Quiero cambiar la respuesta 2  ', v_change_storage);
  foreach v_fn in array array['   ', E' \n\t ', ''] loop
    begin
      perform public.request_change(v_q1, v_fn);
      raise exception 'piece-closure (5): request_change accepted the empty text %', to_jsonb(v_fn);
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  begin
    perform public.request_change(v_q1, null);
    raise exception 'piece-closure (5): request_change accepted a null text';
  exception when invalid_parameter_value then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.piece_assignments where piece_id = v_q1b and member_id = v_ana_id;
  if v_status is distinct from 'submitted' then
    raise exception 'piece-closure (5): Q1b is %, expected submitted', v_status;
  end if;
  if not exists (
    select 1 from public.piece_change_requests
    where id = v_cr1 and piece_id = v_q1 and member_id = v_ana_id and text = 'Quiero cambiar la respuesta 2'
      and payload is null and storage = v_change_storage and not late and fetched_at is null
  ) then
    raise exception 'piece-closure (5): change request not stored as asked';
  end if;
  if (select count(*) from public.piece_change_requests where member_id = v_ana_id) <> 1 then
    raise exception 'piece-closure (5): rejected requests left rows behind';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (5): a change request moved Q1 to %', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (6) a send on a received piece becomes a late change request with the full payload; no new
  --     response; the status stays received.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_late1 := public.submit_response(v_q1, v_late_payload, v_late_storage);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.piece_change_requests
    where id = v_late1 and piece_id = v_q1 and member_id = v_ana_id and late and text is null
      and payload = v_late_payload and storage = v_late_storage and fetched_at is null
  ) then
    raise exception 'piece-closure (6): the late send is not a late change request with its payload';
  end if;
  if exists (select 1 from public.piece_responses where id = v_late1)
     or (select count(*) from public.piece_responses where piece_id = v_q1 and member_id = v_ana_id) <> 1 then
    raise exception 'piece-closure (6): the late send became a response';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (6): status is %, expected received', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (7) save_draft on a received piece keeps the draft, leaves the status received and does not
  --     touch the responses.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.save_draft(v_q1, v_draft2);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (7): save_draft moved a received piece to %', v_status;
  end if;
  if (select count(*) from public.piece_responses where piece_id = v_q1 and member_id = v_ana_id) <> 1
     or not exists (select 1 from public.piece_responses
                    where id = v_r1 and payload = v_payload1 and storage = v_storage1) then
    raise exception 'piece-closure (7): save_draft touched the responses';
  end if;
  if not exists (select 1 from public.piece_drafts
                 where piece_id = v_q1 and member_id = v_ana_id and storage = v_draft2) then
    raise exception 'piece-closure (7): the draft after the close was not kept';
  end if;
  v_checks := v_checks + 1;

  -- (8) a new version replaces the person's submitted and received pieces of the same kind, without
  --     collecting their drafts. A send on a replaced version with a sent (non-partial) response is
  --     a late change request (Ana, Q1b). A send on a replaced version with only a partial response
  --     (Carla: her draft was collected) or with nothing (Eva) is a normal response, and the status
  --     stays replaced.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  perform public.save_draft(v_q1, v_carla_draft);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_slug, 'PC Check Project', 'questions', 'Questions round 2', '2',
    '<p>q2</p>', jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                                   jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                                   jsonb_build_object('display_name', 'Eva', 'email', v_eva)),
    array[v_ana, v_carla]);
  perform set_config('role', v_admin, true);
  v_q2 := (v_res ->> 'piece_id')::uuid;
  v_person := v_res -> 'people' -> 0;
  if jsonb_array_length(v_person -> 'replaced') <> 2
     or not (v_person -> 'replaced') @> jsonb_build_array(v_q1, v_q1b)
     or v_person -> 'partials' is distinct from '[]'::jsonb
     or v_person -> 'kept_in_progress' is distinct from '[]'::jsonb then
    raise exception 'piece-closure (8): Ana''s publish result is %', v_person;
  end if;
  v_person := v_res -> 'people' -> 1;
  if v_person -> 'replaced' is distinct from jsonb_build_array(v_q1)
     or jsonb_array_length(v_person -> 'partials') <> 1
     or v_person -> 'kept_in_progress' is distinct from '[]'::jsonb then
    raise exception 'piece-closure (8): Carla''s publish result is %', v_person;
  end if;
  v_carla_partial := (v_person -> 'partials' ->> 0)::uuid;
  if not exists (select 1 from public.piece_responses
                 where id = v_carla_partial and piece_id = v_q1 and member_id = v_carla_id and partial) then
    raise exception 'piece-closure (8): Carla''s draft was not collected as a partial response';
  end if;
  v_person := v_res -> 'people' -> 2;
  if v_person -> 'replaced' is distinct from jsonb_build_array(v_q1)
     or v_person -> 'partials' is distinct from '[]'::jsonb
     or v_person -> 'kept_in_progress' is distinct from '[]'::jsonb then
    raise exception 'piece-closure (8): Eva''s publish result is %', v_person;
  end if;
  if (select count(*) from public.piece_assignments
      where status = 'replaced'
        and ((piece_id in (v_q1, v_q1b) and member_id = v_ana_id)
          or (piece_id = v_q1 and member_id in (v_carla_id, v_eva_id)))) <> 4 then
    raise exception 'piece-closure (8): the old versions were not all replaced';
  end if;
  if (select count(*) from public.piece_assignments where piece_id = v_q2 and status = 'pending') <> 3 then
    raise exception 'piece-closure (8): the new version is not pending for the three people';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_d1 and member_id = v_ana_id;
  if v_status is distinct from 'received' then
    raise exception 'piece-closure (8): a questions publish moved the demo to %', v_status;
  end if;
  if (select count(*) from public.piece_responses where member_id = v_ana_id and piece_id in (v_q1, v_q1b)) <> 2
     or exists (select 1 from public.piece_responses where member_id = v_ana_id and partial) then
    raise exception 'piece-closure (8): the publish collected a draft of a sent piece';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_late2 := public.submit_response(v_q1b, v_payload_q1b_late);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  v_rc := public.submit_response(v_q1, v_payload_carla);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_eva)::text, true);
  v_re := public.submit_response(v_q1, v_payload_eva);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.piece_change_requests
    where id = v_late2 and piece_id = v_q1b and member_id = v_ana_id and late and text is null
      and payload = v_payload_q1b_late and storage is null
  ) or (select count(*) from public.piece_responses where piece_id = v_q1b and member_id = v_ana_id) <> 1 then
    raise exception 'piece-closure (8): a send on a replaced, sent version is not a late change request';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1b and member_id = v_ana_id;
  if v_status is distinct from 'replaced' then
    raise exception 'piece-closure (8): Q1b is %, expected replaced', v_status;
  end if;
  if not exists (
    select 1 from public.piece_responses
    where id = v_rc and piece_id = v_q1 and member_id = v_carla_id and payload = v_payload_carla
      and not partial and fetched_at is null
  ) or (select count(*) from public.piece_responses where piece_id = v_q1 and member_id = v_carla_id) <> 2
    or exists (select 1 from public.piece_change_requests where member_id = v_carla_id) then
    raise exception 'piece-closure (8): a send on a replaced version with only a partial is not a normal response';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_carla_id;
  if v_status is distinct from 'replaced' then
    raise exception 'piece-closure (8): Carla''s Q1 is %, expected replaced', v_status;
  end if;
  if not exists (
    select 1 from public.piece_responses
    where id = v_re and piece_id = v_q1 and member_id = v_eva_id and payload = v_payload_eva
      and not partial and fetched_at is null
  ) or exists (select 1 from public.piece_change_requests where member_id = v_eva_id) then
    raise exception 'piece-closure (8): a send on a replaced, never sent version is not a normal response';
  end if;
  select status into v_status from public.piece_assignments where piece_id = v_q1 and member_id = v_eva_id;
  if v_status is distinct from 'replaced' then
    raise exception 'piece-closure (8): Eva''s Q1 is %, expected replaced', v_status;
  end if;
  v_checks := v_checks + 1;

  -- (9) factory_reopen turns received back to submitted for the newest response only, once.
  perform set_config('role', 'service_role', true);
  v_bool := public.factory_reopen(v_ra);
  perform set_config('role', v_admin, true);
  select status into v_status from public.piece_assignments where piece_id = v_d1 and member_id = v_ana_id;
  if v_bool is distinct from false or v_status is distinct from 'received' then
    raise exception 'piece-closure (9): reopening with an older response returned % and left %', v_bool, v_status;
  end if;

  perform set_config('role', 'service_role', true);
  v_bool := public.factory_reopen(v_rb);
  perform set_config('role', v_admin, true);
  select status into v_status from public.piece_assignments where piece_id = v_d1 and member_id = v_ana_id;
  if v_bool is distinct from true or v_status is distinct from 'submitted' then
    raise exception 'piece-closure (9): reopening returned % and left %, expected true and submitted', v_bool, v_status;
  end if;

  perform set_config('role', 'service_role', true);
  if public.factory_reopen(v_rb) is distinct from false then
    raise exception 'piece-closure (9): a second reopen did not return false';
  end if;
  if public.factory_reopen(gen_random_uuid()) is distinct from false
     or public.factory_reopen(null) is distinct from false then
    raise exception 'piece-closure (9): reopening an unknown response did not return false';
  end if;
  perform set_config('role', v_admin, true);
  v_checks := v_checks + 1;

  -- (10) factory_fetch_change_requests lists the project's unfetched requests, oldest first, with
  --      the listed fields and nothing from another project; once marked they stop coming.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish(v_other_slug, 'PC Check Other', 'questions', 'Other questions', '1',
    '<p>other</p>', jsonb_build_array(jsonb_build_object('display_name', 'Dora', 'email', v_dora)),
    '{}'::text[]);
  perform set_config('role', v_admin, true);
  v_o1 := (v_res ->> 'piece_id')::uuid;
  v_dora_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_dora)::text, true);
  v_ro := public.submit_response(v_o1, v_payload_dora);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('role', 'service_role', true);
  perform public.factory_mark_fetched(array[v_ro]);
  v_res := public.factory_mark_received(array[v_ro]);
  perform set_config('role', v_admin, true);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_dora)::text, true);
  v_cr_other := public.request_change(v_o1, 'Pedido en otro proyecto');
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_res is distinct from jsonb_build_array(v_ro) or v_cr_other is null then
    raise exception 'piece-closure (10): the other project setup failed: %', v_res;
  end if;

  -- Creation order is cr1, late1, late2; the timestamps make the expected order late2, cr1, late1.
  update public.piece_change_requests set created_at = now() - interval '3 minutes' where id = v_late2;
  update public.piece_change_requests set created_at = now() - interval '2 minutes' where id = v_cr1;
  update public.piece_change_requests set created_at = now() - interval '1 minute' where id = v_late1;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_fetch_change_requests(v_slug);
  perform set_config('role', v_admin, true);

  if jsonb_typeof(v_res) is distinct from 'array' or jsonb_array_length(v_res) <> 3 then
    raise exception 'piece-closure (10): expected 3 unfetched requests, got %', jsonb_array_length(v_res);
  end if;
  if v_res -> 0 ->> 'request_id' is distinct from v_late2::text
     or v_res -> 1 ->> 'request_id' is distinct from v_cr1::text
     or v_res -> 2 ->> 'request_id' is distinct from v_late1::text then
    raise exception 'piece-closure (10): requests not ordered by created_at';
  end if;
  for v_elem in select e from jsonb_array_elements(v_res) as t(e) loop
    if (select count(*) from jsonb_object_keys(v_elem)) <> 12
       or not v_elem ?& array['request_id', 'piece_id', 'kind', 'title', 'revision', 'email', 'display_name',
                              'text', 'late', 'payload', 'storage', 'created_at']
       or v_elem ->> 'email' is distinct from v_ana
       or v_elem ->> 'display_name' is distinct from 'Ana'
       or v_elem ->> 'kind' is distinct from 'questions'
       or v_elem ->> 'created_at' is null then
      raise exception 'piece-closure (10): unexpected request keys or person for %', v_elem ->> 'request_id';
    end if;
  end loop;
  v_elem := v_res -> 0;
  if v_elem ->> 'piece_id' is distinct from v_q1b::text
     or v_elem ->> 'title' is distinct from 'Questions round 1b'
     or v_elem ->> 'revision' is distinct from '1b'
     or v_elem -> 'text' is distinct from 'null'::jsonb
     or v_elem -> 'late' is distinct from 'true'::jsonb
     or v_elem -> 'payload' is distinct from v_payload_q1b_late
     or v_elem -> 'storage' is distinct from 'null'::jsonb then
    raise exception 'piece-closure (10): the late request on Q1b came with other values';
  end if;
  v_elem := v_res -> 1;
  if v_elem ->> 'piece_id' is distinct from v_q1::text
     or v_elem ->> 'title' is distinct from 'Questions round 1'
     or v_elem ->> 'revision' is distinct from '1'
     or v_elem ->> 'text' is distinct from 'Quiero cambiar la respuesta 2'
     or v_elem -> 'late' is distinct from 'false'::jsonb
     or v_elem -> 'payload' is distinct from 'null'::jsonb
     or v_elem -> 'storage' is distinct from v_change_storage then
    raise exception 'piece-closure (10): the text request came with other values';
  end if;
  v_elem := v_res -> 2;
  if v_elem ->> 'piece_id' is distinct from v_q1::text
     or v_elem -> 'text' is distinct from 'null'::jsonb
     or v_elem -> 'late' is distinct from 'true'::jsonb
     or v_elem -> 'payload' is distinct from v_late_payload
     or v_elem -> 'storage' is distinct from v_late_storage then
    raise exception 'piece-closure (10): the late request on Q1 came with other values';
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_fetch_change_requests('pc-check-missing-project');
  perform set_config('role', v_admin, true);
  if v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (10): an unknown slug returned %', v_res;
  end if;

  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_change_requests_fetched(array[v_late2, v_cr1, v_late1]);
  perform set_config('role', v_admin, true);
  if v_count <> 3 then
    raise exception 'piece-closure (10): marked %, expected 3', v_count;
  end if;
  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_change_requests_fetched(array[v_late2, v_cr1, v_late1]);
  v_bool := public.factory_mark_change_requests_fetched(null) = 0;
  v_res := public.factory_fetch_change_requests(v_slug);
  perform set_config('role', v_admin, true);
  if v_count <> 0 or v_bool is distinct from true then
    raise exception 'piece-closure (10): a second mark or a null list marked rows';
  end if;
  if v_res is distinct from '[]'::jsonb then
    raise exception 'piece-closure (10): marked requests still listed (%)', jsonb_array_length(v_res);
  end if;
  perform set_config('role', 'service_role', true);
  v_res := public.factory_fetch_change_requests(v_other_slug);
  perform set_config('role', v_admin, true);
  if jsonb_array_length(v_res) <> 1 or v_res -> 0 ->> 'request_id' is distinct from v_cr_other::text
     or v_res -> 0 ->> 'email' is distinct from v_dora then
    raise exception 'piece-closure (10): the other project''s request is not listed alone';
  end if;
  if (select count(*) from public.piece_change_requests
      where id in (v_late2, v_cr1, v_late1) and fetched_at is not null) <> 3
     or not exists (select 1 from public.piece_change_requests
                    where id = v_late1 and payload = v_late_payload and storage = v_late_storage) then
    raise exception 'piece-closure (10): fetched_at not set or a request changed';
  end if;
  v_checks := v_checks + 1;

  -- (11) person B cannot read person A's change requests nor write one on A's piece.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  if (select count(*) from public.piece_change_requests) <> 3
     or (select count(*) from public.piece_change_requests where member_id <> v_ana_id) <> 0 then
    raise exception 'piece-closure (11): Ana does not see exactly her own change requests';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  if (select count(*) from public.piece_change_requests) <> 0 then
    raise exception 'piece-closure (11): Beto can read change requests that are not his';
  end if;
  begin
    perform public.request_change(v_q1, 'Pedido de un intruso');
    raise exception 'piece-closure (11): Beto made a change request on Ana''s piece';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.submit_response(v_q1, '{"pc-check:intruder": true}'::jsonb);
    raise exception 'piece-closure (11): Beto sent on Ana''s piece';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.piece_change_requests (piece_id, member_id, text)
    values (v_q1, v_ana_id, 'Escrito directo');
    raise exception 'piece-closure (11): Beto wrote a change request row directly';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.piece_change_requests where member_id = v_ana_id) <> 3 then
    raise exception 'piece-closure (11): Ana''s change requests changed';
  end if;
  v_checks := v_checks + 1;

  -- (12) grants: anon and authenticated cannot execute the new factory_* functions; anon cannot
  --      execute request_change nor submit_response; all are security definer with an empty
  --      search_path; the old two-argument submit_response is gone.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['factory_mark_received', 'factory_reopen', 'factory_fetch_change_requests',
                                'factory_mark_change_requests_fetched'] loop
      begin
        perform set_config('role', v_role, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('role', v_role, 'email', v_ana)::text, true);
        case v_fn
          when 'factory_mark_received' then
            perform public.factory_mark_received(array[v_r1]);
          when 'factory_reopen' then
            perform public.factory_reopen(v_rb);
          when 'factory_fetch_change_requests' then
            perform public.factory_fetch_change_requests(v_slug);
          when 'factory_mark_change_requests_fetched' then
            perform public.factory_mark_change_requests_fetched(array[v_cr_other]);
        end case;
        raise exception 'piece-closure (12): % can execute %', v_role, v_fn;
      exception when insufficient_privilege then
        null;
      end;
      perform set_config('role', v_admin, true);
      perform set_config('request.jwt.claims', '', true);
    end loop;
  end loop;

  -- Ana's Q1 is closed, so with execute these calls would succeed: only the grant stops them.
  foreach v_fn in array array['request_change', 'submit_response'] loop
    begin
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'email', v_ana)::text, true);
      if v_fn = 'request_change' then
        perform public.request_change(v_q1, 'Pedido sin sesion');
      else
        perform public.submit_response(v_q1, '{"pc-check:anon": true}'::jsonb);
      end if;
      raise exception 'piece-closure (12): anon can execute %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
    perform set_config('role', v_admin, true);
    perform set_config('request.jwt.claims', '', true);
  end loop;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('factory_publish', 'factory_mark_received', 'factory_reopen',
                      'factory_fetch_change_requests', 'factory_mark_change_requests_fetched')
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_count <> 5 then
    raise exception 'piece-closure (12): expected 5 factory functions with definer, empty search_path and service_role-only execute, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and p.proname in ('submit_response', 'request_change'))
         or (n.nspname = 'private' and p.proname = 'assignment_closed'))
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('service_role', p.oid, 'execute');
  if v_count <> 3 then
    raise exception 'piece-closure (12): expected 3 person functions with definer, empty search_path and authenticated-only execute, found %', v_count;
  end if;
  if to_regprocedure('public.submit_response(uuid, jsonb)') is not null
     or to_regprocedure('public.submit_response(uuid, jsonb, jsonb)') is null
     or to_regprocedure('public.request_change(uuid, text, jsonb)') is null then
    raise exception 'piece-closure (12): submit_response or request_change has the wrong signature';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.piece_change_requests'::regclass)
     or not has_table_privilege('authenticated', 'public.piece_change_requests', 'select')
     or has_table_privilege('authenticated', 'public.piece_change_requests', 'insert')
     or has_table_privilege('authenticated', 'public.piece_change_requests', 'update')
     or has_table_privilege('authenticated', 'public.piece_change_requests', 'delete')
     or has_table_privilege('anon', 'public.piece_change_requests', 'select') then
    raise exception 'piece-closure (12): piece_change_requests has RLS off or the wrong table grants';
  end if;
  v_checks := v_checks + 1;

  if v_checks <> 12 then
    raise exception 'piece-closure: only % of 12 checks ran', v_checks;
  end if;
  raise notice 'piece-closure: ok % checks', v_checks;
end
$check$;

select 'piece-closure: ok 12 checks' as result;

rollback;
