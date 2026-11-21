-- HEALTHPLEX :: 009 revoke PUBLIC execute on browser-reachable RPCs + realtime
--
-- Supersedes the earlier 008_grants_and_realtime attempt, which only revoked EXECUTE
-- from `anon` and was therefore a no-op (see the note below); that file was folded
-- into this one so the migration history contains no ineffective step.
--
-- Also fixed here: the `supabase_realtime` publication had no tables at all, so the
-- live monitor and the notification bell could never receive an event. Both tables
-- are published with `replica identity full` so RLS-checked DELETEs carry the row.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and Supabase also
-- grants `anon`. Revoking from `anon` alone leaves the PUBLIC (`=X/postgres`) entry,
-- so an unauthenticated caller could still invoke the analytics RPCs. Every function
-- that is not a trigger or an internal helper is revoked from PUBLIC and granted
-- explicitly to `authenticated` (and `service_role` for the server routes).

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and p.proname not in (
         'write_audit', 'retention_cutoff_date', 'healthplex_retention_job',
         'refresh_monthly_summaries', 'set_updated_at',
         'guard_profile_privileges', 'guard_student_fields', 'guard_student_delete'
       )
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- trigger functions and internal helpers stay server-only
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.prorettype = 'trigger'::regtype or p.proname in (
         'write_audit', 'retention_cutoff_date', 'healthplex_retention_job',
         'refresh_monthly_summaries', 'set_updated_at'
       ))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to postgres, service_role', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon;
