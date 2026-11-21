-- HEALTHPLEX :: 014 automatic attendance duration, daily summaries & reporting
--
-- Implements:
--  * gym_settings.min_presence_minutes — Super-Admin configurable minimum verified
--    gym time per day for a PRESENT classification (default 30 minutes).
--  * gym_holidays — official holidays / closure days, excluded from eligible days.
--  * attendance_daily_summary — one row per student per operating day
--    (PK student_id+attendance_date, so duplicate daily summaries are impossible).
--    Classification: present (>= min_presence_minutes verified), incomplete
--    (open visit pending resolution), absent otherwise.
--  * Operating calendar derives from gym_settings.opening_hours ("closed" = closed)
--    plus holidays, and never counts future days. Absences come from the official
--    calendar, not from calendar days.
--  * attendance_frequency_report() — Super Admin / Gym Admin report RPCs.
--  * attendance_dashboard_stats() — staff dashboard metrics for the current month.
--  * run_attendance_cleanup() now preserves daily summaries (not just monthly)
--    before any detailed records are removed under the retention policy.
--
-- Eligibility rule (matches the rest of the app): students.deleted_at IS NULL and
-- profiles.status = 'active'. Inactive / out-of-eligibility students are excluded.

-- ---------------------------------------------------------------- schema
alter table public.gym_settings
  add column if not exists min_presence_minutes integer not null default 30;
alter table public.gym_settings
  drop constraint if exists gym_settings_min_presence_minutes_check;
alter table public.gym_settings
  add constraint gym_settings_min_presence_minutes_check
  check (min_presence_minutes between 1 and 600);

create table if not exists public.gym_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null check (length(trim(name)) >= 2),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.gym_holidays enable row level security;
revoke insert, update, delete on public.gym_holidays from anon, authenticated;
grant select on public.gym_holidays to authenticated;
drop policy if exists holidays_staff_read on public.gym_holidays;
create policy holidays_staff_read on public.gym_holidays
  for select to authenticated using (public.is_gym_staff());

create table if not exists public.attendance_daily_summary (
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  classification text not null check (classification in ('present', 'absent', 'incomplete')),
  verified_minutes integer not null default 0 check (verified_minutes >= 0),
  resolved_visits integer not null default 0 check (resolved_visits >= 0),
  open_visits integer not null default 0 check (open_visits >= 0),
  computed_at timestamptz not null default now(),
  primary key (student_id, attendance_date)
);
create index if not exists attendance_daily_summary_date_idx
  on public.attendance_daily_summary (attendance_date);
create index if not exists attendance_daily_summary_classification_idx
  on public.attendance_daily_summary (attendance_date, classification);
alter table public.attendance_daily_summary enable row level security;
revoke insert, update, delete on public.attendance_daily_summary from anon, authenticated;
grant select on public.attendance_daily_summary to authenticated;
drop policy if exists daily_summary_staff_read on public.attendance_daily_summary;
create policy daily_summary_staff_read on public.attendance_daily_summary
  for select to authenticated using (public.is_gym_staff());

-- --------------------------------------------------- calendar primitives (internal)
-- Operating weekday numbers (0 = Sunday .. 6 = Saturday) from opening_hours.
create or replace function public.gym_operating_days()
returns integer[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d.ord order by d.ord), array[]::integer[])
    from (values ('mon', 1), ('tue', 2), ('wed', 3), ('thu', 4), ('fri', 5), ('sat', 6), ('sun', 0)) as d(key, ord)
   where lower(coalesce(trim((select opening_hours ->> d.key from gym_settings where id)), 'closed')) not in ('closed', 'off', '');
$$;

-- Is a date an official gym operating day? (past or today, not holiday, weekday enabled)
create or replace function public.is_operating_day(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_date is not null
     and p_date <= (now() at time zone (select timezone from gym_settings where id))::date
     and extract(dow from p_date)::int = any (public.gym_operating_days())
     and not exists (select 1 from gym_holidays h where h.holiday_date = p_date);
$$;

-- The set of operating days in [p_from, p_to], capped at today (IST).
create or replace function public.operating_days_in_range(p_from date, p_to date)
returns table (day date) language sql stable security definer set search_path = public as $$
  select d::date
    from generate_series(p_from, p_to, interval '1 day') as d
   where d::date <= (now() at time zone (select timezone from gym_settings where id))::date
     and extract(dow from d::date)::int = any (public.gym_operating_days())
     and not exists (select 1 from gym_holidays h where h.holiday_date = d::date);
$$;

-- Eligible students: not soft-deleted and account active.
create or replace function public.attendance_eligible_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id
    from students s
    join profiles p on p.id = s.id
   where s.deleted_at is null and p.status = 'active';
$$;

-- ------------------------------------------- aggregation (caller controls range)
-- Recomputes daily summaries for [p_from, p_to] inside the caller's transaction.
-- Resolved (timed) visits contribute verified minutes; open visits never mark a
-- student present or absent — the day is INCOMPLETE until corrected.
create or replace function public.compute_daily_summaries(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_min int;
  v_days int := 0;
  v_rows int := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then
    return jsonb_build_object('days', 0, 'rows', 0);
  end if;
  select min_presence_minutes into v_min from gym_settings where id;

  -- drop stale rows for days that are not operating days in this range
  -- (e.g. a holiday recorded after the fact). Only touches the requested range.
  delete from attendance_daily_summary s
   where s.attendance_date between p_from and p_to
     and s.attendance_date not in (select day from public.operating_days_in_range(p_from, p_to));

  insert into attendance_daily_summary
    (student_id, attendance_date, classification, verified_minutes, resolved_visits, open_visits, computed_at)
  select e.id,
         d.day,
         case
           when coalesce(a.verified_minutes, 0) >= v_min then 'present'
           when coalesce(a.open_visits, 0) > 0 then 'incomplete'
           else 'absent'
         end,
         coalesce(a.verified_minutes, 0),
         coalesce(a.resolved_visits, 0),
         coalesce(a.open_visits, 0),
         now()
    from public.operating_days_in_range(p_from, p_to) as d
    cross join public.attendance_eligible_students() as e(id)
    left join lateral (
      select coalesce(sum(r.duration_minutes) filter (where r.check_out_at is not null), 0)::int as verified_minutes,
             count(*) filter (where r.check_out_at is not null)::int as resolved_visits,
             count(*) filter (where r.check_out_at is null)::int as open_visits
        from attendance_records r
       where r.student_id = e.id and r.attendance_date = d.day
    ) as a on true
  on conflict (student_id, attendance_date) do update set
    classification = excluded.classification,
    verified_minutes = excluded.verified_minutes,
    resolved_visits = excluded.resolved_visits,
    open_visits = excluded.open_visits,
    computed_at = now();
  get diagnostics v_rows = row_count;

  select count(*) into v_days from public.operating_days_in_range(p_from, p_to);
  return jsonb_build_object('days', v_days, 'rows', v_rows, 'min_presence_minutes', v_min);
end $$;

-- ------------------------------------------------------------ report RPC (admin)
create or replace function public.attendance_frequency_report(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_from date;
  v_to date;
  v_cutoff date;
  v_refresh_from date;
  v_days int;
  v_students jsonb;
  v_overall jsonb;
  v_eligible int;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range';
  end if;
  select timezone into v_tz from gym_settings where id;
  v_today := (now() at time zone v_tz)::date;
  v_from := p_from;
  v_to := least(p_to, v_today);

  -- Recompute only the window where detailed records still exist (retention-safe).
  v_cutoff := public.retention_cutoff_date();
  v_refresh_from := greatest(v_from, v_cutoff);
  if v_refresh_from <= v_to then
    perform public.compute_daily_summaries(v_refresh_from, v_to);
  end if;

  v_days := (select count(*) from public.operating_days_in_range(v_from, v_to));

  with eligible as (
    select s.id,
           s.enrollment_id,
           p.full_name,
           coalesce(d.name, '—') as department,
           coalesce(d.code, '—') as department_code
      from students s
      join profiles p on p.id = s.id
      left join departments d on d.id = s.department_id
     where s.deleted_at is null and p.status = 'active'
  ),
  agg as (
    select e.id,
           e.enrollment_id,
           e.full_name,
           e.department,
           e.department_code,
           count(*) filter (where s.classification = 'present')::int as present_days,
           count(*) filter (where s.classification = 'incomplete')::int as incomplete_visits,
           coalesce(sum(s.verified_minutes), 0)::bigint as total_minutes,
           coalesce(sum(s.resolved_visits), 0)::int as visits
      from eligible e
      left join attendance_daily_summary s
        on s.student_id = e.id
       and s.attendance_date between v_from and v_to
       and s.attendance_date in (select day from public.operating_days_in_range(v_from, v_to))
     group by e.id, e.enrollment_id, e.full_name, e.department, e.department_code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'student_id', a.id,
             'full_name', a.full_name,
             'enrollment_id', a.enrollment_id,
             'department', a.department,
             'department_code', a.department_code,
             'eligible_days', v_days,
             'present_days', a.present_days,
             -- absent is derived from the official calendar: eligible − present − incomplete
             'absent_days', greatest(v_days - a.present_days - a.incomplete_visits, 0),
             'incomplete_visits', a.incomplete_visits,
             'visits', a.visits,
             'attendance_pct', case when v_days = 0 then null
                                    else round(100.0 * a.present_days / v_days, 1) end,
             'total_minutes', a.total_minutes,
             'avg_visit_minutes', case when a.visits = 0 then null
                                       else round(a.total_minutes::numeric / a.visits, 1) end
           ) order by a.full_name, a.enrollment_id), '[]'::jsonb)
    into v_students
    from agg a;

  select count(*) into v_eligible from public.attendance_eligible_students();

  with totals as (
    select coalesce(sum(s.present_days), 0)::bigint as present_days,
           coalesce(sum(s.absent_days), 0)::bigint as absent_days,
           coalesce(sum(s.incomplete_visits), 0)::bigint as incomplete_visits,
           coalesce(sum(s.total_minutes), 0)::bigint as total_minutes,
           coalesce(sum(s.visits), 0)::bigint as visits,
           count(*)::int as students
      from jsonb_to_recordset(v_students) as s(present_days int, absent_days int, incomplete_visits int,
                                               total_minutes bigint, visits int)
  )
  select jsonb_build_object(
           'students', t.students,
           'eligible_days', v_days,
           'student_eligible_days', (v_days::bigint * t.students),
           'present_days', t.present_days,
           'absent_days', t.absent_days,
           'incomplete_visits', t.incomplete_visits,
           'total_minutes', t.total_minutes,
           'visits', t.visits,
           'attendance_pct', case when v_days = 0 or t.students = 0 then null
                                  else round(100.0 * t.present_days / (v_days::bigint * t.students), 1) end,
           'avg_visit_minutes', case when t.visits = 0 then null
                                     else round(t.total_minutes::numeric / t.visits, 1) end
         )
    into v_overall
    from totals t;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'requested_to', p_to,
    'days_eligible', v_days,
    'timezone', v_tz,
    'generated_at', now(),
    'students', v_students,
    'overall', v_overall
  );
end $$;

-- ------------------------------------------------- dashboard stats (staff, month to date)
create or replace function public.attendance_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_month_start date;
  v_cutoff date;
  v_days int;
  v_eligible int;
  v_today_present int; v_today_absent int; v_today_incomplete int;
  v_month jsonb;
  v_departments jsonb;
  v_low jsonb;
  v_avg_visit numeric;
  v_month_present bigint; v_month_total bigint; v_month_visits bigint; v_month_minutes bigint;
begin
  if not public.is_gym_staff() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select timezone into v_tz from gym_settings where id;
  v_today := (now() at time zone v_tz)::date;
  v_month_start := date_trunc('month', v_today)::date;

  -- keep the month window fresh (retention-safe)
  v_cutoff := public.retention_cutoff_date();
  if greatest(v_month_start, v_cutoff) <= v_today then
    perform public.compute_daily_summaries(greatest(v_month_start, v_cutoff), v_today);
  end if;

  v_days := (select count(*) from public.operating_days_in_range(v_month_start, v_today));
  v_eligible := (select count(*) from public.attendance_eligible_students());

  -- today (only when today is an operating day)
  select
    count(*) filter (where s.classification = 'present'),
    count(*) filter (where s.classification = 'absent'),
    count(*) filter (where s.classification = 'incomplete')
    into v_today_present, v_today_absent, v_today_incomplete
    from attendance_daily_summary s
    join students st on st.id = s.student_id and st.deleted_at is null
    join profiles p on p.id = st.id and p.status = 'active'
   where s.attendance_date = v_today;

  -- month aggregates
  select coalesce(sum(s.verified_minutes), 0)::bigint,
         coalesce(sum(s.resolved_visits), 0)::bigint
    into v_month_minutes, v_month_visits
    from attendance_daily_summary s
   where s.attendance_date between v_month_start and v_today;

  select coalesce(sum((s.classification = 'present')::int), 0)::bigint,
         count(*)::bigint
    into v_month_present, v_month_total
    from attendance_daily_summary s
   where s.attendance_date between v_month_start and v_today
     and s.attendance_date in (select day from public.operating_days_in_range(v_month_start, v_today));

  v_avg_visit := case when v_month_visits > 0 then round(v_month_minutes::numeric / v_month_visits, 1) else null end;

  v_month := jsonb_build_object(
    'year', extract(year from v_today)::int,
    'month', extract(month from v_today)::int,
    'from', v_month_start,
    'to', v_today,
    'eligible_days', v_days,
    'student_eligible_days', v_days::bigint * v_eligible,
    'present_student_days', v_month_present,
    'attendance_pct', case when v_days = 0 or v_eligible = 0 then null
                           else round(100.0 * v_month_present / (v_days::bigint * v_eligible), 1) end,
    'total_visits', v_month_visits,
    'avg_visit_minutes', v_avg_visit,
    'summary_rows', v_month_total
  );

  -- department-wise (month to date)
  select coalesce(jsonb_agg(jsonb_build_object(
           'department', x.department,
           'code', x.code,
           'students', x.students,
           'present_days', x.present_days,
           'absent_days', x.absent_days,
           'attendance_pct', case when x.eligible_days_total = 0 or x.students = 0 then null
                                  else round(100.0 * x.present_days / x.eligible_days_total, 1) end
         ) order by x.department), '[]'::jsonb)
    into v_departments
    from (
      select coalesce(d.name, 'Unassigned') as department,
             coalesce(d.code, '—') as code,
             count(distinct e.id)::int as students,
             coalesce(sum((s.classification = 'present')::int), 0)::bigint as present_days,
             coalesce(sum((s.classification = 'absent')::int), 0)::bigint as absent_days,
             (count(distinct e.id)::bigint * v_days) as eligible_days_total
        from students e
        join profiles p on p.id = e.id and p.status = 'active'
        left join departments d on d.id = e.department_id
        left join attendance_daily_summary s
          on s.student_id = e.id
         and s.attendance_date between v_month_start and v_today
         and s.attendance_date in (select day from public.operating_days_in_range(v_month_start, v_today))
       where e.deleted_at is null
       group by 1, 2
    ) x;

  -- students below 50% for the month (with at least one eligible day elapsed)
  with per_student as (
    select e.id, e.enrollment_id, p.full_name,
           coalesce(d.name, '—') as department,
           count(*) filter (where s.classification = 'present')::int as present_days,
           count(*)::int as days_counted
      from students e
      join profiles p on p.id = e.id and p.status = 'active'
      left join departments d on d.id = e.department_id
      join attendance_daily_summary s
        on s.student_id = e.id
       and s.attendance_date between v_month_start and v_today
       and s.attendance_date in (select day from public.operating_days_in_range(v_month_start, v_today))
     where e.deleted_at is null
     group by e.id, e.enrollment_id, p.full_name, d.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', y.id,
           'full_name', y.full_name,
           'enrollment_id', y.enrollment_id,
           'department', y.department,
           'present_days', y.present_days,
           'eligible_days', v_days,
           'attendance_pct', case when v_days = 0 then null
                                  else round(100.0 * y.present_days / v_days, 1) end
         ) order by y.present_days asc, y.full_name), '[]'::jsonb)
    into v_low
    from (
      select id, enrollment_id, full_name, department, present_days
        from per_student
       where v_days > 0
         and (100.0 * present_days / v_days) < 50
       order by present_days asc, full_name
       limit 12
    ) y;

  return jsonb_build_object(
    'timezone', v_tz,
    'generated_at', now(),
    'eligible_students', v_eligible,
    'today', jsonb_build_object(
      'date', v_today,
      'is_operating_day', public.is_operating_day(v_today),
      'eligible_students', v_eligible,
      'present', coalesce(v_today_present, 0),
      'absent', coalesce(v_today_absent, 0),
      'incomplete', coalesce(v_today_incomplete, 0),
      'attendance_pct', case when not public.is_operating_day(v_today) or v_eligible = 0 then null
                             else round(100.0 * coalesce(v_today_present, 0) / v_eligible, 1) end
    ),
    'month', v_month,
    'departments', v_departments,
    'low_attendance', v_low
  );
end $$;

-- ------------------------------------------------------- admin mutations (audited)
create or replace function public.set_gym_holiday(p_date date, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'A holiday date is required'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'A holiday name is required'; end if;

  select to_jsonb(h) into v_before from gym_holidays h where h.holiday_date = p_date;
  insert into gym_holidays (holiday_date, name, created_by)
  values (p_date, trim(p_name), auth.uid())
  on conflict (holiday_date) do update set name = excluded.name;

  -- stale summaries for the new holiday date must not linger
  delete from attendance_daily_summary where attendance_date = p_date;

  perform public.write_audit('gym.holiday_set', 'gym_holidays', p_date::text,
    v_before, jsonb_build_object('holiday_date', p_date, 'name', trim(p_name)));
  return jsonb_build_object('ok', true, 'holiday_date', p_date, 'name', trim(p_name));
end $$;

create or replace function public.remove_gym_holiday(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_cutoff date;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select to_jsonb(h) into v_before from gym_holidays h where h.holiday_date = p_date;
  if v_before is null then raise exception 'No holiday recorded for that date'; end if;
  delete from gym_holidays where holiday_date = p_date;

  -- recompute the reopened day (only where detailed records still exist)
  v_cutoff := public.retention_cutoff_date();
  if p_date >= v_cutoff and p_date <= (now() at time zone (select timezone from gym_settings where id))::date then
    perform public.compute_daily_summaries(p_date, p_date);
  end if;

  perform public.write_audit('gym.holiday_remove', 'gym_holidays', p_date::text, v_before, null);
  return jsonb_build_object('ok', true, 'holiday_date', p_date);
end $$;

create or replace function public.set_min_presence_minutes(p_minutes integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old int;
begin
  if not public.is_super_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 600 then
    raise exception 'Minimum presence must be between 1 and 600 minutes';
  end if;
  select min_presence_minutes into v_old from gym_settings where id;
  update gym_settings set min_presence_minutes = p_minutes where id;
  -- summaries classify against the new threshold from this point on
  perform public.compute_daily_summaries(greatest(date_trunc('month', (now() at time zone (select timezone from gym_settings where id))::date)::date, public.retention_cutoff_date()),
                                         (now() at time zone (select timezone from gym_settings where id))::date);
  perform public.write_audit('settings.min_presence_minutes', 'gym_settings', 'min_presence_minutes',
    jsonb_build_object('min_presence_minutes', v_old),
    jsonb_build_object('min_presence_minutes', p_minutes));
  return jsonb_build_object('ok', true, 'min_presence_minutes', p_minutes, 'previous', v_old);
end $$;

-- --------------------------------------- retention: preserve DAILY summaries too
-- (matches the existing rule that aggregates are written before detailed records
-- are removed; previously only monthly summaries were preserved)
create or replace function public.run_attendance_cleanup(
  p_mode cleanup_mode default 'dry_run',
  p_trigger text default 'manual',
  p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run cleanup_runs; v_settings gym_settings; v_cutoff date; v_candidates int;
  v_payload jsonb; v_checksum text; v_backup uuid; v_stats jsonb; v_daily jsonb; v_deleted int;
  v_verify jsonb; v_verify_checksum text; v_busy int;
  v_first date;
begin
  if p_trigger = 'manual' then
    if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    p_actor := auth.uid();
  elsif p_trigger = 'cron' then
    if auth.uid() is not null or coalesce(auth.role(), '') not in ('', 'service_role') then
      raise exception 'cron trigger requires internal session' using errcode = '42501';
    end if;
  else
    raise exception 'invalid trigger source';
  end if;

  update cleanup_runs set status = 'failed', finished_at = now(),
    error = coalesce(error, 'abandoned run - cleared by the next execution')
  where mode = 'execute' and status = 'running' and started_at < now() - interval '1 hour';

  select count(*) into v_busy from cleanup_runs where mode = 'execute' and status = 'running';
  if v_busy > 0 then
    return jsonb_build_object('aborted', true, 'message',
      'Another cleanup execution is already running. Nothing was deleted.');
  end if;

  select * into v_settings from gym_settings where id;
  v_cutoff := public.retention_cutoff_date();

  insert into cleanup_runs (mode, status, cutoff_date, triggered_by, actor_id)
  values (p_mode, 'running', v_cutoff, p_trigger, p_actor) returning * into v_run;

  select count(*) into v_candidates from attendance_records where attendance_date < v_cutoff;

  if p_mode = 'dry_run' then
    update cleanup_runs set status = 'success', finished_at = now(), candidate_records = v_candidates,
      details = jsonb_build_object('preview', true, 'message',
        v_candidates || ' records older than ' || v_cutoff || ' would be archived and deleted')
    where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'dry_run',
      'candidate_records', v_candidates, 'cutoff_date', v_cutoff, 'deleted', 0);
  end if;

  if not v_settings.retention_enabled or not v_settings.retention_armed then
    update cleanup_runs set status = 'aborted', finished_at = now(), candidate_records = v_candidates,
      error = 'retention policy not armed by super admin' where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'aborted', true,
      'candidate_records', v_candidates, 'cutoff_date', v_cutoff, 'deleted', 0,
      'message', 'Cleanup skipped: retention policy is not enabled/armed.');
  end if;

  if v_candidates = 0 then
    update cleanup_runs set status = 'success', finished_at = now(), candidate_records = 0 where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'deleted', 0,
      'candidate_records', 0, 'cutoff_date', v_cutoff);
  end if;

  -- 1. preserve aggregates BEFORE any deletion (monthly and now daily).
  --    The daily window is clamped to the first recorded visit so historical
  --    absences are not synthesised beyond the known data window.
  select min(attendance_date) into v_first from attendance_records;
  v_stats := public.refresh_monthly_summaries('1900-01-01'::date, v_cutoff - 1);
  v_daily := public.compute_daily_summaries(coalesce(v_first, current_date), v_cutoff - 1);

  -- 2. verified backup snapshot (compact JSON export) before any deletion
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_payload
    from attendance_records a where a.attendance_date < v_cutoff;
  v_checksum := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  insert into cleanup_backups (cutoff_date, record_count, checksum, payload, verified, verified_at, storage_bytes)
  values (v_cutoff, v_candidates, v_checksum, v_payload, true, now(), octet_length(v_payload::text))
  returning id into v_backup;

  select payload into v_verify from cleanup_backups where id = v_backup;
  v_verify_checksum := encode(sha256(convert_to(v_verify::text, 'UTF8')), 'hex');
  if v_verify_checksum is distinct from v_checksum or jsonb_array_length(v_verify) <> v_candidates then
    update cleanup_backups set verified = false where id = v_backup;
    update cleanup_runs set status = 'failed', finished_at = now(), candidate_records = v_candidates,
      backup_id = v_backup, error = 'backup verification failed - deletion aborted' where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'failed', true, 'error', 'backup verification failed');
  end if;

  -- 3. destructive step, guarded by the same cutoff expression
  delete from attendance_records where attendance_date < public.retention_cutoff_date();
  get diagnostics v_deleted = row_count;

  update cleanup_runs set status = 'success', finished_at = now(), candidate_records = v_candidates,
    archived_students = (v_stats->>'students')::int, archived_departments = (v_stats->>'departments')::int,
    archived_hours = (v_stats->>'hours')::int, deleted_records = v_deleted, backup_id = v_backup,
    details = jsonb_build_object('cutoff', v_cutoff, 'checksum', v_checksum, 'summary', v_stats, 'daily_summary', v_daily)
  where id = v_run.id;

  insert into audit_logs (actor_id, actor_role, action, entity, entity_id, after)
  values (p_actor, (select role from profiles where id = p_actor), 'retention.cleanup_execute',
    'attendance_records', v_run.id::text,
    jsonb_build_object('deleted', v_deleted, 'cutoff', v_cutoff, 'backup_id', v_backup, 'daily_summary', v_daily));

  return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'cutoff_date', v_cutoff,
    'candidate_records', v_candidates, 'deleted', v_deleted, 'backup_id', v_backup,
    'backups_verified', true, 'summaries', v_stats, 'daily_summaries', v_daily);
exception when others then
  update cleanup_runs set status = 'failed', finished_at = now(), error = sqlerrm where id = v_run.id;
  raise;
end $$;

-- --------------------------------------------------------------- privileges
-- internal helpers: no direct browser access
revoke execute on function public.gym_operating_days() from public, anon, authenticated;
revoke execute on function public.is_operating_day(date) from public, anon, authenticated;
revoke execute on function public.operating_days_in_range(date, date) from public, anon, authenticated;
revoke execute on function public.attendance_eligible_students() from public, anon, authenticated;
revoke execute on function public.compute_daily_summaries(date, date) from public, anon, authenticated;
-- staff-facing RPCs: authenticated (each one enforces its own role guard)
revoke execute on function public.attendance_frequency_report(date, date) from public, anon;
revoke execute on function public.attendance_dashboard_stats() from public, anon;
revoke execute on function public.set_gym_holiday(date, text) from public, anon;
revoke execute on function public.remove_gym_holiday(date) from public, anon;
revoke execute on function public.set_min_presence_minutes(integer) from public, anon;
grant execute on function public.attendance_frequency_report(date, date) to authenticated, service_role;
grant execute on function public.attendance_dashboard_stats() to authenticated, service_role;
grant execute on function public.set_gym_holiday(date, text) to authenticated, service_role;
grant execute on function public.remove_gym_holiday(date) to authenticated, service_role;
grant execute on function public.set_min_presence_minutes(integer) to authenticated, service_role;

-- ------------------------------------------------- backfill existing history
-- The daily summary is new; materialise it for the window covered by the known
-- attendance data (clamped to the first recorded visit) so historical months are
-- available to reports immediately. Runs inside this migration transaction.
do $$
declare v_first date;
begin
  select min(attendance_date) into v_first from public.attendance_records;
  if v_first is not null then
    perform public.compute_daily_summaries(v_first, (now() at time zone (select timezone from gym_settings where id))::date);
  end if;
end $$;
