-- HEALTHPLEX :: 007 fix refresh_monthly_summaries()
--
-- The original implementation used max(s.department_id); PostgreSQL has no
-- max(uuid) aggregate, so every cleanup execution (which calls this function to
-- preserve aggregates before deletion) failed. It also computed peak_hour with a
-- correlated subquery that referenced an outer aggregate, which is fragile.
-- Rewritten: department is resolved with a deterministic array aggregate, and the
-- peak hour is derived from the hourly summary that the same call writes.

create or replace function public.refresh_monthly_summaries(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tz text; v_students int := 0; v_depts int := 0; v_hours int := 0; v_months int := 0;
begin
  select timezone into v_tz from gym_settings where id;

  -- 1. monthly totals
  insert into attendance_monthly_summary
    (year, month, total_visits, unique_students, total_minutes, avg_duration_minutes, computed_at)
  select extract(year from attendance_date)::smallint,
         extract(month from attendance_date)::smallint,
         count(*), count(distinct student_id),
         coalesce(sum(duration_minutes), 0), round(avg(duration_minutes), 1), now()
    from attendance_records
   where attendance_date >= p_from and attendance_date <= p_to
   group by 1, 2
  on conflict (year, month) do update set
    total_visits = excluded.total_visits,
    unique_students = excluded.unique_students,
    total_minutes = excluded.total_minutes,
    avg_duration_minutes = excluded.avg_duration_minutes,
    computed_at = now();
  get diagnostics v_months = row_count;

  -- 2. per-student monthly summary (department taken deterministically)
  insert into attendance_monthly_student_summary
    (student_id, year, month, department_id, visits, total_minutes, first_visit, last_visit)
  select a.student_id,
         extract(year from a.attendance_date)::smallint,
         extract(month from a.attendance_date)::smallint,
         (array_agg(s.department_id) filter (where s.department_id is not null))[1],
         count(*), coalesce(sum(a.duration_minutes), 0), min(a.check_in_at), max(a.check_in_at)
    from attendance_records a
    left join students s on s.id = a.student_id
   where a.attendance_date >= p_from and a.attendance_date <= p_to
   group by a.student_id, 2, 3
  on conflict (student_id, year, month) do update set
    visits = excluded.visits,
    total_minutes = excluded.total_minutes,
    department_id = excluded.department_id,
    first_visit = excluded.first_visit,
    last_visit = excluded.last_visit;
  get diagnostics v_students = row_count;

  -- 3. per-department monthly summary
  insert into attendance_monthly_department_summary (department_id, year, month, visits, unique_students)
  select s.department_id,
         extract(year from a.attendance_date)::smallint,
         extract(month from a.attendance_date)::smallint,
         count(*), count(distinct a.student_id)
    from attendance_records a
    join students s on s.id = a.student_id
   where a.attendance_date >= p_from and a.attendance_date <= p_to
     and s.department_id is not null
   group by s.department_id, 2, 3
  on conflict (department_id, year, month) do update set
    visits = excluded.visits,
    unique_students = excluded.unique_students;
  get diagnostics v_depts = row_count;

  -- 4. hourly distribution (IST)
  insert into attendance_monthly_hourly_summary (year, month, hour, visits)
  select extract(year from attendance_date)::smallint,
         extract(month from attendance_date)::smallint,
         extract(hour from (check_in_at at time zone v_tz))::smallint,
         count(*)
    from attendance_records
   where attendance_date >= p_from and attendance_date <= p_to
   group by 1, 2, 3
  on conflict (year, month, hour) do update set visits = excluded.visits;
  get diagnostics v_hours = row_count;

  -- 5. peak hour per month, derived from the hourly summary (busiest single hour)
  update attendance_monthly_summary m
     set peak_hour = (select h.hour
                        from attendance_monthly_hourly_summary h
                       where h.year = m.year and h.month = m.month
                       order by h.visits desc, h.hour
                       limit 1)
   where exists (select 1 from attendance_monthly_hourly_summary h
                  where h.year = m.year and h.month = m.month);

  return jsonb_build_object('months', v_months, 'students', v_students,
    'departments', v_depts, 'hours', v_hours);
end $$;
