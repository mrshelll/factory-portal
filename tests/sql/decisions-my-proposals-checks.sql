-- Checks for my_decisions with the caller's own proposals (migration 20261029120000_decisions_my_proposals.sql,
-- on top of 20261028120000_decisions.sql).
--
-- Run as ONE request against the `factory` database (Supabase MCP execute_sql, or psql as postgres), after the
-- migration; run it again and it passes again. Everything happens inside `begin; ... rollback;`: no data is left
-- behind. Every failure raises an exception; success prints NOTICE "decisions_my_proposals: ok 6 checks" and returns
-- one row with the same text. People are simulated with JWT claims that carry an email and no `sub`, so auth.uid()
-- is null. All names start with dc-check-mp (point keys and versions with dc, which are hex digits) so nothing
-- collides with real data. Inside one transaction now() does not move, so the checks set the proposals' timestamps
-- apart by hand. The tables are not readable by authenticated, so every direct read of them happens back in the
-- admin role.
--
-- People: Ana and Beto are dc-check-mp-project's list, created by the publish (they have nothing but the section);
-- Dora is a client of the project added by hand before the publish, then put in the list (a member who also has
-- the section); Olga owns the project and is never in its list; Carla is the list of dc-check-mp-other.

begin;

do $check$
declare
  v_admin constant text := current_user;
  v_slug constant text := 'dc-check-mp-project';
  v_other_slug constant text := 'dc-check-mp-other';
  v_olga constant text := 'dc-check-mp-olga@example.invalid';
  v_ana constant text := 'dc-check-mp-ana@example.invalid';
  v_beto constant text := 'dc-check-mp-beto@example.invalid';
  v_dora constant text := 'dc-check-mp-dora@example.invalid';
  v_carla constant text := 'dc-check-mp-carla@example.invalid';
  v_k1 constant text := 'dc00000000e1';
  v_v1 constant text := 'dc000000e001';
  v_ko constant text := 'dc00000000f1';
  v_vo constant text := 'dc000000f001';
  v_checks integer := 0;
  v_fn text;
  v_who text;
  v_res jsonb;
  v_project_id uuid;
  v_other_id uuid;
  v_ana_id uuid;
  v_beto_id uuid;
  v_dora_id uuid;
  v_ana_p1 uuid;
  v_ana_p2 uuid;
  v_beto_p1 uuid;
  v_dora_p1 uuid;
begin
  if exists (select 1 from public.projects where slug in (v_slug, v_other_slug)) then
    raise exception 'decisions_my_proposals: project % or % already exists; the checks need them absent',
      v_slug, v_other_slug;
  end if;

  -- The project with Dora as a client first; then one publish to Ana, Beto and Dora; Olga, its owner.
  -- dc-check-mp-other, published to Carla.
  insert into public.projects (slug, name) values (v_slug, 'DC Check MP Project') returning id into v_project_id;
  insert into public.project_members (project_id, email, role, display_name)
  values (v_project_id, v_dora, 'client', 'Dora')
  returning id into v_dora_id;
  perform set_config('role', 'service_role', true);
  perform public.factory_publish_decisions(v_slug, 'DC Check MP Project',
    jsonb_build_array(jsonb_build_object('key', v_k1, 'version', v_v1, 'title', 'Punto uno',
                                         'decided', 'Se decidió uno.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                      jsonb_build_object('display_name', 'Beto', 'email', v_beto),
                      jsonb_build_object('display_name', 'Dora', 'email', v_dora)), false);
  perform public.factory_set_owner(v_slug, v_olga, 'Olga');
  v_res := public.factory_publish_decisions(v_other_slug, 'DC Check MP Other',
    jsonb_build_array(jsonb_build_object('key', v_ko, 'version', v_vo, 'title', 'Otro punto',
                                         'decided', 'Se decidió otro.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Carla', 'email', v_carla)), false);
  perform set_config('role', v_admin, true);
  v_other_id := (v_res ->> 'project_id')::uuid;
  select id into v_ana_id from public.project_members where project_id = v_project_id and email = v_ana;
  select id into v_beto_id from public.project_members where project_id = v_project_id and email = v_beto;
  if v_ana_id is null or v_beto_id is null or v_other_id is null
     or (select role from public.project_members where id = v_dora_id) is distinct from 'client'
     or (select count(*) from public.decision_audience where project_id = v_project_id
         and member_id in (v_ana_id, v_beto_id, v_dora_id)) <> 3 then
    raise exception 'decisions_my_proposals: the fixture is not Ana, Beto and Dora (a client) in the list';
  end if;

  -- (1) Before anyone proposes, Ana's my_decisions keeps every field it had (last_opened_at, points with the eight
  --     fields of a point) and adds proposals, empty.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if (select count(*) from jsonb_object_keys(v_res)) <> 3
     or not v_res ?& array['last_opened_at', 'points', 'proposals']
     or v_res -> 'last_opened_at' is distinct from 'null'::jsonb
     or v_res -> 'proposals' is distinct from '[]'::jsonb
     or jsonb_array_length(v_res -> 'points') <> 1
     or v_res -> 'points' -> 0 is distinct from jsonb_build_object(
          'key', v_k1, 'version', v_v1, 'position', 1, 'title', 'Punto uno', 'decided', 'Se decidió uno.',
          'basis', '[]'::jsonb, 'mark', 'new', 'answer', null) then
    raise exception 'decisions_my_proposals (1): before proposing, Ana sees %', v_res;
  end if;
  v_checks := v_checks + 1;

  -- (2) Ana proposes twice (one with markup and spaces around it), Beto and Dora once each. Ana gets her two, oldest
  --     first, each with exactly id, text (stored trimmed, the markup as written) and created_at; nothing of Beto's
  --     or Dora's, and no email or member id.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_ana_p1 := public.propose_decision(v_project_id, '  Falta el horario <b>nocturno</b>  ');
  v_ana_p2 := public.propose_decision(v_project_id, 'Falta quién avisa');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
  v_beto_p1 := public.propose_decision(v_project_id, 'Lo de Beto');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_dora)::text, true);
  v_dora_p1 := public.propose_decision(v_project_id, 'Lo de Dora');
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  -- now() does not move inside the transaction: the second of Ana's goes first by its time, so the order is the
  -- time's, not the insert's.
  update public.decision_proposals set created_at = now() - interval '2 minutes' where id = v_ana_p2;
  update public.decision_proposals set created_at = now() - interval '1 minute' where id = v_ana_p1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_ana)::text, true);
  v_res := public.my_decisions(v_project_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_res -> 'proposals' is distinct from jsonb_build_array(
       jsonb_build_object('id', v_ana_p2, 'text', 'Falta quién avisa', 'created_at', now() - interval '2 minutes'),
       jsonb_build_object('id', v_ana_p1, 'text', 'Falta el horario <b>nocturno</b>', 'created_at', now() - interval '1 minute'))
     or exists (select 1 from jsonb_array_elements(v_res -> 'proposals') as t(e)
                where (select count(*) from jsonb_object_keys(t.e)) <> 3)
     or v_res::text like '%' || v_beto || '%' or v_res::text like '%Lo de Beto%' or v_res::text like '%Lo de Dora%'
     or v_res::text like '%' || v_ana || '%' then
    raise exception 'decisions_my_proposals (2): Ana sees %', v_res -> 'proposals';
  end if;
  v_checks := v_checks + 1;

  -- (3) Beto, in the list only through the publish, gets his one; Dora, a member who is also in the list, gets hers.
  --     Neither gets Ana's. Both keep the old fields.
  foreach v_who in array array[v_beto, v_dora] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_who)::text, true);
    v_res := public.my_decisions(v_project_id);
    perform set_config('role', v_admin, true);
    perform set_config('request.jwt.claims', '', true);
    if (select count(*) from jsonb_object_keys(v_res)) <> 3
       or jsonb_array_length(v_res -> 'points') <> 1
       or jsonb_array_length(v_res -> 'proposals') <> 1
       or v_res -> 'proposals' -> 0 is distinct from jsonb_build_object(
            'id', case when v_who = v_beto then v_beto_p1 else v_dora_p1 end,
            'text', case when v_who = v_beto then 'Lo de Beto' else 'Lo de Dora' end,
            'created_at', now())
       or v_res::text like '%nocturno%' then
      raise exception 'decisions_my_proposals (3): % sees %', v_who, v_res;
    end if;
  end loop;
  v_checks := v_checks + 1;

  -- (4) Not in the list: Olga, the owner, and Carla, of another project, get 42501 from my_decisions, as before the
  --     migration; Carla's own project shows her nothing of dc-check-mp-project.
  foreach v_who in array array[v_olga, v_carla] loop
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_who)::text, true);
      perform public.my_decisions(v_project_id);
      raise exception 'decisions_my_proposals (4): my_decisions answered %', v_who;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_carla)::text, true);
  v_res := public.my_decisions(v_other_id);
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if v_res -> 'proposals' is distinct from '[]'::jsonb or jsonb_array_length(v_res -> 'points') <> 1 then
    raise exception 'decisions_my_proposals (4): Carla sees in her project %', v_res;
  end if;
  v_checks := v_checks + 1;

  -- (5) Removed from the list by a republish, Beto gets 42501 like anyone outside it; his proposal stays stored.
  perform set_config('role', 'service_role', true);
  perform public.factory_publish_decisions(v_slug, 'DC Check MP Project',
    jsonb_build_array(jsonb_build_object('key', v_k1, 'version', v_v1, 'title', 'Punto uno',
                                         'decided', 'Se decidió uno.', 'basis', '[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('display_name', 'Ana', 'email', v_ana),
                      jsonb_build_object('display_name', 'Dora', 'email', v_dora)), false);
  perform set_config('role', v_admin, true);
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', v_beto)::text, true);
    perform public.my_decisions(v_project_id);
    raise exception 'decisions_my_proposals (5): my_decisions answered Beto out of the list';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', v_admin, true);
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.decision_proposals where id = v_beto_p1) then
    raise exception 'decisions_my_proposals (5): Beto''s proposal is gone';
  end if;
  v_checks := v_checks + 1;

  -- (6) The function keeps its grant: execute for authenticated only (not public, anon or service_role), security
  --     definer with an empty search_path.
  if not has_function_privilege('authenticated', 'public.my_decisions(uuid)', 'execute')
     or has_function_privilege('anon', 'public.my_decisions(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.my_decisions(uuid)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = 'public.my_decisions(uuid)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
     or not (select prosecdef from pg_proc where oid = 'public.my_decisions(uuid)'::regprocedure)
     or not coalesce((select proconfig from pg_proc where oid = 'public.my_decisions(uuid)'::regprocedure)
                     @> array['search_path=""'], false) then
    raise exception 'decisions_my_proposals (6): my_decisions lost its grant or its security';
  end if;
  v_checks := v_checks + 1;

  if v_checks <> 6 then
    raise exception 'decisions_my_proposals: only % of 6 checks ran', v_checks;
  end if;
  raise notice 'decisions_my_proposals: ok % checks', v_checks;
end
$check$;

select 'decisions_my_proposals: ok 6 checks' as result;

rollback;
