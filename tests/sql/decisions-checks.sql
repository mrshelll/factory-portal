-- Checks for the Decisiones section (migration 20261028120000_decisions.sql).
--
-- Run as ONE request against the `factory` database (Supabase MCP execute_sql, or psql as postgres).
-- Everything happens inside `begin; ... rollback;`: no data is left behind. Every failure raises an
-- exception; success prints NOTICE "decisions: ok 15 checks" and returns one row with the same text.
-- People are simulated with JWT claims that carry an email and no `sub`, so auth.uid() is null. All
-- names start with dc-check (point keys and versions with dc, which are hex digits) so nothing
-- collides with real data. Inside one transaction now() does not move, so where the order of two
-- rows matters the checks set their timestamps apart by hand. The new tables are not readable by
-- authenticated, so every direct read of them happens back in the admin role.
--
-- People: Olga owns dc-check-project and is never in its list; Ana (A) and Beto (B) are its list;
-- Carla (C) is the list of dc-check-other, whose owner is Pía; Dora is a client of dc-check-other who
-- is published to (to prove a publish never changes an existing role). An owner in a list stops the
-- publish (check 13); a member of a list promoted to owner afterwards no longer answers (check 14); a
-- point whose version returns to an earlier one counts each person by their latest answer (check 15).

begin;

do $check$
declare
  v_admin constant text := current_user;
  v_slug constant text := 'dc-check-project';
  v_other_slug constant text := 'dc-check-other';
  v_missing_slug constant text := 'dc-check-missing';
  v_olga constant text := 'dc-check-olga@example.invalid';
  v_ana constant text := 'dc-check-ana@example.invalid';
  v_beto constant text := 'dc-check-beto@example.invalid';
  v_carla constant text := 'dc-check-carla@example.invalid';
  v_pia constant text := 'dc-check-pia@example.invalid';
  v_dora constant text := 'dc-check-dora@example.invalid';
  v_k1 constant text := 'dc00000000a1';
  v_k2 constant text := 'dc00000000a2';
  v_k3 constant text := 'dc00000000a3';
  v_k4 constant text := 'dc00000000a4';
  v_ko constant text := 'dc00000000b1';
  v_v1 constant text := 'dc000000c001';
  v_v1b constant text := 'dc000000c011';
  v_v2 constant text := 'dc000000c002';
  v_v3 constant text := 'dc000000c003';
  v_v4 constant text := 'dc000000c004';
  v_vo constant text := 'dc000000c0b1';
  v_vo2 constant text := 'dc000000c0b2';
  v_stale constant text := 'dc000000ffff';
  v_ana_marker constant text := 'dc-check-ana-private';
  v_basis1 constant jsonb := '[{"text": "dc-check basis one", "quote": {"file": "docs/a.md", "text": "una cita"}}]';
  v_points jsonb;
  v_points_changed jsonb;
  v_points_last jsonb;
  v_people jsonb;
  v_checks integer := 0;
  v_fn text;
  v_value text;
  v_comment text;
  v_res jsonb;
  v_elem jsonb;
  v_before jsonb;
  v_count integer;
  v_project_id uuid;
  v_other_id uuid;
  v_olga_id uuid;
  v_ana_id uuid;
  v_beto_id uuid;
  v_carla_id uuid;
  v_pia_id uuid;
  v_dora_id uuid;
  v_a1 uuid;
  v_a2 uuid;
  v_a3 uuid;
  v_b1 uuid;
  v_c1 uuid;
  v_prop uuid;
  v_ids uuid[];
begin
  if exists (select 1 from public.projects where slug in (v_slug, v_other_slug, v_missing_slug)) then
    raise exception 'decisions: project %, % or % already exists; the checks need them absent',
      v_slug, v_other_slug, v_missing_slug;
  end if;

  v_points := jsonb_build_array(
    jsonb_build_object('key', v_k1, 'version', v_v1, 'title', 'Punto uno', 'decided', 'Se decidió uno.', 'basis', v_basis1),
    jsonb_build_object('key', v_k2, 'version', v_v2, 'title', 'Punto dos', 'decided', 'Se decidió dos.', 'basis', '[]'::jsonb),
    jsonb_build_object('key', v_k3, 'version', v_v3, 'title', 'Punto tres', 'decided', 'Se decidió tres.', 'basis', '[]'::jsonb));
  v_people := jsonb_build_array(
    jsonb_build_object('display_name', 'Ana', 'email', v_ana),
    jsonb_build_object('display_name', 'Beto', 'email', '  ' || upper(v_beto) || ' '));

  -- (1) A dry run writes nothing and reports what a real publish would do; invalid input gives 22023
  --     before anything is written. The real publish creates the project, the points (positions in
  --     display order, active, both dates now()), the list and the members as stakeholder. A publish
  --     never changes an existing role: Olga and Pía, owners left out of the lists, stay owners, and
  --     Dora, a client of dc-check-other who is published to, stays a client (only display_name
  --     changes).
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_slug, 'DC Check Project', v_points, v_people, true);
  perform set_config('role', v_admin, true);
  if (select count(*) from jsonb_object_keys(v_res)) <> 3
     or v_res -> 'project_id' is distinct from 'null'::jsonb
     or v_res -> 'points' is distinct from jsonb_build_object(
          'new', jsonb_build_array(v_k1, v_k2, v_k3), 'changed', '[]'::jsonb,
          'same', '[]'::jsonb, 'removed', '[]'::jsonb)
     or jsonb_array_length(v_res -> 'people') <> 2
     or v_res -> 'people' -> 0 is distinct from jsonb_build_object(
          'display_name', 'Ana', 'email', v_ana, 'member_id', null, 'added', true, 'notify', true,
          'reasons', jsonb_build_array(jsonb_build_object('key', v_k1, 'why', 'added'),
                                       jsonb_build_object('key', v_k2, 'why', 'added'),
                                       jsonb_build_object('key', v_k3, 'why', 'added')))
     or v_res -> 'people' -> 1 ->> 'email' is distinct from v_beto then
    raise exception 'decisions (1): the dry run returned %', v_res;
  end if;
  if exists (select 1 from public.projects where slug = v_slug)
     or exists (select 1 from public.project_members where email in (v_ana, v_beto)) then
    raise exception 'decisions (1): the dry run wrote something';
  end if;

  perform set_config('role', 'service_role', true);
  foreach v_fn in array array['slug-empty', 'slug-bad', 'name-missing', 'dry-null', 'points-null',
                              'points-empty', 'points-object', 'key-bad', 'version-bad', 'title-blank',
                              'decided-missing', 'basis-object', 'keys-twice', 'people-empty',
                              'email-missing', 'email-bad', 'email-twice'] loop
    begin
      case v_fn
        when 'slug-empty' then
          perform public.factory_publish_decisions('  ', 'X', v_points, v_people, true);
        when 'slug-bad' then
          perform public.factory_publish_decisions('DC Check Bad', 'X', v_points, v_people, true);
        when 'name-missing' then
          perform public.factory_publish_decisions(v_slug, '  ', v_points, v_people, true);
        when 'dry-null' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points, v_people, null);
        when 'points-null' then
          perform public.factory_publish_decisions(v_slug, 'X', null, v_people, true);
        when 'points-empty' then
          perform public.factory_publish_decisions(v_slug, 'X', '[]'::jsonb, v_people, true);
        when 'points-object' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points -> 0, v_people, true);
        when 'key-bad' then
          perform public.factory_publish_decisions(v_slug, 'X',
            jsonb_set(v_points, '{0,key}', '"DC00000000A1"'), v_people, true);
        when 'version-bad' then
          perform public.factory_publish_decisions(v_slug, 'X',
            jsonb_set(v_points, '{1,version}', '"dc000000c0"'), v_people, true);
        when 'title-blank' then
          perform public.factory_publish_decisions(v_slug, 'X',
            jsonb_set(v_points, '{2,title}', '"   "'), v_people, true);
        when 'decided-missing' then
          perform public.factory_publish_decisions(v_slug, 'X', jsonb_set(v_points, '{0}',
            (v_points -> 0) - 'decided'), v_people, true);
        when 'basis-object' then
          perform public.factory_publish_decisions(v_slug, 'X',
            jsonb_set(v_points, '{0,basis}', '{"text": "x"}'), v_people, true);
        when 'keys-twice' then
          perform public.factory_publish_decisions(v_slug, 'X',
            jsonb_set(v_points, '{1,key}', to_jsonb(v_k1)), v_people, true);
        when 'people-empty' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points, '[]'::jsonb, true);
        when 'email-missing' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points,
            '[{"display_name": "Sin correo"}]'::jsonb, true);
        when 'email-bad' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points,
            '[{"display_name": "Mal", "email": "dc check@example.invalid"}]'::jsonb, false);
        when 'email-twice' then
          perform public.factory_publish_decisions(v_slug, 'X', v_points,
            v_people || jsonb_build_array(jsonb_build_object('display_name', 'Ana 2', 'email', upper(v_ana))), false);
      end case;
      raise exception 'decisions (1): factory_publish_decisions accepted %', v_fn;
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  perform set_config('role', v_admin, true);
  if exists (select 1 from public.projects where slug = v_slug) then
    raise exception 'decisions (1): an invalid publish wrote something';
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_slug, 'DC Check Project', v_points, v_people, false);
  perform set_config('role', v_admin, true);
  select id into v_project_id from public.projects where slug = v_slug;
  select id into v_ana_id from public.project_members where project_id = v_project_id and email = v_ana;
  select id into v_beto_id from public.project_members where project_id = v_project_id and email = v_beto;
  -- Both were created by one publish (same now()): Ana goes first by hand, so lists ordered by
  -- (created_at, id) put Ana before Beto.
  update public.project_members set created_at = now() - interval '1 minute' where id = v_ana_id;
  if v_project_id is null or v_ana_id is null or v_beto_id is null
     or v_res ->> 'project_id' is distinct from v_project_id::text
     or v_res -> 'points' -> 'new' is distinct from jsonb_build_array(v_k1, v_k2, v_k3)
     or v_res -> 'people' -> 0 ->> 'member_id' is distinct from v_ana_id::text
     or v_res -> 'people' -> 1 is distinct from jsonb_build_object(
          'display_name', 'Beto', 'email', v_beto, 'member_id', v_beto_id, 'added', true, 'notify', true,
          'reasons', jsonb_build_array(jsonb_build_object('key', v_k1, 'why', 'added'),
                                       jsonb_build_object('key', v_k2, 'why', 'added'),
                                       jsonb_build_object('key', v_k3, 'why', 'added'))) then
    raise exception 'decisions (1): the real publish returned %', v_res;
  end if;
  if (select string_agg(role || '/' || display_name, ',' order by display_name)
      from public.project_members where project_id = v_project_id) is distinct from 'stakeholder/Ana,stakeholder/Beto' then
    raise exception 'decisions (1): the members are not Ana and Beto as stakeholder';
  end if;
  if (select count(*) from public.decision_audience where project_id = v_project_id
      and member_id in (v_ana_id, v_beto_id) and added_at = now()) <> 2
     or (select count(*) from public.decision_audience where project_id = v_project_id) <> 2 then
    raise exception 'decisions (1): the list is not Ana and Beto';
  end if;
  if (select string_agg(dp.key || ':' || dp.version || ':' || dp.position || ':' || dp.active::text, ','
                        order by dp.position)
      from public.decision_points dp where dp.project_id = v_project_id)
       is distinct from v_k1 || ':' || v_v1 || ':1:true,' || v_k2 || ':' || v_v2 || ':2:true,'
                        || v_k3 || ':' || v_v3 || ':3:true'
     or exists (select 1 from public.decision_points where project_id = v_project_id
                and (first_published_at <> now() or version_published_at <> now()))
     or (select basis from public.decision_points where project_id = v_project_id and key = v_k1)
        is distinct from v_basis1
     or (select title || '/' || decided from public.decision_points where project_id = v_project_id and key = v_k2)
        is distinct from 'Punto dos/Se decidió dos.' then
    raise exception 'decisions (1): the points were not stored as published';
  end if;

  -- The owner of dc-check-project, never in its list.
  perform set_config('role', 'service_role', true);
  v_res := public.factory_set_owner(v_slug, v_olga, 'Olga');
  v_olga_id := (v_res ->> 'member_id')::uuid;
  -- dc-check-other: Carla; then Pía becomes its owner and Dora is added by hand as a client; the
  -- republish goes to Carla and Dora, never to Pía.
  v_res := public.factory_publish_decisions(v_other_slug, 'DC Check Other',
    jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo, 'title', 'Otro punto',
                                         'decided', 'Se decidió otro.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla)), false);
  v_other_id := (v_res ->> 'project_id')::uuid;
  v_carla_id := (v_res -> 'people' -> 0 ->> 'member_id')::uuid;
  v_res := public.factory_set_owner(v_other_slug, v_pia, 'Pía');
  v_pia_id := (v_res ->> 'member_id')::uuid;
  perform set_config('role', v_admin, true);
  insert into public.project_members (project_id, email, role, display_name)
  values (v_other_id, v_dora, 'client', 'Dora')
  returning id into v_dora_id;
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_other_slug, 'DC Check Other',
    jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo, 'title', 'Otro punto',
                                         'decided', 'Se decidió otro.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                      jsonb_build_object('display_name', 'Dora Nueva', 'email', v_dora)), false);
  perform set_config('role', v_admin, true);
  if v_olga_id is null or v_other_id is null or v_carla_id is null or v_pia_id is null or v_dora_id is null
     or (select role from public.project_members where id = v_olga_id) is distinct from 'owner'
     or (select role || '/' || display_name from public.project_members where id = v_pia_id)
        is distinct from 'owner/Pía'
     or v_res -> 'people' -> 1 ->> 'member_id' is distinct from v_dora_id::text
     or v_res -> 'people' -> 1 -> 'added' is distinct from 'true'::jsonb
     or v_res -> 'people' -> 0 -> 'added' is distinct from 'false'::jsonb
     or v_res -> 'points' -> 'same' is distinct from jsonb_build_array(v_ko)
     or (select role || '/' || display_name from public.project_members where id = v_dora_id)
        is distinct from 'client/Dora Nueva'
     or (select role from public.project_members where id = v_carla_id) is distinct from 'stakeholder' then
    raise exception 'decisions (1): a publish changed an existing role, or returned %', v_res;
  end if;
  if exists (select 1 from public.decision_audience where member_id in (v_olga_id, v_pia_id)) then
    raise exception 'decisions (1): an owner is in the list of her project';
  end if;
  if exists (select 1 from public.decision_audience where member_id = v_olga_id) then
    raise exception 'decisions (1): Olga, the owner, is in the list of her project';
  end if;
  v_checks := v_checks + 1;

  -- (2) Ana sees the three points, in order, all new and without answer; decision_projects lists the
  --     project. After mark_decisions_opened (twice: one row) they are none. An opening older than the
  --     publish makes them new again.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  v_elem := public.decision_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  -- The keys: last_opened_at and points; from 20261029120000_decisions_my_proposals also proposals, here
  -- still empty (checked there): these checks pass before and after that migration.
  if not v_res ?& array['last_opened_at', 'points']
     or exists (select 1 from jsonb_object_keys(v_res) as k(name) where k.name not in ('last_opened_at', 'points', 'proposals'))
     or (v_res ? 'proposals' and v_res -> 'proposals' is distinct from '[]'::jsonb)
     or v_res -> 'last_opened_at' is distinct from 'null'::jsonb
     or jsonb_array_length(v_res -> 'points') <> 3
     or v_res -> 'points' -> 0 is distinct from jsonb_build_object(
          'key', v_k1, 'version', v_v1, 'position', 1, 'title', 'Punto uno', 'decided', 'Se decidió uno.',
          'basis', v_basis1, 'mark', 'new', 'answer', null)
     or v_res -> 'points' -> 1 ->> 'key' is distinct from v_k2
     or v_res -> 'points' -> 2 ->> 'key' is distinct from v_k3
     or exists (select 1 from jsonb_array_elements(v_res -> 'points') as t(e)
                where t.e ->> 'mark' <> 'new' or t.e -> 'answer' <> 'null'::jsonb) then
    raise exception 'decisions (2): before opening, Ana sees %', v_res;
  end if;
  if v_elem is distinct from jsonb_build_array(jsonb_build_object(
       'project_id', v_project_id, 'slug', v_slug, 'name', 'DC Check Project')) then
    raise exception 'decisions (2): Ana''s decision_projects is %', v_elem;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.mark_decisions_opened(v_project_id);
  perform public.mark_decisions_opened(v_project_id);
  v_res := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.decision_opens where member_id = v_ana_id) <> 1
     or (select last_opened_at from public.decision_opens where project_id = v_project_id and member_id = v_ana_id)
        is distinct from now()
     or (v_res ->> 'last_opened_at')::timestamptz is distinct from now()
     or exists (select 1 from jsonb_array_elements(v_res -> 'points') as t(e) where t.e ->> 'mark' <> 'none') then
    raise exception 'decisions (2): after opening, Ana sees %', v_res;
  end if;

  update public.decision_opens set last_opened_at = now() - interval '1 hour'
  where project_id = v_project_id and member_id = v_ana_id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  if exists (select 1 from jsonb_array_elements(v_res -> 'points') as t(e) where t.e ->> 'mark' <> 'new') then
    raise exception 'decisions (2): points published after Ana''s last opening are not new: %', v_res;
  end if;
  perform public.mark_decisions_opened(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- (3) Ana answers yes (with a private comment) on point 1: confirmed for her. Beto, who opens the
  --     section too, sees no answer of hers through my_decisions, decision_projects or owner_decisions
  --     (42501). Carla, of another project, gets 42501 on every function of dc-check-project, and her
  --     decision_projects lists only dc-check-other.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.answer_decision(v_project_id, v_k1, v_v1, 'yes', '  ' || v_ana_marker || '  ');
  v_a1 := (v_res ->> 'id')::uuid;
  v_elem := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from jsonb_object_keys(v_res)) <> 2
     or v_a1 is null
     or (v_res ->> 'created_at')::timestamptz is distinct from now()
     or not exists (select 1 from public.decision_answers
                    where id = v_a1 and project_id = v_project_id and member_id = v_ana_id and point_key = v_k1
                      and point_version = v_v1 and value = 'yes' and comment = v_ana_marker and fetched_at is null) then
    raise exception 'decisions (3): Ana''s answer was not stored as sent: %', v_res;
  end if;
  if v_elem -> 'points' -> 0 ->> 'mark' is distinct from 'confirmed'
     or v_elem -> 'points' -> 0 -> 'answer' is distinct from jsonb_build_object(
          'value', 'yes', 'comment', v_ana_marker, 'version', v_v1, 'created_at', now())
     or v_elem -> 'points' -> 1 ->> 'mark' is distinct from 'none' then
    raise exception 'decisions (3): after answering, Ana sees %', v_elem;
  end if;
  update public.decision_answers set created_at = now() - interval '30 minutes' where id = v_a1;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  perform public.mark_decisions_opened(v_project_id);
  v_res := public.my_decisions(v_project_id);
  v_elem := public.decision_projects();
  begin
    perform public.owner_decisions(v_project_id);
    raise exception 'decisions (3): Beto read owner_decisions';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from jsonb_array_elements(v_res -> 'points') as t(e)
             where t.e -> 'answer' <> 'null'::jsonb or t.e ->> 'mark' <> 'none')
     or position(v_ana_marker in v_res::text) <> 0
     or position(v_a1::text in v_res::text) <> 0
     or position(v_ana_marker in v_elem::text) <> 0 then
    raise exception 'decisions (3): Beto sees Ana''s answer: %', v_res;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  foreach v_fn in array array['my_decisions', 'answer_decision', 'propose_decision', 'mark_decisions_opened',
                              'owner_decisions'] loop
    begin
      case v_fn
        when 'my_decisions' then perform public.my_decisions(v_project_id);
        when 'answer_decision' then perform public.answer_decision(v_project_id, v_k1, v_v1, 'yes', null);
        when 'propose_decision' then perform public.propose_decision(v_project_id, 'Carla propone');
        when 'mark_decisions_opened' then perform public.mark_decisions_opened(v_project_id);
        when 'owner_decisions' then perform public.owner_decisions(v_project_id);
      end case;
      raise exception 'decisions (3): Carla could call % on dc-check-project', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  v_elem := public.decision_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_elem is distinct from jsonb_build_array(jsonb_build_object(
       'project_id', v_other_id, 'slug', v_other_slug, 'name', 'DC Check Other')) then
    raise exception 'decisions (3): Carla''s decision_projects is %', v_elem;
  end if;
  if exists (select 1 from public.decision_answers where member_id = v_carla_id)
     or exists (select 1 from public.decision_proposals where member_id = v_carla_id)
     or exists (select 1 from public.decision_opens where member_id = v_carla_id) then
    raise exception 'decisions (3): Carla''s failed calls wrote something';
  end if;
  v_checks := v_checks + 1;

  -- (4) change, no and unsure need a comment (null, empty or only spaces: 22023); an unknown or null
  --     value and a comment over 4000 characters are 22023 too, and none of them writes. yes without a
  --     comment works; unsure with a comment works and is stored trimmed.
  select count(*) into v_count from public.decision_answers where member_id = v_ana_id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  foreach v_value in array array['change', 'no', 'unsure'] loop
    foreach v_comment in array array['(null)', '', '   '] loop
      begin
        perform public.answer_decision(v_project_id, v_k3, v_v3, v_value,
          case when v_comment = '(null)' then null else v_comment end);
        raise exception 'decisions (4): % without a comment (%) was accepted', v_value, to_jsonb(v_comment);
      exception when invalid_parameter_value then
        null;
      end;
    end loop;
  end loop;
  foreach v_fn in array array['maybe', 'YES', '(null)', 'too-long'] loop
    begin
      if v_fn = 'too-long' then
        perform public.answer_decision(v_project_id, v_k3, v_v3, 'no', repeat('x', 4001));
      else
        perform public.answer_decision(v_project_id, v_k3, v_v3,
          case when v_fn = '(null)' then null else v_fn end, 'Un comentario');
      end if;
      raise exception 'decisions (4): the answer % was accepted', v_fn;
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  v_res := public.answer_decision(v_project_id, v_k2, v_v2, 'yes', null);
  v_a2 := (v_res ->> 'id')::uuid;
  v_res := public.answer_decision(v_project_id, v_k3, v_v3, 'unsure', '  No sé si es así  ');
  v_a3 := (v_res ->> 'id')::uuid;
  v_elem := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.decision_answers where member_id = v_ana_id) <> v_count + 2
     or not exists (select 1 from public.decision_answers
                    where id = v_a2 and point_key = v_k2 and value = 'yes' and comment is null)
     or not exists (select 1 from public.decision_answers
                    where id = v_a3 and point_key = v_k3 and value = 'unsure' and comment = 'No sé si es así') then
    raise exception 'decisions (4): the rejected answers wrote, or the valid ones were not stored';
  end if;
  if v_elem -> 'points' -> 1 ->> 'mark' is distinct from 'confirmed'
     or v_elem -> 'points' -> 2 ->> 'mark' is distinct from 'none'
     or v_elem -> 'points' -> 2 -> 'answer' ->> 'value' is distinct from 'unsure' then
    raise exception 'decisions (4): Ana sees %', v_elem;
  end if;
  update public.decision_answers set created_at = now() - interval '25 minutes' where id in (v_a2, v_a3);
  v_checks := v_checks + 1;

  -- (5) Answers are insert-only: a second answer on point 1 adds a row and the first stays as it was;
  --     the latest wins in my_decisions (change: none), and a third one (yes, with a comment of only
  --     spaces, stored as null) makes it confirmed again.
  select to_jsonb(d) into v_before from public.decision_answers d where d.id = v_a1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.answer_decision(v_project_id, v_k1, v_v1, 'change', '  Prefiero otra cosa  ');
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  update public.decision_answers set created_at = now() - interval '20 minutes' where id = (v_res ->> 'id')::uuid;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_elem := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.decision_answers where member_id = v_ana_id and point_key = v_k1) <> 2
     or (select to_jsonb(d) from public.decision_answers d where d.id = v_a1) is distinct from v_before then
    raise exception 'decisions (5): the second answer did not add a row, or changed the first';
  end if;
  if v_elem -> 'points' -> 0 ->> 'mark' is distinct from 'none'
     or v_elem -> 'points' -> 0 -> 'answer' is distinct from jsonb_build_object(
          'value', 'change', 'comment', 'Prefiero otra cosa', 'version', v_v1,
          'created_at', now() - interval '20 minutes') then
    raise exception 'decisions (5): after changing her mind, Ana sees %', v_elem -> 'points' -> 0;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  perform public.answer_decision(v_project_id, v_k1, v_v1, 'yes', '   ');
  v_elem := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.decision_answers where member_id = v_ana_id and point_key = v_k1) <> 3
     or v_elem -> 'points' -> 0 ->> 'mark' is distinct from 'confirmed'
     or v_elem -> 'points' -> 0 -> 'answer' is distinct from jsonb_build_object(
          'value', 'yes', 'comment', null, 'version', v_v1, 'created_at', now()) then
    raise exception 'decisions (5): the third answer is not the one that counts: %', v_elem -> 'points' -> 0;
  end if;
  update public.decision_answers set created_at = now() - interval '15 minutes'
  where member_id = v_ana_id and point_key = v_k1 and created_at = now();
  v_checks := v_checks + 1;

  -- (6) A version that is not the current one gives PT409; an unknown or null key gives P0002. None
  --     of them writes.
  select count(*) into v_count from public.decision_answers;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  foreach v_fn in array array['stale', 'null-version'] loop
    begin
      perform public.answer_decision(v_project_id, v_k1,
        case when v_fn = 'stale' then v_stale else null end, 'no', 'No va');
      raise exception 'decisions (6): an answer on a version that is not current was accepted (%)', v_fn;
    exception when sqlstate 'PT409' then
      null;
    end;
  end loop;
  foreach v_fn in array array['unknown', 'null-key', 'other-project-key'] loop
    begin
      perform public.answer_decision(v_project_id,
        case v_fn when 'unknown' then 'dc00000000ff' when 'other-project-key' then v_ko else null end,
        v_v1, 'yes', null);
      raise exception 'decisions (6): an answer on an unknown point was accepted (%)', v_fn;
    exception when sqlstate 'P0002' then
      null;
    end;
  end loop;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from public.decision_answers) <> v_count then
    raise exception 'decisions (6): a rejected answer was stored';
  end if;
  v_checks := v_checks + 1;

  -- (7) Republish with point 1 changed (dates set back by hand first, so a move is seen). The dry run
  --     and the real publish agree: changed [1], same [2, 3]; only Ana, who answered point 1 on the
  --     old version, is notified, with why = changed. Ana sees point 1 changed (her answer on the old
  --     version still shown); Beto, who never answered, sees the same marks as before. Only point 1's
  --     version_published_at moves; no first_published_at moves. An answer with the old version gives
  --     PT409.
  update public.decision_points set first_published_at = now() - interval '2 hours',
                                    version_published_at = now() - interval '2 hours'
  where project_id = v_project_id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  v_before := (select jsonb_agg(jsonb_build_object('key', t.e ->> 'key', 'mark', t.e ->> 'mark', 'answer', t.e -> 'answer'))
               from jsonb_array_elements(public.my_decisions(v_project_id) -> 'points') as t(e));
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  v_points_changed := jsonb_set(jsonb_set(v_points, '{0,version}', to_jsonb(v_v1b)),
                                '{0,decided}', '"Se decidió uno, con otro contenido."');
  v_people := jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                                jsonb_build_object('display_name', null, 'email', v_beto));
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_slug, 'DC Check Project', v_points_changed, v_people, true);
  perform set_config('role', v_admin, true);
  if (select version from public.decision_points where project_id = v_project_id and key = v_k1) is distinct from v_v1 then
    raise exception 'decisions (7): the dry run changed the point';
  end if;
  v_elem := jsonb_build_object(
    'project_id', v_project_id,
    'points', jsonb_build_object('new', '[]'::jsonb, 'changed', jsonb_build_array(v_k1),
                                 'same', jsonb_build_array(v_k2, v_k3), 'removed', '[]'::jsonb),
    'people', jsonb_build_array(
      jsonb_build_object('display_name', 'Ana', 'email', v_ana, 'member_id', v_ana_id, 'added', false,
                         'notify', true, 'reasons', jsonb_build_array(jsonb_build_object('key', v_k1, 'why', 'changed'))),
      jsonb_build_object('display_name', 'Beto', 'email', v_beto, 'member_id', v_beto_id, 'added', false,
                         'notify', false, 'reasons', '[]'::jsonb)));
  if v_res is distinct from v_elem then
    raise exception 'decisions (7): the dry run returned %, expected %', v_res, v_elem;
  end if;
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_slug, 'DC Check Project', v_points_changed, v_people, false);
  perform set_config('role', v_admin, true);
  if v_res is distinct from v_elem then
    raise exception 'decisions (7): the real publish returned %, expected %', v_res, v_elem;
  end if;
  if (select string_agg(dp.key || ':' || dp.version || ':' || (dp.version_published_at = now())::text
                        || ':' || (dp.first_published_at = now() - interval '2 hours')::text, ','
                        order by dp.position)
      from public.decision_points dp where dp.project_id = v_project_id)
       is distinct from v_k1 || ':' || v_v1b || ':true:true,' || v_k2 || ':' || v_v2 || ':false:true,'
                        || v_k3 || ':' || v_v3 || ':false:true'
     or (select decided from public.decision_points where project_id = v_project_id and key = v_k1)
        is distinct from 'Se decidió uno, con otro contenido.'
     or (select display_name from public.project_members where id = v_beto_id) is distinct from 'Beto' then
    raise exception 'decisions (7): the points or Beto''s name after the republish are not as expected';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  begin
    perform public.answer_decision(v_project_id, v_k1, v_v1, 'yes', null);
    raise exception 'decisions (7): an answer on the old version of point 1 was accepted';
  exception when sqlstate 'PT409' then
    null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  v_elem := (select jsonb_agg(jsonb_build_object('key', t.e ->> 'key', 'mark', t.e ->> 'mark', 'answer', t.e -> 'answer'))
             from jsonb_array_elements(public.my_decisions(v_project_id) -> 'points') as t(e));
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_res -> 'points' -> 0 ->> 'version' is distinct from v_v1b
     or v_res -> 'points' -> 0 ->> 'mark' is distinct from 'changed'
     or v_res -> 'points' -> 0 -> 'answer' ->> 'version' is distinct from v_v1
     or v_res -> 'points' -> 0 -> 'answer' ->> 'value' is distinct from 'yes'
     or v_res -> 'points' -> 1 ->> 'mark' is distinct from 'confirmed'
     or v_res -> 'points' -> 2 ->> 'mark' is distinct from 'none' then
    raise exception 'decisions (7): after the change, Ana sees %', v_res;
  end if;
  if v_elem is distinct from v_before then
    raise exception 'decisions (7): Beto''s marks moved from % to %', v_before, v_elem;
  end if;
  v_checks := v_checks + 1;

  -- (8) owner_decisions as Olga, after Beto answers no on point 2 (disagreement with Ana) and Ana
  --     proposes something missing. Point 1: nobody answered the current version, so none = 2 (silence
  --     is never yes), and Ana's latest is her yes on the old version (current = false) with her three
  --     answers in order. Point 2: yes 1, no 1. Point 3: unsure 1, none 1. People are Ana and Beto with
  --     their openings; Olga is not among them. Non-owners get 42501; so does Olga answering, opening,
  --     proposing or reading the person's view: she is not in the list.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  v_res := public.answer_decision(v_project_id, v_k2, v_v2, 'no', 'dc-check Beto no está de acuerdo');
  v_b1 := (v_res ->> 'id')::uuid;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  foreach v_comment in array array['(null)', '', '   ', 'too-long'] loop
    begin
      perform public.propose_decision(v_project_id,
        case v_comment when '(null)' then null when 'too-long' then repeat('x', 4001) else v_comment end);
      raise exception 'decisions (8): the proposal % was accepted', to_jsonb(v_comment);
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  v_prop := public.propose_decision(v_project_id, '  Falta hablar del horario <b>nocturno</b>  ');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_res := public.owner_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  update public.decision_answers set created_at = now() - interval '10 minutes' where id = v_b1;

  if (select count(*) from public.decision_proposals where member_id = v_ana_id) <> 1
     or (select text from public.decision_proposals where id = v_prop)
        is distinct from 'Falta hablar del horario <b>nocturno</b>' then
    raise exception 'decisions (8): the proposal was not stored once and trimmed';
  end if;
  if (select count(*) from jsonb_object_keys(v_res)) <> 3
     or jsonb_array_length(v_res -> 'points') <> 3
     or v_res -> 'proposals' is distinct from jsonb_build_array(jsonb_build_object(
          'display_name', 'Ana', 'text', 'Falta hablar del horario <b>nocturno</b>', 'created_at', now()))
     or v_res -> 'people' is distinct from jsonb_build_array(
          jsonb_build_object('member_id', v_ana_id, 'display_name', 'Ana', 'in_audience', true,
                             'last_opened_at', now()),
          jsonb_build_object('member_id', v_beto_id, 'display_name', 'Beto', 'in_audience', true,
                             'last_opened_at', now())) then
    raise exception 'decisions (8): owner_decisions people or proposals are % / %', v_res -> 'people', v_res -> 'proposals';
  end if;
  v_elem := v_res -> 'points' -> 0;
  if (select count(*) from jsonb_object_keys(v_elem)) <> 7
     or v_elem ->> 'key' is distinct from v_k1
     or v_elem ->> 'version' is distinct from v_v1b
     or v_elem ->> 'title' is distinct from 'Punto uno'
     or v_elem ->> 'decided' is distinct from 'Se decidió uno, con otro contenido.'
     or v_elem -> 'active' is distinct from 'true'::jsonb
     or v_elem -> 'counts' is distinct from '{"yes": 0, "change": 0, "no": 0, "unsure": 0, "none": 2}'::jsonb
     or jsonb_array_length(v_elem -> 'people') <> 2
     or v_elem -> 'people' -> 0 -> 'latest' is distinct from jsonb_build_object(
          'value', 'yes', 'comment', null, 'version', v_v1, 'created_at', now() - interval '15 minutes',
          'current', false)
     or v_elem -> 'people' -> 0 -> 'history' is distinct from jsonb_build_array(
          jsonb_build_object('value', 'yes', 'comment', v_ana_marker, 'version', v_v1,
                             'created_at', now() - interval '30 minutes'),
          jsonb_build_object('value', 'change', 'comment', 'Prefiero otra cosa', 'version', v_v1,
                             'created_at', now() - interval '20 minutes'),
          jsonb_build_object('value', 'yes', 'comment', null, 'version', v_v1,
                             'created_at', now() - interval '15 minutes'))
     or v_elem -> 'people' -> 1 is distinct from jsonb_build_object(
          'member_id', v_beto_id, 'display_name', 'Beto', 'in_audience', true, 'latest', null,
          'history', '[]'::jsonb) then
    raise exception 'decisions (8): owner_decisions point 1 is %', v_elem;
  end if;
  if v_res -> 'points' -> 1 -> 'counts' is distinct from '{"yes": 1, "change": 0, "no": 1, "unsure": 0, "none": 0}'::jsonb
     or v_res -> 'points' -> 1 -> 'people' -> 1 -> 'latest' is distinct from jsonb_build_object(
          'value', 'no', 'comment', 'dc-check Beto no está de acuerdo', 'version', v_v2,
          'created_at', now(), 'current', true)
     or v_res -> 'points' -> 2 -> 'counts' is distinct from '{"yes": 0, "change": 0, "no": 0, "unsure": 1, "none": 1}'::jsonb then
    raise exception 'decisions (8): owner_decisions points 2 and 3 are % / %', v_res -> 'points' -> 1, v_res -> 'points' -> 2;
  end if;
  if position(v_olga in v_res::text) <> 0 or position(v_ana in v_res::text) <> 0 then
    raise exception 'decisions (8): owner_decisions returned an email';
  end if;

  perform set_config('role', 'authenticated', true);
  foreach v_fn in array array['ana-owner', 'beto-owner', 'pia-owner', 'olga-other', 'olga-unknown', 'olga-null'] loop
    begin
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email',
        case v_fn when 'ana-owner' then v_ana when 'beto-owner' then v_beto when 'pia-owner' then v_pia
                  else v_olga end)::text, true);
      case v_fn
        when 'olga-other' then perform public.owner_decisions(v_other_id);
        when 'olga-unknown' then perform public.owner_decisions(gen_random_uuid());
        when 'olga-null' then perform public.owner_decisions(null);
        else perform public.owner_decisions(v_project_id);
      end case;
      raise exception 'decisions (8): owner_decisions answered for %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  foreach v_fn in array array['answer_decision', 'mark_decisions_opened', 'propose_decision', 'my_decisions'] loop
    begin
      case v_fn
        when 'answer_decision' then perform public.answer_decision(v_project_id, v_k1, v_v1b, 'yes', null);
        when 'mark_decisions_opened' then perform public.mark_decisions_opened(v_project_id);
        when 'propose_decision' then perform public.propose_decision(v_project_id, 'Olga propone');
        when 'my_decisions' then perform public.my_decisions(v_project_id);
      end case;
      raise exception 'decisions (8): Olga, the owner, could call %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  if public.decision_projects() is distinct from '[]'::jsonb then
    raise exception 'decisions (8): Olga, not in any list, got decision projects';
  end if;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.decision_answers where member_id = v_olga_id)
     or exists (select 1 from public.decision_proposals where member_id = v_olga_id)
     or exists (select 1 from public.decision_opens where member_id = v_olga_id) then
    raise exception 'decisions (8): Olga''s calls wrote something';
  end if;
  v_checks := v_checks + 1;

  -- (9) Beto is removed from the list, point 3 is removed and point 4 is new. Ana is notified for
  --     point 4 (why = new). Beto keeps his membership but gets 42501 and no decision project; his
  --     answer stays in owner_decisions (in_audience = false, not counted) and in the factory's fetch.
  --     Point 3 is inactive: Ana no longer sees it and answering it is P0002; her answer is kept.
  v_points_last := jsonb_build_array(v_points_changed -> 0, v_points_changed -> 1,
    jsonb_build_object('key', v_k4, 'version', v_v4, 'title', 'Punto cuatro', 'decided', 'Se decidió cuatro.',
                       'basis', '[]'::jsonb));
  v_elem := jsonb_build_object(
    'project_id', v_project_id,
    'points', jsonb_build_object('new', jsonb_build_array(v_k4), 'changed', '[]'::jsonb,
                                 'same', jsonb_build_array(v_k1, v_k2), 'removed', jsonb_build_array(v_k3)),
    'people', jsonb_build_array(
      jsonb_build_object('display_name', 'Ana', 'email', v_ana, 'member_id', v_ana_id, 'added', false,
                         'notify', true, 'reasons', jsonb_build_array(jsonb_build_object('key', v_k4, 'why', 'new')))));
  perform set_config('role', 'service_role', true);
  v_res := public.factory_publish_decisions(v_slug, null,
    v_points_last, jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), true);
  if v_res is distinct from v_elem then
    raise exception 'decisions (9): the dry run returned %, expected %', v_res, v_elem;
  end if;
  v_res := public.factory_publish_decisions(v_slug, null,
    v_points_last, jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), false);
  perform set_config('role', v_admin, true);
  if v_res is distinct from v_elem then
    raise exception 'decisions (9): the real publish returned %, expected %', v_res, v_elem;
  end if;
  if (select array_agg(member_id) from public.decision_audience where project_id = v_project_id)
       is distinct from array[v_ana_id]
     or (select role from public.project_members where id = v_beto_id) is distinct from 'stakeholder'
     or (select string_agg(dp.key || ':' || dp.position || ':' || dp.active::text, ',' order by dp.key)
         from public.decision_points dp where dp.project_id = v_project_id)
        is distinct from v_k1 || ':1:true,' || v_k2 || ':2:true,' || v_k3 || ':3:false,' || v_k4 || ':3:true'
     or not exists (select 1 from public.decision_answers where id = v_a3)
     or not exists (select 1 from public.decision_answers where id = v_b1) then
    raise exception 'decisions (9): the list, the points or the kept answers are not as expected';
  end if;

  -- Ana last opened the section before point 4 was published: it is new for her.
  update public.decision_opens set last_opened_at = now() - interval '5 minutes'
  where project_id = v_project_id and member_id = v_ana_id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  foreach v_fn in array array['my_decisions', 'answer_decision', 'mark_decisions_opened', 'propose_decision'] loop
    begin
      case v_fn
        when 'my_decisions' then perform public.my_decisions(v_project_id);
        when 'answer_decision' then perform public.answer_decision(v_project_id, v_k2, v_v2, 'yes', null);
        when 'mark_decisions_opened' then perform public.mark_decisions_opened(v_project_id);
        when 'propose_decision' then perform public.propose_decision(v_project_id, 'Beto propone');
      end case;
      raise exception 'decisions (9): Beto, removed from the list, could call %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  if public.decision_projects() is distinct from '[]'::jsonb then
    raise exception 'decisions (9): Beto, removed from the list, still gets the project';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  begin
    perform public.answer_decision(v_project_id, v_k3, v_v3, 'yes', null);
    raise exception 'decisions (9): an answer on the removed point 3 was accepted';
  exception when sqlstate 'P0002' then
    null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
  v_elem := public.owner_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select string_agg((t.e ->> 'key') || ':' || (t.e ->> 'position') || ':' || (t.e ->> 'mark'), ',' order by t.n)
      from jsonb_array_elements(v_res -> 'points') with ordinality as t(e, n))
       is distinct from v_k1 || ':1:changed,' || v_k2 || ':2:confirmed,' || v_k4 || ':3:new' then
    raise exception 'decisions (9): after the republish, Ana sees %', v_res;
  end if;
  if v_elem -> 'people' -> 1 is distinct from jsonb_build_object(
       'member_id', v_beto_id, 'display_name', 'Beto', 'in_audience', false, 'last_opened_at', now()) then
    raise exception 'decisions (9): Beto in owner_decisions people is %', v_elem -> 'people';
  end if;
  if (select string_agg((t.e ->> 'key') || ':' || (t.e ->> 'active'), ',' order by t.n)
      from jsonb_array_elements(v_elem -> 'points') with ordinality as t(e, n))
       is distinct from v_k1 || ':true,' || v_k2 || ':true,' || v_k4 || ':true,' || v_k3 || ':false' then
    raise exception 'decisions (9): owner_decisions points are not the active ones in order, then point 3';
  end if;
  select t.e into v_before from jsonb_array_elements(v_elem -> 'points') as t(e) where t.e ->> 'key' = v_k2;
  if v_before -> 'counts' is distinct from '{"yes": 1, "change": 0, "no": 0, "unsure": 0, "none": 0}'::jsonb
     or jsonb_array_length(v_before -> 'people') <> 2
     or v_before -> 'people' -> 1 ->> 'member_id' is distinct from v_beto_id::text
     or v_before -> 'people' -> 1 -> 'in_audience' is distinct from 'false'::jsonb
     or v_before -> 'people' -> 1 -> 'latest' ->> 'value' is distinct from 'no' then
    raise exception 'decisions (9): Beto''s answer on point 2 after his removal is %', v_before;
  end if;
  select t.e into v_before from jsonb_array_elements(v_elem -> 'points') as t(e) where t.e ->> 'key' = v_k1;
  if jsonb_array_length(v_before -> 'people') <> 1
     or v_before -> 'counts' is distinct from '{"yes": 0, "change": 0, "no": 0, "unsure": 0, "none": 1}'::jsonb then
    raise exception 'decisions (9): point 1 still lists or counts Beto, who never answered it: %', v_before;
  end if;
  select t.e into v_before from jsonb_array_elements(v_elem -> 'points') as t(e) where t.e ->> 'key' = v_k3;
  if v_before -> 'people' -> 0 -> 'latest' ->> 'value' is distinct from 'unsure' then
    raise exception 'decisions (9): Ana''s answer on the removed point 3 is gone from owner_decisions: %', v_before;
  end if;

  perform set_config('role', 'service_role', true);
  v_res := public.factory_fetch_decisions(v_slug);
  perform set_config('role', v_admin, true);
  if not exists (select 1 from jsonb_array_elements(v_res -> 'answers') as t(e)
                 where t.e ->> 'id' = v_b1::text and t.e ->> 'member_id' = v_beto_id::text
                   and t.e ->> 'display_name' = 'Beto') then
    raise exception 'decisions (9): Beto''s answer is not in the factory''s fetch after his removal';
  end if;
  v_checks := v_checks + 1;

  -- (10) factory_fetch_decisions returns the unfetched answers and proposals of the project only,
  --      oldest first, with exactly their keys and no email; an unknown slug returns two empty lists.
  --      factory_mark_decisions_fetched counts what it marks (never twice); marked rows no longer
  --      come back, and only fetched_at changes.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  v_c1 := (public.answer_decision(v_other_id, v_ko, v_vo, 'yes', null) ->> 'id')::uuid;
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  v_res := public.factory_fetch_decisions(v_slug);
  v_elem := public.factory_fetch_decisions(v_missing_slug);
  perform set_config('role', v_admin, true);
  if v_elem is distinct from '{"answers": [], "proposals": []}'::jsonb then
    raise exception 'decisions (10): an unknown slug returned %', v_elem;
  end if;
  if (select count(*) from jsonb_object_keys(v_res)) <> 2
     or jsonb_array_length(v_res -> 'answers') <> 6
     or jsonb_array_length(v_res -> 'proposals') <> 1
     or exists (select 1 from jsonb_array_elements(v_res -> 'answers') as t(e)
                where (select count(*) from jsonb_object_keys(t.e)) <> 8
                   or not t.e ?& array['id', 'member_id', 'display_name', 'point_key', 'point_version',
                                       'value', 'comment', 'created_at'])
     or v_res -> 'proposals' -> 0 is distinct from jsonb_build_object(
          'id', v_prop, 'member_id', v_ana_id, 'display_name', 'Ana',
          'text', 'Falta hablar del horario <b>nocturno</b>', 'created_at', now())
     or v_res -> 'answers' -> 0 is distinct from jsonb_build_object(
          'id', v_a1, 'member_id', v_ana_id, 'display_name', 'Ana', 'point_key', v_k1, 'point_version', v_v1,
          'value', 'yes', 'comment', v_ana_marker, 'created_at', now() - interval '30 minutes')
     or position(v_c1::text in v_res::text) <> 0
     or position('@example.invalid' in v_res::text) <> 0 then
    raise exception 'decisions (10): factory_fetch_decisions returned %', v_res;
  end if;
  select array_agg((t.e ->> 'id')::uuid order by t.n) into v_ids
  from jsonb_array_elements(v_res -> 'answers') with ordinality as t(e, n);
  if exists (select 1 from unnest(v_ids) with ordinality as a(id, n)
             join unnest(v_ids) with ordinality as b(id, n) on b.n = a.n + 1
             join public.decision_answers x on x.id = a.id
             join public.decision_answers y on y.id = b.id
             where (x.created_at, x.id) > (y.created_at, y.id)) then
    raise exception 'decisions (10): the answers are not oldest first';
  end if;

  v_before := (select jsonb_agg(to_jsonb(d) - 'fetched_at' order by d.id) from public.decision_answers d
               where d.project_id = v_project_id);
  perform set_config('role', 'service_role', true);
  v_count := public.factory_mark_decisions_fetched(v_ids[1:2], array[v_prop]);
  if v_count <> 3 then
    raise exception 'decisions (10): marking 2 answers and 1 proposal counted %', v_count;
  end if;
  v_count := public.factory_mark_decisions_fetched(v_ids[1:2], array[v_prop]);
  if v_count <> 0 then
    raise exception 'decisions (10): marking the same rows again counted %', v_count;
  end if;
  if public.factory_mark_decisions_fetched(null, null) <> 0 then
    raise exception 'decisions (10): marking nothing counted something';
  end if;
  v_res := public.factory_fetch_decisions(v_slug);
  if jsonb_array_length(v_res -> 'answers') <> 4 or jsonb_array_length(v_res -> 'proposals') <> 0
     or exists (select 1 from jsonb_array_elements(v_res -> 'answers') as t(e)
                where (t.e ->> 'id')::uuid = any (v_ids[1:2])) then
    raise exception 'decisions (10): marked rows came back: %', v_res;
  end if;
  v_count := public.factory_mark_decisions_fetched(v_ids[3:6], '{}'::uuid[]);
  v_res := public.factory_fetch_decisions(v_slug);
  perform set_config('role', v_admin, true);
  if v_count <> 4 or v_res is distinct from '{"answers": [], "proposals": []}'::jsonb then
    raise exception 'decisions (10): after marking everything, % marked and the fetch is %', v_count, v_res;
  end if;
  if (select jsonb_agg(to_jsonb(d) - 'fetched_at' order by d.id) from public.decision_answers d
      where d.project_id = v_project_id) is distinct from v_before
     or exists (select 1 from public.decision_answers where project_id = v_project_id and fetched_at is distinct from now())
     or (select fetched_at from public.decision_answers where id = v_c1) is not null then
    raise exception 'decisions (10): marking changed more than fetched_at, or touched another project';
  end if;
  v_checks := v_checks + 1;

  -- (11) RPC-only access: RLS on and no policy on the five tables; authenticated and anon have no
  --      table privilege, and a direct select, insert, update or delete as authenticated fails. anon
  --      cannot execute any new function (each call would succeed with execute: only the grant stops
  --      it); authenticated cannot execute the factory ones. Every new function is security definer
  --      with an empty search_path, and only its caller has execute.
  if exists (select 1 from pg_class c
             where c.oid in ('public.decision_points'::regclass, 'public.decision_audience'::regclass,
                             'public.decision_answers'::regclass, 'public.decision_proposals'::regclass,
                             'public.decision_opens'::regclass)
               and not c.relrowsecurity)
     or exists (select 1 from pg_policies where schemaname = 'public'
                and tablename in ('decision_points', 'decision_audience', 'decision_answers',
                                  'decision_proposals', 'decision_opens'))
     or exists (select 1
                from unnest(array['decision_points', 'decision_audience', 'decision_answers',
                                  'decision_proposals', 'decision_opens']) as t(name)
                cross join unnest(array['anon', 'authenticated']) as r(name)
                cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate',
                                        'references', 'trigger']) as p(name)
                where has_table_privilege(r.name, 'public.' || t.name, p.name)) then
    raise exception 'decisions (11): a decisions table has RLS off, a policy, or a grant to anon or authenticated';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  foreach v_fn in array array['select-points', 'select-audience', 'select-answers', 'select-proposals',
                              'select-opens', 'insert-answer', 'update-answer', 'delete-answer',
                              'insert-audience'] loop
    begin
      case v_fn
        when 'select-points' then perform 1 from public.decision_points;
        when 'select-audience' then perform 1 from public.decision_audience;
        when 'select-answers' then perform 1 from public.decision_answers;
        when 'select-proposals' then perform 1 from public.decision_proposals;
        when 'select-opens' then perform 1 from public.decision_opens;
        when 'insert-answer' then
          insert into public.decision_answers (project_id, member_id, point_key, point_version, value)
          values (v_project_id, v_ana_id, v_k1, v_v1b, 'yes');
        when 'update-answer' then update public.decision_answers set value = 'no' where id = v_a1;
        when 'delete-answer' then delete from public.decision_answers where id = v_a1;
        when 'insert-audience' then
          insert into public.decision_audience (project_id, member_id) values (v_project_id, v_beto_id);
      end case;
      raise exception 'decisions (11): authenticated could % directly', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_fn in array array['decision_projects', 'my_decisions', 'answer_decision', 'propose_decision',
                              'mark_decisions_opened', 'owner_decisions', 'factory_publish_decisions',
                              'factory_fetch_decisions', 'factory_mark_decisions_fetched'] loop
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'email',
      case when v_fn = 'owner_decisions' then v_olga else v_ana end)::text, true);
    begin
      case v_fn
        when 'decision_projects' then perform public.decision_projects();
        when 'my_decisions' then perform public.my_decisions(v_project_id);
        when 'answer_decision' then perform public.answer_decision(v_project_id, v_k4, v_v4, 'yes', null);
        when 'propose_decision' then perform public.propose_decision(v_project_id, 'Propuesta anónima');
        when 'mark_decisions_opened' then perform public.mark_decisions_opened(v_project_id);
        when 'owner_decisions' then perform public.owner_decisions(v_project_id);
        when 'factory_publish_decisions' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), true);
        when 'factory_fetch_decisions' then perform public.factory_fetch_decisions(v_slug);
        when 'factory_mark_decisions_fetched' then perform public.factory_mark_decisions_fetched(null, null);
      end case;
      raise exception 'decisions (11): anon can execute %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
    perform set_config('role', v_admin, true);
    perform set_config('request.jwt.claims', '', true);
  end loop;

  foreach v_fn in array array['factory_publish_decisions', 'factory_fetch_decisions',
                              'factory_mark_decisions_fetched'] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_olga)::text, true);
    begin
      case v_fn
        when 'factory_publish_decisions' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana)), true);
        when 'factory_fetch_decisions' then perform public.factory_fetch_decisions(v_slug);
        when 'factory_mark_decisions_fetched' then perform public.factory_mark_decisions_fetched(null, null);
      end case;
      raise exception 'decisions (11): authenticated can execute %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
    perform set_config('role', v_admin, true);
    perform set_config('request.jwt.claims', '', true);
  end loop;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and p.proname in ('decision_projects', 'my_decisions', 'answer_decision',
                                                 'propose_decision', 'mark_decisions_opened', 'owner_decisions'))
         or (n.nspname = 'private' and p.proname = 'audience_member_id'))
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('service_role', p.oid, 'execute');
  if v_count <> 7 then
    raise exception 'decisions (11): expected 7 browser functions with definer, empty search_path and authenticated-only execute, found %', v_count;
  end if;
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('factory_publish_decisions', 'factory_fetch_decisions', 'factory_mark_decisions_fetched')
    and p.prosecdef
    and p.proconfig @> array['search_path=""']
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_count <> 3 then
    raise exception 'decisions (11): expected 3 factory functions with definer, empty search_path and service_role-only execute, found %', v_count;
  end if;
  if to_regprocedure('private.audience_member_id(uuid)') is null
     or to_regprocedure('public.decision_projects()') is null
     or to_regprocedure('public.my_decisions(uuid)') is null
     or to_regprocedure('public.answer_decision(uuid, text, text, text, text)') is null
     or to_regprocedure('public.propose_decision(uuid, text)') is null
     or to_regprocedure('public.mark_decisions_opened(uuid)') is null
     or to_regprocedure('public.owner_decisions(uuid)') is null
     or to_regprocedure('public.factory_publish_decisions(text, text, jsonb, jsonb, boolean)') is null
     or to_regprocedure('public.factory_fetch_decisions(text)') is null
     or to_regprocedure('public.factory_mark_decisions_fetched(uuid[], uuid[])') is null then
    raise exception 'decisions (11): a new function has the wrong signature';
  end if;
  v_checks := v_checks + 1;

  -- (12) factory_publish, owner_project and save_draft stay as the earlier migrations left them (the
  --      migration file itself is checked not to define them; see the task report): same signatures,
  --      definer with an empty search_path, the same callers, and the lines that carry their behavior:
  --      factory_publish never demotes (its on conflict only updates display_name), owner_project
  --      returns its four keys, save_draft moves updated_at while pending or in progress.
  select count(*) into v_count
  from pg_proc p
  where p.oid in (to_regprocedure('public.factory_publish(text, text, text, text, text, text, jsonb, text[])'),
                  to_regprocedure('public.owner_project(uuid)'),
                  to_regprocedure('public.save_draft(uuid, jsonb)'))
    and p.prosecdef
    and p.proconfig @> array['search_path=""'];
  if v_count <> 3 then
    raise exception 'decisions (12): factory_publish, owner_project or save_draft is missing or no longer definer with an empty search_path';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('factory_publish', 'owner_project', 'save_draft')) <> 3 then
    raise exception 'decisions (12): factory_publish, owner_project or save_draft gained an overload';
  end if;
  if not has_function_privilege('service_role', 'public.factory_publish(text, text, text, text, text, text, jsonb, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.factory_publish(text, text, text, text, text, text, jsonb, text[])', 'execute')
     or has_function_privilege('anon', 'public.factory_publish(text, text, text, text, text, text, jsonb, text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_project(uuid)', 'execute')
     or has_function_privilege('anon', 'public.owner_project(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.owner_project(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_draft(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.save_draft(uuid, jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.save_draft(uuid, jsonb)', 'execute') then
    raise exception 'decisions (12): the callers of factory_publish, owner_project or save_draft changed';
  end if;
  if position('set display_name = coalesce(excluded.display_name, m.display_name)' in
       (select prosrc from pg_proc where oid = to_regprocedure('public.factory_publish(text, text, text, text, text, text, jsonb, text[])'))) = 0
     or position('and a.status in (''pending'', ''in_progress'', ''submitted'', ''received'')' in
       (select prosrc from pg_proc where oid = to_regprocedure('public.factory_publish(text, text, text, text, text, text, jsonb, text[])'))) = 0
     or position('set role' in
       (select prosrc from pg_proc where oid = to_regprocedure('public.factory_publish(text, text, text, text, text, text, jsonb, text[])'))) <> 0
     or position('''change_requests'', v_change_requests' in
       (select prosrc from pg_proc where oid = to_regprocedure('public.owner_project(uuid)'))) = 0
     or position('status in (''pending'', ''in_progress'')' in
       (select prosrc from pg_proc where oid = to_regprocedure('public.save_draft(uuid, jsonb)'))) = 0 then
    raise exception 'decisions (12): the body of factory_publish, owner_project or save_draft is not the earlier migrations''';
  end if;
  v_checks := v_checks + 1;

  -- (13) The owner never answers: a publish (dry run or real) whose list has an owner of the project
  --      (her own email, in capitals and with spaces too, or among other people) raises 22023 without
  --      echoing any address, and writes nothing: list, points, members and projects stay as they were.
  v_before := jsonb_build_object(
    'audience', (select jsonb_agg(to_jsonb(a) order by a.project_id, a.member_id) from public.decision_audience a
                 where a.project_id in (v_project_id, v_other_id)),
    'points', (select jsonb_agg(to_jsonb(dp) order by dp.project_id, dp.key) from public.decision_points dp
               where dp.project_id in (v_project_id, v_other_id)),
    'members', (select jsonb_agg(to_jsonb(m) order by m.id) from public.project_members m
                where m.project_id in (v_project_id, v_other_id)),
    'projects', (select count(*) from public.projects where slug like 'dc-check-%'));
  perform set_config('role', 'service_role', true);
  foreach v_fn in array array['olga-dry', 'olga-real', 'olga-spaced', 'olga-among', 'pia-other'] loop
    begin
      case v_fn
        when 'olga-dry' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Olga', 'email', v_olga)), true);
        when 'olga-real' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Olga', 'email', v_olga)), false);
        when 'olga-spaced' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Olga', 'email', '  ' || upper(v_olga) || ' ')), false);
        when 'olga-among' then
          perform public.factory_publish_decisions(v_slug, null, v_points_last,
            jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                              jsonb_build_object('display_name', 'Beto', 'email', v_beto),
                              jsonb_build_object('display_name', 'Olga', 'email', v_olga)), false);
        when 'pia-other' then
          perform public.factory_publish_decisions(v_other_slug, null,
            jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo, 'title', 'Otro punto',
                                                 'decided', 'Se decidió otro.', 'basis', '[]'::jsonb)),
            jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                              jsonb_build_object('display_name', 'Pía', 'email', v_pia)), true);
      end case;
      raise exception 'decisions (13): a list with an owner was accepted (%)', v_fn;
    exception when invalid_parameter_value then
      if position('@' in sqlerrm) <> 0 then
        raise exception 'decisions (13): the refusal echoes an address (%)', v_fn;
      end if;
    end;
  end loop;
  perform set_config('role', v_admin, true);
  if jsonb_build_object(
       'audience', (select jsonb_agg(to_jsonb(a) order by a.project_id, a.member_id) from public.decision_audience a
                    where a.project_id in (v_project_id, v_other_id)),
       'points', (select jsonb_agg(to_jsonb(dp) order by dp.project_id, dp.key) from public.decision_points dp
                  where dp.project_id in (v_project_id, v_other_id)),
       'members', (select jsonb_agg(to_jsonb(m) order by m.id) from public.project_members m
                   where m.project_id in (v_project_id, v_other_id)),
       'projects', (select count(*) from public.projects where slug like 'dc-check-%'))
     is distinct from v_before then
    raise exception 'decisions (13): a refused publish wrote something';
  end if;
  if (select role from public.project_members where id = v_olga_id) is distinct from 'owner'
     or (select role from public.project_members where id = v_pia_id) is distinct from 'owner' then
    raise exception 'decisions (13): a refused publish changed an owner';
  end if;
  v_checks := v_checks + 1;

  -- (14) A member of the list promoted to owner afterwards (factory_set_owner does not look at the
  --      list) never answers: Ana, still in the list, gets 42501 on every person function and the
  --      project leaves her decision_projects; her calls write nothing. Before the promotion she has
  --      the project, so the check proves something.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  if public.decision_projects() is distinct from jsonb_build_array(jsonb_build_object(
       'project_id', v_project_id, 'slug', v_slug, 'name', 'DC Check Project')) then
    raise exception 'decisions (14): before the promotion, Ana does not have the project';
  end if;
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  v_res := public.factory_set_owner(v_slug, v_ana, null);
  perform set_config('role', v_admin, true);
  if v_res is distinct from jsonb_build_object('project_exists', true, 'member_id', v_ana_id)
     or (select role from public.project_members where id = v_ana_id) is distinct from 'owner'
     or not exists (select 1 from public.decision_audience
                    where project_id = v_project_id and member_id = v_ana_id) then
    raise exception 'decisions (14): Ana was not promoted while still in the list: %', v_res;
  end if;
  v_before := jsonb_build_object(
    'answers', (select count(*) from public.decision_answers where member_id = v_ana_id),
    'proposals', (select count(*) from public.decision_proposals where member_id = v_ana_id),
    'opens', (select jsonb_agg(to_jsonb(o)) from public.decision_opens o where o.member_id = v_ana_id));
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  foreach v_fn in array array['my_decisions', 'answer_decision', 'mark_decisions_opened', 'propose_decision'] loop
    begin
      case v_fn
        when 'my_decisions' then perform public.my_decisions(v_project_id);
        when 'answer_decision' then perform public.answer_decision(v_project_id, v_k4, v_v4, 'yes', null);
        when 'mark_decisions_opened' then perform public.mark_decisions_opened(v_project_id);
        when 'propose_decision' then perform public.propose_decision(v_project_id, 'Ana, ya responsable, propone');
      end case;
      raise exception 'decisions (14): Ana, promoted to owner, could call %', v_fn;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  v_res := public.decision_projects();
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_res is distinct from '[]'::jsonb then
    raise exception 'decisions (14): Ana, promoted to owner, still gets decision projects: %', v_res;
  end if;
  if jsonb_build_object(
       'answers', (select count(*) from public.decision_answers where member_id = v_ana_id),
       'proposals', (select count(*) from public.decision_proposals where member_id = v_ana_id),
       'opens', (select jsonb_agg(to_jsonb(o)) from public.decision_opens o where o.member_id = v_ana_id))
     is distinct from v_before then
    raise exception 'decisions (14): Ana''s refused calls wrote something';
  end if;
  v_checks := v_checks + 1;

  -- (15) A point whose version returns to an earlier one: Carla said yes on dc-check-other's point on
  --      v_vo, then no on v_vo2, and the point goes back to v_vo. Her latest answer overall is the no on
  --      v_vo2, not on the current version, so the counts take her as none (never her older yes on
  --      v_vo), as her entry in people (latest no, current false) and her own my_decisions (changed)
  --      say. Dora, in the list, never answered: none too.
  update public.decision_answers set created_at = now() - interval '9 minutes' where id = v_c1;
  perform set_config('role', 'service_role', true);
  perform public.factory_publish_decisions(v_other_slug, null,
    jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo2, 'title', 'Otro punto',
                                         'decided', 'Se decidió otro, de otra forma.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                      jsonb_build_object('display_name', 'Dora Nueva', 'email', v_dora)), false);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  v_res := public.answer_decision(v_other_id, v_ko, v_vo2, 'no', 'dc-check Carla ya no está de acuerdo');
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  update public.decision_answers set created_at = now() - interval '5 minutes' where id = (v_res ->> 'id')::uuid;
  perform set_config('role', 'service_role', true);
  perform public.factory_publish_decisions(v_other_slug, null,
    jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo, 'title', 'Otro punto',
                                         'decided', 'Se decidió otro.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla),
                      jsonb_build_object('display_name', 'Dora Nueva', 'email', v_dora)), false);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_pia)::text, true);
  v_res := public.owner_decisions(v_other_id);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  v_before := public.my_decisions(v_other_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select version from public.decision_points where project_id = v_other_id and key = v_ko)
       is distinct from v_vo
     or (select count(*) from public.decision_answers where member_id = v_carla_id and point_key = v_ko) <> 2 then
    raise exception 'decisions (15): the point did not go back to its earlier version, or Carla''s two answers are not kept';
  end if;
  v_elem := v_res -> 'points' -> 0;
  if jsonb_array_length(v_res -> 'points') <> 1
     or v_elem ->> 'version' is distinct from v_vo
     or v_elem -> 'counts' is distinct from '{"yes": 0, "change": 0, "no": 0, "unsure": 0, "none": 2}'::jsonb then
    raise exception 'decisions (15): back on an earlier version, the counts take an older answer: %', v_elem;
  end if;
  select t.e into v_elem from jsonb_array_elements(v_res -> 'points' -> 0 -> 'people') as t(e)
  where t.e ->> 'member_id' = v_carla_id::text;
  if v_elem -> 'latest' ->> 'value' is distinct from 'no'
     or v_elem -> 'latest' ->> 'version' is distinct from v_vo2
     or v_elem -> 'latest' -> 'current' is distinct from 'false'::jsonb
     or jsonb_array_length(v_elem -> 'history') <> 2 then
    raise exception 'decisions (15): Carla''s entry in owner_decisions is %', v_elem;
  end if;
  if v_before -> 'points' -> 0 ->> 'mark' is distinct from 'changed'
     or v_before -> 'points' -> 0 -> 'answer' ->> 'value' is distinct from 'no'
     or v_before -> 'points' -> 0 -> 'answer' ->> 'version' is distinct from v_vo2 then
    raise exception 'decisions (15): Carla sees %', v_before -> 'points' -> 0;
  end if;
  v_checks := v_checks + 1;

  if v_checks <> 15 then
    raise exception 'decisions: only % of 15 checks ran', v_checks;
  end if;
  raise notice 'decisions: ok % checks', v_checks;
end
$check$;

select 'decisions: ok 15 checks' as result;

rollback;
