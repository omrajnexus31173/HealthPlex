-- HEALTHPLEX :: 006 retention grants for the Super Admin control surface
--
-- run_attendance_cleanup() is SECURITY DEFINER and enforces its own authorisation
-- (manual => is_super_admin() from the caller's JWT, cron => internal session with
-- no JWT claim). It was executable only by postgres/service_role, which meant the
-- Super Admin "run now" button could never reach it. The function's internal guard
-- is the real control, so EXECUTE is granted to authenticated.
--
-- refresh_monthly_summaries() and healthplex_retention_job() stay internal.

grant execute on function public.run_attendance_cleanup(cleanup_mode, text, uuid) to authenticated;
revoke execute on function public.refresh_monthly_summaries(date, date) from authenticated, anon;
revoke execute on function public.healthplex_retention_job() from authenticated, anon;

-- read-only visibility for the Super Admin data-management page (RLS still applies)
grant select on cleanup_runs, cleanup_backups, retention_settings_audit to authenticated;
grant select on attendance_monthly_summary, attendance_monthly_student_summary,
  attendance_monthly_department_summary, attendance_monthly_hourly_summary to authenticated;
