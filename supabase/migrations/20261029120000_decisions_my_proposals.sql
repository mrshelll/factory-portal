-- Decisiones: the person sees what they proposed. my_decisions also returns the caller's own
-- proposals for the project (what they wrote under «¿Falta algo?»), oldest first, so the page can say
-- «Lo que propusiste» when they come back (the manual's FOR-09, «retomar donde quedaste»; answered
-- points already say when and what).
--
-- Replaces public.my_decisions(uuid) only: same signature, same security (security definer, empty
-- search_path), same grant (execute for authenticated only). Every field it returned before stays as
-- it was (last_opened_at, points with key, version, position, title, decided, basis, mark and
-- answer); it adds proposals: [{id, text, created_at}], only the caller's own, never anybody else's
-- and never an email. 42501 when the caller is not in the list, as before (private.audience_member_id).
-- Builds on 20261028120000_decisions.sql, which stays as applied. Safe to re-run: create or replace,
-- then the same revoke and grant.

-- ---------------------------------------------------------------------------------------------
-- my_decisions: the active points of the project, in display order, each with the caller's own
-- newest answer (any version; newest by (created_at, id)) and its mark:
--   confirmed  the newest answer is yes, on the current version;
--   changed    the newest answer (any value) is on another version: the point changed since;
--   new        no answer, and the point entered the section after the caller last opened it (or
--              the caller never opened it);
--   none       otherwise.
-- And the caller's own proposals for the project, oldest first (by (created_at, id)): id, text and
-- created_at. Only the caller's answers and proposals: never anybody else's. 42501 when the caller
-- is not in the list.
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
  v_proposals jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', dp.id,
           'text', dp.text,
           'created_at', dp.created_at)
         order by dp.created_at, dp.id), '[]'::jsonb)
  into v_proposals
  from public.decision_proposals dp
  where dp.project_id = p_project_id and dp.member_id = v_member_id;

  return jsonb_build_object('last_opened_at', v_last_opened_at, 'points', v_points, 'proposals', v_proposals);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Grant, as in 20261028120000_decisions.sql: revoke first (Supabase default privileges and PUBLIC),
-- then execute for authenticated only.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.my_decisions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_decisions(uuid) to authenticated;

-- PostgREST reads the schema once: reload it so the new result is served at once.
notify pgrst, 'reload schema';
