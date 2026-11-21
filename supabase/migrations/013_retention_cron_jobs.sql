-- 013 — retention_cron_jobs(): let the dashboard report the real schedule
--
-- POSTGRES ROOT CAUSE OF THE /api/admin/retention 500
-- The route read the schedule with `service.schema("cron").from("job")`. The API roles
-- hold SELECT on cron.job but not USAGE on the `cron` schema, so PostgREST could not
-- expose it; the request failed and — because that error was never inspected — the
-- dashboard silently returned `cron: []` while the rest of it rendered.
--
-- The larger failure was elsewhere in the same route: `retention_status()` opens with
-- `IF NOT is_super_admin()` and authorises from `auth.uid()` in the JWT. The route
-- called it with the service-role client, which has no JWT, so it raised FORBIDDEN
-- (42501) and every load of the retention dashboard returned HTTP 500. That is fixed
-- in the route (it now uses the caller's session). This function removes the need to
-- expose the cron schema at all.
--
-- Security: SECURITY DEFINER, callable only by a super admin or a trusted server role,
-- and it returns nothing but the job name/schedule/active flag — no command text, no
-- credentials.

begin;

create or replace function public.retention_cron_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_rows jsonb;
begin
  if not is_super_admin() and not is_trusted_server() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('jobid', jobid, 'jobname', jobname,
                                'schedule', schedule, 'active', active)
             order by jobid
           ),
           '[]'::jsonb
         )
    into v_rows
    from cron.job
   where jobname = 'healthplex-monthly-attendance-retention';

  return v_rows;
exception
  when insufficient_privilege then
    -- never break the dashboard because the scheduler is unreadable
    return '[]'::jsonb;
end $fn$;

revoke execute on function public.retention_cron_jobs() from public, anon;
grant execute on function public.retention_cron_jobs() to authenticated, service_role;

commit;
