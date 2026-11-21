-- 012 — monthly retention cron: the day guard could never be true
--
-- The job ran on days 28–31 and then compared today with the *first* day of the next
-- month:
--
--     (date_trunc('month', now()) + interval '1 month')::date   -- always the 1st
--
-- so on every day the job is allowed to fire the comparison was false and
-- healthplex_retention_job() never executed. Retention would silently never run.
-- The guard must select the LAST day of the month instead. Verified: for 2026-11-28
-- .. 2026-12-01 the old expression is false on all four days and the new one is true
-- on 2026-11-30 only, which is exactly when the job should act.
--
-- The job is recreated (not patched) so the definition in this file is the single
-- source of truth; jobid changes because cron.schedule allocates a new one.

begin;

-- remove any previous incarnation of this job by name, whatever its id
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'healthplex-monthly-attendance-retention'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'healthplex-monthly-attendance-retention',
  '0 21 28-31 * *',
  $job$
  select case when (now() at time zone 'Asia/Kolkata')::date
                 = (date_trunc('month', (now() at time zone 'Asia/Kolkata'))
                    + interval '1 month' - interval '1 day')::date
              then healthplex_retention_job() end;
  $job$
);

commit;
