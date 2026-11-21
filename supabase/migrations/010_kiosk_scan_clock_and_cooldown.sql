-- 011 — kiosk_scan: event-accurate timestamps + re-entry-only cooldown
--
-- Two production bugs found while testing against the live database:
--
-- 1. Scan timestamps used now(), which in Postgres is the transaction start time.
--    Two scans handled inside a single request/transaction therefore received the
--    same timestamp, a zero-length visit, and a scan that should have been throttled
--    by the cooldown window could slip through. clock_timestamp() is the true
--    wall-clock instant of the scan.
--
-- 2. The cooldown check selected the latest *open* record. Because an open record is
--    also what triggers check-out, the check was unreachable: a student could not be
--    throttled at all, so a lingering face in front of the camera created a tight
--    create/close loop. The window now applies to the latest visit of any kind and
--    only gates a *new entry*; closing an open record (check-out) is always allowed.
--
-- Behaviour after this migration:
--   entry -> check-out -> immediate third scan = "cooldown", no phantom record
--   entry -> exit -> wait cooldown_minutes -> entry = allowed
--
-- Replaces the definition last set by 002_security_rls.sql. Idempotent.
-- NOTE: applied to the project before this file was added to the repo, i.e. the
-- project's applied_migration history lists it as `kiosk_scan_clock_and_cooldown`.

begin;

create or replace function public.kiosk_scan(
  p_code text,
  p_student uuid,
  p_confidence numeric default null,
  p_liveness numeric default null,
  p_faces smallint default null,
  p_meta jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_device uuid; v_settings gym_settings; v_profile profiles; v_student students;
  v_open attendance_records; v_last attendance_records;
  v_now timestamptz := clock_timestamp();   -- (1) real scan instant, not tx start
  v_date date; v_action text; v_rec attendance_records; v_inside integer;
begin
  select * into v_settings from gym_settings where id;

  select id into v_device
    from kiosk_devices
   where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
     and status = 'active';
  if v_device is null then
    raise exception 'KIOSK_UNAUTHORIZED' using errcode = '28000';
  end if;
  update kiosk_devices set last_seen_at = v_now where id = v_device;

  select p.* into v_profile from profiles p where p.id = p_student;
  select s.* into v_student from students s where s.id = p_student;

  if v_student.id is null then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason, meta)
    values (null, v_device, 'unknown_face', p_confidence, p_liveness, p_faces, 'no_student_record', p_meta);
    return jsonb_build_object('status', 'unknown', 'message', 'This face is not registered for gym attendance.');
  end if;

  if v_profile.status <> 'active' or v_student.deleted_at is not null then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'inactive_student', p_confidence, p_liveness, p_faces, 'account ' || v_profile.status::text);
    return jsonb_build_object(
      'status', 'inactive',
      'message', 'Student account is not active. Please contact the gym office.',
      'student', jsonb_build_object('id', v_profile.id, 'name', v_profile.full_name, 'enrollment', v_student.enrollment_id));
  end if;

  v_date := (v_now at time zone v_settings.timezone)::date;

  select * into v_open
    from attendance_records
   where student_id = p_student and check_out_at is null and status = 'present'
   order by check_in_at desc limit 1;

  -- (2) throttle re-entry only; a scan that closes an open record is always honoured
  select * into v_last
    from attendance_records
   where student_id = p_student
   order by check_in_at desc limit 1;
  if v_open.id is null and v_last.id is not null
     and v_last.check_in_at > v_now - make_interval(mins => v_settings.cooldown_minutes) then
    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'cooldown', p_confidence, p_liveness, p_faces, 're-entry within cooldown window');
    return jsonb_build_object(
      'status', 'cooldown',
      'message', 'Your last visit was just recorded. Please wait a moment before scanning in again.',
      'student', jsonb_build_object('id', v_profile.id, 'name', v_profile.full_name,
                                    'enrollment', v_student.enrollment_id, 'photo_path', v_student.photo_path),
      'record', to_jsonb(v_last));
  end if;

  if v_settings.entry_exit_enabled and v_open.id is not null then
    v_action := 'exit';
    update attendance_records
       set check_out_at = v_now,
           duration_minutes = greatest(1, floor(extract(epoch from (v_now - v_open.check_in_at)) / 60)::int),
           exit_source = 'face',
           status = 'checked_out',
           updated_at = v_now
     where id = v_open.id
    returning * into v_rec;

    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'success', p_confidence, p_liveness, p_faces, 'check_out');
  else
    v_action := 'entry';
    begin
      insert into attendance_records
        (student_id, attendance_date, check_in_at, entry_source, device_id, recognition_confidence, liveness_score, status)
      values
        (p_student, v_date, v_now, 'face', v_device, p_confidence, p_liveness, 'present')
      returning * into v_rec;
    exception when unique_violation then
      insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
      values (p_student, v_device, 'already_marked', p_confidence, p_liveness, p_faces, 'duplicate check-in');
      return jsonb_build_object(
        'status', 'duplicate',
        'message', 'Attendance for this scan already exists.',
        'student', jsonb_build_object('id', v_profile.id, 'name', v_profile.full_name,
                                      'enrollment', v_student.enrollment_id, 'photo_path', v_student.photo_path));
    end;

    insert into attendance_attempts (student_id, device_id, result, confidence, liveness_score, faces_detected, reason)
    values (p_student, v_device, 'success', p_confidence, p_liveness, p_faces, 'check_in');
  end if;

  select count(*) into v_inside
    from attendance_records where check_out_at is null and status = 'present';

  return jsonb_build_object(
    'status', 'success',
    'action', v_action,
    'message', case when v_action = 'entry'
                    then 'Attendance marked - welcome to HEALTHPLEX!'
                    else 'Exit recorded - see you next session!' end,
    'student', jsonb_build_object('id', v_profile.id, 'name', v_profile.full_name,
                                  'enrollment', v_student.enrollment_id, 'photo_path', v_student.photo_path,
                                  'department_id', v_student.department_id),
    'record', to_jsonb(v_rec), 'server_time', v_now,
    'inside_count', v_inside, 'capacity', v_settings.capacity);
end $fn$;

-- kiosk_scan is called by the server route with the service role; authenticated is
-- granted because the RPC re-validates the device key itself.
revoke execute on function public.kiosk_scan(text, uuid, numeric, numeric, smallint, jsonb) from public, anon;
grant execute on function public.kiosk_scan(text, uuid, numeric, numeric, smallint, jsonb) to authenticated, service_role;

commit;
