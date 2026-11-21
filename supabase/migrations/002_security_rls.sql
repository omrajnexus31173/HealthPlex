-- HEALTHPLEX :: 002 security, RLS, secure RPCs
-- Principles:
--  * attendance & biometric data are never writable directly from the browser
--  * kiosk identity resolved by device key (hashed) through SECURITY DEFINER RPCs
--  * recognition templates readable only by the service role
--  * all administrative mutations are audited

create or replace function public.current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','gym_admin') from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_gym_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','gym_admin','gym_staff','trainer') from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_trainer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','gym_admin','trainer') from profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------- audit helper
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb default null, p_after jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, actor_role, action, entity, entity_id, before, after)
  values (auth.uid(), (select role from profiles where id = auth.uid()), p_action, p_entity, p_entity_id, p_before, p_after);
end $$;

-- ================================================================= RLS
alter table profiles enable row level security;
alter table students enable row level security;
alter table departments enable row level security;
alter table staff enable row level security;
alter table trainers enable row level security;
alter table gym_shifts enable row level security;
alter table trainer_schedules enable row level security;
alter table gym_settings enable row level security;
alter table kiosk_devices enable row level security;
alter table face_templates enable row level security;
alter table face_enrollment_audit enable row level security;
alter table attendance_records enable row level security;
alter table attendance_attempts enable row level security;
alter table equipment enable row level security;
alter table equipment_maintenance enable row level security;
alter table training_sessions enable row level security;
alter table session_bookings enable row level security;
alter table session_attendance enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table attendance_monthly_summary enable row level security;
alter table attendance_monthly_student_summary enable row level security;
alter table attendance_monthly_department_summary enable row level security;
alter table attendance_monthly_hourly_summary enable row level security;
alter table cleanup_runs enable row level security;
alter table cleanup_backups enable row level security;
alter table retention_settings_audit enable row level security;

-- profiles
create policy profiles_self_read on profiles for select to authenticated using (id = auth.uid());
create policy profiles_staff_read on profiles for select to authenticated using (is_gym_staff());
create policy profiles_admin_write on profiles for update to authenticated using (is_admin()) with check (is_admin());
create policy profiles_self_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- students
create policy students_self_read on students for select to authenticated using (id = auth.uid());
create policy students_staff_read on students for select to authenticated using (is_gym_staff());
create policy students_admin_write on students for all to authenticated using (is_admin()) with check (is_admin());
create policy students_self_update on students for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- reference data
create policy departments_read on departments for select to authenticated using (true);
create policy departments_admin_write on departments for all to authenticated using (is_admin()) with check (is_admin());

create policy shifts_read on gym_shifts for select to authenticated using (true);
create policy shifts_admin_write on gym_shifts for all to authenticated using (is_admin()) with check (is_admin());

create policy schedules_read on trainer_schedules for select to authenticated using (true);
create policy schedules_admin_write on trainer_schedules for all to authenticated using (is_trainer()) with check (is_trainer());

create policy staff_read on staff for select to authenticated using (is_gym_staff());
create policy staff_admin_write on staff for all to authenticated using (is_admin()) with check (is_admin());

create policy trainers_read on trainers for select to authenticated using (true);
create policy trainers_admin_write on trainers for all to authenticated using (is_admin()) with check (is_admin());

create policy settings_read on gym_settings for select to authenticated using (true);
create policy settings_admin_write on gym_settings for update to authenticated using (is_admin()) with check (is_admin());

-- kiosk devices: never exposed in detail to browsers; admins manage through API
create policy kiosk_read on kiosk_devices for select to authenticated using (is_admin());

-- biometrics: readable only by service role
create policy face_templates_service_only on face_templates for select to service_role using (true);
create policy face_audit_staff_read on face_enrollment_audit for select to authenticated using (is_admin());

-- attendance
create policy attendance_self_read on attendance_records for select to authenticated using (student_id = auth.uid());
create policy attendance_staff_read on attendance_records for select to authenticated using (is_gym_staff());
-- NOTE: no insert/update/delete policies => browser cannot write attendance directly.

create policy attempts_staff_read on attendance_attempts for select to authenticated using (is_admin());

-- equipment
create policy equipment_read on equipment for select to authenticated using (is_gym_staff());
create policy equipment_write on equipment for all to authenticated using (is_admin()) with check (is_admin());
create policy maintenance_read on equipment_maintenance for select to authenticated using (is_gym_staff());
create policy maintenance_write on equipment_maintenance for all to authenticated using (is_admin()) with check (is_admin());
create policy maintenance_report on equipment_maintenance for insert to authenticated with check (is_trainer());

-- sessions
create policy sessions_read on training_sessions for select to authenticated using (true);
create policy sessions_write on training_sessions for all to authenticated using (is_trainer()) with check (is_trainer());

create policy bookings_self_read on session_bookings for select to authenticated using (student_id = auth.uid() or is_gym_staff());
create policy bookings_self_insert on session_bookings for insert to authenticated with check (student_id = auth.uid());
create policy bookings_self_cancel on session_bookings for update to authenticated using (student_id = auth.uid() or is_admin()) with check (student_id = auth.uid() or is_admin());

create policy session_attendance_read on session_attendance for select to authenticated using (student_id = auth.uid() or is_gym_staff());
create policy session_attendance_write on session_attendance for all to authenticated using (is_trainer()) with check (is_trainer());

-- notifications
create policy notifications_read on notifications for select to authenticated
  using (user_id = auth.uid() or (user_id is null and role = current_role_name()) or is_admin());
create policy notifications_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_admin_write on notifications for all to authenticated using (is_admin()) with check (is_admin());

-- audit: admins only, append-only through definer functions
create policy audit_read on audit_logs for select to authenticated using (is_admin());

-- summaries: staff read; writes are server-side only
create policy ms_read on attendance_monthly_summary for select to authenticated using (is_gym_staff());
create policy mss_read on attendance_monthly_student_summary for select to authenticated using (student_id = auth.uid() or is_gym_staff());
create policy msd_read on attendance_monthly_department_summary for select to authenticated using (is_gym_staff());
create policy msh_read on attendance_monthly_hourly_summary for select to authenticated using (is_gym_staff());

-- retention metadata: super admin only
create policy cleanup_runs_read on cleanup_runs for select to authenticated using (is_super_admin());
create policy cleanup_backups_read on cleanup_backups for select to authenticated using (is_super_admin());
create policy retention_audit_read on retention_settings_audit for select to authenticated using (is_super_admin());

-- ============================================ harden direct table privileges
revoke all on face_templates from anon, authenticated;
revoke insert, update, delete on attendance_records from anon, authenticated;
revoke insert, update, delete on attendance_attempts from anon, authenticated;
revoke insert, update, delete on audit_logs from anon, authenticated;
revoke insert, update, delete on attendance_monthly_summary from anon, authenticated;
revoke insert, update, delete on attendance_monthly_student_summary from anon, authenticated;
revoke insert, update, delete on attendance_monthly_department_summary from anon, authenticated;
revoke insert, update, delete on attendance_monthly_hourly_summary from anon, authenticated;
revoke insert, update, delete on cleanup_runs from anon, authenticated;
revoke insert, update, delete on cleanup_backups from anon, authenticated;
revoke insert, update, delete on attendance_records from authenticated;
revoke insert, update, delete on kiosk_devices from anon, authenticated;
revoke insert, update, delete on notifications from anon, authenticated;
revoke insert, update, delete on session_attendance from anon, authenticated;
revoke select on profiles from anon;
revoke select on students from anon;

-- column level guards: a student may only change safe profile fields
revoke update on profiles from authenticated;
grant update (full_name, phone, avatar_path) on profiles to authenticated;

revoke update on students from authenticated;
grant update (program, emergency_contact) on students to authenticated;

-- role/status escalation guard
create or replace function guard_profile_privileges() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status) and not is_admin() then
    raise exception 'Only administrators can change role or account status';
  end if;
  if (new.id is distinct from old.id) then raise exception 'profile id is immutable'; end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles for each row execute function guard_profile_privileges();

create or replace function guard_student_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and (new.enrollment_id is distinct from old.enrollment_id
      or new.department_id is distinct from old.department_id
      or new.academic_year is distinct from old.academic_year
      or new.face_enrolled is distinct from old.face_enrolled
      or new.face_consent is distinct from old.face_consent
      or new.gym_pin_hash is distinct from old.gym_pin_hash
      or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Field is managed by gym administration';
  end if;
  return new;
end $$;
create trigger students_guard before update on students for each row execute function guard_student_fields();

-- =================================================== kiosk RPC (device keyed)
create or replace function kiosk_students(p_code text)
returns table (student_id uuid, full_name text, enrollment_id text, photo_path text, account_status account_status, face_enrolled boolean, has_template boolean)
language plpgsql volatile security definer set search_path = public as $$
declare v_device uuid;
begin
  select id into v_device from kiosk_devices
   where code_hash = encode(sha256(convert_to(p_code,'UTF8')),'hex') and status = 'active';
  if v_device is null then raise exception 'KIOSK_UNAUTHORIZED' using errcode = '28000'; end if;
  update kiosk_devices set last_seen_at = now() where id = v_device;
  return query
    select s.id, p.full_name, s.enrollment_id, s.photo_path, p.status, s.face_enrolled,
           exists(select 1 from face_templates ft where ft.student_id = s.id and ft.status = 'granted')
      from students s join profiles p on p.id = s.id
     where s.deleted_at is null
       and exists(select 1 from face_templates ft where ft.student_id = s.id and ft.status = 'granted')
     order by p.full_name;
end $$;

create or replace function kiosk_attempt(
  p_code text, p_student uuid, p_result attempt_result, p_confidence numeric default null,
  p_second_best numeric default null, p_liveness numeric default null, p_faces smallint default null,
  p_reason text default null, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_device uuid;
begin
  select id into v_device from kiosk_devices
   where code_hash = encode(sha256(convert_to(p_code,'UTF8')),'hex') and status = 'active';
  if v_device is null then raise exception 'KIOSK_UNAUTHORIZED' using errcode = '28000'; end if;
  insert into attendance_attempts (student_id, device_id, result, confidence, second_best, liveness_score, faces_detected, reason, meta)
  values (p_student, v_device, p_result, p_confidence, p_second_best, p_liveness, p_faces, p_reason, p_meta);
end $$;

create or replace function kiosk_scan(
  p_code text, p_student uuid, p_confidence numeric default null,
  p_liveness numeric default null, p_faces smallint default null, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device uuid; v_settings gym_settings; v_profile profiles; v_student students;
  v_open attendance_records; v_last attendance_records; v_now timestamptz := clock_timestamp();
  v_date date; v_action text; v_rec attendance_records; v_inside integer;
begin
  select * into v_settings from gym_settings where id;
  select id into v_device from kiosk_devices
   where code_hash = encode(sha256(convert_to(p_code,'UTF8')),'hex') and status = 'active';
  if v_device is null then raise exception 'KIOSK_UNAUTHORIZED' using errcode = '28000'; end if;
  update kiosk_devices set last_seen_at = v_now where id = v_device;

  select p.* into v_profile from profiles p where p.id = p_student;
  select s.* into v_student from students s where s.id = p_student;
  if v_student.id is null then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason, meta)
    values (null, v_device, 'unknown_face', p_confidence, p_liveness, p_faces, 'no_student_record', p_meta);
    return jsonb_build_object('status','unknown','message','This face is not registered for gym attendance.');
  end if;
  if v_profile.status <> 'active' or v_student.deleted_at is not null then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'inactive_student', p_confidence, p_liveness, p_faces, 'account ' || v_profile.status::text);
    return jsonb_build_object('status','inactive','message','Student account is not active. Please contact the gym office.',
      'student', jsonb_build_object('id',v_profile.id,'name',v_profile.full_name,'enrollment',v_student.enrollment_id));
  end if;

  v_date := (v_now at time zone v_settings.timezone)::date;

  select * into v_open from attendance_records
   where student_id = p_student and check_out_at is null and status = 'present'
   order by check_in_at desc limit 1;

  -- duplicate-scan cooldown. The kiosk auto-detects, so a student who lingers in front
  -- of the camera would otherwise create repeated entry records. A scan always closes
  -- an open record (check-out) immediately; a *new* entry is throttled for
  -- cooldown_minutes after the previous visit. The window is configurable in settings.
  select * into v_last from attendance_records
   where student_id = p_student
   order by check_in_at desc limit 1;
  if v_open.id is null and v_last.id is not null
     and v_last.check_in_at > v_now - make_interval(mins => v_settings.cooldown_minutes) then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'cooldown', p_confidence, p_liveness, p_faces, 're-entry within cooldown window');
    return jsonb_build_object('status','cooldown',
      'message','Your last visit was just recorded. Please wait a moment before scanning in again.',
      'student', jsonb_build_object('id',v_profile.id,'name',v_profile.full_name,'enrollment',v_student.enrollment_id,'photo_path',v_student.photo_path),
      'record', to_jsonb(v_last));
  end if;

  if v_settings.entry_exit_enabled and v_open.id is not null then
    v_action := 'exit';
    update attendance_records set
      check_out_at = v_now,
      duration_minutes = greatest(1, floor(extract(epoch from (v_now - v_open.check_in_at))/60)::int),
      exit_source = 'face', status = 'checked_out', updated_at = v_now
     where id = v_open.id returning * into v_rec;
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'success', p_confidence, p_liveness, p_faces, 'check_out');
  else
    v_action := 'entry';
    begin
      insert into attendance_records (student_id, attendance_date, check_in_at, entry_source, device_id, recognition_confidence, liveness_score, status)
      values (p_student, v_date, v_now, 'face', v_device, p_confidence, p_liveness, 'present')
      returning * into v_rec;
    exception when unique_violation then
      insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
      values (p_student, v_device, 'already_marked', p_confidence, p_liveness, p_faces, 'duplicate check-in');
      return jsonb_build_object('status','duplicate','message','Attendance for this scan already exists.',
        'student', jsonb_build_object('id',v_profile.id,'name',v_profile.full_name,'enrollment',v_student.enrollment_id,'photo_path',v_student.photo_path));
    end;
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'success', p_confidence, p_liveness, p_faces, 'check_in');
  end if;

  select count(*) into v_inside from attendance_records where check_out_at is null and status = 'present';

  return jsonb_build_object(
    'status','success','action',v_action,
    'message', case when v_action = 'entry' then 'Attendance marked — welcome to HEALTHPLEX!' else 'Exit recorded — see you next session!' end,
    'student', jsonb_build_object('id',v_profile.id,'name',v_profile.full_name,'enrollment',v_student.enrollment_id,'photo_path',v_student.photo_path,'department_id',v_student.department_id),
    'record', to_jsonb(v_rec),
    'server_time', v_now,
    'inside_count', v_inside,
    'capacity', v_settings.capacity
  );
end $$;

-- manual (non-biometric) attendance verification by gym staff
create or replace function manual_attendance(p_student uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_settings gym_settings; v_student students; v_profile profiles; v_open attendance_records; v_rec attendance_records;
  v_action text; v_inside integer;
begin
  if not is_gym_staff() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_settings from gym_settings where id;
  select * into v_student from students where id = p_student and deleted_at is null;
  select * into v_profile from profiles where id = p_student;
  if v_student.id is null then raise exception 'Student not found'; end if;
  if v_profile.status <> 'active' then raise exception 'Student account is not active'; end if;
  select * into v_open from attendance_records where student_id = p_student and check_out_at is null and status='present' order by check_in_at desc limit 1;
  if v_open.id is not null then
    update attendance_records set check_out_at = now(),
      duration_minutes = greatest(1, floor(extract(epoch from (now() - v_open.check_in_at))/60)::int),
      exit_source = 'manual', status = 'checked_out', marked_by = auth.uid() where id = v_open.id returning * into v_rec;
    v_action := 'exit';
  else
    insert into attendance_records (student_id, attendance_date, check_in_at, entry_source, status, marked_by, correction_reason)
    values (p_student, (now() at time zone v_settings.timezone)::date, now(), 'id_fallback', 'present', auth.uid(), p_reason)
    returning * into v_rec;
    v_action := 'entry';
  end if;
  perform write_audit('attendance.manual_mark','attendance_records', v_rec.id::text, null, to_jsonb(v_rec));
  select count(*) into v_inside from attendance_records where check_out_at is null and status='present';
  return jsonb_build_object('status','success','action',v_action,'record',to_jsonb(v_rec),'inside_count',v_inside);
end $$;

create or replace function correct_attendance(p_record uuid, p_check_in timestamptz, p_check_out timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before attendance_records; v_after attendance_records;
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'A correction reason is required'; end if;
  select * into v_before from attendance_records where id = p_record;
  if v_before.id is null then raise exception 'Record not found'; end if;
  update attendance_records set
    check_in_at = coalesce(p_check_in, check_in_at),
    check_out_at = p_check_out,
    duration_minutes = case when p_check_out is not null then greatest(1, floor(extract(epoch from (p_check_out - coalesce(p_check_in, check_in_at)))/60)::int) else null end,
    status = case when p_check_out is not null then 'corrected'::attendance_status else 'present'::attendance_status end,
    marked_by = auth.uid(), correction_reason = p_reason, corrected_at = now()
  where id = p_record returning * into v_after;
  perform write_audit('attendance.correct','attendance_records', p_record::text, to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('reason', p_reason));
  return to_jsonb(v_after);
end $$;

-- ================================================================ analytics
create or replace function dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_tz text; v_today date;
begin
  if not is_gym_staff() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select timezone into v_tz from gym_settings where id;
  v_today := (now() at time zone v_tz)::date;
  select jsonb_build_object(
    'total_students', (select count(*) from students where deleted_at is null),
    'active_students', (select count(*) from students s join profiles p on p.id=s.id where p.status='active' and s.deleted_at is null),
    'face_enrolled', (select count(*) from students where face_enrolled and deleted_at is null),
    'today_visits', (select count(*) from attendance_records where attendance_date = v_today),
    'today_unique', (select count(distinct student_id) from attendance_records where attendance_date = v_today),
    'currently_inside', (select count(*) from attendance_records where check_out_at is null and status='present'),
    'capacity', (select capacity from gym_settings where id),
    'this_month_visits', (select count(*) from attendance_records where attendance_date >= date_trunc('month', v_today)::date),
    'last_month_visits', (select count(*) from attendance_records where attendance_date >= (date_trunc('month', v_today) - interval '1 month')::date and attendance_date < date_trunc('month', v_today)::date),
    'open_faults', (select count(*) from equipment_maintenance where status in ('open','in_progress')),
    'equipment_total', (select count(*) from equipment where status <> 'retired'),
    'equipment_down', (select count(*) from equipment where status in ('maintenance','out_of_service')),
    'upcoming_sessions', (select count(*) from training_sessions where session_date >= v_today and status='scheduled'),
    'unverified_attempts', (select count(*) from attendance_attempts where result in ('unknown_face','liveness_failed','ambiguous_match','low_confidence') and attempted_at > now() - interval '7 days'),
    'attendance_rate', coalesce((select round(100.0 * count(distinct student_id) / greatest((select count(*) from students where deleted_at is null),1), 1) from attendance_records where attendance_date >= v_today - 6), 0)
  ) into v;
  return v;
end $$;

create or replace function attendance_trend(p_days integer default 14)
returns table (day date, visits bigint, unique_students bigint)
language sql stable security definer set search_path = public as $$
  select d::date as day,
         (select count(*) from attendance_records a where a.attendance_date = d::date) as visits,
         (select count(distinct a.student_id) from attendance_records a where a.attendance_date = d::date) as unique_students
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
   where is_gym_staff();
$$;

create or replace function department_stats(p_days integer default 30)
returns table (department text, code text, visits bigint, unique_students bigint, students bigint)
language sql stable security definer set search_path = public as $$
  select d.name, d.code,
         count(a.id) as visits,
         count(distinct a.student_id) as unique_students,
         (select count(*) from students s where s.department_id = d.id and s.deleted_at is null) as students
    from departments d
    left join students s on s.department_id = d.id and s.deleted_at is null
    left join attendance_records a on a.student_id = s.id
      and a.attendance_date >= current_date - (p_days - 1)
   where is_gym_staff()
   group by d.id, d.name, d.code
   order by visits desc;
$$;

create or replace function peak_hours(p_days integer default 30)
returns table (hour integer, visits bigint)
language sql stable security definer set search_path = public as $$
  select extract(hour from (a.check_in_at at time zone (select timezone from gym_settings where id)))::int as hour,
         count(*)::bigint as visits
    from attendance_records a
   where a.attendance_date >= current_date - (p_days - 1) and is_gym_staff()
   group by 1 order by 1;
$$;

-- live feed for monitoring dashboards
create or replace function live_feed(p_limit integer default 20)
returns table (id uuid, student_id uuid, full_name text, enrollment_id text, photo_path text,
               check_in_at timestamptz, check_out_at timestamptz, department text, entry_source attendance_source)
language sql stable security definer set search_path = public as $$
  select a.id, a.student_id, p.full_name, s.enrollment_id, s.photo_path,
         a.check_in_at, a.check_out_at, d.name, a.entry_source
    from attendance_records a
    join students s on s.id = a.student_id
    join profiles p on p.id = s.id
    left join departments d on d.id = s.department_id
   where is_gym_staff()
   order by greatest(a.check_in_at, coalesce(a.check_out_at, a.check_in_at)) desc
   limit p_limit;
$$;

-- student self service stats
create or replace function my_attendance_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date; v_id uuid := auth.uid();
begin
  v_today := (now() at time zone (select timezone from gym_settings where id))::date;
  return jsonb_build_object(
    'total_visits', (select count(*) from attendance_records where student_id = v_id),
    'this_month', (select count(*) from attendance_records where student_id = v_id and attendance_date >= date_trunc('month', v_today)::date),
    'this_week', (select count(*) from attendance_records where student_id = v_id and attendance_date >= (v_today - extract(dow from v_today)::int)),
    'last_visit', (select max(check_in_at) from attendance_records where student_id = v_id),
    'streak_days', (select count(*) from (select distinct attendance_date from attendance_records where student_id = v_id order by attendance_date desc limit 30) t),
    'avg_duration', (select coalesce(round(avg(duration_minutes)),0) from attendance_records where student_id = v_id and duration_minutes is not null),
    'total_minutes', (select coalesce(sum(duration_minutes),0) from attendance_records where student_id = v_id)
  );
end $$;
